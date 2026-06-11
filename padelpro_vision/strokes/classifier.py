"""
Stroke classifier: TCN over sliding window of pose keypoints + rules-based fallback.

Classes: forehand_volley, backhand_volley, bandeja, vibora, smash, serve, other.

Two modes:
  - "rules"  : geometry heuristics from pose — runs without any trained weights.
  - "tcn"    : trained Temporal Convolutional Network (trained via train_classifier.py).
"""

from __future__ import annotations
import logging
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

from padelpro_vision.pose.estimator import (
    Pose,
    KP_LEFT_WRIST, KP_RIGHT_WRIST,
    KP_LEFT_SHOULDER, KP_RIGHT_SHOULDER,
    KP_LEFT_ELBOW, KP_RIGHT_ELBOW,
    KP_LEFT_HIP, KP_RIGHT_HIP,
    KP_NOSE,
)

logger = logging.getLogger(__name__)

StrokeType = Literal[
    "forehand_volley", "backhand_volley",
    "bandeja", "vibora", "smash", "serve", "other",
]

STROKE_CLASSES: list[StrokeType] = [
    "forehand_volley", "backhand_volley",
    "bandeja", "vibora", "smash", "serve", "other",
]

WINDOW_SIZE = 16   # frames in the sliding window
N_KEYPOINTS = 17
FEATURE_DIM = N_KEYPOINTS * 2   # flattened (x, y) — normalised to bbox


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

def pose_to_features(pose: Pose) -> np.ndarray:
    """
    Normalise keypoints to [0,1] relative to the player bounding box.
    Returns a flat (34,) vector.
    """
    if pose.bbox is None:
        return np.zeros(FEATURE_DIM, dtype=np.float32)
    bw = max(1.0, pose.bbox.x2 - pose.bbox.x1)
    bh = max(1.0, pose.bbox.y2 - pose.bbox.y1)
    kps = pose.keypoints.copy()
    kps[:, 0] = (kps[:, 0] - pose.bbox.x1) / bw
    kps[:, 1] = (kps[:, 1] - pose.bbox.y1) / bh
    return kps.flatten().astype(np.float32)


# ---------------------------------------------------------------------------
# Rules-based classifier
# ---------------------------------------------------------------------------

def _wrist_height_relative(pose: Pose) -> tuple[float, float]:
    """Return (left_wrist_rel_y, right_wrist_rel_y) relative to shoulder-hip distance."""
    kps = pose.keypoints
    scores = pose.scores
    shoulder_y = np.mean([kps[KP_LEFT_SHOULDER, 1], kps[KP_RIGHT_SHOULDER, 1]])
    hip_y      = np.mean([kps[KP_LEFT_HIP, 1],      kps[KP_RIGHT_HIP, 1]])
    ref = max(1.0, abs(hip_y - shoulder_y))
    lw = (shoulder_y - kps[KP_LEFT_WRIST,  1]) / ref
    rw = (shoulder_y - kps[KP_RIGHT_WRIST, 1]) / ref
    lconf = float(scores[KP_LEFT_WRIST])
    rconf = float(scores[KP_RIGHT_WRIST])
    return lw * lconf, rw * rconf


def rules_classify(pose_window: list[Pose]) -> StrokeType:
    """
    Geometry heuristics over a window of poses.

    Heuristics (simplified, padel-specific):
      - Both wrists high + body upright  → smash or bandeja
      - Dominant wrist very high + elbow > shoulder → smash; elbow ≈ shoulder → bandeja
      - Wrist crosses body midline going left  → vibora (left-handed) or backhand side
      - Wrist crosses body midline going right → forehand side
      - Low body position + upward wrist motion → serve
    """
    if not pose_window:
        return "other"

    # Use the most recent frame for instantaneous geometry
    pose = pose_window[-1]
    kps  = pose.keypoints
    scores = pose.scores

    lw_rel, rw_rel = _wrist_height_relative(pose)

    # Determine dominant (racket) hand: higher wrist = hitting
    dom_wrist_kp = KP_RIGHT_WRIST if rw_rel >= lw_rel else KP_LEFT_WRIST
    dom_elbow_kp = KP_RIGHT_ELBOW if dom_wrist_kp == KP_RIGHT_WRIST else KP_LEFT_ELBOW
    dom_shoulder_kp = KP_RIGHT_SHOULDER if dom_wrist_kp == KP_RIGHT_WRIST else KP_LEFT_SHOULDER

    wrist_y    = kps[dom_wrist_kp, 1]
    elbow_y    = kps[dom_elbow_kp, 1]
    shoulder_y = kps[dom_shoulder_kp, 1]
    nose_y     = kps[KP_NOSE, 1]
    hip_y      = np.mean([kps[KP_LEFT_HIP, 1], kps[KP_RIGHT_HIP, 1]])
    ref        = max(1.0, abs(hip_y - shoulder_y))

    wrist_above_shoulder  = (shoulder_y - wrist_y) / ref   # >0 = above
    wrist_above_nose      = (nose_y - wrist_y) / ref
    elbow_above_shoulder  = (shoulder_y - elbow_y) / ref

    # --- Overhead strokes ---
    if wrist_above_nose > 0.3:
        if elbow_above_shoulder > 0.5:
            return "smash"
        return "bandeja"

    # --- Wrist above shoulder (not overhead) ---
    if wrist_above_shoulder > 0.2:
        # Motion direction across window for vibora vs overhead
        if len(pose_window) >= 4:
            wx_start = pose_window[-4].keypoints[dom_wrist_kp, 0]
            wx_end   = pose_window[-1].keypoints[dom_wrist_kp, 0]
            horizontal_move = wx_end - wx_start
            if abs(horizontal_move) > 20:
                return "vibora"
        return "bandeja"

    # --- Mid-height wrist: volley range ---
    cx = np.mean([kps[KP_LEFT_SHOULDER, 0], kps[KP_RIGHT_SHOULDER, 0]])
    wrist_x = kps[dom_wrist_kp, 0]
    if dom_wrist_kp == KP_RIGHT_WRIST:
        # Right-handed: forehand = wrist right of body, backhand = wrist left
        return "forehand_volley" if wrist_x >= cx else "backhand_volley"
    else:
        return "backhand_volley" if wrist_x >= cx else "forehand_volley"


