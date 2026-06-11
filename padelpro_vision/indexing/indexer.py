"""Clip indexing stub — Indexing milestone."""

from __future__ import annotations
from pathlib import Path


def query_clips(
    match_id: str,
    player: str | None = None,
    stroke: str | None = None,
    zone: str | None = None,
    rally_phase: str | None = None,
) -> list[dict]:
    """Return clip intervals matching filters — no video I/O."""
    raise NotImplementedError("TODO (Indexing milestone): implement query_clips.")


def build_montage(clips: list[dict], output_path: Path) -> None:
    """Render a montage video from clip intervals via ffmpeg concat."""
    raise NotImplementedError("TODO (Indexing milestone): implement build_montage.")
