"""
Clip analysis report — turn a short match clip into player indicators.

Designed for ~4-minute test clips on CPU (no GPU):
  1. Segmentation (audio + motion) → rallies.
  2. Person detection (torchvision) only on frames inside rallies, ~4 fps.
  3. Court filter via homography: detections whose feet land outside the
     court (+margin) are discarded — removes spectators/referee.
  4. Greedy tracking → 4 stable player tracks (fragments merged by proximity).
  5. Projection to court metres → per player: distance, speeds, heatmap,
     zone occupancy (rede / meio / fundo, linha de serviço).
  6. Audio onset detection → hits ("pancadas") per rally, attributed to the
     player with the strongest movement spike (team-alternation constrained —
     experimental).

Output: a JSON-serialisable dict (saved as report.json in output_dir).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import time
import wave
from pathlib import Path

import numpy as np

from padelpro_vision.constants.court import (
    COURT_LENGTH_M,
    COURT_WIDTH_M,
    SERVICE_LINE_FROM_BACK_M,
)

logger = logging.getLogger(__name__)

NET_Y = COURT_LENGTH_M / 2.0                          # 10.0 m
SERVICE_LINE_FROM_NET = NET_Y - SERVICE_LINE_FROM_BACK_M  # 3.05 m
ZONE_FUNDO_FROM_NET = 7.0                             # last 3 m before the glass

# Court-filter margins (asymmetric): sideways/near-camera tolerance is loose,
# but beyond the FAR glass sits the spectator area — anything projecting past
# the far baseline is not a player. Small negative slack absorbs calibration
# error for players touching the back glass.
COURT_MARGIN_X_M = 1.0
COURT_MARGIN_Y_FAR_M = 0.15
COURT_MARGIN_Y_NEAR_M = 1.0
MAX_PLAYER_SPEED = 9.0      # m/s — steps above this are tracking glitches
HEATMAP_ROWS, HEATMAP_COLS = 20, 10

TARGET_FPS = 4.0            # detection sampling rate
DETECT_MIN_SIZE = 640       # torchvision transform min_size (speed knob)

ONSET_MIN_SEP_S = 0.35      # two hits can't be closer than this
ONSET_WINDOW_S = 0.45       # movement-spike window for hit attribution


def analysis_available() -> bool:
    """True when torch/torchvision are importable (analysis can run)."""
    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("torchvision") is not None
    )


# ---------------------------------------------------------------------------
# Audio hits
# ---------------------------------------------------------------------------

def _load_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        raw = wf.readframes(n)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if ch > 1:
        samples = samples.reshape(-1, ch).mean(axis=1)
    return samples / 32768.0, sr


def detect_hits(
    video_path: Path,
    rallies: list[tuple[float, float]],
    work_dir: Path,
) -> list[float]:
    """Return hit timestamps (seconds) inside rallies, from audio onsets."""
    from padelpro_vision.segmentation.segmentation import _extract_audio_wav

    wav_path = work_dir / "_hits.wav"
    if not _extract_audio_wav(video_path, wav_path):
        return []
    try:
        x, sr = _load_wav(wav_path)
    finally:
        try:
            wav_path.unlink()
        except OSError:
            pass
    if len(x) < sr:
        return []

    # Pre-emphasis boosts the sharp transient of a ball impact.
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])

    hop = int(sr * 0.010)
    win = int(sr * 0.030)
    n_frames = max(0, (len(x) - win) // hop)
    if n_frames < 10:
        return []
    idx = np.arange(win)[None, :] + hop * np.arange(n_frames)[:, None]
    env = np.sqrt((x[idx] ** 2).mean(axis=1))           # RMS envelope
    t_env = (np.arange(n_frames) * hop + win / 2) / sr  # seconds

    flux = np.maximum(0.0, np.diff(env, prepend=env[0]))

    in_rally = np.zeros(n_frames, dtype=bool)
    for s_ms, e_ms in rallies:
        in_rally |= (t_env >= s_ms / 1000.0) & (t_env <= e_ms / 1000.0)
    if not in_rally.any():
        return []

    ref = flux[in_rally]
    thr = float(np.percentile(ref, 90)) + 1.5 * float(np.std(ref))

    min_sep = int(ONSET_MIN_SEP_S / 0.010)
    hits: list[float] = []
    last = -min_sep
    for i in range(1, n_frames - 1):
        if not in_rally[i] or flux[i] < thr:
            continue
        if flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1] and i - last >= min_sep:
            hits.append(float(t_env[i]))
            last = i
    return hits


# ---------------------------------------------------------------------------
# Track post-processing
# ---------------------------------------------------------------------------

def _merge_fragments(
    tracks: dict[int, list[tuple[float, float, float, int]]],
) -> dict[int, list[tuple[float, float, float, int]]]:
    """
    Merge track fragments that are plausibly the same player: consecutive in
    time (gap ≤ 25 s, overlap ≤ 0.5 s), close in court space, and on the same
    side of the net (players never cross it). Allowed distance grows with the
    gap — between points a player drifts back to position.
    """
    frags = sorted(tracks.items(), key=lambda kv: kv[1][0][0])
    merged: list[list[tuple[float, float, float, int]]] = []
    for _, pts in frags:
        best = None
        best_d = 1e9
        for m in merged:
            gap = (pts[0][0] - m[-1][0]) / 1000.0
            if not (-0.5 <= gap <= 25.0):
                continue
            same_half = (m[-1][2] < NET_Y) == (pts[0][2] < NET_Y)
            if not same_half:
                continue
            limit = 2.5 + min(3.5, max(0.0, gap) * 0.6)
            d = float(np.hypot(pts[0][1] - m[-1][1], pts[0][2] - m[-1][2]))
            if d <= limit and d < best_d:
                best, best_d = m, d
        if best is not None:
            best.extend(pts)
        else:
            merged.append(list(pts))
    return {i + 1: pts for i, pts in enumerate(merged)}


def _pick_players(
    merged: dict[int, list[tuple[float, float, float, int]]],
) -> list[list[tuple[float, float, float, int]]]:
    """
    Pick the 4 real players: per court half, the 2 candidates with the most
    samples — after dropping "static" tracks (position std < 0.8 m: net posts,
    referee, someone standing courtside).
    """
    cands = []
    for _, pts in merged.items():
        if len(pts) < 8:
            continue
        xs = np.array([p[1] for p in pts])
        ys = np.array([p[2] for p in pts])
        std = float(np.hypot(xs.std(), ys.std()))
        cands.append({"pts": pts, "std": std, "my": float(ys.mean())})

    picked: list[list] = []
    for half in (0, 1):
        pool = [
            c for c in cands
            if (c["my"] < NET_Y) == (half == 0) and c["std"] >= 0.8
        ]
        pool.sort(key=lambda c: -len(c["pts"]))
        if len(pool) < 2:   # fall back to statics rather than report 1 player
            extra = [
                c for c in cands
                if (c["my"] < NET_Y) == (half == 0) and c["std"] < 0.8
            ]
            extra.sort(key=lambda c: -len(c["pts"]))
            pool += extra
        picked.extend(c["pts"] for c in pool[:2])
    return picked


# ---------------------------------------------------------------------------
# Per-player metrics
# ---------------------------------------------------------------------------

def _movement_metrics(pts: list[tuple[float, float, float, int]]) -> dict:
    """Distance / speeds computed within rallies only (no cross-gap jumps)."""
    dist = 0.0
    active_t = 0.0
    speeds: list[float] = []
    for i in range(1, len(pts)):
        if pts[i][3] != pts[i - 1][3]:      # rally boundary
            continue
        dt = (pts[i][0] - pts[i - 1][0]) / 1000.0
        if dt <= 0 or dt > 2.0:
            continue
        step = float(np.hypot(pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
        v = step / dt
        if v > MAX_PLAYER_SPEED:            # ID switch / glitch
            continue
        dist += step
        active_t += dt
        speeds.append(v)
    spd = np.array(speeds) if speeds else np.zeros(1)
    if len(spd) >= 3:
        spd = np.convolve(spd, np.ones(3) / 3, mode="valid")
    return {
        "distance_m": round(dist, 1),
        "avg_speed_ms": round(dist / active_t, 2) if active_t > 0 else 0.0,
        "max_speed_ms": round(float(np.percentile(spd, 95)), 2),
        "active_s": round(active_t, 1),
    }


def _zone_metrics(pts: list[tuple[float, float, float, int]]) -> dict:
    ys = np.array([p[2] for p in pts])
    d_net = np.abs(ys - NET_Y)
    n = len(d_net)
    rede = float((d_net <= SERVICE_LINE_FROM_NET).sum()) / n * 100
    fundo = float((d_net >= ZONE_FUNDO_FROM_NET).sum()) / n * 100
    meio = 100.0 - rede - fundo
    return {
        "rede_pct": round(rede, 1),
        "meio_pct": round(meio, 1),
        "fundo_pct": round(fundo, 1),
        "frente_linha_pct": round(rede, 1),   # à frente da linha de serviço
    }


def _heatmap(pts: list[tuple[float, float, float, int]]) -> list[list[float]]:
    grid = np.zeros((HEATMAP_ROWS, HEATMAP_COLS), dtype=np.float32)
    for p in pts:
        x, y = p[1], p[2]
        r = int(np.clip(y / COURT_LENGTH_M * HEATMAP_ROWS, 0, HEATMAP_ROWS - 1))
        c = int(np.clip(x / COURT_WIDTH_M * HEATMAP_COLS, 0, HEATMAP_COLS - 1))
        grid[r, c] += 1
    if grid.max() > 0:
        grid /= grid.max()
    return [[round(float(v), 3) for v in row] for row in grid]


def _speed_at(
    pts: list[tuple[float, float, float, int]], t_s: float, window_s: float
) -> float:
    """Peak speed of a player in [t−w, t+w] — the 'lunge' signal of a hit."""
    lo, hi = (t_s - window_s) * 1000.0, (t_s + window_s) * 1000.0
    seg = [p for p in pts if lo <= p[0] <= hi]
    best = 0.0
    for i in range(1, len(seg)):
        dt = (seg[i][0] - seg[i - 1][0]) / 1000.0
        if dt <= 0:
            continue
        v = float(np.hypot(seg[i][1] - seg[i - 1][1], seg[i][2] - seg[i - 1][2])) / dt
        if v <= MAX_PLAYER_SPEED:
            best = max(best, v)
    return best


def _pos_at(
    pts: list[tuple[float, float, float, int]], t_s: float
) -> tuple[float, float] | None:
    if not pts:
        return None
    t_ms = t_s * 1000.0
    p = min(pts, key=lambda p: abs(p[0] - t_ms))
    if abs(p[0] - t_ms) > 600.0:
        return None
    return p[1], p[2]


def _hit_zone(y: float) -> str:
    d = abs(y - NET_Y)
    if d <= SERVICE_LINE_FROM_NET:
        return "rede"
    if d >= ZONE_FUNDO_FROM_NET:
        return "fundo"
    return "meio"


def _pixel_at(
    pts: list[tuple], t_s: float, max_gap_ms: float = 450.0
) -> tuple[float, float, float] | None:
    """Player's pixel (centre_x, centre_y, box_top_y) nearest in time to t."""
    if not pts or len(pts[0]) < 7:
        return None
    t_ms = t_s * 1000.0
    p = min(pts, key=lambda p: abs(p[0] - t_ms))
    if abs(p[0] - t_ms) > max_gap_ms:
        return None
    return p[4], p[5], p[6]


