"""
WASB (Winner-Aware Stroke Boundary) ball-detection stub.

Activates automatically when the checkpoint file is present:
    checkpoints/wasb_ball.pth

Without the checkpoint this module is a no-op — callers should check
`wasb_available()` before using `detect_ball_in_frame`.

To get the real weights:
    python scripts/download_model_weights.py --model wasb

License: MIT (original WASB paper weights are for tennis; transfer to padel via
fine-tuning is the planned next step using frames from /annotate).
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

_CKPT = Path("checkpoints/wasb_ball.pth")


def wasb_available() -> bool:
    """True when the WASB checkpoint exists and torch is importable."""
    if not _CKPT.exists():
        return False
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


def detect_ball_in_frame(frame_bgr, confidence_threshold: float = 0.5) -> Optional[dict]:
    """Detect the ball in a single BGR frame.

    Returns {"x": float, "y": float, "conf": float} in pixel coordinates,
    or None if no ball detected above threshold.

    Raises RuntimeError if WASB is not available.
    """
    if not wasb_available():
        raise RuntimeError(
            "WASB não disponível — checkpoint em falta: "
            f"{_CKPT}. Corre: python scripts/download_model_weights.py --model wasb"
        )

    import torch
    import numpy as np

    # --- placeholder: load model on first call and run inference ---
    # Real implementation: load a RetinaNet/WASB model from _CKPT, preprocess
    # the frame, run forward pass, decode the highest-confidence ball detection.
    raise NotImplementedError(
        "WASB checkpoint found but inference is not yet implemented. "
        "Contribute the inference code in padelpro_vision/strokes/wasb_detector.py"
    )


def annotate_key_frames(key_frames: list[dict], video_path: str | Path) -> list[dict]:
    """Best-effort: add 'ball_x', 'ball_y', 'ball_conf' to each key-frame dict.

    Silently skips frames where detection fails or WASB is unavailable.
    """
    if not wasb_available():
        return key_frames

    try:
        import cv2
    except ImportError:
        return key_frames

    cap = cv2.VideoCapture(str(video_path))
    try:
        for kf in key_frames:
            t_s = float(kf.get("t_s", 0.0))
            cap.set(cv2.CAP_PROP_POS_MSEC, t_s * 1000.0)
            ok, frame = cap.read()
            if not ok:
                continue
            try:
                result = detect_ball_in_frame(frame)
                if result:
                    kf["ball_x"] = result["x"]
                    kf["ball_y"] = result["y"]
                    kf["ball_conf"] = result["conf"]
            except Exception:
                pass
    finally:
        cap.release()

    return key_frames
