"""Tests for the clip-labelling API (folder tree = dataset)."""

from __future__ import annotations
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture()
def label_env(tmp_path, monkeypatch):
    root = tmp_path / "hits"
    (root / "por_classificar").mkdir(parents=True)
    (root / "smash").mkdir()
    (root / "por_classificar" / "clip_001.mp4").write_bytes(b"video-a" * 50)
    (root / "por_classificar" / "clip_002.mp4").write_bytes(b"video-b" * 50)
    (root / "smash" / "clip_003.mp4").write_bytes(b"video-c" * 50)
    (root / "smash" / "notes.txt").write_text("ignore me")
    monkeypatch.setenv("PADELPRO_HITS_DIR", str(root))

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app), root


def test_queue_lists_unlabelled_first(label_env):
    client, _ = label_env
    r = client.get("/label/queue")
    assert r.status_code == 200
    data = r.json()
    assert data["n_unlabelled"] == 2
    assert data["clips"][0]["label"] is None
    assert data["counts"] == {"por_classificar": 2, "smash": 1}
    assert "smash" in data["labels"] and "bandeja" in data["labels"]
    names = [c["name"] for c in data["clips"]]
    assert "notes.txt" not in names


def test_label_moves_file(label_env):
    client, root = label_env
    r = client.post("/label/clip/clip_001.mp4", json={"label": "vibora"})
    assert r.status_code == 200
    assert r.json()["moved"] is True
    assert (root / "vibora" / "clip_001.mp4").exists()
    assert not (root / "por_classificar" / "clip_001.mp4").exists()

    # Relabelling to the same folder is a no-op
    r = client.post("/label/clip/clip_001.mp4", json={"label": "vibora"})
    assert r.json()["moved"] is False


def test_label_validation(label_env):
    client, _ = label_env
    assert client.post("/label/clip/clip_001.mp4", json={"label": "../escape"}).status_code == 400
    assert client.post("/label/clip/missing.mp4", json={"label": "smash"}).status_code == 404
    assert client.post("/label/clip/..%2F..%2Fetc.mp4", json={"label": "smash"}).status_code == 404


def test_clip_streaming_with_range(label_env):
    client, _ = label_env
    r = client.get("/label/clip/clip_003.mp4", headers={"Range": "bytes=0-6"})
    assert r.status_code == 206
    assert r.content == b"video-c"


def test_queue_empty_root(monkeypatch, tmp_path):
    monkeypatch.setenv("PADELPRO_HITS_DIR", str(tmp_path / "nope"))
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    data = client.get("/label/queue").json()
    assert data["clips"] == []
    assert data["n_unlabelled"] == 0


def test_harvest_label_resolution():
    from scripts.harvest_pose_from_clips import resolve_label
    assert resolve_label("smash", {}) == "smash"
    assert resolve_label("Bandeja", {}) == "bandeja"
    assert resolve_label("rede", {}) is None
    assert resolve_label("rede", {"rede": "forehand_volley"}) == "forehand_volley"
    assert resolve_label("rede", {"rede": "invalid_class"}) is None
