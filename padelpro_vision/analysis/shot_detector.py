"""
Shot detector for padel video — two complementary signals:

  1. Optical flow (visual, court-specific, high confidence)
     Detects burst of rapid arm/racket motion in the player zones.
     Immune to sound from adjacent courts.

  2. Audio energy peaks (suggestive, faster, may include adjacent courts)
     Detects percussive transients in the video's audio track.
     Used as a secondary hint — Gemini is told to treat these with caution.

The two signals are merged and labelled so Gemini knows which confidence
level to apply to each timestamp.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Shared constants ─────────────────────────────────────────────────────────
MIN_GAP_S     = 1.5       # minimum seconds between two shots (both signals)
MAX_ANALYZE_S = 40 * 60   # only analyze first 40 min

# ── Optical flow ─────────────────────────────────────────────────────────────
SAMPLE_FPS       = 4      # flow analysis rate (frames/sec)
FLOW_SIGMA       = 1.5    # threshold = mean + N * std
MAX_FLOW_SHOTS   = 150

# Fraction of frame height per team zone (middle ~10% excluded)
NEAR_BOTTOM_FRAC = 0.55
FAR_TOP_FRAC     = 0.35

# ── Audio ────────────────────────────────────────────────────────────────────
AUDIO_SR         = 16000  # Hz for ffmpeg extraction
AUDIO_FRAME_MS   = 20     # energy window (ms)
AUDIO_HOP_MS     = 10     # hop size (ms)
AUDIO_SIGMA      = 2.5    # stricter threshold to reduce false positives
MAX_AUDIO_SHOTS  = 200

# If an audio peak is within this many seconds of an optical-flow peak,
# they are considered the same event (audio "confirms" the visual peak).
CONFIRM_WINDOW_S = 1.0


# ── Public API ───────────────────────────────────────────────────────────────

def detect_shots(
    video_path: str | Path,
    sample_fps: float = SAMPLE_FPS,
    min_gap_s:  float = MIN_GAP_S,
) -> list[dict]:
    """
    Visual shot detection via optical flow.

    Returns list of {"t_s", "zone": "near"|"far", "magnitude"}, sorted by t_s.
    Returns [] if cv2 unavailable or video unreadable.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        logger.warning("cv2/numpy unavailable — optical-flow detection skipped")
        return []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.warning("Cannot open video: %s", video_path)
        return []

    fps  = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps / sample_fps)))

    flow_rows: list[tuple[float, float, float]] = []
    prev_gray = None
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx / fps > MAX_ANALYZE_S:
            break
        if frame_idx % step == 0:
            small = cv2.resize(frame, (320, 180))
            gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            if prev_gray is not None:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray, None,
                    0.5, 3, 15, 3, 5, 1.2, 0,
                )
                mag      = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                h        = mag.shape[0]
                far_mag  = float(mag[: int(h * FAR_TOP_FRAC), :].mean())
                near_mag = float(mag[int(h * (1 - NEAR_BOTTOM_FRAC)):, :].mean())
                flow_rows.append((frame_idx / fps, near_mag, far_mag))
            prev_gray = gray
        frame_idx += 1

    cap.release()
    logger.info("Optical flow: %d samples from %d frames", len(flow_rows), frame_idx)
    if len(flow_rows) < 8:
        return []

    times     = np.array([r[0] for r in flow_rows])
    near_mags = np.array([r[1] for r in flow_rows])
    far_mags  = np.array([r[2] for r in flow_rows])

    shots: list[dict] = []
    for zone_label, mags in (("near", near_mags), ("far", far_mags)):
        thr = float(mags.mean() + FLOW_SIGMA * mags.std())
        shots.extend(_find_peaks(times, mags, thr, min_gap_s, zone_label))

    shots.sort(key=lambda s: s["t_s"])
    if len(shots) > MAX_FLOW_SHOTS:
        shots = sorted(shots, key=lambda s: -s["magnitude"])[:MAX_FLOW_SHOTS]
        shots.sort(key=lambda s: s["t_s"])

    logger.info("Optical flow found %d candidate shots", len(shots))
    return shots


