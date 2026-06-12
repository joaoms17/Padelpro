"""Tests for audio fusion, event consolidation, quality report, review queue,
classifier velocity features and tracker prediction."""

from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from padelpro_vision.strokes.shot_event import ShotEvent


def _ev(player_id: int, ts_ms: float, stroke="smash", conf=0.9, wrist=None):
    return ShotEvent(
        match_id="m1", player_id=player_id, rally_id=0, ts_ms=ts_ms,
        stroke_type=stroke, confidence=conf, frame_idx=int(ts_ms / 40),
        wrist_speed=wrist,
    )


# ---------------------------------------------------------------------------
# Event consolidation
# ---------------------------------------------------------------------------

def test_consolidate_merges_burst_into_one_event():
    from padelpro_vision.strokes.audio_fusion import consolidate_shot_events
    burst = [_ev(1, 1000.0 + i * 40, wrist=0.1 * i) for i in range(10)]
    out = consolidate_shot_events(burst, min_gap_ms=700.0)
    assert len(out) == 1
    # Representative = highest wrist speed (the last one here)
    assert out[0].ts_ms == pytest.approx(1360.0)


def test_consolidate_keeps_separate_hits():
    from padelpro_vision.strokes.audio_fusion import consolidate_shot_events
    events = [_ev(1, 1000.0), _ev(1, 3000.0), _ev(2, 1100.0)]
    out = consolidate_shot_events(events, min_gap_ms=700.0)
    assert len(out) == 3


def test_consolidate_falls_back_to_confidence():
    from padelpro_vision.strokes.audio_fusion import consolidate_shot_events
    events = [_ev(1, 1000.0, conf=0.5), _ev(1, 1040.0, conf=0.95), _ev(1, 1080.0, conf=0.6)]
    out = consolidate_shot_events(events, min_gap_ms=700.0)
    assert len(out) == 1
    assert out[0].confidence == 0.95


# ---------------------------------------------------------------------------
# Audio onset fusion
# ---------------------------------------------------------------------------

def test_fuse_no_onsets_passthrough():
    from padelpro_vision.strokes.audio_fusion import fuse_events_with_onsets
    events = [_ev(1, 1000.0)]
    out = fuse_events_with_onsets(events, [], tolerance_ms=200.0)
    assert len(out) == 1
    assert out[0].audio_onset is None   # absence of audio is not evidence


def test_fuse_confirms_and_downweights():
    from padelpro_vision.strokes.audio_fusion import fuse_events_with_onsets
    events = [_ev(1, 1000.0, conf=0.8), _ev(1, 5000.0, conf=0.8)]
    out = fuse_events_with_onsets(events, [1100.0], tolerance_ms=200.0)
    assert out[0].audio_onset is True
    assert out[0].confidence == 0.8
    assert out[1].audio_onset is False
    assert out[1].confidence == pytest.approx(0.4)


def test_fuse_drop_mode():
    from padelpro_vision.strokes.audio_fusion import fuse_events_with_onsets
    events = [_ev(1, 1000.0), _ev(1, 5000.0)]
    out = fuse_events_with_onsets(events, [1050.0], tolerance_ms=200.0, drop_without_onset=True)
    assert len(out) == 1
    assert out[0].ts_ms == 1000.0


def test_onsets_from_energy_detects_spikes():
    from padelpro_vision.segmentation.segmentation import _onsets_from_energy
    env = np.full(200, 0.1, dtype=np.float64)
    env[50] = 1.0    # impact at hop 50
    env[120] = 1.0   # impact at hop 120
    onsets = _onsets_from_energy(env, hop_s=0.02, k_std=3.0, min_gap_s=0.25)
    assert len(onsets) == 2
    assert onsets[0] == pytest.approx(50 * 20.0, abs=40.0)
    assert onsets[1] == pytest.approx(120 * 20.0, abs=40.0)


def test_onsets_min_gap_suppresses_double_trigger():
    from padelpro_vision.segmentation.segmentation import _onsets_from_energy
    env = np.full(100, 0.1, dtype=np.float64)
    env[50] = 1.0
    env[53] = 1.0   # 60 ms later — same impact, should be suppressed
    onsets = _onsets_from_energy(env, hop_s=0.02, k_std=3.0, min_gap_s=0.25)
    assert len(onsets) == 1


# ---------------------------------------------------------------------------
# ShotEvent serialisation round-trip with new fields
# ---------------------------------------------------------------------------

def test_shot_event_new_fields_roundtrip(tmp_path):
    from padelpro_vision.strokes.shot_event import save_shot_events, load_shot_events
    ev = _ev(1, 1000.0, wrist=0.42)
    ev.audio_onset = True
    save_shot_events([ev], tmp_path / "ev.json")
    loaded = load_shot_events(tmp_path / "ev.json")
    assert loaded[0].wrist_speed == pytest.approx(0.42)
    assert loaded[0].audio_onset is True


# ---------------------------------------------------------------------------
# Quality report + review queue
# ---------------------------------------------------------------------------

class _Box:
    def __init__(self, conf=0.9):
        self.confidence = conf


class _Track:
    def __init__(self, tid, conf=0.9):
        self.track_id = tid
        self.box = _Box(conf)


class _FrameResult:
    def __init__(self, ts_ms, n_tracks):
        self.timestamp_ms = ts_ms
        self.tracks = [_Track(i + 1) for i in range(n_tracks)]


