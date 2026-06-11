"""
Pose estimation stub — Milestone 2.

TODO: wrap RTMPose/ViTPose (MMPose, Apache 2.0).
Download: mim download mmpose --config rtmpose-m_8xb256-420e_coco-256x192 --dest checkpoints/
License: RTMPose — Apache 2.0. Confirm weight file license before production use.
"""

from __future__ import annotations
from dataclasses import dataclass

import numpy as np

from padelpro_vision.detection.detector import PlayerBox


@dataclass
class Pose:
    """17-keypoint pose estimate in COCO format."""
    keypoints: np.ndarray   # (17, 2) pixel coordinates
    scores: np.ndarray      # (17,)


class PoseEstimator:
    def estimate(self, frame: np.ndarray, box: PlayerBox) -> Pose:
        raise NotImplementedError("TODO M2: implement RTMPose wrapper.")
