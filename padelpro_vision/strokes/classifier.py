"""
Stroke classifier: TCN over sliding window of pose keypoints + rules-based fallback.

Classes: forehand_volley, backhand_volley, forehand, backhand,
         forehand_lob, backhand_lob, bandeja, vibora, kick,
         smash, serve, saida_vidro, other.

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
    "forehand", "backhand",
    "forehand_lob", "backhand_lob",
    "bandeja", "vibora", "kick",
    "smash", "serve",
    "saida_vidro",
    "other",
]

STROKE_CLASSES: list[StrokeType] = [
    "forehand_volley", "backhand_volley",
    "forehand", "backhand",
    "forehand_lob", "backhand_lob",
    "bandeja", "vibora", "kick",
    "smash", "serve",
    "saida_vidro",
    "other",
]

WINDOW_SIZE = 16   # frames in the sliding window
N_KEYPOINTS = 17
FEATURE_DIM = N_KEYPOINTS * 2       # flattened (x, y) — normalised to bbox
FEATURE_DIM_VEL = N_KEYPOINTS * 4   # (x, y) + per-frame velocity (dx, dy)

FeatureMode = Literal["pos", "posvel"]

FEATURE_DIMS: dict[str, int] = {"pos": FEATURE_DIM, "posvel": FEATURE_DIM_VEL}


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


def window_to_features(window: list[Pose], mode: FeatureMode = "pos") -> np.ndarray:
    """
    Build the (D, T) feature matrix for a pose window.

    mode="pos"    : bbox-normalised keypoint positions (D=34).
    mode="posvel" : positions + per-frame velocities (D=68). Velocity carries
                    the dynamics that separate e.g. bandeja (slow, controlled)
                    from víbora/smash (fast wrist) — positions alone can't.
    """
    pos = np.stack([pose_to_features(p) for p in window], axis=1)  # (34, T)
    if mode == "pos":
        return pos
    vel = np.zeros_like(pos)
    if pos.shape[1] > 1:
        vel[:, 1:] = np.diff(pos, axis=1)
    return np.concatenate([pos, vel], axis=0)  # (68, T)


def add_velocity_features(seq_features: np.ndarray) -> np.ndarray:
    """(34, T) position features → (68, T) position+velocity (training helper)."""
    vel = np.zeros_like(seq_features)
    if seq_features.shape[1] > 1:
        vel[:, 1:] = np.diff(seq_features, axis=1)
    return np.concatenate([seq_features, vel], axis=0)


# ---------------------------------------------------------------------------
# Impact-moment estimation from wrist dynamics
# ---------------------------------------------------------------------------

def _wrist_speeds(window: list[Pose]) -> np.ndarray:
    """
    Per-frame speed of the faster wrist, in bbox-heights/frame (scale
    invariant: same threshold works for near and far players). Index i is
    the speed between window[i] and window[i+1]; length = len(window) - 1.
    """
    if len(window) < 2:
        return np.zeros(0, dtype=np.float32)
    speeds = np.zeros(len(window) - 1, dtype=np.float32)
    for i in range(len(window) - 1):
        a, b = window[i], window[i + 1]
        scale = 1.0
        if b.bbox is not None:
            scale = max(1.0, b.bbox.y2 - b.bbox.y1)
        best = 0.0
        for kp in (KP_LEFT_WRIST, KP_RIGHT_WRIST):
            conf = min(float(a.scores[kp]), float(b.scores[kp]))
            if conf <= 0.0:
                continue
            d = float(np.hypot(
                b.keypoints[kp, 0] - a.keypoints[kp, 0],
                b.keypoints[kp, 1] - a.keypoints[kp, 1],
            )) / scale
            best = max(best, d)
        speeds[i] = best
    return speeds


def current_wrist_speed(window: list[Pose]) -> float:
    """Wrist speed between the two most recent poses (impact proxy)."""
    speeds = _wrist_speeds(window[-2:])
    return float(speeds[-1]) if len(speeds) else 0.0


def estimate_impact_index(window: list[Pose]) -> int:
    """
    Index (into the window) of the most likely impact frame: where the
    dominant wrist moved fastest. Returns the last index when no signal.
    """
    speeds = _wrist_speeds(window)
    if len(speeds) == 0 or speeds.max() <= 0.0:
        return len(window) - 1
    return int(np.argmax(speeds)) + 1   # speed[i] is motion arriving at frame i+1


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

    Heuristics (padel-specific):
      - Both wrists high + elbow very high         -> smash
      - Both wrists high + elbow moderate          -> bandeja
      - Wrist above shoulder + strong horizontal   -> vibora
      - Wrist at shoulder + low horizontal         -> kick (vibora subtipo baixo)
      - Wrist above shoulder + upward + slow       -> forehand_lob / backhand_lob
      - Mid-height wrist + high speed              -> forehand_volley / backhand_volley
      - Mid-height wrist + low speed               -> forehand / backhand (groundstroke)
      - Low body + upward wrist motion             -> serve
      - Default                                    -> forehand_volley / backhand_volley
    """
    if not pose_window:
        return "other"

    pose = pose_window[-1]
    kps  = pose.keypoints
    scores = pose.scores

    lw_rel, rw_rel = _wrist_height_relative(pose)

    # Determine dominant (racket) hand: higher wrist = hitting
    dom_wrist_kp    = KP_RIGHT_WRIST    if rw_rel >= lw_rel else KP_LEFT_WRIST
    dom_elbow_kp    = KP_RIGHT_ELBOW    if dom_wrist_kp == KP_RIGHT_WRIST else KP_LEFT_ELBOW
    dom_shoulder_kp = KP_RIGHT_SHOULDER if dom_wrist_kp == KP_RIGHT_WRIST else KP_LEFT_SHOULDER

    wrist_y    = kps[dom_wrist_kp, 1]
    elbow_y    = kps[dom_elbow_kp, 1]
    shoulder_y = kps[dom_shoulder_kp, 1]
    nose_y     = kps[KP_NOSE, 1]
    hip_y      = np.mean([kps[KP_LEFT_HIP, 1], kps[KP_RIGHT_HIP, 1]])
    ref        = max(1.0, abs(hip_y - shoulder_y))

    wrist_above_shoulder  = (shoulder_y - wrist_y) / ref   # >0 = above shoulder
    wrist_above_nose      = (nose_y - wrist_y) / ref
    elbow_above_shoulder  = (shoulder_y - elbow_y) / ref

    # Wrist speed for last few frames
    speeds = _wrist_speeds(pose_window[-4:]) if len(pose_window) >= 4 else np.array([])
    avg_speed = float(speeds.mean()) if len(speeds) > 0 else 0.0

    # Horizontal and vertical wrist motion over window
    horizontal_move = 0.0
    vertical_move   = 0.0
    if len(pose_window) >= 4:
        wx_start = pose_window[-4].keypoints[dom_wrist_kp, 0]
        wx_end   = pose_window[-1].keypoints[dom_wrist_kp, 0]
        wy_start = pose_window[-4].keypoints[dom_wrist_kp, 1]
        wy_end   = pose_window[-1].keypoints[dom_wrist_kp, 1]
        horizontal_move = abs(wx_end - wx_start)
        vertical_move   = wy_start - wy_end   # positive = wrist moved up

    # Body centre for forehand/backhand side determination
    cx = np.mean([kps[KP_LEFT_SHOULDER, 0], kps[KP_RIGHT_SHOULDER, 0]])
    wrist_x = kps[dom_wrist_kp, 0]
    is_forehand_side = (dom_wrist_kp == KP_RIGHT_WRIST and wrist_x >= cx) or \
                       (dom_wrist_kp == KP_LEFT_WRIST  and wrist_x < cx)

    # --- Overhead strokes ---
    if wrist_above_nose > 0.3:
        if elbow_above_shoulder > 0.5:
            return "smash"
        return "bandeja"

    # --- Wrist well above shoulder ---
    if wrist_above_shoulder > 0.2:
        if horizontal_move > 20:
            return "vibora"
        # Upward wrist motion at this height = lob
        if vertical_move > 15 and avg_speed < 0.15:
            return "forehand_lob" if is_forehand_side else "backhand_lob"
        return "bandeja"

    # --- Wrist at shoulder level: kick range (below vibora, horizontal swing) ---
    if 0.0 < wrist_above_shoulder <= 0.2 and horizontal_move > 20:
        return "kick"

    # --- Lob at mid-height (wrist below shoulder, slow upward swing) ---
    if vertical_move > 20 and avg_speed < 0.12:
        return "forehand_lob" if is_forehand_side else "backhand_lob"

    # --- Mid-height wrist: volley vs groundstroke ---
    # High wrist speed -> volley (player at net, compact swing)
    # Low wrist speed  -> groundstroke (player at baseline, full swing but slow at contact)
    if avg_speed > 0.18:
        return "forehand_volley" if is_forehand_side else "backhand_volley"
    else:
        return "forehand" if is_forehand_side else "backhand"


