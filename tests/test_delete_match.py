"""Tests for DELETE /matches/{id}."""

from __future__ import annotations
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from api.routers import matches as matches_mod
    monkeypatch.setattr(matches_mod, "_jobs", {})
    monkeypatch.chdir(tmp_path)   # data/output resolves under tmp

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app), matches_mod, tmp_path


def test_delete_unknown(client):
    c, _, _ = client
    assert c.delete("/matches/nope").status_code == 404


def test_delete_while_processing_conflicts(client):
    c, mod, _ = client
    mod._jobs["m1"] = {"status": "processing"}
    assert c.delete("/matches/m1").status_code == 409
    assert "m1" in mod._jobs


def test_delete_removes_job_video_and_outputs(client):
    c, mod, tmp = client
    video = tmp / "v.mp4"
    video.write_bytes(b"00")
    out_dir = tmp / "data" / "output" / "m1"
    out_dir.mkdir(parents=True)
    (out_dir / "quality_report.json").write_text("{}")
    mod._jobs["m1"] = {"status": "error", "video_path": str(video)}

    r = c.delete("/matches/m1")
    assert r.status_code == 200
    assert r.json() == {"match_id": "m1", "deleted": True}
    assert "m1" not in mod._jobs
    assert not video.exists()
    assert not out_dir.exists()
