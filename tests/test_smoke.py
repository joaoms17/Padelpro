"""Smoke tests for M1 + Segmentation + M2 + M3 — no real video or model weights required."""

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


# ---------------------------------------------------------------------------
# M3: Projection + Analytics tests
# ---------------------------------------------------------------------------

def test_projection_imports():
    from padelpro_vision.projection import project_point, project_points, foot_point, project_track_positions


def test_project_point_identity():
    """With an identity-like homography, points should map close to input."""
    from padelpro_vision.projection.projection import project_point
    H = np.eye(3, dtype=np.float64)
    cx, cy = project_point(H, 100.0, 200.0)
    assert abs(cx - 100.0) < 1e-6
    assert abs(cy - 200.0) < 1e-6


def test_project_points_batch():
    from padelpro_vision.projection.projection import project_points
    H = np.eye(3, dtype=np.float64)
    pts = np.array([[10.0, 20.0], [30.0, 40.0]], dtype=np.float64)
    out = project_points(H, pts)
    assert out.shape == (2, 2)
    assert np.allclose(out, pts)


def test_foot_point():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.projection.projection import foot_point
    box = PlayerBox(100.0, 50.0, 200.0, 300.0, 0.9)
    px, py = foot_point(box)
    assert px == 150.0
    assert py == 300.0


def test_project_empty_points():
    from padelpro_vision.projection.projection import project_points
    H = np.eye(3, dtype=np.float64)
    out = project_points(H, np.empty((0, 2)))
    assert out.shape == (0, 2)


def test_analytics_imports():
    from padelpro_vision.analytics import PlayerStats, MatchAnalyticsResult, compute_match_analytics


def test_compute_distance():
    from padelpro_vision.analytics.analytics import _compute_distance_and_speed
    positions = [
        (0.0,    0.0, 0.0),
        (1000.0, 3.0, 4.0),   # 5 m in 1 s → 5 m/s
        (2000.0, 3.0, 4.0),   # no movement
    ]
    dist, avg, mx = _compute_distance_and_speed(positions)
    assert abs(dist - 5.0) < 0.01


def test_compute_heatmap():
    from padelpro_vision.analytics.analytics import _compute_heatmap
    positions = [(float(i) * 100, 5.0, 10.0) for i in range(20)]
    grid = _compute_heatmap(positions)
    arr = np.array(grid)
    assert arr.shape == (20, 10)
    assert arr.max() == pytest.approx(1.0)


def test_compute_zones():
    from padelpro_vision.analytics.analytics import _compute_zones
    # All positions deep in attack zone (y < 4m, team_side=0)
    positions = [(float(i) * 100, 5.0, 1.0) for i in range(20)]
    atk, dfn, trn = _compute_zones(positions, team_side=0)
    assert atk == pytest.approx(100.0)
    assert dfn == pytest.approx(0.0)
    assert trn == pytest.approx(0.0)


def test_compute_match_analytics_no_crash():
    from padelpro_vision.analytics.analytics import compute_match_analytics
    track_positions = {
        1: [(float(i) * 200, float(i) * 0.3, float(i) * 0.15) for i in range(50)],
        2: [(float(i) * 200, 10.0 - float(i) * 0.3, 20.0 - float(i) * 0.15) for i in range(50)],
    }
    result = compute_match_analytics("test_match", track_positions, [], {1: 0, 2: 1})
    assert len(result.player_stats) == 2
    assert 0.0 <= result.sync_score <= 1.0
    assert result.player_stats[0].distance_m > 0


def test_player_stats_dataclass():
    from padelpro_vision.analytics.analytics import PlayerStats
    ps = PlayerStats(match_id="m1", player_id=1, distance_m=250.0, avg_speed_ms=2.1)
    assert ps.distance_m == 250.0
    assert ps.shots_json == "{}"


def test_supabase_client_no_credentials():
    """Should not raise even when credentials are absent."""
    import os
    orig_url = os.environ.pop("SUPABASE_URL", None)
    orig_key = os.environ.pop("SUPABASE_KEY", None)
    try:
        from padelpro_vision.io.supabase_client import SupabaseClient
        db = SupabaseClient()
        assert not db.connected
    finally:
        if orig_url: os.environ["SUPABASE_URL"] = orig_url
        if orig_key: os.environ["SUPABASE_KEY"] = orig_key


def test_annotate_frame_no_tracks():
    from padelpro_vision.viz.visualizer import annotate_frame
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    out   = annotate_frame(frame, [])
    assert out.shape == frame.shape


def test_draw_mini_court():
    from padelpro_vision.viz.visualizer import draw_mini_court
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    out   = draw_mini_court(frame, {1: (5.0, 10.0), 2: (7.0, 15.0)})
    assert out.shape == frame.shape
    assert not np.array_equal(out, frame)


