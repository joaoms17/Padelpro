"""Player detection — torchvision backend (BSD-3-Clause).

The project standardised on a single detection stack:
    torchvision Faster R-CNN (players) → supervision ByteTrack → RTMPose → TCN

Upgrading the detector later (e.g. a fine-tuned model) means implementing
BaseDetector.detect() and wiring it in build_detector — nothing else changes.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass

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


class TorchvisionDetector(BaseDetector):
    """
    Player detector backed by torchvision's pretrained COCO detection models.

    License: torchvision — BSD-3-Clause (model weights are permissively licensed),
    satisfying the project's "no AGPL/NC" rule. Works on modern Python + torch
    without extra toolchains.

    Default model is Faster R-CNN with a MobileNetV3 backbone — a good
    speed/accuracy balance on CPU. COCO label 1 == "person".
    """

    def __init__(
        self,
        score_thr: float = 0.5,
        device: str = "cpu",
        model_name: str = "fasterrcnn_mobilenet_v3_large_fpn",
        min_size: int | None = None,
        target_label: int = 1,
    ) -> None:
        self.score_thr = score_thr
        self.device = device
        self.model_name = model_name
        self.min_size = min_size       # smaller → faster inference, lower accuracy
        self.target_label = target_label  # COCO: 1=person, 37=sports ball
        self._model = None
        self._torch = None
        self._try_load()

    def _try_load(self) -> None:
        try:
            import torch
            from torchvision.models import detection as tvdet
        except ImportError:
            logger.warning("torch/torchvision not installed — detector in stub mode.")
            return

        builder = getattr(tvdet, self.model_name, None)
        if builder is None:
            logger.warning("Unknown torchvision model %r — detector in stub mode.", self.model_name)
            return

        self._torch = torch
        kwargs: dict = {"weights": "DEFAULT"}
        if self.min_size:
            kwargs["min_size"] = self.min_size
            kwargs["max_size"] = int(self.min_size * 16 / 9) + 1
        self._model = builder(**kwargs)
        self._model.eval().to(self.device)
        logger.info("Torchvision detector '%s' loaded on %s.", self.model_name, self.device)

    def detect(self, frame: np.ndarray) -> list[PlayerBox]:
        if self._model is None:
            return []
        torch = self._torch
        # OpenCV frames are BGR HxWx3 uint8 → torchvision expects RGB CxHxW float [0,1]
        rgb = np.ascontiguousarray(frame[:, :, ::-1])
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0).to(self.device)
        with torch.no_grad():
            out = self._model([tensor])[0]

        bboxes = out["boxes"].cpu().numpy()
        scores = out["scores"].cpu().numpy()
        labels = out["labels"].cpu().numpy()
        boxes: list[PlayerBox] = []
        for bbox, score, label in zip(bboxes, scores, labels):
            if int(label) == self.target_label and score >= self.score_thr:
                boxes.append(PlayerBox(
                    float(bbox[0]), float(bbox[1]),
                    float(bbox[2]), float(bbox[3]),
                    float(score),
                ))
        return boxes


def build_detector(cfg) -> BaseDetector:
    """Factory: instantiate the detector specified in ModelConfig."""
    detector_type = cfg.model.detector_type.lower()
    if detector_type != "torchvision":
        raise ValueError(
            f"Unknown detector type: {detector_type!r}. Only 'torchvision' is "
            "supported (the YOLOX/RTMDet MMDetection wrappers were removed — "
            "they only ever ran in stub mode)."
        )
    return TorchvisionDetector(
        score_thr=cfg.model.score_threshold,
        device=cfg.model.device,
    )
