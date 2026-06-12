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
        self._tracks: dict[int, dict] = {}   # id → {box, ts_ms, vx, vy}
        self._next_id = 1
        # Velocity EMA factor and max horizon for coasting a lost track. A
        # player occluded behind a partner keeps moving; predicting the
        # centroid forward keeps the ID instead of spawning a new one.
        self._vel_alpha = 0.5
        self._max_predict_ms = 1000.0

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
            # Constant-velocity prediction: coast the centroid forward for up
            # to _max_predict_ms so a briefly occluded player is matched where
            # he is now, not where he was last seen.
            dt_ms = min(timestamp_ms - t["ts_ms"], self._max_predict_ms)
            if dt_ms > 0:
                tcx += t.get("vx", 0.0) * dt_ms
                tcy += t.get("vy", 0.0) * dt_ms
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
            prev = self._tracks[tid]
            dt_ms = timestamp_ms - prev["ts_ms"]
            vx = prev.get("vx", 0.0)
            vy = prev.get("vy", 0.0)
            if dt_ms > 0:
                pcx, pcy = prev["box"].center
                dcx, dcy = d.center
                inst_vx = (dcx - pcx) / dt_ms
                inst_vy = (dcy - pcy) / dt_ms
                vx = self._vel_alpha * inst_vx + (1 - self._vel_alpha) * vx
                vy = self._vel_alpha * inst_vy + (1 - self._vel_alpha) * vy
            self._tracks[tid] = {"box": d, "ts_ms": timestamp_ms, "vx": vx, "vy": vy}
            out.append(Track(track_id=tid, box=d, frame_idx=frame_idx, timestamp_ms=timestamp_ms))

        # New tracks for unmatched detections
        for di, d in enumerate(detections):
            if di in assigned_dets:
                continue
            tid = self._next_id
            self._next_id += 1
            self._tracks[tid] = {"box": d, "ts_ms": timestamp_ms, "vx": 0.0, "vy": 0.0}
            out.append(Track(track_id=tid, box=d, frame_idx=frame_idx, timestamp_ms=timestamp_ms))

        return out


# Backwards-compatible alias (older code/tests import the stub by this name)
_StubByteTrack = GreedyTracker


def build_player_tracker(frame_rate: float = 25.0):
    """
    The project's tracker: supervision ByteTrack (MIT, Kalman-based) when the
    package is installed, GreedyTracker otherwise. Both expose update().
    """
    try:
        tracker = SupervisionByteTrack(frame_rate=frame_rate)
        logger.info("Tracking with supervision ByteTrack (frame_rate=%.1f).", frame_rate)
        return tracker
    except ImportError:
        logger.info("supervision not installed — using built-in GreedyTracker.")
        return GreedyTracker()


def make_court_gate(H: np.ndarray, margin_x_m: float = 1.5, margin_y_m: float = 2.0):
    """
    Build a detection filter that keeps only people whose foot point projects
    onto (or near) the court — removes spectators and players on other courts.
    """
    from padelpro_vision.constants.court import COURT_LENGTH_M, COURT_WIDTH_M
    from padelpro_vision.projection.projection import foot_point, project_point

    def gate(detections: list[PlayerBox]) -> list[PlayerBox]:
        kept: list[PlayerBox] = []
        for d in detections:
            px, py = foot_point(d)
            cx, cy = project_point(H, px, py)
            if (-margin_x_m <= cx <= COURT_WIDTH_M + margin_x_m
                    and -margin_y_m <= cy <= COURT_LENGTH_M + margin_y_m):
                kept.append(d)
        return kept

    return gate


class Tracker:
    """High-level tracker: detector → [court gate] → ByteTrack/Greedy."""

    def __init__(self, cfg=None, detection_filter=None, frame_rate: float = 25.0) -> None:
        from config import DEFAULT_CONFIG
        self._cfg = cfg or DEFAULT_CONFIG
        from padelpro_vision.detection.detector import build_detector
        self._detector = build_detector(self._cfg)
        self._bt = build_player_tracker(frame_rate=frame_rate)
        self._filter = detection_filter

    @property
    def detection_filter(self):
        return self._filter

    @detection_filter.setter
    def detection_filter(self, fn) -> None:
        self._filter = fn

    def track(self, frame: np.ndarray, frame_idx: int, timestamp_ms: float) -> list[Track]:
        detections = self._detector.detect(frame)
        if self._filter is not None:
            detections = self._filter(detections)
        return self._bt.update(detections, frame_idx, timestamp_ms)
