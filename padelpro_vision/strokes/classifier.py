"""
Stroke classifier stub — Milestone 2.

Classes: forehand_volley, backhand_volley, bandeja, vibora, smash, serve, other.
Architecture: TCN or LSTM over a sliding window of pose keypoints.
Fallback: rule-based heuristics from pose geometry (no trained weights needed).
"""

from __future__ import annotations

STROKE_CLASSES = [
    "forehand_volley",
    "backhand_volley",
    "bandeja",
    "vibora",
    "smash",
    "serve",
    "other",
]


class StrokeClassifier:
    def classify(self, pose_sequence: list) -> str:
        raise NotImplementedError("TODO M2: implement temporal stroke classifier.")
