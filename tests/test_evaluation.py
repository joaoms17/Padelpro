"""Tests for the evaluation package: golden set, metrics, sanity checks."""

from __future__ import annotations
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# Golden set IO
# ---------------------------------------------------------------------------

def test_load_golden_clip():
    from padelpro_vision.evaluation.golden import load_golden_clip
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "clip_001.json"
        with open(path, "w") as f:
            json.dump({
                "clip_id": "clip_001",
                "video": "clip_001.mp4",
                "court_id": "court1",
                "rallies": [{"start_ms": 1000, "end_ms": 5000}],
                "hits": [{"ts_ms": 1500, "player": "A", "stroke_type": "smash"}],
                "positions": [{"ts_ms": 2000, "player": "A", "court_x": 2.5, "court_y": 3.0}],
            }, f)
        clip = load_golden_clip(path)
        assert clip.clip_id == "clip_001"
        assert clip.video_path == Path(tmp) / "clip_001.mp4"
        assert clip.rallies == [(1000.0, 5000.0)]
        assert clip.hits[0].stroke_type == "smash"
        assert clip.positions[0].court_x == 2.5
        assert clip.has_rallies and clip.has_hits and clip.has_positions


def test_load_golden_set_skips_example_and_invalid():
    from padelpro_vision.evaluation.golden import load_golden_set
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "example_annotation.json").write_text("{}")
        (Path(tmp) / "broken.json").write_text("not json")
        (Path(tmp) / "good.json").write_text(json.dumps({"clip_id": "g"}))
        clips = load_golden_set(Path(tmp))
        assert len(clips) == 1
        assert clips[0].clip_id == "g"


# ---------------------------------------------------------------------------
# Interval metrics (segmentation)
# ---------------------------------------------------------------------------

def test_interval_metrics_perfect():
    from padelpro_vision.evaluation.metrics import interval_metrics
    gt = [(0.0, 1000.0), (2000.0, 3000.0)]
    m = interval_metrics(gt, gt)
    assert m["precision"] == 1.0
    assert m["recall"] == 1.0
    assert m["iou"] == 1.0
    assert m["rally_detection_rate"] == 1.0


def test_interval_metrics_partial():
    from padelpro_vision.evaluation.metrics import interval_metrics
    gt = [(0.0, 1000.0)]
    pred = [(500.0, 1500.0)]   # half overlap
    m = interval_metrics(gt, pred)
    assert m["precision"] == pytest.approx(0.5)
    assert m["recall"] == pytest.approx(0.5)
    assert m["rally_detection_rate"] == 1.0   # 50% coverage counts as detected


def test_interval_metrics_empty_pred():
    from padelpro_vision.evaluation.metrics import interval_metrics
    m = interval_metrics([(0.0, 1000.0)], [])
    assert m["recall"] == 0.0
    assert m["f1"] == 0.0


# ---------------------------------------------------------------------------
# Event matching + hit metrics
# ---------------------------------------------------------------------------

def test_match_events_greedy_one_to_one():
    from padelpro_vision.evaluation.metrics import match_events
    gt = [1000.0, 2000.0]
    pred = [1050.0, 1100.0, 2900.0]   # 2900 outside ±300 of 2000... wait 900 > 300
    matches = match_events(gt, pred, tolerance_ms=300.0)
    # 1050 matches 1000 (closest); 1100 cannot reuse gt[0]; 2900 too far from 2000
    assert len(matches) == 1
    assert matches[0][0] == 0 and matches[0][1] == 0
    assert matches[0][2] == pytest.approx(50.0)


class _Hit:
    def __init__(self, ts_ms, stroke_type=None):
        self.ts_ms = ts_ms
        self.stroke_type = stroke_type


def test_hit_metrics_with_strokes():
    from padelpro_vision.evaluation.metrics import hit_metrics
    gt = [_Hit(1000.0, "smash"), _Hit(2000.0, "bandeja"), _Hit(3000.0, "vibora")]
    pred = [_Hit(1100.0, "smash"), _Hit(2050.0, "vibora")]
    m = hit_metrics(gt, pred, tolerance_ms=300.0)
    assert m["n_matched"] == 2
    assert m["precision"] == 1.0
    assert m["recall"] == pytest.approx(2 / 3, abs=1e-3)
    assert m["mean_abs_offset_ms"] == pytest.approx(75.0)
    assert m["stroke_accuracy"] == pytest.approx(0.5)   # smash ok, bandeja→vibora errado
    assert m["stroke_confusion"]["bandeja"]["vibora"] == 1


# ---------------------------------------------------------------------------
# Position error
# ---------------------------------------------------------------------------

