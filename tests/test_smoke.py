"""Smoke tests for M1 + Segmentation + M2 — no real video or model weights required."""

from __future__ import annotations
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# M1 tests
# ---------------------------------------------------------------------------

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
    assert box.center == (60.0, 120.0)
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


def test_frame_result_dataclass():
    from padelpro_vision.pipeline import FrameResult
    fr = FrameResult(frame_idx=5, timestamp_ms=200.0)
    assert fr.tracks == []
    assert fr.shot_events == []


# ---------------------------------------------------------------------------
# Segmentation tests
# ---------------------------------------------------------------------------

def test_segmentation_imports():
    from padelpro_vision.segmentation import Segment, get_active_segments, build_timestamp_map
    from padelpro_vision.io.condense import condense_video


def test_play_score_and_state_machine():
    from padelpro_vision.segmentation.segmentation import _state_machine
    # Simulate 60 seconds: 0-10 dead, 10-30 rally, 30-40 dead, 40-55 rally, 55-60 dead
    play_score = np.zeros(60, dtype=np.float32)
    play_score[10:30] = 0.8
    play_score[40:55] = 0.8

    segs = _state_machine(
        play_score,
        enter_thresh=0.6, exit_thresh=0.3,
        min_rally_s=3.0, gap_merge_s=3.0,
        padding_before_s=0.0, padding_after_s=0.0,
        break_gap_s=45.0,
    )
    rally_segs = [s for s in segs if s.type == "rally"]
    assert len(rally_segs) == 2


def test_state_machine_merges_close_rallies():
    from padelpro_vision.segmentation.segmentation import _state_machine
    play_score = np.zeros(60, dtype=np.float32)
    play_score[10:22] = 0.8   # rally 1
    play_score[24:40] = 0.8   # rally 2 — gap = 2s < gap_merge_s=3s → should merge

    segs = _state_machine(
        play_score,
        enter_thresh=0.6, exit_thresh=0.3,
        min_rally_s=3.0, gap_merge_s=3.0,
        padding_before_s=0.0, padding_after_s=0.0,
        break_gap_s=45.0,
    )
    rally_segs = [s for s in segs if s.type == "rally"]
    assert len(rally_segs) == 1   # merged


def test_timestamp_map():
    from padelpro_vision.segmentation.segmentation import Segment, build_timestamp_map
    segs = [Segment(start_ms=1000.0, end_ms=3000.0, type="rally")]
    ts_map = build_timestamp_map(segs)
    assert len(ts_map) > 0
    assert ts_map[0]["condensed_ms"] == 0.0
    assert ts_map[0]["real_ms"] == 1000.0


def test_segment_duration():
    from padelpro_vision.segmentation.segmentation import Segment
    s = Segment(start_ms=1000.0, end_ms=6000.0, type="rally")
    assert s.duration_ms == 5000.0


def test_compute_play_score():
    from padelpro_vision.segmentation.segmentation import _compute_play_score
    motion = np.array([0.1, 0.5, 0.9, 0.3], dtype=np.float32)
    audio  = np.array([0.2, 0.6, 0.8, 0.1], dtype=np.float32)
    score  = _compute_play_score(audio, motion)
    assert score.shape == (4,)
    assert (score >= 0).all() and (score <= 1).all()


# ---------------------------------------------------------------------------
# M2: Pose + Stroke classifier tests
# ---------------------------------------------------------------------------

def test_pose_estimator_imports():
    from padelpro_vision.pose import Pose, PoseEstimator, COCO_KEYPOINTS
    assert len(COCO_KEYPOINTS) == 17


def test_pose_stub_returns_correct_shape():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.pose.estimator import PoseEstimator
    est = PoseEstimator()   # no weights → stub
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    box   = PlayerBox(100.0, 50.0, 200.0, 300.0, 0.9)
    pose  = est.estimate(frame, box)
    assert pose.keypoints.shape == (17, 2)
    assert pose.scores.shape    == (17,)


def test_stroke_classifier_rules():
    from padelpro_vision.strokes.classifier import StrokeClassifier
    from padelpro_vision.pose.estimator import PoseEstimator
    from padelpro_vision.detection.detector import PlayerBox

    clf = StrokeClassifier(mode="rules")
    est = PoseEstimator()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    box   = PlayerBox(100.0, 50.0, 200.0, 300.0, 0.9)

    for _ in range(4):
        pose = est.estimate(frame, box)
        clf.update(track_id=1, pose=pose)

    stroke_type, conf = clf.classify(track_id=1)
    from padelpro_vision.strokes.classifier import STROKE_CLASSES
    assert stroke_type in STROKE_CLASSES


def test_pose_to_features():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.pose.estimator import PoseEstimator
    from padelpro_vision.strokes.classifier import pose_to_features
    est  = PoseEstimator()
    box  = PlayerBox(0.0, 0.0, 100.0, 200.0, 0.9)
    pose = est._stub_pose(box)
    feat = pose_to_features(pose)
    assert feat.shape == (34,)
    assert feat.dtype == np.float32


def test_shot_event_serialisation():
    from padelpro_vision.strokes.shot_event import ShotEvent, save_shot_events, load_shot_events
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "events.json"
        events = [
            ShotEvent("m1", 1, 0, 1500.0, "smash", 0.9, 37),
            ShotEvent("m1", 2, 0, 2000.0, "vibora", 0.85, 50, court_x=3.2, court_y=9.1),
        ]
        save_shot_events(events, path)
        loaded = load_shot_events(path)
        assert len(loaded) == 2
        assert loaded[0].stroke_type == "smash"
        assert loaded[1].court_x == pytest.approx(3.2)


def test_stroke_classifier_reset():
    from padelpro_vision.strokes.classifier import StrokeClassifier
    from padelpro_vision.pose.estimator import PoseEstimator
    from padelpro_vision.detection.detector import PlayerBox
    clf = StrokeClassifier(mode="rules")
    est = PoseEstimator()
    box = PlayerBox(0, 0, 100, 200, 0.9)
    clf.update(1, est._stub_pose(box))
    clf.reset(track_id=1)
    assert 1 not in clf._windows
