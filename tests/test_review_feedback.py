"""Tests for the human-in-the-loop feedback cycle: store, retrain gate, API."""

from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from padelpro_vision.feedback.store import (
    Correction,
    save_corrections,
    load_corrections,
    build_training_samples,
    append_training_samples,
    corrections_to_golden_hits,
)


def _window(n_frames: int = 16):
    return [[[0.5, 0.5]] * 17 for _ in range(n_frames)]


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

def test_corrections_roundtrip(tmp_path):
    corrections = [
        Correction(ts_ms=1000.0, player_id=1, verdict="correct",
                   predicted_type="smash", frame_idx=25),
        Correction(ts_ms=2000.0, player_id=2, verdict="wrong_class",
                   predicted_type="bandeja", corrected_type="vibora", frame_idx=50),
    ]
    save_corrections("m1", corrections, tmp_path)
    loaded = load_corrections("m1", tmp_path)
    assert len(loaded) == 2
    assert loaded[1].corrected_type == "vibora"
    assert load_corrections("missing", tmp_path) == []


def test_final_label_per_verdict():
    assert Correction(0, 1, "correct", predicted_type="smash").final_label() == "smash"
    assert Correction(0, 1, "wrong_class", predicted_type="smash",
                      corrected_type="bandeja").final_label() == "bandeja"
    assert Correction(0, 1, "not_a_shot", predicted_type="smash").final_label() == "other"
    assert Correction(0, 1, "missed", corrected_type="serve").final_label() is None


def test_build_training_samples_joins_windows():
    corrections = [
        Correction(1000.0, 1, "correct", predicted_type="smash", frame_idx=25),
        Correction(2000.0, 2, "wrong_class", predicted_type="bandeja",
                   corrected_type="vibora", frame_idx=50),
        Correction(3000.0, 3, "correct", predicted_type="serve", frame_idx=99),  # no window
        Correction(4000.0, 4, "missed", corrected_type="smash"),                 # untrainable
    ]
    windows = {"1:25": _window(), "2:50": _window()}
    samples = build_training_samples(corrections, windows)
    assert len(samples) == 2
    assert samples[0]["label"] == "smash"
    assert samples[1]["label"] == "vibora"
    assert len(samples[0]["keypoints_sequence"]) == 16


def test_append_training_samples_replaces_same_rid(tmp_path):
    s1 = [{"label": "smash", "keypoints_sequence": _window()}]
    assert append_training_samples(list(s1), "m1", tmp_path) == 1
    # Re-submission of the same match must replace, not duplicate
    s2 = [{"label": "vibora", "keypoints_sequence": _window()},
          {"label": "serve", "keypoints_sequence": _window()}]
    assert append_training_samples(list(s2), "m1", tmp_path) == 2
    assert append_training_samples(
        [{"label": "bandeja", "keypoints_sequence": _window()}], "m2", tmp_path
    ) == 3


def test_corrections_to_golden_hits():
    corrections = [
        Correction(1000.0, 1, "correct", predicted_type="smash"),
        Correction(2000.0, 2, "wrong_class", predicted_type="bandeja", corrected_type="vibora"),
        Correction(3000.0, 3, "not_a_shot", predicted_type="smash"),
        Correction(4000.0, 4, "missed", corrected_type="serve"),
    ]
    hits = corrections_to_golden_hits(corrections)
    assert len(hits) == 3   # not_a_shot excluded
    assert hits[1]["stroke_type"] == "vibora"
    assert hits[2]["stroke_type"] == "serve"


# ---------------------------------------------------------------------------
# Retrain gate
# ---------------------------------------------------------------------------