def detect_ball_at_hits(
    video_path: Path,
    hit_times: list[float],
    progress_cb=None,
) -> dict[int, tuple[float, float, float]]:
    """
    Run a heavy-but-accurate ball detector ONLY around each hit instant.
    Returns {hit_index: (ball_px_x, ball_px_y, score)} for hits where the ball
    was found. CPU cost ≈ 3-4 s per probed frame, so 2 frames per hit.
    """
    import cv2
    from padelpro_vision.detection.detector import TorchvisionDetector

    det = TorchvisionDetector(
        score_thr=0.25,
        device="cpu",
        model_name="retinanet_resnet50_fpn_v2",
        target_label=37,           # COCO "sports ball"
    )
    cap = cv2.VideoCapture(str(video_path))
    found: dict[int, tuple[float, float, float]] = {}
    offsets = (0.0, -0.12)        # the hit frame, then just before contact
    for i, t in enumerate(hit_times):
        best: tuple[float, float, float] | None = None
        for off in offsets:
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, (t + off) * 1000.0))
            ok, frame = cap.read()
            if not ok:
                continue
            balls = det.detect(frame)
            for b in balls:
                if best is None or b.confidence > best[2]:
                    bx, by = b.center
                    best = (bx, by, b.confidence)
            if best is not None:
                break             # found on the contact frame — good enough
        if best is not None:
            found[i] = best
        if progress_cb:
            progress_cb((i + 1) / max(1, len(hit_times)))
    cap.release()
    return found


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def analyze_clip(
    video_path: Path | str,
    output_dir: Path | str,
    court_id: str = "court1",
    homography: np.ndarray | None = None,
    segments: list | None = None,
    deep: bool = False,
    progress_cb=None,
    phase_cb=None,
) -> dict:
    """
    Analyse a short clip and return the report dict (also saved to
    output_dir/report.json). Requires torch; check analysis_available() first.

    `segments` lets the caller reuse an already-computed segmentation
    (list of Segment) instead of running it again.
    """
    from config import DEFAULT_CONFIG
    from padelpro_vision.io.video import VideoReader, get_video_info
    from padelpro_vision.io.ffmpeg import ensure_ffmpeg
    from padelpro_vision.segmentation.segmentation import get_active_segments
    from padelpro_vision.detection.detector import TorchvisionDetector
    from padelpro_vision.tracking.tracker import GreedyTracker
    from padelpro_vision.projection.projection import project_point, foot_point
    from padelpro_vision.calibration.calibration import CourtCalibrator

    import torch
    import os
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    ensure_ffmpeg()

    t0 = time.time()
    video_path = Path(video_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    info = get_video_info(video_path)
    fps = info["fps"] or 25.0
    duration_s = info["duration_ms"] / 1000.0

    # ---- homography -------------------------------------------------------
    H = homography
    if H is None:
        cal = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
        H = cal.load(court_id)
    calibrated = H is not None
    if not calibrated:
        logger.warning("No homography for court '%s' — spatial stats disabled.", court_id)

    # ---- segmentation ------------------------------------------------------
    cfg = DEFAULT_CONFIG.segmentation
    if segments is not None:
        segs = segments
    else:
        segs = get_active_segments(
            video_path,
            enter_thresh=cfg.play_score_threshold_enter,
            exit_thresh=cfg.play_score_threshold_exit,
            min_rally_s=cfg.min_rally_duration_s,
            gap_merge_s=cfg.gap_merge_threshold_s,
            padding_before_s=cfg.padding_before_s,
            padding_after_s=cfg.padding_after_s,
            break_gap_s=cfg.break_gap_threshold_s,
            output_dir=output_dir,
        )
    rallies = [(s.start_ms, s.end_ms) for s in segs if s.type == "rally"]
    useful_s = sum(e - s for s, e in rallies) / 1000.0
    t_seg = time.time() - t0
    logger.info("Segmentation: %d rallies, %.0fs useful (%.1fs).", len(rallies), useful_s, t_seg)

    # ---- audio hits --------------------------------------------------------
    t1 = time.time()
    hit_times = detect_hits(video_path, rallies, output_dir)
    t_audio = time.time() - t1
    logger.info("Hits: %d audio onsets (%.1fs).", len(hit_times), t_audio)

    # ---- detection + tracking (only inside rallies) ------------------------
    t2 = time.time()
    # Lower threshold = better recall on the small far-half players; the court
    # filter removes the extra false positives this lets through.
    detector = TorchvisionDetector(
        score_thr=0.35, device="cpu", min_size=DETECT_MIN_SIZE,
    )
    skip = max(1, round(fps / TARGET_FPS))
    sampled_fps = fps / skip
    try:
        from padelpro_vision.tracking.tracker import SupervisionByteTrack
        tracker = SupervisionByteTrack(frame_rate=sampled_fps, lost_track_s=4.0)
        logger.info("Tracker: ByteTrack (supervision).")
    except Exception:
        tracker = GreedyTracker(max_missed_s=4.0)
        logger.info("Tracker: GreedyTracker (supervision indisponível).")

    # {tid: [(ts_ms, x_m, y_m, rally_idx)]}
    raw_tracks: dict[int, list[tuple[float, float, float, int]]] = {}
    n_processed = 0
    est_frames = int(useful_s * fps / skip) or 1

    if calibrated:
        with VideoReader(video_path, skip_frames=skip) as reader:
            for frame_idx, ts_ms, frame in reader:
                rally_idx = next(
                    (i for i, (s, e) in enumerate(rallies) if s <= ts_ms <= e), -1
                )
                if rally_idx < 0:
                    continue
                dets = detector.detect(frame)
                in_court = []
                for d in dets:
                    fx, fy = foot_point(d)
                    cx, cy = project_point(H, fx, fy)
                    if (
                        -COURT_MARGIN_X_M <= cx <= COURT_WIDTH_M + COURT_MARGIN_X_M
                        and -COURT_MARGIN_Y_FAR_M <= cy <= COURT_LENGTH_M + COURT_MARGIN_Y_NEAR_M
                    ):
                        in_court.append((d, cx, cy))
                in_court.sort(key=lambda t: -t[0].confidence)
                in_court = in_court[:6]

                tracks = tracker.update([t[0] for t in in_court], frame_idx, ts_ms)
                for tr in tracks:
                    fx, fy = foot_point(tr.box)
                    cx, cy = project_point(H, fx, fy)
                    # Trailing fields are the PIXEL box (centre x/y, top y) so the
                    # deep pass can match players to the detected ball on-screen.
                    bcx, bcy = tr.box.center
                    raw_tracks.setdefault(tr.track_id, []).append(
                        (ts_ms, cx, cy, rally_idx, bcx, bcy, tr.box.y1)
                    )

                n_processed += 1
                if progress_cb and n_processed % 20 == 0:
                    progress_cb(min(0.99, n_processed / est_frames))

    t_det = time.time() - t2
    logger.info(
        "Detection+tracking: %d frames, %d raw tracks (%.1fs, %.2fs/frame).",
        n_processed, len(raw_tracks), t_det, t_det / max(1, n_processed),
    )

    # ---- players -----------------------------------------------------------
    players: list[dict] = []
    player_tracks: dict[int, list] = {}
    if calibrated and raw_tracks:
        merged = _merge_fragments(raw_tracks)
        chosen = _pick_players(merged)

        # Label by team (court half) and side (left/right)
        def sort_key(pts):
            my = float(np.mean([p[2] for p in pts]))
            mx = float(np.mean([p[1] for p in pts]))
            return (0 if my < NET_Y else 1, mx)

        chosen.sort(key=sort_key)
        for i, pts in enumerate(chosen):
            my = float(np.mean([p[2] for p in pts]))
            mx = float(np.mean([p[1] for p in pts]))
            team = "longe" if my < NET_Y else "perto"   # far/near half from camera
            side = "esq" if mx < COURT_WIDTH_M / 2 else "dir"
            pid = i + 1
            player_tracks[pid] = pts
            players.append({
                "id": pid,
                "label": f"Jogador {pid}",
                "team": team,
                "side": side,
                "samples": len(pts),
                "coverage_pct": round(100.0 * len(pts) / max(1, n_processed), 1),
                **_movement_metrics(pts),
                "zones": _zone_metrics(pts),
                "mean_pos": [round(mx, 2), round(my, 2)],
                "heatmap": _heatmap(pts),
                "hits": 0,
            })

    # ---- deep pass: ball detection at hit instants --------------------------
    ball_at_hit: dict[int, tuple[float, float, float]] = {}
    t_ball = 0.0
    if deep and players and hit_times:
        t3 = time.time()
        if phase_cb:
            phase_cb("bola nas pancadas")
        ball_at_hit = detect_ball_at_hits(video_path, hit_times, progress_cb=progress_cb)
        t_ball = time.time() - t3
        logger.info(
            "Ball pass: found at %d/%d hits (%.1fs).",
            len(ball_at_hit), len(hit_times), t_ball,
        )

    # ---- hit attribution -----------------------------------------------------
    hit_records: list[dict] = []
    if players:
        team_of = {p["id"]: p["team"] for p in players}
        rally_of_hit = [
            next((i for i, (s, e) in enumerate(rallies)
                  if s / 1000.0 - 0.3 <= t <= e / 1000.0 + 0.3), -1)
            for t in hit_times
        ]
        prev_rally, expected_team = -1, None
        for hi, (t, r) in enumerate(zip(hit_times, rally_of_hit)):
            if r < 0:
                continue
            if r != prev_rally:
                expected_team = None     # new rally — no expectation yet
                prev_rally = r

            hitter = None
            via_ball = False
            overhead = False
            ball = ball_at_hit.get(hi)
            if ball is not None:
                # Nearest player to the ball on screen, normalised by box size
                # so far (small) and near (big) players compete fairly.
                best_d = None
                for pid, pts in player_tracks.items():
                    pp = _pixel_at(pts, t)
                    if pp is None:
                        continue
                    px, py, ptop = pp
                    scale = max(20.0, (py - ptop) * 2.0)   # ≈ box height
                    d = float(np.hypot(ball[0] - px, ball[1] - py)) / scale
                    if best_d is None or d < best_d:
                        best_d, hitter = d, pid
                if hitter is not None and best_d is not None and best_d <= 2.5:
                    via_ball = True
                    pp = _pixel_at(player_tracks[hitter], t)
                    if pp is not None and ball[1] < pp[2]:
                        overhead = True                     # ball above head
                else:
                    hitter = None

            if hitter is None:
                # Fallback: movement spike + team alternation (experimental)
                spikes = {
                    pid: _speed_at(pts, t, ONSET_WINDOW_S)
                    for pid, pts in player_tracks.items()
                }
                cands = (
                    {pid: v for pid, v in spikes.items() if team_of[pid] == expected_team}
                    if expected_team else spikes
                )
                if not cands or max(cands.values()) <= 0.0:
                    cands = spikes
                hitter = max(cands, key=cands.get)

            expected_team = "perto" if team_of[hitter] == "longe" else "longe"

            pos = _pos_at(player_tracks[hitter], t)
            is_first = not any(h["rally"] == r for h in hit_records)
            if is_first:
                shot_type = "serviço"
            elif overhead:
                shot_type = "smash"
            else:
                shot_type = _hit_zone(pos[1]) if pos else "?"
            hit_records.append({
                "t_s": round(t, 2),
                "rally": r,
                "player_id": hitter,
                "pos": [round(pos[0], 2), round(pos[1], 2)] if pos else None,
                "type": shot_type,
                "via_ball": via_ball,
            })
        for p in players:
            p["hits"] = sum(1 for h in hit_records if h["player_id"] == p["id"])
            types: dict[str, int] = {}
            for h in hit_records:
                if h["player_id"] == p["id"]:
                    types[h["type"]] = types.get(h["type"], 0) + 1
            p["shot_types"] = types
        total_attr = max(1, len(hit_records))
        for p in players:
            p["hit_share_pct"] = round(100.0 * p["hits"] / total_attr, 1)

    # ---- rally summary ------------------------------------------------------
    rally_rows = []
    for i, (s, e) in enumerate(rallies):
        n_hits = sum(1 for h in hit_records if h["rally"] == i) if hit_records else \
                 sum(1 for t in hit_times if s / 1000.0 - 0.3 <= t <= e / 1000.0 + 0.3)
        rally_rows.append({
            "i": i + 1,
            "start_s": round(s / 1000.0, 1),
            "dur_s": round((e - s) / 1000.0, 1),
            "hits": n_hits,
        })

    report = {
        "version": 1,
        "calibrated": calibrated,
        "court_id": court_id,
        "clip": {
            "duration_s": round(duration_s, 1),
            "useful_s": round(useful_s, 1),
            "useful_pct": round(100.0 * useful_s / duration_s, 1) if duration_s else 0.0,
            "rallies": len(rallies),
            "sampled_fps": round(fps / skip, 2),
        },
        "hits": {
            "total": len(hit_times),
            "per_min_useful": round(len(hit_times) / (useful_s / 60.0), 1) if useful_s else 0.0,
            "avg_per_rally": round(len(hit_times) / len(rallies), 1) if rallies else 0.0,
            "attribution": "bola" if ball_at_hit else "experimental",
            "ball_found_pct": (
                round(100.0 * len(ball_at_hit) / len(hit_times), 1)
                if deep and hit_times else None
            ),
            "via_ball_pct": (
                round(100.0 * sum(1 for h in hit_records if h.get("via_ball")) /
                      max(1, len(hit_records)), 1)
                if deep and hit_records else None
            ),
        },
        "players": players,
        "rallies": rally_rows,
        "shots": hit_records,
        "timings_s": {
            "segmentation": round(t_seg, 1),
            "audio": round(t_audio, 1),
            "detection": round(t_det, 1),
            "ball": round(t_ball, 1),
            "total": round(time.time() - t0, 1),
        },
    }

    out_path = output_dir / "report.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    logger.info("Report saved → %s (%.1fs total)", out_path, time.time() - t0)
    return report
