"""Tests for automatic court corner detection and side-based team assignment."""

from __future__ import annotations
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _synthetic_court(w: int = 1280, h: int = 720) -> tuple[np.ndarray, list[list[float]]]:
    """Blue court with white outer lines, camera-behind perspective
    (top edge narrower than bottom). Returns (frame, [TL,TR,BR,BL])."""
    frame = np.full((h, w, 3), (90, 60, 20), dtype=np.uint8)   # dark-blue court
    tl, tr = [380.0, 150.0], [900.0, 150.0]
    bl, br = [160.0, 640.0], [1120.0, 640.0]
    quad = np.array([tl, tr, br, bl], dtype=np.int32)
    cv2.polylines(frame, [quad], isClosed=True, color=(255, 255, 255), thickness=8)
    # service line + centre line, like a real court
    cv2.line(frame, (270, 480), (1010, 480), (255, 255, 255), 6)
    cv2.line(frame, (640, 480), (640, 640), (255, 255, 255), 6)
    return frame, [tl, tr, br, bl]


def test_detects_synthetic_court_corners():
    from padelpro_vision.calibration.auto import detect_court_corners
    frame, expected = _synthetic_court()
    corners = detect_court_corners(frame)
    assert corners is not None
    for got, exp in zip(corners, expected):
        assert abs(got[0] - exp[0]) < 25 and abs(got[1] - exp[1]) < 25, (got, exp)


def test_no_court_returns_none():
    from padelpro_vision.calibration.auto import detect_court_corners
    noise = np.random.default_rng(0).integers(0, 60, (720, 1280, 3), dtype=np.uint8)
    assert detect_court_corners(noise.astype(np.uint8)) is None


def test_auto_calibrate_returns_quality():
    from padelpro_vision.calibration.auto import auto_calibrate
    frame, _ = _synthetic_court()
    result = auto_calibrate(frame)
    assert result is not None
    assert result["quality"]["rating"] in ("good", "ok")
    assert len(result["points"]) == 4
    assert np.array(result["H"]).shape == (3, 3)


def test_auto_endpoint(tmp_path):
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    frame, _ = _synthetic_court()
    ok, buf = cv2.imencode(".jpg", frame)
    assert ok
    r = client.post("/calibrate/auto", files={"file": ("f.jpg", buf.tobytes(), "image/jpeg")})
    assert r.status_code == 200
    data = r.json()
    assert len(data["points"]) == 4
    assert data["quality"]["rating"] in ("good", "ok")

    # Garbage image → 422 (UI falls back to manual)
    blank = np.zeros((720, 1280, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", blank)
    r = client.post("/calibrate/auto", files={"file": ("f.jpg", buf.tobytes(), "image/jpeg")})
    assert r.status_code == 422

    r = client.post("/calibrate/auto", files={"file": ("f.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


def test_team_assignment_by_court_side(monkeypatch, tmp_path):
    """Auto team_map must split players by court half, not by track ID order."""
    import padelpro_vision.analytics.analytics as ana
    from padelpro_vision.pipeline import Pipeline

    captured: dict = {}
    real = ana.compute_match_analytics

    def spy(match_id, tp, se, team_map=None):
        captured["team_map"] = team_map
        return real(match_id, tp, se, team_map)

    monkeypatch.setattr(ana, "compute_match_analytics", spy)

    # IDs deliberately interleaved across sides (1,3 far · 2,4 near)
    positions = {
        1: [(i * 100.0, 5.0, 3.0) for i in range(20)],
        2: [(i * 100.0, 5.0, 17.0) for i in range(20)],
        3: [(i * 100.0, 7.0, 4.0) for i in range(20)],
        4: [(i * 100.0, 7.0, 16.0) for i in range(20)],
    }
    Pipeline()._run_analytics("m1", positions, [], None, tmp_path, supabase=False, segs=[])

    tm = captured["team_map"]
    assert tm[1] == tm[3], "far-side players must share a team"
    assert tm[2] == tm[4], "near-side players must share a team"
    assert tm[1] != tm[2], "the two sides are different teams"
