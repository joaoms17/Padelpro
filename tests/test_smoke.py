"""Smoke tests for M1 — no real video or model weights required."""

from __future__ import annotations
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_imports():
    import padelpro_vision
    from padelpro_vision.io.video import VideoReader, VideoWriter, get_video_info
    from padelpro_vision.detection.detector import PlayerBox, build_detector
    from padelpro_vision.tracking.tracker import Track, Tracker
    from padelpro_vision.calibration.calibration import CourtCalibrator
    from padelpro_vision.pipeline import Pipeline, FrameResult, PipelineResult
    from padelpro_vision.constants.court import COURT_LENGTH_M, COURT_WIDTH_M


def test_get_video_info_missing_file():
    from padelpro_vision.io.video import get_video_info
    with pytest.raises(FileNotFoundError):
        get_video_info("/nonexistent/video.mp4")


def test_player_box():
    from padelpro_vision.detection.detector import PlayerBox
    box = PlayerBox(x1=10.0, y1=20.0, x2=110.0, y2=220.0, confidence=0.9)
    assert box.width == 100.0
    assert box.height == 200.0
    cx, cy = box.center
    assert cx == 60.0
    assert cy == 120.0
    assert box.to_xyxy() == [10.0, 20.0, 110.0, 220.0]


def test_track():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.tracking.tracker import Track
    box = PlayerBox(0.0, 0.0, 50.0, 100.0, 0.8)
    t = Track(track_id=1, box=box, frame_idx=0, timestamp_ms=0.0)
    assert t.track_id == 1


def test_homography_computation():
    from padelpro_vision.calibration.calibration import CourtCalibrator
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        image_pts = [[0, 0], [100, 0], [100, 200], [0, 200]]
        court_pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
        H = cal._compute_homography(image_pts, court_pts)
        assert H.shape == (3, 3)
        assert not np.allclose(H, 0)


def test_homography_save_load():
    from padelpro_vision.calibration.calibration import CourtCalibrator
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        H_orig = np.eye(3, dtype=np.float64)
        H_orig[0, 2] = 5.0
        cal.save(H_orig, "test_court")
        H_loaded = cal.load("test_court")
        assert H_loaded is not None
        assert np.allclose(H_orig, H_loaded)


def test_pipeline_instantiation():
    from padelpro_vision.pipeline import Pipeline
    p = Pipeline()
    assert p is not None


def test_court_constants():
    from padelpro_vision.constants.court import COURT_LENGTH_M, COURT_WIDTH_M, COURT_CORNERS_M
    assert COURT_LENGTH_M == 20.0
    assert COURT_WIDTH_M == 10.0
    assert len(COURT_CORNERS_M) == 4


def test_stub_tracker_returns_tracks():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.tracking.tracker import _StubByteTrack
    stub = _StubByteTrack()
    dets = [PlayerBox(0, 0, 50, 100, 0.9), PlayerBox(200, 100, 300, 250, 0.8)]
    tracks = stub.update(dets, frame_idx=0, timestamp_ms=0.0)
    assert len(tracks) == 2
    assert tracks[0].track_id == 1
    assert tracks[1].track_id == 2


def test_frame_result_dataclass():
    from padelpro_vision.pipeline import FrameResult
    fr = FrameResult(frame_idx=5, timestamp_ms=200.0)
    assert fr.frame_idx == 5
    assert fr.tracks == []
