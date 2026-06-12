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


class SupervisionByteTrack:
    """
    ByteTrack via the `supervision` package (MIT). Kalman-based association —
    noticeably fewer ID switches than GreedyTracker when players cross.
    Falls back is handled by the caller (import may fail).
    """

    def __init__(self, frame_rate: float = 4.0, lost_track_s: float = 4.0) -> None:
        import supervision as sv
        self._sv = sv
        self._impl = sv.ByteTrack(
            frame_rate=max(1, int(round(frame_rate))),
            lost_track_buffer=max(2, int(lost_track_s * frame_rate)),
            track_activation_threshold=0.30,
            minimum_matching_threshold=0.85,
        )

    def update(
        self, detections: list[PlayerBox], frame_idx: int, timestamp_ms: float
    ) -> list[Track]:
        if not detections:
            return []
        sv = self._sv
        dets = sv.Detections(
            xyxy=np.array([[d.x1, d.y1, d.x2, d.y2] for d in detections], dtype=np.float32),
            confidence=np.array([d.confidence for d in detections], dtype=np.float32),
            class_id=np.zeros(len(detections), dtype=int),
        )
        out = self._impl.update_with_detections(dets)
        tracks: list[Track] = []
        for i in range(len(out)):
            tid = out.tracker_id[i] if out.tracker_id is not None else None
            if tid is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in out.xyxy[i])
            conf = float(out.confidence[i]) if out.confidence is not None else 0.5
            tracks.append(Track(
                track_id=int(tid),
                box=PlayerBox(x1, y1, x2, y2, conf),
                frame_idx=frame_idx,
                timestamp_ms=timestamp_ms,
            ))
        return tracks


class GreedyTracker:
    """
    Lightweight multi-object tracker for padel (≤6 targets, low frame rate).

    Greedy nearest-centroid matching with an IoU bonus and a track memory so a
    player occluded for up to `max_missed_s` keeps the same ID. Distances are
    normalised by box size, which makes the same threshold work for near (big)
    and far (small) players.
    """

    def __init__(self, max_missed_s: float = 2.5, max_dist_boxes: float = 2.2) -> None:
        # max_dist_boxes: max centroid jump between matches, in units of box height.
        self.max_missed_s = max_missed_s
        self.max_dist_boxes = max_dist_boxes
        self._tracks: dict[int, dict] = {}   # id → {box, ts_ms}
        self._next_id = 1

    @staticmethod
    def _iou(a: PlayerBox, b: PlayerBox) -> float:
        ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
        ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        union = a.width * a.height + b.width * b.height - inter
        return inter / union if union > 0 else 0.0

    def update(
        self, detections: list[PlayerBox], frame_idx: int, timestamp_ms: float
    ) -> list[Track]:
        # Drop tracks not seen for too long
        stale = [
            tid for tid, t in self._tracks.items()
            if timestamp_ms - t["ts_ms"] > self.max_missed_s * 1000.0
        ]
        for tid in stale:
            del self._tracks[tid]

        # Build all candidate (cost, track_id, det_idx) pairs
        candidates: list[tuple[float, int, int]] = []
        for tid, t in self._tracks.items():
            tb: PlayerBox = t["box"]
            tcx, tcy = tb.center
            scale = max(tb.height, 1.0)
            for di, d in enumerate(detections):
                dcx, dcy = d.center
                dist = float(np.hypot(dcx - tcx, dcy - tcy)) / scale
                if dist > self.max_dist_boxes:
                    continue
                cost = dist - 0.5 * self._iou(tb, d)
                candidates.append((cost, tid, di))

        candidates.sort(key=lambda c: c[0])
        assigned_tracks: set[int] = set()
        assigned_dets: set[int] = set()
        matches: list[tuple[int, int]] = []
        for cost, tid, di in candidates:
            if tid in assigned_tracks or di in assigned_dets:
                continue
            assigned_tracks.add(tid)
            assigned_dets.add(di)
            matches.append((tid, di))

        out: list[Track] = []
        for tid, di in matches:
            d = detections[di]
            self._tracks[tid] = {"box": d, "ts_ms": timestamp_ms}
            out.append(Track(track_id=tid, box=d, frame_idx=frame_idx, timestamp_ms=timestamp_ms))

        # New tracks for unmatched detections
        for di, d in enumerate(detections):
            if di in assigned_dets:
                continue
            tid = self._next_id
            self._next_id += 1
            self._tracks[tid] = {"box": d, "ts_ms": timestamp_ms}
            out.append(Track(track_id=tid, box=d, frame_idx=frame_idx, timestamp_ms=timestamp_ms))

        return out


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
        self._stub = GreedyTracker()
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
            logger.info("bytetracker not installed — using built-in GreedyTracker.")

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