def test_retrain_skips_with_too_few_samples(tmp_path):
    from padelpro_vision.feedback.retrain import retrain_from_feedback
    with open(tmp_path / "training_data.json", "w") as f:
        json.dump([{"label": "smash", "keypoints_sequence": _window()}] * 5, f)
    result = retrain_from_feedback(
        feedback_dir=tmp_path, base_dataset=None,
        output_path=tmp_path / "out.pth",
    )
    assert result["status"] == "skipped"
    assert result["n_samples"] == 5


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@pytest.fixture()
def review_env(tmp_path, monkeypatch):
    """Point the review router at temp dirs with one analysed match."""
    from api.routers import review as review_mod
    out_dir = tmp_path / "output"
    monkeypatch.setattr(review_mod, "_OUTPUT_DIR", out_dir)
    monkeypatch.setattr(review_mod, "_FEEDBACK_DIR", tmp_path / "feedback")
    monkeypatch.setattr(review_mod, "_VIDEO_DIR", tmp_path / "videos")

    match_dir = out_dir / "m1"
    match_dir.mkdir(parents=True)
    events = [{
        "match_id": "m1", "player_id": 1, "rally_id": 0, "ts_ms": 1000.0,
        "stroke_type": "smash", "confidence": 0.9, "frame_idx": 25,
        "court_x": None, "court_y": None, "wrist_speed": 0.3, "audio_onset": True,
    }]
    with open(match_dir / "m1_shot_events.json", "w") as f:
        json.dump(events, f)
    with open(match_dir / "m1_pose_windows.json", "w") as f:
        json.dump({"1:25": _window()}, f)

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app), tmp_path


def test_review_get_items(review_env):
    client, _ = review_env
    r = client.get("/review/m1")
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["trainable"] is True
    assert data["items"][0]["audio_onset"] is True
    assert "smash" in data["stroke_classes"]


def test_review_get_unknown_rid(review_env):
    client, _ = review_env
    assert client.get("/review/nope").status_code == 404


def test_review_submit_and_resubmit(review_env):
    client, tmp_path = review_env
    body = {"corrections": [{
        "ts_ms": 1000.0, "player_id": 1, "verdict": "wrong_class",
        "predicted_type": "smash", "corrected_type": "bandeja", "frame_idx": 25,
    }]}
    r = client.post("/review/m1", json=body)
    assert r.status_code == 200
    assert r.json() == {"rid": "m1", "saved": 1, "training_samples": 1, "golden_hits": 1}

    # Training sample stored with the corrected label
    with open(tmp_path / "feedback" / "training_data.json") as f:
        samples = json.load(f)
    assert len(samples) == 1 and samples[0]["label"] == "bandeja"

    # Golden hits written for evaluate.py
    with open(tmp_path / "feedback" / "golden" / "m1.json") as f:
        golden = json.load(f)
    assert golden["hits"][0]["stroke_type"] == "bandeja"

    # Resubmission replaces rather than duplicates
    r = client.post("/review/m1", json=body)
    assert r.status_code == 200
    with open(tmp_path / "feedback" / "training_data.json") as f:
        assert len(json.load(f)) == 1

    # Previous corrections are returned on GET
    r = client.get("/review/m1")
    assert len(r.json()["previous_corrections"]) == 1


def test_review_submit_validation(review_env):
    client, _ = review_env
    r = client.post("/review/m1", json={"corrections": [{
        "ts_ms": 1000.0, "player_id": 1, "verdict": "wrong_class",
        "predicted_type": "smash",
    }]})
    assert r.status_code == 400

    r = client.post("/review/m1", json={"corrections": [{
        "ts_ms": 1000.0, "player_id": 1, "verdict": "banana",
    }]})
    assert r.status_code == 400


def test_review_video_404_when_absent(review_env):
    client, _ = review_env
    assert client.get("/review/m1/video").status_code == 404


def test_review_video_range_streaming(review_env, tmp_path):
    client, base = review_env
    video_dir = base / "videos"
    video_dir.mkdir(exist_ok=True)
    (video_dir / "m1.mp4").write_bytes(b"0123456789" * 10)

    r = client.get("/review/m1/video")
    assert r.status_code == 200
    assert r.headers["accept-ranges"] == "bytes"
    assert len(r.content) == 100

    r = client.get("/review/m1/video", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == b"0123456789"
    assert r.headers["content-range"] == "bytes 10-19/100"
