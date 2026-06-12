"""
Pose estimation wrapper — RTMPose, two backends (both Apache 2.0):

  1. rtmlib (ONNX) — RECOMMENDED, easy install, no compilation:
        pip install rtmlib onnxruntime
     Weights download automatically on first use.

  2. MMPose — heavier (needs mmcv compiled); set ModelConfig.pose_config /
     pose_weights and:
        mim install mmpose && mim download mmpose --config \\
          rtmpose-m_8xb256-420e_coco-256x192 --dest checkpoints/

When neither is available, falls back to a geometric stub that returns
zero-confidence keypoints so the pipeline still runs end-to-end (but stroke
classification is meaningless — install a real backend for real results).
"""

from __future__ import annotations
import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from padelpro_vision.detection.detector import PlayerBox

logger = logging.getLogger(__name__)

# RTMPose-m trained on body7, outputs 17 COCO keypoints. rtmlib downloads and
# caches the ONNX weights from this URL on first use.
_RTMLIB_POSE_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
    "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip"
)
_RTMLIB_INPUT_SIZE = (192, 256)

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
        self._model = None      # mmpose model
        self._rtmlib = None     # rtmlib ONNX model
        self._device = device
        self.backend = "stub"

        # 1. rtmlib (ONNX) — preferred: easy install, weights auto-download.
        self._try_rtmlib()
        # 2. MMPose — only if rtmlib unavailable and weights were provided.
        if self._rtmlib is None and config_path and weights_path:
            self._try_load(Path(config_path), Path(weights_path))

        if self._rtmlib is None and self._model is None:
            logger.warning(
                "RTMPose not loaded — using geometric stub (stroke classification "
                "will be meaningless). Easiest fix:  pip install rtmlib onnxruntime"
            )

    def _try_rtmlib(self) -> None:
        try:
            from rtmlib import RTMPose
        except ImportError:
            return
        try:
            self._rtmlib = RTMPose(
                onnx_model=_RTMLIB_POSE_URL,
                model_input_size=_RTMLIB_INPUT_SIZE,
                backend="onnxruntime",
                device="cuda" if str(self._device).startswith("cuda") else "cpu",
            )
            self.backend = "rtmlib"
            logger.info("RTMPose (rtmlib/ONNX) loaded on %s.", self._device)
        except Exception as exc:   # noqa: BLE001 — fall back gracefully
            logger.warning("rtmlib present but failed to init (%s) — trying other backends.", exc)
            self._rtmlib = None

    def _try_load(self, config: Path, weights: Path) -> None:
        try:
            from mmpose.apis import init_model
            if config.exists() and weights.exists():
                self._model = init_model(str(config), str(weights), device=self._device)
                self.backend = "mmpose"
                logger.info("RTMPose loaded from %s", weights)
            else:
                logger.warning("RTMPose weights not found at %s", weights)
        except ImportError:
            logger.warning("mmpose not installed — pose estimator in stub mode.")

    def estimate(self, frame: np.ndarray, box: PlayerBox) -> Pose:
        """Estimate 17-keypoint pose for one player bounding box."""
        if self._rtmlib is not None:
            return self._estimate_rtmlib(frame, [box])[0]
        if self._model is not None:
            return self._estimate_mmpose(frame, box)
        return self._stub_pose(box)

    def estimate_batch(self, frame: np.ndarray, boxes: list[PlayerBox]) -> list[Pose]:
        """Estimate poses for all players in one frame (one rtmlib call)."""
        if self._rtmlib is not None and boxes:
            return self._estimate_rtmlib(frame, boxes)
        return [self.estimate(frame, b) for b in boxes]

    def _estimate_rtmlib(self, frame: np.ndarray, boxes: list[PlayerBox]) -> list[Pose]:
        bboxes = [[b.x1, b.y1, b.x2, b.y2] for b in boxes]
        keypoints, scores = self._rtmlib(frame, bboxes=bboxes)
        return [
            Pose(
                keypoints=np.asarray(keypoints[i], dtype=np.float32),
                scores=np.asarray(scores[i], dtype=np.float32),
                bbox=boxes[i],
            )
            for i in range(len(boxes))
        ]

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
