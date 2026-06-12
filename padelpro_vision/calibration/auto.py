"""
Automatic court corner detection — V1, classic CV (no learned model).

Strategy: the court's outer boundary is drawn in bright lines on a darker
surface. We mask bright/low-saturation pixels, close the mask so the line
boundary becomes one blob, take the largest contour and approximate it to a
quadrilateral. Sanity checks (area fraction, convexity, homography quality)
decide whether to trust the result; on any doubt we return None and the UI
falls back to the 4 manual clicks.

Expected hit rate is "most fixed court-behind cameras", not 100% — that's
fine, it removes the manual step where it works and never blocks the flow.
"""

from __future__ import annotations
import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Accept quads covering between 15% and 95% of the frame
MIN_AREA_FRAC = 0.15
MAX_AREA_FRAC = 0.95


def _white_line_mask(frame: np.ndarray) -> np.ndarray:
    """Bright, low-saturation pixels — court lines (and some glass glare)."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # value high, saturation low → white-ish
    mask = cv2.inRange(hsv, (0, 0, 160), (180, 80, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.dilate(mask, kernel, iterations=1)
    return mask


def _order_corners(pts: np.ndarray) -> list[list[float]]:
    """Order 4 points as TL, TR, BR, BL (matches COURT_CORNERS_M)."""
    pts = pts.reshape(4, 2).astype(np.float64)
    # Top pair = smallest y; within each pair sort by x
    idx = np.argsort(pts[:, 1])
    top = sorted(pts[idx[:2]].tolist(), key=lambda p: p[0])
    bottom = sorted(pts[idx[2:]].tolist(), key=lambda p: p[0])
    tl, tr = top[0], top[1]
    bl, br = bottom[0], bottom[1]
    return [tl, tr, br, bl]


def detect_court_corners(frame: np.ndarray) -> list[list[float]] | None:
    """
    Return the 4 court corners [TL, TR, BR, BL] in pixel coordinates, or
    None when no trustworthy quadrilateral is found.
    """
    h, w = frame.shape[:2]
    frame_area = float(h * w)
    mask = _white_line_mask(frame)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Try the biggest contours first; lines form a hollow rectangle, so the
    # outer boundary is normally the largest connected component.
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(contour)
        if area < MIN_AREA_FRAC * frame_area:
            break
        if area > MAX_AREA_FRAC * frame_area:
            continue

        peri = cv2.arcLength(contour, True)
        for eps_frac in (0.02, 0.03, 0.05):
            approx = cv2.approxPolyDP(contour, eps_frac * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                corners = _order_corners(approx)
                if _plausible(corners, w, h):
                    logger.info("Auto-calibration: court quad found (area %.0f%%).",
                                100 * area / frame_area)
                    return corners
    return None


def _plausible(corners: list[list[float]], w: int, h: int) -> bool:
    """Camera-behind-court geometry: bottom edge wider than top, not degenerate."""
    tl, tr, br, bl = corners
    top_w = abs(tr[0] - tl[0])
    bottom_w = abs(br[0] - bl[0])
    height = ((bl[1] - tl[1]) + (br[1] - tr[1])) / 2.0
    if top_w < 0.05 * w or bottom_w < 0.10 * w or height < 0.10 * h:
        return False
    # Perspective from behind: the near (bottom) edge appears wider
    return bottom_w >= 0.8 * top_w


def auto_calibrate(frame: np.ndarray) -> dict | None:
    """
    Full auto-calibration: detect corners, fit the homography, score it.
    Returns {"points", "H", "quality"} or None. Never saves — the caller
    (API/UI) confirms with the user first.
    """
    from padelpro_vision.calibration.calibration import validate_homography
    from padelpro_vision.constants.court import COURT_CORNERS_M

    corners = detect_court_corners(frame)
    if corners is None:
        return None

    src = np.array(corners, dtype=np.float32)
    dst = np.array(COURT_CORNERS_M, dtype=np.float32)
    H, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if H is None:
        return None

    quality = validate_homography(H, corners, list(COURT_CORNERS_M))
    if quality["rating"] == "bad":
        logger.info("Auto-calibration rejected by quality check: %s", quality)
        return None

    return {"points": corners, "H": H.tolist(), "quality": quality}
