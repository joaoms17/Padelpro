"""Tests for pose-based stroke classification in the fast path (defensive paths)."""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_pixel_at_nearest_in_time():
    from padelpro_vision.strokes.clip_strokes import _pixel_at
    pts = [
        (0.0, 1.0, 2.0, 0, 100.0, 200.0, 150.0),
        (1000.0, 1.0, 2.0, 0, 110.0, 210.0, 160.0),
    ]
    assert _pixel_at(pts, 0.0) == (100.0, 200.0)
    assert _pixel_at(pts, 1.0) == (110.0, 210.0)
    # Too far in time → None
    assert _pixel_at(pts, 5.0) is None
    assert _pixel_at([], 0.0) is None


def test_classify_returns_empty_without_real_pose(monkeypatch):
    """With only the geometric stub backend, the fast path must gain nothing
    (and never crash)."""
    from padelpro_vision.strokes import clip_strokes

    # PoseEstimator() with no rtmlib/mmpose installed → backend == "stub"
    from padelpro_vision.pose.estimator import PoseEstimator
    est = PoseEstimator()
    assert est.backend == "stub"

    hit_records = [{"player_id": 1, "t_s": 5.0, "type": "fundo"}]
    player_tracks = {1: [(5000.0, 4.0, 10.0, 0, 300.0, 400.0, 300.0)]}
    types, windows = clip_strokes.classify_clip_strokes(
        "nonexistent.mp4", hit_records, player_tracks, sampled_fps=4.0,
    )
    assert types == {}
    assert windows == {}
    # Geometric type untouched
    assert hit_records[0]["type"] == "fundo"


def test_persist_for_review_writes_shot_events(tmp_path, monkeypatch):
    from api.routers import condense as cond
    monkeypatch.setattr(cond, "_UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.chdir(tmp_path)

    report = {
        "shots": [
            {"t_s": 5.0, "rally": 0, "player_id": 1, "pos": [4.0, 10.0],
             "type": "smash", "frame_idx": 125},
            {"t_s": 8.0, "rally": 0, "player_id": 2, "pos": None, "type": "fundo"},
        ]
    }
    cond._persist_for_review("job1", report)

    import json
    out = tmp_path / "data" / "output" / "job1" / "job1_shot_events.json"
    assert out.exists()
    events = json.loads(out.read_text())
    assert len(events) == 2
    assert events[0]["ts_ms"] == 5000.0
    assert events[0]["stroke_type"] == "smash"
    assert events[0]["frame_idx"] == 125
    assert events[1]["court_x"] is None
