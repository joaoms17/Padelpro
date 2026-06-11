"""
Pose estimation wrapper — RTMPose / ViTPose via MMPose (Apache 2.0).

Download weights:
    mim download mmpose --config rtmpose-m_8xb256-420e_coco-256x192 --dest checkpoints/

License: RTMPose — Apache 2.0. Confirm weight file license before production use.

When MMPose is not installed, falls back to a geometric stub that returns
zero-confidence keypoints so the pipeline can run end-to-end for testing.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from padelpro_vision.detection.detector import PlayerBox

logger = logging.getLogger(__name__)

# COCO 17-keypoint skeleton indices
COCO_KEYPOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
N_KEYPOINTS = 17

# Useful keypoint indices
KP_LEFT_WRIST   = 9
KP_RIGHT_WRIST  = 10
KP_LEFT_SHOULDER  = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW   = 7
KP_RIGHT_ELBOW  = 8
KP_LEFT_HIP     = 11
KP_RIGHT_HIP    = 12
KP_NOSE         = 0


@dataclass
class Pose:
    """17-keypoint pose estimate (COCO format)."""
    keypoints: np.ndarray   # (17, 2) — pixel (x, y) relative to full frame
    scores: np.ndarray      # (17,)   — confidence per keypoint
    bbox: PlayerBox | None = None


class PoseEstimator:
    """
    RTMPose-based pose estimator with automatic stub fallback.

    Usage:
        estimator = PoseEstimator(config_path, weights_path)
        pose = estimator.estimate(frame, player_box)
    """

    def __init__(
        self,
        config_path: Path | str | None = None,
        weights_path: Path | str | None = None,
        device: str = "cpu",
    ) -> None:
        self._model = None
        self._device = device
        if config_path and weights_path:
            self._try_load(Path(config_path), Path(weights_path))
        if self._model is None:
            logger.warning(
                "RTMPose not loaded — using geometric stub. "
                "Install: mim install mmpose && "
                "mim download mmpose --config rtmpose-m_8xb256-420e_coco-256x192 --dest checkpoints/"
            )

    def _try_load(self, config: Path, weights: Path) -> None:
        try:
            from mmpose.apis import init_model
            if config.exists() and weights.exists():
                self._model = init_model(str(config), str(weights), device=self._device)
                logger.info("RTMPose loaded from %s", weights)
            else:
                logger.warning("RTMPose weights not found at %s", weights)
        except ImportError:
            logger.warning("mmpose not installed — pose estimator in stub mode.")

    def estimate(self, frame: np.ndarray, box: PlayerBox) -> Pose:
        """Estimate 17-keypoint pose for one player bounding box."""
        if self._model is not None:
            return self._estimate_mmpose(frame, box)
        return self._stub_pose(box)

    def estimate_batch(self, frame: np.ndarray, boxes: list[PlayerBox]) -> list[Pose]:
        """Estimate poses for all players in one frame."""
        return [self.estimate(frame, b) for b in boxes]

    def _estimate_mmpose(self, frame: np.ndarray, box: PlayerBox) -> Pose:
        from mmpose.apis import inference_topdown
        from mmpose.structures import merge_data_samples
        person = {"bbox": np.array([[box.x1, box.y1, box.x2, box.y2, box.confidence]])}
        result = inference_topdown(self._model, frame, [person])
        merged = merge_data_samples(result)
        kps    = merged.pred_instances.keypoints[0]      # (17, 2)
        scores = merged.pred_instances.keypoint_scores[0]  # (17,)
        return Pose(keypoints=kps.astype(np.float32), scores=scores.astype(np.float32), bbox=box)

    @staticmethod
    def _stub_pose(box: PlayerBox) -> Pose:
        """Geometric stub: distribute keypoints evenly inside the bounding box."""
        cx = (box.x1 + box.x2) / 2
        h  = box.y2 - box.y1
        # Rough proportions for a standing person
        fractions = [0.05, 0.08, 0.08, 0.1, 0.1, 0.22, 0.22, 0.35, 0.35,
                     0.48, 0.48, 0.55, 0.55, 0.75, 0.75, 0.95, 0.95]
        offsets_x = [0, -5, 5, -8, 8, -12, 12, -18, 18,
                     -22, 22, -10, 10, -10, 10, -10, 10]
        kps = np.array(
            [[cx + offsets_x[i], box.y1 + fractions[i] * h] for i in range(N_KEYPOINTS)],
            dtype=np.float32,
        )
        scores = np.zeros(N_KEYPOINTS, dtype=np.float32)
        return Pose(keypoints=kps, scores=scores, bbox=box)
