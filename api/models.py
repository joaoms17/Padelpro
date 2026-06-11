"""Pydantic request/response models for the FastAPI layer."""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field


# ---- Matches ----

class MatchCreate(BaseModel):
    court_id:  str
    played_at: str | None = None   # ISO 8601
    player_ids: list[str] = Field(default_factory=list)


class MatchStatus(BaseModel):
    match_id: str
    status: str
    error_message: str | None = None


# ---- Pipeline trigger ----

class RunPipelineRequest(BaseModel):
    match_id:  str
    segment:   bool = False
    condense:  bool = False
    pose:      bool = False
    analytics: bool = False
    supabase:  bool = False
    device:    str  = "cpu"


# ---- Player stats ----

class PlayerStatsResponse(BaseModel):
    player_id:      int
    distance_m:     float
    avg_speed_ms:   float
    max_speed_ms:   float
    attack_pct:     float
    defense_pct:    float
    transition_pct: float
    shots:          dict[str, int]
    sync_score:     float


# ---- Clips ----

class ClipResponse(BaseModel):
    clip_id:      int
    player_id:    int
    stroke_type:  str
    zone:         str
    rally_phase:  str
    t_start_ms:   float
    t_end_ms:     float
    thumbnail_url: str | None = None


class ClipQueryParams(BaseModel):
    player_id:   int   | None = None
    stroke:      str   | None = None
    zone:        str   | None = None
    rally_phase: str   | None = None


class MontageRequest(BaseModel):
    match_id:    str
    player_id:   int   | None = None
    stroke:      str   | None = None
    zone:        str   | None = None
    rally_phase: str   | None = None
    output_name: str   = "montage.mp4"


# ---- Progression ----

class ProgressionPoint(BaseModel):
    measured_at: str
    value:       float
    match_id:    str | None = None


class ProgressionResponse(BaseModel):
    player_id: str
    metric:    str
    history:   list[ProgressionPoint]


# ---- Calibration ----

class CalibrateRequest(BaseModel):
    court_id: str
    points:   list[list[float]]            # 4 corners in video-pixel coords: TL, TR, BR, BL
    frame_width:  int | None = None
    frame_height: int | None = None