def test_position_error_metrics():
    from padelpro_vision.evaluation.golden import GoldenPosition
    from padelpro_vision.evaluation.metrics import position_error_metrics
    gt = [
        GoldenPosition(ts_ms=1000.0, player="A", court_x=2.0, court_y=3.0),
        GoldenPosition(ts_ms=1000.0, player="B", court_x=8.0, court_y=17.0),
    ]
    tracks = {
        1: [(990.0, 2.5, 3.0)],     # 0.5 m from A
        2: [(1010.0, 8.0, 16.0)],   # 1.0 m from B
    }
    m = position_error_metrics(gt, tracks, max_gap_ms=200.0)
    assert m["n_matched"] == 2
    assert m["mean_error_m"] == pytest.approx(0.75)


def test_position_error_no_track_nearby_in_time():
    from padelpro_vision.evaluation.golden import GoldenPosition
    from padelpro_vision.evaluation.metrics import position_error_metrics
    gt = [GoldenPosition(ts_ms=1000.0, player="A", court_x=2.0, court_y=3.0)]
    tracks = {1: [(5000.0, 2.0, 3.0)]}   # 4 s away
    m = position_error_metrics(gt, tracks, max_gap_ms=200.0)
    assert m["n_matched"] == 0
    assert m["n_unmatched"] == 1
    assert m["mean_error_m"] is None


# ---------------------------------------------------------------------------
# Physics sanity + tracking stability
# ---------------------------------------------------------------------------

def test_physics_sanity_clean_track():
    from padelpro_vision.evaluation.sanity import physics_sanity
    # Walk at 1 m/s along the court
    track = {1: [(i * 1000.0, 5.0, 2.0 + i * 1.0) for i in range(10)]}
    m = physics_sanity(track)
    assert m["pct_implausible_speed"] == 0.0
    assert m["teleport_count"] == 0
    assert m["pct_out_of_court"] == 0.0


def test_physics_sanity_flags_violations():
    from padelpro_vision.evaluation.sanity import physics_sanity
    track = {
        1: [
            (0.0, 5.0, 5.0),
            (100.0, 5.0, 10.0),    # 5 m in 100 ms = 50 m/s + teleport
            (200.0, 50.0, 10.0),   # way out of court + teleport
        ]
    }
    m = physics_sanity(track)
    assert m["pct_implausible_speed"] > 0
    assert m["teleport_count"] == 2
    assert m["pct_out_of_court"] > 0
    assert m["max_observed_speed_ms"] > 8.0


def test_tracking_stability_ideal():
    from padelpro_vision.evaluation.sanity import tracking_stability
    tracks = {
        tid: [(i * 1000.0, 2.0 + tid, 5.0) for i in range(60)]
        for tid in range(1, 5)
    }
    m = tracking_stability(tracks, expected_players=4)
    assert m["n_tracks"] == 4
    assert m["pct_time_with_expected_players"] == pytest.approx(100.0)


def test_tracking_stability_empty():
    from padelpro_vision.evaluation.sanity import tracking_stability
    m = tracking_stability({})
    assert m["n_tracks"] == 0


# ---------------------------------------------------------------------------
# Homography validation
# ---------------------------------------------------------------------------

def test_validate_homography_good():
    from padelpro_vision.calibration.calibration import CourtCalibrator, validate_homography
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        image_pts = [[100, 50], [500, 50], [600, 400], [20, 400]]
        court_pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
        H = cal._compute_homography(image_pts, court_pts)
        q = validate_homography(H, image_pts, court_pts)
        assert q["rating"] in ("good", "ok")
        assert q["convex"] is True
        assert q["reprojection_error_px"] < 8.0


def test_validate_homography_crossed_points_is_bad():
    from padelpro_vision.calibration.calibration import CourtCalibrator, validate_homography
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        # TL and TR swapped → self-intersecting quad
        image_pts = [[500, 50], [100, 50], [600, 400], [20, 400]]
        court_pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
        H = cal._compute_homography(image_pts, court_pts)
        q = validate_homography(H, image_pts, court_pts)
        assert q["convex"] is False
        assert q["rating"] == "bad"


def test_homography_save_includes_quality():
    from padelpro_vision.calibration.calibration import CourtCalibrator
    with tempfile.TemporaryDirectory() as tmp:
        cal = CourtCalibrator(Path(tmp))
        H = np.eye(3)
        cal.save(H, "c1", quality={"rating": "good", "reprojection_error_px": 1.0})
        assert cal.load_quality("c1")["rating"] == "good"
        assert cal.load_quality("missing") is None