def detect_shots_audio(
    video_path: str | Path,
    min_gap_s: float = MIN_GAP_S,
) -> list[dict]:
    """
    Audio-based shot detection via energy transient peaks.

    Returns list of {"t_s", "zone": "audio", "magnitude"}, sorted by t_s.
    Returns [] if ffmpeg is unavailable, numpy missing, or audio is silent.

    NOTE: audio cannot distinguish this court from adjacent courts — treat
    results as suggestive only (see format_shot_hints).
    """
    try:
        import numpy as np
    except ImportError:
        return []

    # Check ffmpeg is available
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        logger.debug("ffmpeg not available — audio detection skipped")
        return []

    tmp = tempfile.NamedTemporaryFile(suffix=".raw", delete=False)
    tmp.close()
    try:
        end_s = MAX_ANALYZE_S
        result = subprocess.run(
            [
                "ffmpeg", "-i", str(video_path),
                "-t", str(end_s),
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", str(AUDIO_SR),
                "-ac", "1",
                "-f", "s16le",
                tmp.name,
                "-y", "-loglevel", "error",
            ],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.debug("ffmpeg audio extraction failed: %s", result.stderr[:200])
            return []

        raw = Path(tmp.name).read_bytes()
        if len(raw) < 1024:
            return []

        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as exc:
        logger.debug("Audio extraction error: %s", exc)
        return []
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    # Short-time energy
    frame_size = int(AUDIO_SR * AUDIO_FRAME_MS / 1000)
    hop_size   = int(AUDIO_SR * AUDIO_HOP_MS  / 1000)
    n_frames   = max(0, (len(samples) - frame_size) // hop_size)
    if n_frames < 16:
        return []

    energy = np.array([
        float(np.mean(samples[i * hop_size: i * hop_size + frame_size] ** 2))
        for i in range(n_frames)
    ])
    times_a = np.arange(n_frames) * hop_size / AUDIO_SR

    # Normalise by rolling mean to handle volume changes across the match
    roll_win = int(2.0 / (AUDIO_HOP_MS / 1000))  # ~2s window
    kernel   = np.ones(roll_win) / roll_win
    rolling  = np.convolve(energy, kernel, mode="same")
    norm_e   = np.where(rolling > 1e-9, energy / (rolling + 1e-9), 0.0)

    thr = float(norm_e.mean() + AUDIO_SIGMA * norm_e.std())
    shots = _find_peaks(times_a, norm_e, thr, min_gap_s, "audio")

    if len(shots) > MAX_AUDIO_SHOTS:
        shots = sorted(shots, key=lambda s: -s["magnitude"])[:MAX_AUDIO_SHOTS]
        shots.sort(key=lambda s: s["t_s"])

    logger.info("Audio detection found %d candidate shots", len(shots))
    return shots


def merge_signals(
    visual_shots: list[dict],
    audio_shots:  list[dict],
    confirm_window: float = CONFIRM_WINDOW_S,
) -> dict:
    """
    Merge optical-flow and audio detections into labelled categories.

    Returns:
      {
        "confirmed": [t_s, ...],   # audio peak within confirm_window of visual
        "visual_only": [t_s, ...], # visual peak with no nearby audio
        "audio_only": [t_s, ...],  # audio peak with no visual confirmation
      }
    All lists sorted by t_s.
    """
    confirmed:    list[float] = []
    visual_only:  list[float] = []
    audio_used:   set[int]    = set()

    for vs in visual_shots:
        vt = vs["t_s"]
        match = next(
            (i for i, a in enumerate(audio_shots)
             if i not in audio_used and abs(a["t_s"] - vt) <= confirm_window),
            None,
        )
        if match is not None:
            confirmed.append(vt)
            audio_used.add(match)
        else:
            visual_only.append(vt)

    audio_only = [
        a["t_s"] for i, a in enumerate(audio_shots) if i not in audio_used
    ]

    return {
        "confirmed":   sorted(confirmed),
        "visual_only": sorted(visual_only),
        "audio_only":  sorted(audio_only),
    }


def format_shot_hints(
    visual_shots: list[dict],
    audio_shots:  list[dict] | None = None,
) -> str:
    """
    Format shot detections as a Gemini prompt section.

    When audio_shots is provided, merges both signals with confidence labels.
    """
    if not visual_shots and not audio_shots:
        return ""

    if audio_shots:
        merged   = merge_signals(visual_shots, audio_shots)
        confirmed   = merged["confirmed"]
        visual_only = merged["visual_only"]
        audio_only  = merged["audio_only"]
        n_total = len(visual_shots) + len(audio_only)
    else:
        # optical flow only
        confirmed   = []
        visual_only = [s["t_s"] for s in visual_shots]
        audio_only  = []
        n_total = len(visual_shots)

    if n_total == 0:
        return ""

    # For optical-flow shots, split near/far
    near_ts = {s["t_s"] for s in visual_shots if s["zone"] == "near"}
    far_ts  = {s["t_s"] for s in visual_shots if s["zone"] == "far"}

    def _fmt(ts_list: list[float]) -> str:
        return "  ".join(_t_to_hhmmss(t) for t in sorted(ts_list))

    lines = [
        f"## PRÉ-DETECÇÃO: {n_total} BATIMENTOS DETETADOS",
        "",
    ]

    visual_all = sorted(set(confirmed) | set(visual_only))
    if visual_all:
        near = [t for t in visual_all if t in near_ts]
        far  = [t for t in visual_all if t in far_ts]
        lines.append(
            "**Batimentos visuais (optical flow — alta confiança):** "
            "Para CADA timestamp abaixo, inclui uma entrada em `pancadas`."
        )
        if near:
            lines.append(f"  Equipa próxima (A): {_fmt(near)}")
        if far:
            lines.append(f"  Equipa afastada (B): {_fmt(far)}")
        lines.append("")

    if audio_only:
        lines.append(
            "**Batimentos por áudio (sugestivo — pode incluir campos vizinhos):** "
            "Verifica se vês movimento nestes timestamps antes de incluir em `pancadas`."
        )
        lines.append(f"  {_fmt(audio_only)}")
        lines.append("")

    lines.append(
        "Podes adicionar outros shots que vejas claramente e que não estejam nestas listas."
    )
    lines.append("")
    lines.append("---")
    return "\n".join(lines)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _find_peaks(
    times,
    mags,
    threshold: float,
    min_gap_s: float,
    zone: str,
) -> list[dict]:
    """Cluster above-threshold samples; return the peak of each cluster."""
    above = [(float(times[i]), float(mags[i])) for i in range(len(mags)) if mags[i] > threshold]
    if not above:
        return []

    clusters: list[list[tuple[float, float]]] = [[above[0]]]
    for t, m in above[1:]:
        if t - clusters[-1][-1][0] < min_gap_s:
            clusters[-1].append((t, m))
        else:
            clusters.append([(t, m)])

    return [
        {
            "t_s":       max(c, key=lambda x: x[1])[0],
            "zone":      zone,
            "magnitude": max(c, key=lambda x: x[1])[1],
        }
        for c in clusters
    ]


def _t_to_hhmmss(t_s: float) -> str:
    s = int(t_s)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"
