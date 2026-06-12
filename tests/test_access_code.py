"""Tests for the optional shared access code (PADELPRO_ACCESS_CODE)."""

from __future__ import annotations
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


def test_open_when_env_not_set(client, monkeypatch):
    monkeypatch.delenv("PADELPRO_ACCESS_CODE", raising=False)
    assert client.get("/health").status_code == 200
    assert client.get("/matches/").status_code == 200


def test_locked_endpoints_require_code(client, monkeypatch):
    monkeypatch.setenv("PADELPRO_ACCESS_CODE", "segredo123")
    # health stays open (tunnel/deploy probes)
    assert client.get("/health").status_code == 200
    # everything else is locked without the code
    assert client.get("/matches/").status_code == 401
    assert client.get("/label/queue").status_code == 401
    # wrong code is still locked
    assert client.get("/matches/", headers={"X-Access-Code": "errado"}).status_code == 401


def test_code_accepted_as_header_and_query(client, monkeypatch):
    monkeypatch.setenv("PADELPRO_ACCESS_CODE", "segredo123")
    assert client.get("/matches/", headers={"X-Access-Code": "segredo123"}).status_code == 200
    # query form for <video src=…> URLs
    assert client.get("/matches/?code=segredo123").status_code == 200
