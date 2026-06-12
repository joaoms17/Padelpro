"""
Fleet quality endpoint — aggregates the quality_report.json each processed
match writes, so model/config changes show their impact across ALL matches,
not just one test clip.
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

import numpy as np
from fastapi import APIRouter

router = APIRouter(prefix="/quality", tags=["quality"])
logger = logging.getLogger(__name__)

_OUTPUT_DIR = Path("data/output")

# (section, field) pairs aggregated into the fleet summary
_SUMMARY_FIELDS = [
    ("detection", "pct_frames_with_expected_players"),
    ("detection", "mean_detection_confidence"),
    ("detection", "mean_players_per_frame"),
    ("tracking", "tracks_per_minute"),
    ("tracking", "pct_time_with_expected_players"),
    ("physics", "pct_implausible_speed"),
    ("physics", "pct_out_of_court"),
    ("physics", "teleport_count"),
    ("strokes", "n_events"),
    ("strokes", "pct_with_audio_onset"),
    ("performance", "realtime_factor"),
]


def _load_reports() -> list[dict]:
    reports: list[dict] = []
    if not _OUTPUT_DIR.exists():
        return reports
    for path in sorted(_OUTPUT_DIR.glob("*/quality_report.json")):
        try:
            with open(path) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Skipping unreadable %s: %s", path, exc)
            continue
        data.setdefault("match_id", path.parent.name)
        # Older reports predate the generated_at field — use file mtime
        data.setdefault("generated_at", path.stat().st_mtime)
        reports.append(data)
    reports.sort(key=lambda r: r["generated_at"], reverse=True)
    return reports


def _summarise(reports: list[dict]) -> dict:
    summary: dict = {}
    for section, field in _SUMMARY_FIELDS:
        values = [
            r[section][field]
            for r in reports
            if isinstance(r.get(section), dict) and isinstance(
                r[section].get(field), (int, float)
            )
        ]
        if values:
            summary[f"{section}.{field}"] = round(float(np.mean(values)), 2)
    return summary


@router.get("/")
async def fleet_quality():
    """All per-match quality reports (newest first) + fleet-wide means."""
    reports = _load_reports()
    return {
        "n_matches": len(reports),
        "summary": _summarise(reports),
        "reports": reports,
    }
