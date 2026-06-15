"""
Optical-flow shot detector for padel video.

Detects shot timestamps by finding rapid-motion bursts in the player zones
of each video frame. Immune to noise from adjacent courts (purely visual).
No GPU or ML required — uses OpenCV dense optical flow (Farneback).

Algorithm:
  1. Sample frames at SAMPLE_FPS (default 4 fps)
  2. Compute dense optical flow between consecutive sampled frames
  3. Split each frame into near-team zone (bottom) and far-team zone (top)
  4. Track per-zone motion magnitude over time
  5. Find peaks above mean + N*std with MIN_GAP_S minimum separation
  6. Return sorted list of {t_s, zone, magnitude}
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SAMPLE_FPS      = 4      # flow analysis rate (frames/sec)
MIN_GAP_S       = 1.5    # minimum seconds between two shots
THRESHOLD_SIGMA = 1.5    # threshold = mean + N * std of zone magnitudes
MAX_SHOTS       = 150    # hard cap to avoid absurd results on noisy video
MAX_ANALYZE_S   = 40 * 60  # only analyze first 40 min (matches long-video rule)

# Fraction of frame height allocated to each team's zone.
# Middle band is excluded to avoid counting ball-crossing motion.
NEAR_BOTTOM_FRAC = 0.55   # bottom 55% = near team (A)
FAR_TOP_FRAC     = 0.35   # top 35%    = far team (B)


def detect_shots(
    video_path: str | Path,
    sample_fps: float = SAMPLE_FPS,
    min_gap_s:  float = MIN_GAP_S,
) -> list[dict]:
    """
    Return candidate shot timestamps from a padel video.

    Each entry: {"t_s": float, "zone": "near"|"far", "magnitude": float}
    Sorted by t_s. Returns [] if cv2 is unavailable or video unreadable.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        logger.warning("cv2/numpy unavailable — optical-flow shot detection skipped")
        return []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.warning("Cannot open video for shot detection: %s", video_path)
        return []

    fps  = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps / sample_fps)))

    flow_rows: list[tuple[float, float, float]] = []   # (t_s, near_mag, far_mag)
    prev_gray = None
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        t_s = frame_idx / fps
        if t_s > MAX_ANALYZE_S:
            break

        if frame_idx % step == 0:
            small = cv2.resize(frame, (320, 180))
            gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

            if prev_gray is not None:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray, None,
                    pyr_scale=0.5, levels=3, winsize=15,
                    iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
                )
                mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                h   = mag.shape[0]
                far_mag  = float(mag[: int(h * FAR_TOP_FRAC), :].mean())
                near_mag = float(mag[int(h * (1 - NEAR_BOTTOM_FRAC)):, :].mean())
                flow_rows.append((t_s, near_mag, far_mag))

            prev_gray = gray

        frame_idx += 1

    cap.release()
    logger.info("Optical flow: %d frames read, %d flow samples", frame_idx, len(flow_rows))

    if len(flow_rows) < 8:
        return []

    import numpy as np

    times     = np.array([r[0] for r in flow_rows])
    near_mags = np.array([r[1] for r in flow_rows])
    far_mags  = np.array([r[2] for r in flow_rows])

    shots: list[dict] = []
    for zone_label, mags in (("near", near_mags), ("far", far_mags)):
        thr = float(mags.mean() + THRESHOLD_SIGMA * mags.std())
        shots.extend(_find_peaks(times, mags, thr, min_gap_s, zone_label))

    shots.sort(key=lambda s: s["t_s"])

    if len(shots) > MAX_SHOTS:
        shots = sorted(shots, key=lambda s: -s["magnitude"])[:MAX_SHOTS]
        shots.sort(key=lambda s: s["t_s"])

    logger.info("Optical flow found %d candidate shots", len(shots))
    return shots


def _find_peaks(
    times,
    mags,
    threshold: float,
    min_gap_s: float,
    zone: str,
) -> list[dict]:
    """Cluster above-threshold samples and return the peak of each cluster."""
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
        {"t_s": max(c, key=lambda x: x[1])[0], "zone": zone,
         "magnitude": max(c, key=lambda x: x[1])[1]}
        for c in clusters
    ]


def _t_to_hhmmss(t_s: float) -> str:
    s = int(t_s)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def format_shot_hints(shots: list[dict]) -> str:
    """Format detected shots as a Gemini prompt section."""
    if not shots:
        return ""
    near = [s for s in shots if s["zone"] == "near"]
    far  = [s for s in shots if s["zone"] == "far"]

    lines = [
        f"## PRÉ-DETECÇÃO: {len(shots)} BATIMENTOS DETETADOS POR OPTICAL FLOW",
        "",
        "A análise de movimento de frame detetou os seguintes timestamps como "
        "prováveis batimentos (burst de movimento rápido na zona do jogador).",
        "Para CADA timestamp abaixo, inclui uma entrada em `pancadas` com o jogador "
        "e tipo corretos. Podes adicionar outros shots que vejas claramente.",
        "",
    ]
    if near:
        ts = "  ".join(_t_to_hhmmss(s["t_s"]) for s in near)
        lines.append(f"**Equipa próxima (A):** {ts}")
    if far:
        ts = "  ".join(_t_to_hhmmss(s["t_s"]) for s in far)
        lines.append(f"**Equipa afastada (B):** {ts}")
    lines.append("")
    lines.append("---")
    return "\n".join(lines)
