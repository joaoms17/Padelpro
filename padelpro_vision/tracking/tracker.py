"""ByteTrack-based multi-object tracker wrapper."""

from __future__ import annotations
import logging
from dataclasses import dataclass

import numpy as np

from padelpro_vision.detection.detector import PlayerBox

logger = logging.getLogger(__name__)


@dataclass
class Track:
    """A tracked player at a specific frame."""
    track_id: int
    box: PlayerBox
    frame_idx: int
    timestamp_ms: float


class _StubByteTrack:
    """Minimal stub that assigns stable IDs when ByteTrack is not installed."""

    def update(
        self, detections: list[PlayerBox], frame_idx: int, timestamp_ms: float
    ) -> list[Track]:
        return [
            Track(track_id=i + 1, box=det, frame_idx=frame_idx, timestamp_ms=timestamp_ms)
            for i, det in enumerate(detections)
        ]


class ByteTrackTracker:
    """
    ByteTrack multi-object tracker.

    TODO: install ByteTrack (MIT):
        pip install git+https://github.com/ifzhang/ByteTrack.git
    or:
        pip install bytetracker
    """

    def __init__(
        self,
        track_thresh: float = 0.5,
        track_buffer: int = 30,
        match_thresh: float = 0.8,
    ) -> None:
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh
        self._impl = None
        self._stub = _StubByteTrack()
        self._try_load()

    def _try_load(self) -> None:
        try:
            from bytetracker import BYTETracker

            class _Args:
                track_thresh = self.track_thresh
                track_buffer = self.track_buffer
                match_thresh = self.match_thresh
                mot20 = False

            self._impl = BYTETracker(_Args())
            logger.info("ByteTrack loaded successfully.")
        except ImportError:
            logger.warning(
                "bytetracker not installed — running stub tracker. "
                "Install: pip install git+https://github.com/ifzhang/ByteTrack.git"
            )

    def update(
        self, detections: list[PlayerBox], frame_idx: int, timestamp_ms: float
    ) -> list[Track]:
        if self._impl is None:
            return self._stub.update(detections, frame_idx, timestamp_ms)
        if not detections:
            return []
        dets_np = np.array(
            [[d.x1, d.y1, d.x2, d.y2, d.confidence] for d in detections],
            dtype=np.float32,
        )
        online_targets = self._impl.update(dets_np, [1080, 1920], [1080, 1920])
        tracks: list[Track] = []
        for t in online_targets:
            tlbr = t.tlbr
            box = PlayerBox(
                x1=float(tlbr[0]), y1=float(tlbr[1]),
                x2=float(tlbr[2]), y2=float(tlbr[3]),
                confidence=float(t.score),
            )
            tracks.append(Track(
                track_id=int(t.track_id), box=box,
                frame_idx=frame_idx, timestamp_ms=timestamp_ms,
            ))
        return tracks


class Tracker:
    """High-level tracker: detector → ByteTrackTracker."""

    def __init__(self, cfg=None) -> None:
        from config import DEFAULT_CONFIG
        self._cfg = cfg or DEFAULT_CONFIG
        from padelpro_vision.detection.detector import build_detector
        self._detector = build_detector(self._cfg)
        self._bt = ByteTrackTracker(track_thresh=self._cfg.model.score_threshold)

    def track(self, frame: np.ndarray, frame_idx: int, timestamp_ms: float) -> list[Track]:
        detections = self._detector.detect(frame)
        return self._bt.update(detections, frame_idx, timestamp_ms)
