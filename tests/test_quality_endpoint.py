"""Tests for the fleet quality endpoint."""

from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _report(match_id: str, pct_expected: float, generated_at: float) -> dict:
    return {
        "match_id": match_id,
        "generated_at": generated_at,
        "detection": {
            "frames_processed": 100,
            "mean_detection_confidence": 0.8,
            "mean_players_per_frame": 3.9,
            "pct_frames_with_expected_players": pct_expected,
            "pct_frames_with_zero_players": 0.0,
        },
        "tracking": {
            "n_tracks": 4,
            "tracks_per_minute": 4.0,
            "avg_track_duration_s": 60.0,
            "pct_time_with_expected_players": 95.0,
        },
        "physics": {
            "pct_implausible_speed": 0.5,
            "max_observed_speed_ms": 6.0,
            "p99_speed_ms": 5.0,
            "teleport_count": 0,
            "pct_out_of_court": 0.0,
            "n_position_samples": 400,
        },
        "strokes": {"n_events": 30, "mean_confidence": 0.8, "pct_with_audio_onset": 90.0},
        "performance": {"elapsed_s": 60.0, "realtime_factor": 1.0},
        "homography_quality": {"rating": "good", "reprojection_error_px": 2.0},
    }


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api.routers import quality as quality_mod
    out = tmp_path / "output"
    monkeypatch.setattr(quality_mod, "_OUTPUT_DIR", out)

    for mid, pct, ts in (("m_old", 60.0, 100.0), ("m_new", 90.0, 200.0)):
        d = out / mid
        d.mkdir(parents=True)
        with open(d / "quality_report.json", "w") as f:
            json.dump(_report(mid, pct, ts), f)
    # An unreadable report must not break the endpoint
    bad = out / "m_bad"
    bad.mkdir()
    (bad / "quality_report.json").write_text("not json")

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


def test_fleet_quality_aggregates(client):
    r = client.get("/quality/")
    assert r.status_code == 200
    data = r.json()
    assert data["n_matches"] == 2
    # Newest first
    assert [x["match_id"] for x in data["reports"]] == ["m_new", "m_old"]
    # Fleet mean of 60 and 90
    assert data["summary"]["detection.pct_frames_with_expected_players"] == pytest.approx(75.0)
    assert data["summary"]["performance.realtime_factor"] == pytest.approx(1.0)


def test_fleet_quality_empty(client, monkeypatch, tmp_path):
    from api.routers import quality as quality_mod
    monkeypatch.setattr(quality_mod, "_OUTPUT_DIR", tmp_path / "nothing")
    data = client.get("/quality/").json()
    assert data["n_matches"] == 0
    assert data["summary"] == {}
