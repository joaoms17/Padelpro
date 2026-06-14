"""Lightweight SQLite-backed job store (replaces in-memory _jobs dicts).

Jobs are stored as JSON blobs keyed by (router, job_id).  On restart the
backend can read any job whose file-system artefact still exists — in-progress
jobs at the time of the crash are marked "error" on next read.
"""
from __future__ import annotations
import json
import sqlite3
import threading
import time
from pathlib import Path

_DB_PATH = Path("data/padelpro.db")
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            router    TEXT NOT NULL,
            job_id    TEXT NOT NULL,
            data      TEXT NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY (router, job_id)
        )
    """)
    conn.commit()
    return conn


def save_job(router: str, job_id: str, data: dict) -> None:
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT OR REPLACE INTO jobs (router, job_id, data, updated_at) VALUES (?, ?, ?, ?)",
            (router, job_id, json.dumps(data, default=str), time.time()),
        )
        conn.commit()
        conn.close()


def get_job(router: str, job_id: str) -> dict | None:
    with _lock:
        conn = _conn()
        row = conn.execute(
            "SELECT data FROM jobs WHERE router=? AND job_id=?",
            (router, job_id),
        ).fetchone()
        conn.close()
    return json.loads(row[0]) if row else None


def update_job(router: str, job_id: str, **kwargs) -> None:
    with _lock:
        conn = _conn()
        row = conn.execute(
            "SELECT data FROM jobs WHERE router=? AND job_id=?",
            (router, job_id),
        ).fetchone()
        if row:
            data = json.loads(row[0])
            data.update(kwargs)
            conn.execute(
                "UPDATE jobs SET data=?, updated_at=? WHERE router=? AND job_id=?",
                (json.dumps(data, default=str), time.time(), router, job_id),
            )
            conn.commit()
        conn.close()


def prune_jobs(router: str, max_age_s: float = 7200.0) -> None:
    """Delete done/error jobs older than max_age_s."""
    with _lock:
        conn = _conn()
        cutoff = time.time() - max_age_s
        conn.execute(
            "DELETE FROM jobs WHERE router=? AND updated_at < ? "
            "AND json_extract(data,'$.status') IN ('done','error')",
            (router, cutoff),
        )
        conn.commit()
        conn.close()
