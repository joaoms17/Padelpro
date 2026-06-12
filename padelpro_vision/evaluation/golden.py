"""
Golden set: hand-annotated ground truth for short clips, used by scripts/evaluate.py.

One JSON file per clip in data/golden/:

    {
      "clip_id": "clip_001",
      "video": "clip_001.mp4",          // relative to the JSON file, or absolute
      "court_id": "sintra_court1",      // optional — enables court-space metrics
      "rallies": [{"start_ms": 1000, "end_ms": 9500}],
      "hits": [
        {"ts_ms": 1520, "player": "A", "stroke_type": "bandeja"}
      ],
      "positions": [                    // sparse keyframe positions (court metres)
        {"ts_ms": 2000, "player": "A", "court_x": 2.5, "court_y": 3.0}
      ]
    }

Only annotate what you can: rallies alone already give segmentation metrics,
hits give detection/classification metrics, positions give projection error.
Players are letters ("A".."D") — they are matched to track IDs at evaluation
time, so annotations stay valid when tracking changes.
"""

from __future__ import annotations
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class GoldenHit:
    ts_ms: float
    player: str | None = None
    stroke_type: str | None = None


@dataclass
class GoldenPosition:
    ts_ms: float
    player: str
    court_x: float
    court_y: float


@dataclass
class GoldenClip:
    clip_id: str
    video_path: Path | None
    court_id: str | None = None
    rallies: list[tuple[float, float]] = field(default_factory=list)
    hits: list[GoldenHit] = field(default_factory=list)
    positions: list[GoldenPosition] = field(default_factory=list)

    @property
    def has_rallies(self) -> bool:
        return len(self.rallies) > 0

    @property
    def has_hits(self) -> bool:
        return len(self.hits) > 0

    @property
    def has_positions(self) -> bool:
        return len(self.positions) > 0


def load_golden_clip(path: Path) -> GoldenClip:
    path = Path(path)
    with open(path) as f:
        data = json.load(f)

    video_path: Path | None = None
    if data.get("video"):
        v = Path(data["video"])
        video_path = v if v.is_absolute() else path.parent / v

    return GoldenClip(
        clip_id=data.get("clip_id", path.stem),
        video_path=video_path,
        court_id=data.get("court_id"),
        rallies=[(float(r["start_ms"]), float(r["end_ms"])) for r in data.get("rallies", [])],
        hits=[
            GoldenHit(
                ts_ms=float(h["ts_ms"]),
                player=h.get("player"),
                stroke_type=h.get("stroke_type"),
            )
            for h in data.get("hits", [])
        ],
        positions=[
            GoldenPosition(
                ts_ms=float(p["ts_ms"]),
                player=p["player"],
                court_x=float(p["court_x"]),
                court_y=float(p["court_y"]),
            )
            for p in data.get("positions", [])
        ],
    )


def load_golden_set(golden_dir: Path) -> list[GoldenClip]:
    """Load every *.json annotation in a directory (non-recursive)."""
    golden_dir = Path(golden_dir)
    clips: list[GoldenClip] = []
    for path in sorted(golden_dir.glob("*.json")):
        if path.name.startswith(("example", "_")):
            continue
        try:
            clips.append(load_golden_clip(path))
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("Skipping invalid golden annotation %s: %s", path.name, exc)
    return clips
