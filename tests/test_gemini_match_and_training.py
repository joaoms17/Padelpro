"""Tests for full-match Gemini metrics and training-progression levels."""

from __future__ import annotations
import json

from padelpro_vision.analysis.gemini_match import (
    compute_shot_counts,
    compute_formation_pct,
    compute_rally_stats,
    enrich_report,
    _parse_match_json,
)
from padelpro_vision.training.dataset import (
    count_dataset,
    level_for,
    next_threshold,
    LEVEL_THRESHOLDS,
)


# ── Derived metrics ──────────────────────────────────────────────────────────

def test_shot_counts_buckets_unknown_type_as_other():
    shots = [
        {"t_s": 1, "player": 1, "type": "smash"},
        {"t_s": 2, "player": 1, "type": "forehand"},
        {"t_s": 3, "player": 2, "type": "not_a_real_type"},
        {"t_s": 4, "player": 9, "type": "smash"},  # invalid player ignored
    ]
    counts = compute_shot_counts(shots)
    assert counts["player_1"]["smash"] == 1
    assert counts["player_1"]["forehand"] == 1
    assert counts["player_2"]["other"] == 1
    assert set(counts) == {"player_1", "player_2", "player_3", "player_4"}


def test_formation_pct_sums_to_100_and_buckets_unknown():
    samples = [
        {"type": "both_net"}, {"type": "both_net"},
        {"type": "both_back"}, {"type": "weird"},
    ]
    pct = compute_formation_pct(samples)
    assert pct["both_net"] == 50.0
    assert pct["both_back"] == 25.0
    assert pct["mixed"] == 25.0
    assert abs(sum(pct.values()) - 100.0) < 0.01


def test_formation_pct_empty():
    assert compute_formation_pct([]) == {
        "both_net": 0.0, "both_back": 0.0,
        "split_near_net": 0.0, "split_far_net": 0.0, "mixed": 0.0,
    }


def test_rally_stats():
    rallies = [{"start_s": 0, "end_s": 10}, {"start_s": 20, "end_s": 35}]
    stats = compute_rally_stats(rallies, 100.0)
    assert stats["total_rallies"] == 2
    assert stats["avg_duration_s"] == 12.5
    assert stats["total_play_time_s"] == 25
    assert stats["play_time_pct"] == 25.0


def test_rally_stats_zero_duration_safe():
    assert compute_rally_stats([], 0.0)["play_time_pct"] == 0.0


def test_enrich_report_adds_derived_fields():
    report = {
        "duration_s": 60.0,
        "shots": [{"t_s": 1, "player": 1, "type": "smash"}],
        "formation_samples": [{"type": "both_net"}],
        "rallies": [{"start_s": 0, "end_s": 6}],
    }
    out = enrich_report(report)
    assert out["shot_counts"]["player_1"]["smash"] == 1
    assert out["formation_pct"]["both_net"] == 100.0
    assert out["rally_stats"]["total_rallies"] == 1


def test_parse_match_json_fills_defaults_on_garbage():
    data = _parse_match_json("not json at all")
    for key in ("player_positions", "shots", "formation_samples",
                "score_timeline", "key_frames", "rallies"):
        assert data[key] == []
    assert data["confidence"] == 0.0
    assert "final_score" in data


def test_parse_match_json_valid():
    raw = json.dumps({
        "duration_s": 10.0,
        "shots": [{"t_s": 1, "player": 1, "type": "smash"}],
        "confidence": 0.8,
    })
    data = _parse_match_json(raw)
    assert data["duration_s"] == 10.0
    assert data["confidence"] == 0.8
    assert data["rallies"] == []  # default filled


# ── Levels ───────────────────────────────────────────────────────────────────

def test_level_for_thresholds():
    assert level_for(0) == 0
    assert level_for(LEVEL_THRESHOLDS[0] - 1) == 0
    assert level_for(LEVEL_THRESHOLDS[0]) == 1
    assert level_for(LEVEL_THRESHOLDS[-1]) == 5
    assert level_for(10_000) == 5


def test_next_threshold():
    assert next_threshold(0) == LEVEL_THRESHOLDS[0]
    assert next_threshold(LEVEL_THRESHOLDS[-1]) is None


def test_count_dataset_empty(tmp_path):
    data = count_dataset(
        feedback_dir=tmp_path / "feedback",
        ball_dir=tmp_path / "ball",
        player_dir=tmp_path / "players",
        frames_dir=tmp_path / "frames",
    )
    assert data["overall_count"] == 0
    assert data["overall_level"] == 0
    assert {t["key"] for t in data["tracks"]} == {"ball", "player", "stroke"}


def test_count_dataset_counts_ball_with_frames(tmp_path):
    fb = tmp_path / "feedback"
    ball = tmp_path / "ball"
    fb.mkdir()
    ball.mkdir()
    # one ball annotation with an existing frame, one without
    (ball / "f1.jpg").write_bytes(b"x")
    (fb / "rid1_ball.json").write_text(json.dumps([
        {"ts_ms": 1, "frame_path": "f1.jpg"},
        {"ts_ms": 2, "frame_path": "missing.jpg"},
    ]))
    data = count_dataset(
        feedback_dir=fb, ball_dir=ball,
        player_dir=tmp_path / "players", frames_dir=tmp_path / "frames",
    )
    ball_track = next(t for t in data["tracks"] if t["key"] == "ball")
    assert ball_track["count"] == 1
