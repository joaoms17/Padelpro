"""
Active-learning review queue: collect the moments where the model was least
confident so annotation time goes exactly where the model fails most.

Output review_queue.json items:
    {"type": "low_conf_stroke", "ts_ms": ..., "detail": {...}}
    {"type": "missing_players", "start_ms": ..., "end_ms": ..., "detail": {...}}
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def build_review_queue(
    shot_events: list,
    frame_results: list,
    *,
    confidence_threshold: float = 0.6,
    expected_players: int = 4,
    min_gap_duration_ms: float = 1500.0,
) -> list[dict]:
    items: list[dict] = []

    for ev in shot_events:
        if ev.confidence < confidence_threshold:
            items.append({
                "type": "low_conf_stroke",
                "ts_ms": ev.ts_ms,
                "detail": {
                    "player_id": ev.player_id,
                    "stroke_type": ev.stroke_type,
                    "confidence": round(ev.confidence, 3),
                    "audio_onset": getattr(ev, "audio_onset", None),
                },
            })

    # Group consecutive frames with fewer players than expected into ranges
    gap_start: float | None = None
    prev_ts: float | None = None
    min_seen = expected_players
    for fr in frame_results:
        short = len(fr.tracks) < expected_players
        if short and gap_start is None:
            gap_start = fr.timestamp_ms
            min_seen = len(fr.tracks)
        elif short:
            min_seen = min(min_seen, len(fr.tracks))
        elif gap_start is not None:
            if prev_ts is not None and (prev_ts - gap_start) >= min_gap_duration_ms:
                items.append({
                    "type": "missing_players",
                    "start_ms": gap_start,
                    "end_ms": prev_ts,
                    "detail": {"min_players_seen": min_seen, "expected": expected_players},
                })
            gap_start = None
            min_seen = expected_players
        prev_ts = fr.timestamp_ms
    if gap_start is not None and prev_ts is not None and (prev_ts - gap_start) >= min_gap_duration_ms:
        items.append({
            "type": "missing_players",
            "start_ms": gap_start,
            "end_ms": prev_ts,
            "detail": {"min_players_seen": min_seen, "expected": expected_players},
        })

    items.sort(key=lambda i: i.get("ts_ms", i.get("start_ms", 0.0)))
    return items


def save_review_queue(items: list[dict], output_dir: Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "review_queue.json"
    with open(path, "w") as f:
        json.dump(items, f, indent=2)
    logger.info("Review queue: %d items → %s", len(items), path)
    return path
