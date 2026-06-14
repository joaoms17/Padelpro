"""
Unified ball detector — WASB when checkpoint is present, RetinaNet otherwise.

Usage (single frame):
    from padelpro_vision.ball.detector import detect_ball, detector_available
    if detector_available():
        result = detect_ball(bgr_frame)  # {"x", "y", "w", "h", "conf"} or None

Usage (full video at sample_hz):
    from padelpro_vision.ball.detector import track_ball_in_video
    detections = track_ball_in_video("match.mp4", sample_hz=2.0)
    # → [(t_s, {"x_norm","y_norm","conf"} | None), ...]

Both functions return normalised coordinates (0-1 in image width/height).
Raises ImportError internally if torch is missing — callers must check
detector_available() first or wrap in try/except.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_WASB_CKPT   = Path("checkpoints/wasb_ball.pth")
_RETINA_LABEL = 37   # COCO class 37 = "sports ball" (0-indexed in torchvision)


# ---------------------------------------------------------------------------
# Availability checks
# ---------------------------------------------------------------------------

def detector_available() -> bool:
    """True if any ball detector can run (torch importable)."""
    try:
        import torch        # noqa: F401
        import torchvision  # noqa: F401
        return True
    except ImportError:
        return False


def _wasb_available() -> bool:
    return _WASB_CKPT.exists() and detector_available()


# ---------------------------------------------------------------------------
# Single-frame detection
# ---------------------------------------------------------------------------

def detect_ball(
    bgr_frame,
    conf_threshold: float = 0.25,
) -> Optional[dict]:
    """
    Detect the ball in a single BGR frame.

    Returns {"x_norm", "y_norm", "conf"} in normalised image coordinates,
    or None if no detection above threshold.

    Uses WASB if checkpoint exists, otherwise RetinaNet COCO.
    """
    if _wasb_available():
        try:
            return _detect_wasb(bgr_frame, conf_threshold)
        except Exception as exc:
            logger.debug("WASB detection failed, falling back to RetinaNet: %s", exc)

    return _detect_retinanet(bgr_frame, conf_threshold)


def _detect_retinanet(bgr_frame, conf_threshold: float) -> Optional[dict]:
    import torch
    import torchvision
    import torchvision.transforms.functional as TF
    import numpy as np

    h, w = bgr_frame.shape[:2]
    rgb = bgr_frame[:, :, ::-1].copy()
    tensor = TF.to_tensor(rgb).unsqueeze(0)

    # Load model lazily (cached across calls via module-level singleton)
    model = _get_retinanet()
    with torch.no_grad():
        preds = model(tensor)[0]

    best_score = 0.0
    best_box = None
    for box, label, score in zip(preds["boxes"], preds["labels"], preds["scores"]):
        if int(label) != _RETINA_LABEL:
            continue
        s = float(score)
        if s > best_score and s >= conf_threshold:
            best_score = s
            best_box = box.tolist()

    if best_box is None:
        return None

    x1, y1, x2, y2 = best_box
    return {
        "x_norm": round((x1 + x2) / 2 / w, 4),
        "y_norm": round((y1 + y2) / 2 / h, 4),
        "conf":   round(best_score, 3),
    }


def _detect_wasb(bgr_frame, conf_threshold: float) -> Optional[dict]:
    from padelpro_vision.strokes.wasb_detector import detect_ball_in_frame
    result = detect_ball_in_frame(bgr_frame, confidence_threshold=conf_threshold)
    if result is None:
        return None
    h, w = bgr_frame.shape[:2]
    return {
        "x_norm": round(result["x"] / w, 4),
        "y_norm": round(result["y"] / h, 4),
        "conf":   round(result["conf"], 3),
    }


# ---------------------------------------------------------------------------
# Singleton model cache (avoids reloading on every frame)
# ---------------------------------------------------------------------------

_retinanet_model = None


def _get_retinanet():
    global _retinanet_model
    if _retinanet_model is None:
        import torchvision
        weights = torchvision.models.detection.RetinaNet_ResNet50_FPN_V2_Weights.DEFAULT
        _retinanet_model = torchvision.models.detection.retinanet_resnet50_fpn_v2(weights=weights)
        _retinanet_model.eval()
        logger.info("RetinaNet loaded for ball detection.")
    return _retinanet_model


# ---------------------------------------------------------------------------
# Full-video tracking (dense samples → Kalman → smooth trajectory)
# ---------------------------------------------------------------------------

def track_ball_in_video(
    video_path,
    sample_hz: float = 2.0,
    conf_threshold: float = 0.25,
) -> list[dict]:
    """
    Sample the video at `sample_hz`, run ball detection on each frame, smooth
    with a Kalman filter, and return a trajectory:
        [{"t_s", "x", "y", "vx", "vy", "conf", "predicted"}, ...]

    x, y are normalised to [0, 1] in image coordinates.

    Returns [] if torch is unavailable or the video cannot be opened.
    The step is silently skipped on Render (no torch) and the caller falls
    back to the Gemini-interpolated trajectory.
    """
    if not detector_available():
        return []

    try:
        import cv2
    except ImportError:
        return []

    from padelpro_vision.tracking.ball_tracker import KalmanBallTracker, BallMeasurement

    video_path = Path(video_path)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.warning("track_ball_in_video: cannot open %s", video_path)
        return []

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(video_fps / sample_hz))
    tracker = KalmanBallTracker(process_noise=8e-3, measurement_noise=3e-3)

    raw_detections: list[tuple[float, Optional[dict]]] = []
    frame_idx = 0
    n_detections = 0

    try:
        while True:
            ret = cap.grab()
            if not ret:
                break
            if frame_idx % step == 0:
                ok, frame = cap.retrieve()
                t_s = frame_idx / video_fps
                det = None
                if ok and frame is not None:
                    try:
                        det = detect_ball(frame, conf_threshold)
                        if det is not None:
                            n_detections += 1
                    except Exception:
                        pass
                raw_detections.append((t_s, det))
            frame_idx += 1
    finally:
        cap.release()

    logger.info(
        "Ball detection: %d/%d frames with detections (%.1f%% hit rate)",
        n_detections, len(raw_detections),
        100.0 * n_detections / max(len(raw_detections), 1),
    )

    if not raw_detections:
        return []

    # Run Kalman filter
    trajectory: list[dict] = []
    for t_s, det in raw_detections:
        meas = BallMeasurement(det["x_norm"], det["y_norm"], det["conf"]) if det else None
        state = tracker.step(t_s, meas)
        trajectory.append({
            "t_s":       round(state.t_s, 3),
            "x":         round(state.x, 4),
            "y":         round(state.y, 4),
            "vx":        round(state.vx, 4),
            "vy":        round(state.vy, 4),
            "conf":      round(state.conf, 3),
            "predicted": state.predicted,
        })

    return trajectory
