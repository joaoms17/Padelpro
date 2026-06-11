"""Visualisation utilities — M1: bounding box overlays. M3: heatmaps, shot charts."""

from __future__ import annotations
import cv2
import numpy as np

from padelpro_vision.tracking.tracker import Track


def annotate_frame(frame: np.ndarray, tracks: list[Track]) -> np.ndarray:
    """Draw bounding boxes and track IDs onto a frame (returns a copy)."""
    out = frame.copy()
    for t in tracks:
        b = t.box
        x1, y1, x2, y2 = int(b.x1), int(b.y1), int(b.x2), int(b.y2)
        cv2.rectangle(out, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(
            out, f"ID:{t.track_id}  {b.confidence:.2f}",
            (x1, max(y1 - 6, 10)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2,
        )
    return out


# TODO (M3): heatmap_image(), shot_distribution_chart(), mini_court_overlay()