# ---------------------------------------------------------------------------
# TCN model (PyTorch)
# ---------------------------------------------------------------------------

class _TCNBlock(object):
    """Placeholder — actual nn.Module defined in the torch import block below."""


def _build_tcn_model(n_classes: int, input_dim: int = FEATURE_DIM) -> object:
    """Build a small Temporal Convolutional Network."""
    import torch
    import torch.nn as nn

    class TCNClassifier(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.conv1 = nn.Conv1d(input_dim, 64, kernel_size=3, padding=1)
            self.conv2 = nn.Conv1d(64, 64, kernel_size=3, padding=2, dilation=2)
            self.conv3 = nn.Conv1d(64, 64, kernel_size=3, padding=4, dilation=4)
            self.pool  = nn.AdaptiveAvgPool1d(1)
            self.fc    = nn.Linear(64, n_classes)
            self.relu  = nn.ReLU()
            self.drop  = nn.Dropout(0.3)

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            # x: (batch, input_dim, seq_len)
            x = self.relu(self.conv1(x))
            x = self.relu(self.conv2(x))
            x = self.drop(self.relu(self.conv3(x)))
            x = self.pool(x).squeeze(-1)
            return self.fc(x)

    return TCNClassifier()


# ---------------------------------------------------------------------------
# Public classifier class
# ---------------------------------------------------------------------------

@dataclass
class StrokeEvent:
    track_id: int
    frame_idx: int
    timestamp_ms: float
    stroke_type: StrokeType
    confidence: float
    # court_x, court_y: filled in M3 projection step
    court_x: float | None = None
    court_y: float | None = None


class StrokeClassifier:
    """
    Classifies padel strokes from a sliding window of pose keypoints.

    mode="rules"  — geometry heuristics, no weights needed.
    mode="tcn"    — trained TCN; falls back to rules if weights absent.
    """

    def __init__(
        self,
        mode: Literal["rules", "tcn"] = "rules",
        weights_path: Path | str | None = None,
        window_size: int = WINDOW_SIZE,
        device: str = "cpu",
    ) -> None:
        self.mode = mode
        self.window_size = window_size
        self.device = device
        self._model = None
        self._windows: dict[int, deque[Pose]] = {}  # track_id → pose window

        if mode == "tcn" and weights_path:
            self._try_load_tcn(Path(weights_path))

        if self.mode == "tcn" and self._model is None:
            logger.warning("TCN weights not loaded — falling back to rules mode.")
            self.mode = "rules"

    def _try_load_tcn(self, path: Path) -> None:
        try:
            import torch
            model = _build_tcn_model(len(STROKE_CLASSES))
            model.load_state_dict(torch.load(path, map_location=self.device))
            model.eval()
            self._model = model.to(self.device)
            logger.info("TCN stroke classifier loaded from %s", path)
        except Exception as exc:
            logger.warning("Could not load TCN weights: %s", exc)

    def update(self, track_id: int, pose: Pose) -> None:
        """Add a pose observation for a given track."""
        if track_id not in self._windows:
            self._windows[track_id] = deque(maxlen=self.window_size)
        self._windows[track_id].append(pose)

    def classify(self, track_id: int) -> tuple[StrokeType, float]:
        """Return (stroke_type, confidence) for the current window of a track."""
        window = list(self._windows.get(track_id, []))
        if len(window) < 2:
            return "other", 0.0

        if self.mode == "rules":
            stroke = rules_classify(window)
            return stroke, 1.0   # rules give no probability

        # TCN mode
        import torch
        feats = np.stack([pose_to_features(p) for p in window], axis=1)  # (34, T)
        x = torch.tensor(feats[np.newaxis], dtype=torch.float32).to(self.device)
        with torch.no_grad():
            logits = self._model(x)[0]
            probs  = torch.softmax(logits, dim=-1).cpu().numpy()
        idx    = int(np.argmax(probs))
        return STROKE_CLASSES[idx], float(probs[idx])

    def reset(self, track_id: int | None = None) -> None:
        """Clear pose windows (call between points or at match start)."""
        if track_id is not None:
            self._windows.pop(track_id, None)
        else:
            self._windows.clear()
