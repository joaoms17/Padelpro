"""WASB (Weakly Annotated Sports Ball) detector stub.

When checkpoints/wasb_ball.pth exists, uses the WASB model for ball tracking.
Falls back to the RetinaNet COCO stub when the checkpoint is absent.

To download WASB weights:
  python scripts/download_model_weights.py --model wasb
"""
from __future__ import annotations
from pathlib import Path
import logging

logger = logging.getLogger(__name__)
WASB_CKPT = Path("checkpoints/wasb_ball.pth")


def detect_balls_in_video(
    video_path: Path,
    timestamps_s: list[float],
) -> dict[float, dict]:
    """Return ball detections for each timestamp.

    Returns: {t_s: {"x_norm": float, "y_norm": float, "confidence": float}}
    """
    if WASB_CKPT.exists():
        return _wasb_detect(video_path, timestamps_s)
    return _retina_detect(video_path, timestamps_s)


def _wasb_detect(video_path: Path, timestamps_s: list[float]) -> dict[float, dict]:
    """WASB model inference — only runs when checkpoint available."""
    try:
        import torch
        ckpt = torch.load(WASB_CKPT, map_location="cpu")
        # TODO: wire up WASB model forward pass when repo is integrated
        # For now fall through to RetinaNet
        logger.info("WASB checkpoint found but model not yet wired — using RetinaNet fallback")
    except Exception as exc:
        logger.warning("WASB load failed: %s", exc)
    return _retina_detect(video_path, timestamps_s)


def _retina_detect(video_path: Path, timestamps_s: list[float]) -> dict[float, dict]:
    """RetinaNet COCO sports-ball fallback."""
    results: dict[float, dict] = {}
    try:
        import cv2
        from padelpro_vision.detection.detector import TorchvisionDetector
        detector = TorchvisionDetector(
            model_name="retinanet_resnet50_fpn_v2",
            target_label=37,
            score_threshold=0.3,
        )
        cap = cv2.VideoCapture(str(video_path))
        for t_s in timestamps_s:
            cap.set(cv2.CAP_PROP_POS_MSEC, t_s * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            dets = detector.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if dets:
                best = max(dets, key=lambda d: d.get("score", 0))
                results[t_s] = {
                    "x_norm": (best["x1"] + best["x2"]) / 2 / w,
                    "y_norm": (best["y1"] + best["y2"]) / 2 / h,
                    "confidence": best.get("score", 0.0),
                }
        cap.release()
    except Exception as exc:
        logger.warning("RetinaNet ball detection failed: %s", exc)
    return results