# ---------------------------------------------------------------------------
# TCN model (PyTorch)
# ---------------------------------------------------------------------------

class _TCNBlock(object):
    """Placeholder -- actual nn.Module defined in the torch import block below."""


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

    mode="rules"  -- geometry heuristics, no weights needed.
    mode="tcn"    -- trained TCN; falls back to rules if weights absent.
    """

    def __init__(
        self,
        mode: Literal["rules", "tcn"] = "rules",
        weights_path: Path | str | None = None,
        window_size: int = WINDOW_SIZE,
        device: str = "cpu",
        feature_mode: FeatureMode = "pos",
    ) -> None:
        self.mode = mode
        self.window_size = window_size
        self.device = device
        self.feature_mode: FeatureMode = feature_mode
        self._model = None
        self._windows: dict[int, deque[Pose]] = {}  # track_id -> pose window

        if mode == "tcn" and weights_path:
            self._try_load_tcn(Path(weights_path))

        if self.mode == "tcn" and self._model is None:
            logger.warning("TCN weights not loaded -- falling back to rules mode.")
            self.mode = "rules"

    def _try_load_tcn(self, path: Path) -> None:
        try:
            import json as _json
            import torch
            # Sidecar metadata (written by train_stroke_classifier.py) wins
            # over the constructor arg so weights and features can't diverge.
            meta_path = path.with_suffix(path.suffix + ".meta.json")
            if meta_path.exists():
                with open(meta_path) as f:
                    meta = _json.load(f)
                self.feature_mode = meta.get("feature_mode", self.feature_mode)
            model = _build_tcn_model(
                len(STROKE_CLASSES), FEATURE_DIMS[self.feature_mode]
            )
            model.load_state_dict(torch.load(path, map_location=self.device))
            model.eval()
            self._model = model.to(self.device)
            logger.info(
                "TCN stroke classifier loaded from %s (features=%s)",
                path, self.feature_mode,
            )
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
        feats = window_to_features(window, self.feature_mode)  # (D, T)
        x = torch.tensor(feats[np.newaxis], dtype=torch.float32).to(self.device)
        with torch.no_grad():
            logits = self._model(x)[0]
            probs  = torch.softmax(logits, dim=-1).cpu().numpy()
        idx    = int(np.argmax(probs))
        return STROKE_CLASSES[idx], float(probs[idx])

    def wrist_speed(self, track_id: int) -> float:
        """Dominant-wrist speed at the latest frame of a track (impact proxy)."""
        return current_wrist_speed(list(self._windows.get(track_id, [])))

    def reset(self, track_id: int | None = None) -> None:
        """Clear pose windows (call between points or at match start)."""
        if track_id is not None:
            self._windows.pop(track_id, None)
        else:
            self._windows.clear()
