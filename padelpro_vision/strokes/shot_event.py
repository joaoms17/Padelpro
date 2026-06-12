"""Shot event data model — generated in M2, completed in M3 (court_x/court_y)."""

from __future__ import annotations
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal


@dataclass
class ShotEvent:
    match_id: str
    player_id: int          # track_id from ByteTrack
    rally_id: int           # index of the rally segment
    ts_ms: float
    stroke_type: str
    confidence: float
    frame_idx: int
    # Filled in M3 after homography projection
    court_x: float | None = None
    court_y: float | None = None
    # Dominant-wrist speed at this frame (bbox-heights/frame) — impact proxy
    wrist_speed: float | None = None
    # True when an audio onset confirmed this stroke (None = audio unavailable)
    audio_onset: bool | None = None


def save_shot_events(events: list[ShotEvent], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump([asdict(e) for e in events], f, indent=2)


def load_shot_events(path: Path) -> list[ShotEvent]:
    with open(path) as f:
        return [ShotEvent(**d) for d in json.load(f)]
