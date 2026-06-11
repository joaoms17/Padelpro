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
        self.save(H, court_id)
        logger.info("Homography computed and saved for court '%s'.", court_id)
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

    def save(self, H: np.ndarray, court_id: str) -> None:
        path = self._cache_path(court_id)
        with open(path, "w") as f:
            json.dump({"court_id": court_id, "H": H.tolist()}, f, indent=2)
        logger.info("Homography saved to %s", path)

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
