"""
2D court projection — apply homography to map pixel coordinates → court metres.

The homography H is computed by CourtCalibrator (4 corner points, RANSAC).
All positions are expressed in (x_m, y_m) from the top-left court corner.
"""

from __future__ import annotations
import numpy as np


def project_point(H: np.ndarray, pixel_x: float, pixel_y: float) -> tuple[float, float]:
    """Project one image pixel to court coordinates (metres) using homography H."""
    src = np.array([[[pixel_x, pixel_y]]], dtype=np.float64)
    dst = _apply_homography(H, src)
    return float(dst[0, 0, 0]), float(dst[0, 0, 1])


def project_points(H: np.ndarray, pixels: np.ndarray) -> np.ndarray:
    """
    Project N pixel coordinates to court coordinates.

    Args:
        H:      (3, 3) homography matrix.
        pixels: (N, 2) array of (x, y) pixel coordinates.

    Returns:
        (N, 2) array of (court_x, court_y) in metres.
    """
    if len(pixels) == 0:
        return np.empty((0, 2), dtype=np.float64)
    src = pixels.reshape(1, -1, 2).astype(np.float64)
    dst = _apply_homography(H, src)
    return dst.reshape(-1, 2)


def _apply_homography(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    import cv2
    return cv2.perspectiveTransform(pts, H)


def foot_point(box) -> tuple[float, float]:
    """Return the foot-contact pixel (bottom-centre of bounding box)."""
    cx = (box.x1 + box.x2) / 2.0
    return cx, float(box.y2)


def project_track_positions(
    H: np.ndarray,
    frame_results: list,
) -> dict[int, list[tuple[float, float, float]]]:
    """
    Project all track positions to court coordinates.

    Returns:
        {track_id: [(ts_ms, court_x, court_y), ...]}
    """
    positions: dict[int, list] = {}
    for fr in frame_results:
        for t in fr.tracks:
            px, py = foot_point(t.box)
            cx, cy = project_point(H, px, py)
            if t.track_id not in positions:
                positions[t.track_id] = []
            positions[t.track_id].append((fr.timestamp_ms, cx, cy))
    return positions