# ---------------------------------------------------------------------------
# Indexing tests
# ---------------------------------------------------------------------------

def test_indexing_imports():
    from padelpro_vision.indexing import (
        Rally, Clip, build_rallies, build_clips, query_clips,
        derive_zone, derive_rally_phase, save_index, load_index,
    )


def test_derive_zone():
    from padelpro_vision.indexing.indexer import derive_zone
    assert derive_zone(2.0,  1.0)  == "net_left"
    assert derive_zone(8.0,  1.0)  == "net_right"
    assert derive_zone(2.0,  6.0)  == "mid_left"
    assert derive_zone(8.0, 15.0)  == "back_right"
    assert derive_zone(None, None) == "unknown"


def test_derive_rally_phase():
    from padelpro_vision.indexing.indexer import derive_rally_phase
    assert derive_rally_phase(1000.0, 0.0, 9000.0)  == "early"
    assert derive_rally_phase(5000.0, 0.0, 9000.0)  == "mid"
    assert derive_rally_phase(8000.0, 0.0, 9000.0)  == "late"


def test_build_rallies_and_clips():
    from padelpro_vision.segmentation.segmentation import Segment
    from padelpro_vision.strokes.shot_event import ShotEvent
    from padelpro_vision.indexing.indexer import build_rallies, build_clips, query_clips

    segs = [
        Segment(start_ms=0.0,    end_ms=15000.0, type="rally"),
        Segment(start_ms=20000.0, end_ms=35000.0, type="break"),
        Segment(start_ms=35000.0, end_ms=50000.0, type="rally"),
    ]
    events = [
        ShotEvent("m1", 1, 0, 5000.0,  "smash",  0.9, 125, court_x=4.0, court_y=2.0),  # net_left
        ShotEvent("m1", 2, 0, 8000.0,  "vibora", 0.8, 200, court_x=8.0, court_y=3.0),  # net_right
        ShotEvent("m1", 1, 2, 40000.0, "bandeja", 0.85, 1000, court_x=3.0, court_y=5.0),
    ]
    rallies = build_rallies("m1", segs)
    assert len(rallies) == 2

    clips = build_clips("m1", events, rallies, video_duration_ms=60000.0)
    assert len(clips) == 3

    smashes = query_clips(clips, stroke="smash")
    assert len(smashes) == 1 and smashes[0].player_id == 1

    net = query_clips(clips, zone="net_left")
    assert len(net) >= 1


def test_save_load_index():
    from padelpro_vision.indexing.indexer import Rally, Clip, save_index, load_index
    with tempfile.TemporaryDirectory() as tmp:
        rallies = [Rally(0, "m1", 0.0, 15000.0, 3)]
        clips   = [Clip(0, "m1", 0, 1, "smash", 3500.0, 6500.0, "net_left", "early")]
        r_path, c_path = save_index(rallies, clips, Path(tmp))
        assert r_path.exists() and c_path.exists()
        loaded_r, loaded_c = load_index(Path(tmp))
        assert loaded_r[0].num_shots == 3
        assert loaded_c[0].stroke_type == "smash"


def test_query_clips_combined_filters():
    from padelpro_vision.indexing.indexer import Clip, query_clips
    clips = [
        Clip(0, "m1", 0, 1, "smash",  1000.0, 4000.0, "net_left",  "early"),
        Clip(1, "m1", 0, 2, "vibora", 5000.0, 8000.0, "mid_right", "mid"),
        Clip(2, "m1", 0, 1, "vibora", 9000.0, 12000.0, "net_right", "late"),
    ]
    # player 1 + vibora → only clip 2
    result = query_clips(clips, player_id=1, stroke="vibora")
    assert len(result) == 1 and result[0].clip_id == 2

    # all clips in net zone
    net = query_clips(clips, zone="net_left")
    assert len(net) == 1


# ---------------------------------------------------------------------------
# FastAPI tests
# ---------------------------------------------------------------------------

def test_api_imports():
    from api.main import app
    from api.models import (
        MatchCreate, MatchStatus, RunPipelineRequest,
        ClipResponse, MontageRequest, PlayerStatsResponse,
    )


def test_api_health():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_api_create_match():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.post("/matches/", json={"court_id": "sintra_court1"})
    assert r.status_code == 201
    data = r.json()
    assert "match_id" in data
    assert data["status"] == "queued"


def test_api_status_not_found():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.get("/matches/nonexistent-id/status")
    assert r.status_code == 404


def test_api_clips_not_found():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.get("/clips/matches/nonexistent-match")
    assert r.status_code == 404
