"""
E2E-Spot stroke-boundary detector stub (BSD-3 licence).

E2E-Spot (End-to-End Spotting) detects the exact frame where a stroke occurs.
The pretrained tennis models transfer well to padel — forehand/backhand onset
can be detected directly from RGB video without pose estimation.

Activates when the checkpoint is present:
    checkpoints/e2e_spot_tennis.pth

Without it this is a no-op stub. Check `e2e_spot_available()` before calling.

To download the checkpoint:
    python scripts/download_model_weights.py --model e2e_spot

Reference: https://github.com/jhong93/e2e-spot (BSD-3)
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

_CKPT = Path("checkpoints/e2e_spot_tennis.pth")

# Stroke class names used by the pretrained tennis model.
# Map them to PadelPro's shot types in _LABEL_MAP.
_LABEL_MAP = {
    "forehand": "forehand",
    "backhand": "backhand",
    "serve":    "serve",
    "volley":   "volley",
    "smash":    "smash",
    # tennis-specific labels not in padel
    "return":   "other",
    "lob":      "lob",
}


def e2e_spot_available() -> bool:
    """True when the E2E-Spot checkpoint exists and torch is importable."""
    if not _CKPT.exists():
        return False
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


def detect_strokes(
    video_path: str | Path,
    threshold: float = 0.5,
    window_s: float = 0.5,
) -> list[dict]:
    """Detect stroke boundaries in the full video.

    Returns a list of dicts:
        [{"t_s": float, "type": str, "conf": float}, ...]

    Args:
        video_path: Path to the video file.
        threshold:  Minimum confidence to include a detection.
        window_s:   Non-maximum suppression window in seconds.

    Raises RuntimeError if E2E-Spot is not available.
    """
    if not e2e_spot_available():
        raise RuntimeError(
            "E2E-Spot não disponível — checkpoint em falta: "
            f"{_CKPT}. Corre: python scripts/download_model_weights.py --model e2e_spot"
        )

    import torch

    # --- placeholder: real implementation loads model, runs windowed inference,
    #     applies NMS, and returns stroke events ---
    raise NotImplementedError(
        "E2E-Spot checkpoint found but inference is not yet implemented. "
        "Contribute the inference code in padelpro_vision/strokes/e2e_spot_detector.py"
    )


def merge_with_gemini(
    gemini_shots: list[dict],
    e2e_strokes: list[dict],
    tolerance_s: float = 0.5,
) -> list[dict]:
    """Merge E2E-Spot timing precision into Gemini's semantic labels.

    For each E2E detection within `tolerance_s` of a Gemini shot, replace the
    Gemini timestamp with the E2E one (more precise to the frame). Otherwise
    keep the Gemini shot as-is. New E2E detections without a Gemini match are
    added with type="other" and outcome="continuation".
    """
    merged = list(gemini_shots)
    used = set()

    for e2e in e2e_strokes:
        t = e2e["t_s"]
        best_i, best_d = None, float("inf")
        for i, gs in enumerate(merged):
            if i in used:
                continue
            d = abs(gs.get("t_s", 0.0) - t)
            if d < tolerance_s and d < best_d:
                best_d = d
                best_i = i
        if best_i is not None:
            merged[best_i] = {**merged[best_i], "t_s": t, "e2e_conf": e2e.get("conf")}
            used.add(best_i)
        else:
            merged.append({
                "t_s": t,
                "player": None,
                "type": _LABEL_MAP.get(e2e.get("type", "other"), "other"),
                "outcome": "continuation",
                "e2e_conf": e2e.get("conf"),
            })

    merged.sort(key=lambda x: x.get("t_s", 0.0))
    return merged
