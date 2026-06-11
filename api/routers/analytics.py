"""Player stats and progression endpoints."""

from __future__ import annotations
import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from api.models import PlayerStatsResponse, ProgressionResponse, ProgressionPoint

router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)


@router.get("/matches/{match_id}/stats", response_model=list[PlayerStatsResponse])
async def get_player_stats(match_id: str):
    """Return per-player stats for a match (reads analytics JSON from disk)."""
    analytics_path = Path("data/output") / match_id / f"{match_id}_analytics.json"
    if not analytics_path.exists():
        raise HTTPException(status_code=404, detail="Analytics not found. Run pipeline with --analytics first.")

    with open(analytics_path) as f:
        data = json.load(f)

    result = []
    sync = data.get("sync_score", 0.0)
    for ps in data.get("player_stats", []):
        shots = json.loads(ps.get("shots_json", "{}"))
        result.append(PlayerStatsResponse(
            player_id=ps["player_id"],
            distance_m=ps["distance_m"],
            avg_speed_ms=ps["avg_speed_ms"],
            max_speed_ms=ps["max_speed_ms"],
            attack_pct=ps["attack_pct"],
            defense_pct=ps["defense_pct"],
            transition_pct=ps["transition_pct"],
            shots=shots,
            sync_score=sync,
        ))
    return result


@router.get("/matches/{match_id}/heatmap/{player_id}")
async def get_heatmap(match_id: str, player_id: int):
    """Return heatmap grid (list-of-lists) for a player."""
    analytics_path = Path("data/output") / match_id / f"{match_id}_analytics.json"
    if not analytics_path.exists():
        raise HTTPException(status_code=404, detail="Analytics not found.")

    with open(analytics_path) as f:
        data = json.load(f)

    for ps in data.get("player_stats", []):
        if ps["player_id"] == player_id:
            return {"player_id": player_id, "heatmap": json.loads(ps["heatmap_json"])}

    raise HTTPException(status_code=404, detail=f"Player {player_id} not found in analytics.")


@router.get("/progression/{player_id}/{metric}", response_model=ProgressionResponse)
async def get_progression(player_id: str, metric: str):
    """
    Return progression history for a player metric across matches.
    Reads from Supabase if connected, else returns empty history.
    """
    history: list[ProgressionPoint] = []

    try:
        from padelpro_vision.io.supabase_client import SupabaseClient
        db = SupabaseClient()
        if db.connected:
            rows = (
                db._client.table("progression")
                .select("*")
                .eq("player_id", player_id)
                .eq("metric", metric)
                .order("measured_at")
                .execute()
            )
            history = [
                ProgressionPoint(
                    measured_at=r["measured_at"],
                    value=r["value"],
                    match_id=r.get("match_id"),
                )
                for r in (rows.data or [])
            ]
    except Exception as exc:
        logger.warning("Supabase progression query failed: %s", exc)

    return ProgressionResponse(player_id=player_id, metric=metric, history=history)
