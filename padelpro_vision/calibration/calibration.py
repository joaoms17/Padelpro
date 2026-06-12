"""Court homography calibration: interactive keypoint selection + RANSAC."""

from __future__ import annotations
import json
import logging
from pathlib import Path

import cv2
import numpy as np

from padelpro_vision.constants.court import COURT_CORNERS_M

logger = logging.getLogger(__name__)

_WINDOW = "Court Calibration — click 4 corners (TL, TR, BR, BL), press ENTER"

# Quality thresholds for validate_homography
_GOOD_REPROJ_PX = 8.0
_OK_REPROJ_PX = 20.0


def validate_homography(
    H: np.ndarray,
    image_pts: list[list[float]] | np.ndarray,
    court_pts: list[tuple[float, float]] | np.ndarray,
) -> dict:
    """
    Score a computed homography so bad calibrations are caught at source
    instead of surfacing later as absurd speeds/positions.

    Checks:
      - reprojection error: court corners → image (px), vs the clicked points
      - forward error: clicked points → court (m), vs canonical corners
      - convexity + orientation of the clicked quad (crossed/reordered clicks
        produce a valid-looking H that maps the court inside-out)

    Returns {"reprojection_error_px", "forward_error_m", "convex", "rating"}.
    """
    src = np.array(image_pts, dtype=np.float64).reshape(-1, 1, 2)
    dst = np.array(court_pts, dtype=np.float64).reshape(-1, 1, 2)

    fwd = cv2.perspectiveTransform(src, H)
    forward_err_m = float(np.linalg.norm(fwd - dst, axis=2).mean())

    try:
        H_inv = np.linalg.inv(H)
        back = cv2.perspectiveTransform(dst, H_inv)
        reproj_err_px = float(np.linalg.norm(back - src, axis=2).mean())
    except np.linalg.LinAlgError:
        reproj_err_px = float("inf")

    pts = np.array(image_pts, dtype=np.float64)
    convex = bool(
        len(pts) >= 4 and cv2.isContourConvex(pts[:4].astype(np.float32).reshape(-1, 1, 2))
    )

    if not convex or not np.isfinite(reproj_err_px) or reproj_err_px > _OK_REPROJ_PX:
        rating = "bad"
    elif reproj_err_px > _GOOD_REPROJ_PX:
        rating = "ok"
    else:
        rating = "good"

    return {
        "reprojection_error_px": round(reproj_err_px, 2) if np.isfinite(reproj_err_px) else None,
        "forward_error_m": round(forward_err_m, 3),
        "convex": convex,
        "rating": rating,
    }


class CourtCalibrator:
    """Compute and cache the image→court homography for a specific court/camera pair."""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._image_pts: list[list[float]] = []

    def load_or_calibrate(self, frame: np.ndarray, court_id: str) -> np.ndarray:
        """Return cached homography if available, else run interactive calibration."""
        H = self.load(court_id)
        if H is not None:
            logger.info("Homography loaded from cache for court '%s'.", court_id)
            return H
        return self.calibrate_interactive(frame, court_id)

    def calibrate_interactive(self, frame: np.ndarray, court_id: str) -> np.ndarray:
        """Open an OpenCV window; user clicks 4+ court corners; returns homography."""
        self._image_pts = []
        display = frame.copy()
        cv2.namedWindow(_WINDOW, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(_WINDOW, self._mouse_cb, display)
        logger.info("Click 4 court corners: top-left, top-right, bottom-right, bottom-left.")
        while True:
            cv2.imshow(_WINDOW, display)
            key = cv2.waitKey(20) & 0xFF
            if key in (13, ord("q")):
                break
            if key == 27:
                cv2.destroyWindow(_WINDOW)
                raise RuntimeError("Calibration cancelled by user.")
        cv2.destroyWindow(_WINDOW)
        if len(self._image_pts) < 4:
            raise ValueError(f"Need at least 4 points, got {len(self._image_pts)}.")
        court_pts = list(COURT_CORNERS_M[: len(self._image_pts)])
        H = self._compute_homography(self._image_pts, court_pts)
        quality = validate_homography(H, self._image_pts, court_pts)
        if quality["rating"] == "bad":
            logger.warning("Calibration quality is BAD (%s) — re-click the corners.", quality)
        self.save(H, court_id, quality=quality)
        logger.info("Homography computed and saved for court '%s' (%s).", court_id, quality["rating"])
        return H

    def _compute_homography(
        self,
        image_pts: list[list[float]] | np.ndarray,
        court_pts: list[tuple[float, float]] | np.ndarray,
    ) -> np.ndarray:
        src = np.array(image_pts, dtype=np.float32)
        dst = np.array(court_pts, dtype=np.float32)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if H is None:
            raise RuntimeError("findHomography failed — check point correspondences.")
        inliers = int(mask.sum()) if mask is not None else len(src)
        logger.debug("Homography inliers: %d / %d", inliers, len(src))
        return H

    def save(self, H: np.ndarray, court_id: str, quality: dict | None = None) -> None:
        path = self._cache_path(court_id)
        data = {"court_id": court_id, "H": H.tolist()}
        if quality is not None:
            data["quality"] = quality
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        logger.info("Homography saved to %s", path)

    def load_quality(self, court_id: str) -> dict | None:
        """Return the stored calibration quality metrics, if any."""
        path = self._cache_path(court_id)
        if not path.exists():
            return None
        with open(path) as f:
            data = json.load(f)
        return data.get("quality")

    def load(self, court_id: str) -> np.ndarray | None:
        path = self._cache_path(court_id)
        if not path.exists():
            return None
        with open(path) as f:
            data = json.load(f)
        return np.array(data["H"], dtype=np.float64)

    def _cache_path(self, court_id: str) -> Path:
        return self.cache_dir / f"{court_id}.json"

    def _mouse_cb(self, event: int, x: int, y: int, flags: int, display: np.ndarray) -> None:
        if event == cv2.EVENT_LBUTTONDOWN:
            self._image_pts.append([float(x), float(y)])
            cv2.circle(display, (x, y), 6, (0, 255, 0), -1)
            cv2.putText(
                display, str(len(self._image_pts)),
                (x + 8, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2,
            )
            logger.info("Point %d: (%d, %d)", len(self._image_pts), x, y)
