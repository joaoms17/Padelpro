"""Access code removed — API is now open. Just verify health and basic reachability."""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_health_open():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    assert client.get("/health").status_code == 200


def test_open_when_env_not_set(monkeypatch):
    monkeypatch.delenv("PADELPRO_ACCESS_CODE", raising=False)
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    assert client.get("/health").status_code == 200
