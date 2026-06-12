"""Tests for POST /matches/{id}/retry."""

from __future__ import annotations
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from api.routers import matches as matches_mod

    # Background task must not run the real pipeline in tests
    async def fake_bg(match_id, video_path, court_id, req):
        matches_mod._jobs[match_id]["bg_ran_with"] = req
    monkeypatch.setattr(matches_mod, "_run_pipeline_bg", fake_bg)
    monkeypatch.setattr(matches_mod, "_jobs", {})

    video = tmp_path / "v.mp4"
    video.write_bytes(b"00")

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app), matches_mod, str(video)


def test_retry_unknown_match(client):
    c, _, _ = client
    assert c.post("/matches/nope/retry").status_code == 404


def test_retry_without_video(client):
    c, mod, _ = client
    mod._jobs["m1"] = {"status": "error", "error": "boom"}
    assert c.post("/matches/m1/retry").status_code == 400


def test_retry_while_processing_conflicts(client):
    c, mod, video = client
    mod._jobs["m1"] = {"status": "processing", "video_path": video}
    assert c.post("/matches/m1/retry").status_code == 409


def test_retry_after_error_reuses_last_request(client):
    c, mod, video = client
    mod._jobs["m1"] = {"status": "queued", "video_path": video, "court_id": "c1"}

    # First run with explicit options
    r = c.post("/matches/m1/run", json={
        "match_id": "m1", "segment": True, "pose": True, "analytics": False,
    })
    assert r.status_code == 200

    # Simulate failure, then retry
    mod._jobs["m1"]["status"] = "error"
    mod._jobs["m1"]["error"] = "'ModelConfig' object has no attribute 'x'"
    r = c.post("/matches/m1/retry")
    assert r.status_code == 200
    assert r.json()["status"] == "processing"
    assert mod._jobs["m1"].get("error") is None

    req = mod._jobs["m1"]["bg_ran_with"]
    assert req.segment is True and req.pose is True and req.analytics is False


def test_retry_without_previous_run_uses_full_defaults(client):
    c, mod, video = client
    mod._jobs["m1"] = {"status": "error", "video_path": video, "error": "x"}
    r = c.post("/matches/m1/retry")
    assert r.status_code == 200
    req = mod._jobs["m1"]["bg_ran_with"]
    assert req.segment and req.pose and req.analytics
