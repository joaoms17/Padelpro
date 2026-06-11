"""
Segmentation stub — Segmentation milestone.

Approach:
  1. Audio: ffmpeg extract → short-time energy + onset detection (ball impacts).
  2. Video: low-res + ~5 fps frame differencing / Farneback optical flow.
  3. Combine into play_score per second; state machine with hysteresis.

Outputs:
  - segments.json: [{start_ms, end_ms, type: "rally"|"break"}]
  - timestamp_map.json: condensed_ms → real_ms
"""

from __future__ import annotations
from pathlib import Path


def get_active_segments(video_path: Path | str) -> list[dict]:
    """Return list of active rally segments [{start_ms, end_ms, type}]."""
    raise NotImplementedError(
        "TODO (Segmentation milestone): implement audio + motion segmentation."
    )
