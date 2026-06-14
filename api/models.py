"""Pydantic request/response models for the FastAPI layer."""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel


class MatchCreate(BaseModel):
    court_id: str = "default"
    youtube_url: str | None = None


class MatchStatus(BaseModel):
    match_id: str
    status: str  # queued|downloading|uploading|analyzing|done|error
    error_message: str | None = None
    progress: str | None = None


class AnalysisReport(BaseModel):
    match_id: str
    duration_s: float
    final_score: dict
    shot_counts: dict
    match_summary: str
    confidence: float
    formation_pct: dict  # computed from formation_samples
    player_positions: list[dict]
    shots: list[dict]
    score_timeline: list[dict]
    key_frames: list[dict]