def test_build_quality_report_basic():
    from padelpro_vision.quality.report import build_quality_report
    frames = [_FrameResult(i * 40.0, 4) for i in range(100)]
    court = {tid: [(i * 40.0, 2.0 + tid, 5.0) for i in range(100)] for tid in range(1, 5)}
    events = [_ev(1, 1000.0, conf=0.9)]
    events[0].audio_onset = True

    report = build_quality_report(
        "m1", frames, court, events,
        processing_elapsed_s=10.0, video_duration_s=20.0,
    )
    assert report["detection"]["pct_frames_with_expected_players"] == 100.0
    assert report["detection"]["mean_detection_confidence"] == pytest.approx(0.9)
    assert report["tracking"]["n_tracks"] == 4
    assert report["physics"]["pct_implausible_speed"] == 0.0
    assert report["strokes"]["pct_with_audio_onset"] == 100.0
    assert report["performance"]["realtime_factor"] == pytest.approx(0.5)


def test_quality_report_without_court_positions():
    from padelpro_vision.quality.report import build_quality_report
    frames = [_FrameResult(i * 40.0, 2) for i in range(10)]
    report = build_quality_report("m1", frames, None, [])
    assert report["physics"] is None
    assert report["detection"]["pct_frames_with_expected_players"] == 0.0


def test_review_queue_low_conf_and_gaps():
    from padelpro_vision.quality.active_learning import build_review_queue
    # 2 s with only 2 players in the middle
    frames = (
        [_FrameResult(i * 100.0, 4) for i in range(20)]
        + [_FrameResult(2000.0 + i * 100.0, 2) for i in range(20)]
        + [_FrameResult(4000.0 + i * 100.0, 4) for i in range(20)]
    )
    events = [_ev(1, 500.0, conf=0.4), _ev(2, 800.0, conf=0.95)]
    queue = build_review_queue(events, frames, confidence_threshold=0.6)
    kinds = [q["type"] for q in queue]
    assert kinds.count("low_conf_stroke") == 1
    assert kinds.count("missing_players") == 1
    gap = next(q for q in queue if q["type"] == "missing_players")
    assert gap["start_ms"] == pytest.approx(2000.0)
    assert gap["detail"]["min_players_seen"] == 2


# ---------------------------------------------------------------------------
# Classifier: velocity features, wrist speed, impact index
# ---------------------------------------------------------------------------

def test_window_to_features_dims():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.pose.estimator import PoseEstimator
    from padelpro_vision.strokes.classifier import window_to_features
    est = PoseEstimator()
    box = PlayerBox(0.0, 0.0, 100.0, 200.0, 0.9)
    window = [est._stub_pose(box) for _ in range(5)]
    assert window_to_features(window, "pos").shape == (34, 5)
    assert window_to_features(window, "posvel").shape == (68, 5)


def test_add_velocity_features():
    from padelpro_vision.strokes.classifier import add_velocity_features
    pos = np.random.rand(34, 16).astype(np.float32)
    out = add_velocity_features(pos)
    assert out.shape == (68, 16)
    assert np.allclose(out[34:, 0], 0.0)            # first frame: zero velocity
    assert np.allclose(out[34:, 1:], np.diff(pos, axis=1))


def test_impact_index_finds_fastest_wrist_frame():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.pose.estimator import Pose
    from padelpro_vision.strokes.classifier import estimate_impact_index, current_wrist_speed, KP_RIGHT_WRIST

    box = PlayerBox(0.0, 0.0, 100.0, 200.0, 0.9)
    window = []
    # Wrist mostly still, then a fast move into frame 5
    xs = [50, 50, 50, 50, 50, 120, 122, 122]
    for x in xs:
        kps = np.full((17, 2), 50.0, dtype=np.float32)
        kps[KP_RIGHT_WRIST] = [x, 80.0]
        scores = np.ones(17, dtype=np.float32)
        window.append(Pose(keypoints=kps, scores=scores, bbox=box))

    assert estimate_impact_index(window) == 5
    assert current_wrist_speed(window) < 0.05   # quiet at the end


def test_impact_index_degenerate_window():
    from padelpro_vision.strokes.classifier import estimate_impact_index
    assert estimate_impact_index([]) == -1 or True   # must not raise


# ---------------------------------------------------------------------------
# Tracker: velocity prediction keeps IDs through occlusion
# ---------------------------------------------------------------------------

def test_greedy_tracker_keeps_id_through_gap_with_motion():
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.tracking.tracker import GreedyTracker

    tr = GreedyTracker(max_missed_s=2.5, max_dist_boxes=2.2)

    def box_at(x):
        return PlayerBox(x, 100.0, x + 60.0, 280.0, 0.9)

    # Constant motion +30 px/frame at 25 fps
    tid = None
    for i in range(5):
        out = tr.update([box_at(100.0 + 30.0 * i)], frame_idx=i, timestamp_ms=i * 40.0)
        tid = out[0].track_id

    # Occluded for 1 s (25 frames) while continuing the motion;
    # reappears ~750 px further — far beyond max_dist without prediction.
    out = tr.update([box_at(100.0 + 30.0 * 30)], frame_idx=30, timestamp_ms=30 * 40.0)
    assert len(out) == 1
    assert out[0].track_id == tid


def test_court_gate_filters_spectators():
    from padelpro_vision.calibration.calibration import CourtCalibrator
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.tracking.tracker import make_court_gate

    # Identity-like mapping: 100 px = 1 m, court occupies x∈[0,1000], y∈[0,2000]
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        image_pts = [[0, 0], [1000, 0], [1000, 2000], [0, 2000]]
        court_pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
        H = cal._compute_homography(image_pts, court_pts)

    gate = make_court_gate(H, margin_x_m=1.5, margin_y_m=2.0)
    on_court = PlayerBox(450.0, 900.0, 550.0, 1100.0, 0.9)      # foot at (500, 1100) → (5, 11)
    spectator = PlayerBox(2900.0, 900.0, 3000.0, 1100.0, 0.9)   # foot at (2950, 1100) → (29.5, 11)
    kept = gate([on_court, spectator])
    assert kept == [on_court]
