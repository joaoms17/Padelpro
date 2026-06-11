"""
Court calibration script — interactive keypoint selection.

Usage:
    python scripts/calibrate_court.py --video path/to/video.mp4 --court-id sintra_court1
    python scripts/calibrate_court.py --video path/to/video.mp4 --court-id sintra_court1 --frame 30
"""

from __future__ import annotations
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
from config import DEFAULT_CONFIG
from padelpro_vision.calibration.calibration import CourtCalibrator

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate court homography interactively.")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--court-id", required=True, help="Unique ID for this court/camera setup.")
    parser.add_argument("--frame", type=int, default=0, help="Frame index for calibration image.")
    args = parser.parse_args()

    cap = cv2.VideoCapture(str(args.video))
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        logger.error("Could not read frame %d from %s", args.frame, args.video)
        sys.exit(1)

    calibrator = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
    H = calibrator.calibrate_interactive(frame, args.court_id)

    cache = DEFAULT_CONFIG.calibration.homography_cache_dir / f"{args.court_id}.json"
    print(f"\nHomografia guardada para campo '{args.court_id}'.")
    print(f"Ficheiro: {cache}")
    print("\nMatriz H:")
    print(H)


if __name__ == "__main__":
    main()
