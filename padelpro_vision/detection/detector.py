"""Player detection wrappers for RTMDet and YOLOX (Apache 2.0)."""

from __future__ import annotations
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class PlayerBox:
    """Bounding box for a detected player."""
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    class_id: int = 0

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    @property
    def center(self) -> tuple[float, float]:
        return (self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2

    def to_xyxy(self) -> list[float]:
        return [self.x1, self.y1, self.x2, self.y2]


class BaseDetector:
    """Abstract base for all player detectors."""

    def detect(self, frame: np.ndarray) -> list[PlayerBox]:
        raise NotImplementedError


class YOLOXDetector(BaseDetector):
    """
    YOLOX-based player detector.

    TODO: install MMDetection and download YOLOX-m weights (Apache 2.0):
        pip install openmim mmcv
        mim install mmdet
        mim download mmdet --config yolox_m_8xb8-300e_coco --dest checkpoints/

    License: YOLOX — Apache 2.0. Confirm weight file license at download time.
    """

    def __init__(
        self,
        config_path: Path | str,
        weights_path: Path | str,
        score_thr: float = 0.5,
        device: str = "cpu",
    ) -> None:
        self.config_path = Path(config_path)
        self.weights_path = Path(weights_path)
        self.score_thr = score_thr
        self.device = device
        self._model = None
        self._try_load()

    def _try_load(self) -> None:
        try:
            from mmdet.apis import init_detector
            if self.config_path.exists() and self.weights_path.exists():
                self._model = init_detector(
                    str(self.config_path), str(self.weights_path), device=self.device
                )
                logger.info("YOLOX detector loaded from %s", self.weights_path)
            else:
                logger.warning(
                    "YOLOX weights not found at %s — running in stub mode. "
                    "Download: mim download mmdet --config yolox_m_8xb8-300e_coco --dest checkpoints/",
                    self.weights_path,
                )
        except ImportError:
            logger.warning("mmdet not installed — YOLOX detector in stub mode.")

    def detect(self, frame: np.ndarray) -> list[PlayerBox]:
        if self._model is None:
            return []
        from mmdet.apis import inference_detector
        result = inference_detector(self._model, frame)
        boxes: list[PlayerBox] = []
        bboxes = result.pred_instances.bboxes.cpu().numpy()
        scores = result.pred_instances.scores.cpu().numpy()
        labels = result.pred_instances.labels.cpu().numpy()
        for bbox, score, label in zip(bboxes, scores, labels):
            if label == 0 and score >= self.score_thr:
                boxes.append(PlayerBox(
                    float(bbox[0]), float(bbox[1]),
                    float(bbox[2]), float(bbox[3]),
                    float(score),
                ))
        return boxes


class RTMDetDetector(BaseDetector):
    """
    RTMDet-based player detector.

    TODO: install MMDetection and download RTMDet-m weights (Apache 2.0):
        mim download mmdet --config rtmdet_m_8xb32-300e_coco --dest checkpoints/

    License: RTMDet — Apache 2.0. Confirm weight file license at download time.
    """

    def __init__(
        self,
        config_path: Path | str,
        weights_path: Path | str,
        score_thr: float = 0.5,
        device: str = "cpu",
    ) -> None:
        self.config_path = Path(config_path)
        self.weights_path = Path(weights_path)
        self.score_thr = score_thr
        self.device = device
        self._model = None
        self._try_load()

    def _try_load(self) -> None:
        try:
            from mmdet.apis import init_detector
            if self.config_path.exists() and self.weights_path.exists():
                self._model = init_detector(
                    str(self.config_path), str(self.weights_path), device=self.device
                )
                logger.info("RTMDet detector loaded from %s", self.weights_path)
            else:
                logger.warning(
                    "RTMDet weights not found at %s — running in stub mode. "
                    "Download: mim download mmdet --config rtmdet_m_8xb32-300e_coco --dest checkpoints/",
                    self.weights_path,
                )
        except ImportError:
            logger.warning("mmdet not installed — RTMDet detector in stub mode.")

    def detect(self, frame: np.ndarray) -> list[PlayerBox]:
        if self._model is None:
            return []
        from mmdet.apis import inference_detector
        result = inference_detector(self._model, frame)
        boxes: list[PlayerBox] = []
        bboxes = result.pred_instances.bboxes.cpu().numpy()
        scores = result.pred_instances.scores.cpu().numpy()
        labels = result.pred_instances.labels.cpu().numpy()
        for bbox, score, label in zip(bboxes, scores, labels):
            if label == 0 and score >= self.score_thr:
                boxes.append(PlayerBox(
                    float(bbox[0]), float(bbox[1]),
                    float(bbox[2]), float(bbox[3]),
                    float(score),
                ))
        return boxes


def build_detector(cfg) -> BaseDetector:
    """Factory: instantiate the detector specified in ModelConfig."""
    detector_type = cfg.model.detector_type.lower()
    if detector_type == "yolox":
        return YOLOXDetector(
            cfg.model.detector_config,
            cfg.model.detector_weights,
            score_thr=cfg.model.score_threshold,
            device=cfg.model.device,
        )
    if detector_type == "rtmdet":
        return RTMDetDetector(
            cfg.model.detector_config,
            cfg.model.detector_weights,
            score_thr=cfg.model.score_threshold,
            device=cfg.model.device,
        )
    raise ValueError(f"Unknown detector type: {detector_type!r}. Choose 'yolox' or 'rtmdet'.")
