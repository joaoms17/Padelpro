"""
Match analytics — per player, per match.

Inputs:
  - track_positions: {track_id: [(ts_ms, court_x, court_y), ...]}  (from projection)
  - shot_events: list[ShotEvent]

Outputs (PlayerStats dataclass → Supabase player_stats table):
  - distance_m        total distance covered
  - avg_speed_ms      average speed in m/s
  - max_speed_ms      peak speed in m/s (smoothed)
  - heatmap_json      NxM grid (JSON list-of-lists), normalised to [0,1]
  - attack_pct        % of frames in the attack zone
  - defense_pct       % in the defense zone
  - transition_pct    % in the transition zone
  - shots_json        {stroke_type: count}
  - sync_score        mean cross-correlation of partner speed profiles (0–1)
"""

from __future__ import annotations
import json
import logging
from dataclasses import asdict, dataclass, field

import numpy as np

from padelpro_vision.constants.court import (
    COURT_LENGTH_M,
    COURT_WIDTH_M,
    ZONE_NET_DEPTH_M,
    ZONE_MID_DEPTH_M,
)

logger = logging.getLogger(__name__)

# Heatmap grid resolution
HEATMAP_ROWS = 20    # along court length
HEATMAP_COLS = 10    # along court width

# Speed smoothing window (frames)
SPEED_SMOOTH_WINDOW = 5


@dataclass
class PlayerStats:
    match_id: str
    player_id: int
    distance_m: float = 0.0
    avg_speed_ms: float = 0.0
    max_speed_ms: float = 0.0
    attack_pct: float = 0.0
    defense_pct: float = 0.0
    transition_pct: float = 0.0
    shots_json: str = "{}"       # JSON: {stroke_type: count}
    heatmap_json: str = "[]"     # JSON: [[float, ...], ...]  normalised grid


@dataclass
class MatchAnalyticsResult:
    player_stats: list[PlayerStats] = field(default_factory=list)
    sync_score: float = 0.0      # 0–1, meaningful only when 2 players are on the same team


# ---------------------------------------------------------------------------
# Core computations
# ---------------------------------------------------------------------------

def _compute_distance_and_speed(
    positions: list[tuple[float, float, float]],
) -> tuple[float, float, float]:
    """
    Return (distance_m, avg_speed_ms, max_speed_ms) from a list of (ts_ms, cx, cy).
    """
    if len(positions) < 2:
        return 0.0, 0.0, 0.0

    ts  = np.array([p[0] for p in positions], dtype=np.float64) / 1000.0  # → seconds
    xs  = np.array([p[1] for p in positions], dtype=np.float64)
    ys  = np.array([p[2] for p in positions], dtype=np.float64)

    dx   = np.diff(xs)
    dy   = np.diff(ys)
    dt   = np.maximum(np.diff(ts), 1e-6)
    step = np.sqrt(dx**2 + dy**2)
    spd  = step / dt

    # Smooth instantaneous speed
    kernel = np.ones(SPEED_SMOOTH_WINDOW) / SPEED_SMOOTH_WINDOW
    if len(spd) >= SPEED_SMOOTH_WINDOW:
        spd_smooth = np.convolve(spd, kernel, mode="valid")
    else:
        spd_smooth = spd

    distance  = float(step.sum())
    avg_speed = float(spd_smooth.mean()) if len(spd_smooth) > 0 else 0.0
    max_speed = float(spd_smooth.max())  if len(spd_smooth) > 0 else 0.0
    return distance, avg_speed, max_speed


def _compute_heatmap(
    positions: list[tuple[float, float, float]],
    rows: int = HEATMAP_ROWS,
    cols: int = HEATMAP_COLS,
) -> list[list[float]]:
    """Normalised occupancy grid (rows × cols), values in [0, 1]."""
    grid = np.zeros((rows, cols), dtype=np.float32)
    for _, cx, cy in positions:
        r = int(np.clip(cy / COURT_LENGTH_M * rows, 0, rows - 1))
        c = int(np.clip(cx / COURT_WIDTH_M  * cols, 0, cols - 1))
        grid[r, c] += 1
    peak = grid.max()
    if peak > 0:
        grid /= peak
    return grid.tolist()


def _compute_zones(
    positions: list[tuple[float, float, float]],
    team_side: int = 0,   # kept for API compatibility; zones are net-relative
) -> tuple[float, float, float]:
    """
    Return (attack_pct, defense_pct, transition_pct).

    The net sits at y = COURT_LENGTH_M / 2 (court spans y ∈ [0, 20] with one
    team on each half). Zones are defined by distance to the net, so they are
    symmetric and team_side is irrelevant:
      - attack:     within ZONE_NET_DEPTH_M of the net
      - defense:    within 3 m of the back glass
      - transition: everything in between
    """
    if not positions:
        return 0.0, 0.0, 1.0

    ys = np.array([p[2] for p in positions], dtype=np.float64)
    net_y = COURT_LENGTH_M / 2.0
    d_net = np.abs(ys - net_y)
    half = COURT_LENGTH_M / 2.0

    attack  = d_net <= ZONE_NET_DEPTH_M
    defense = d_net >= (half - 3.0)
    transition = ~attack & ~defense
    n = len(ys)
    return (
        float(attack.sum() / n * 100),
        float(defense.sum() / n * 100),
        float(transition.sum() / n * 100),
    )


def _compute_shot_counts(
    shot_events: list,
    player_id: int,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for ev in shot_events:
        if ev.player_id == player_id:
            counts[ev.stroke_type] = counts.get(ev.stroke_type, 0) + 1
    return counts


def _sync_score(
    pos_a: list[tuple[float, float, float]],
    pos_b: list[tuple[float, float, float]],
) -> float:
    """
    Mean cross-correlation (at lag 0) of the speed profiles of two players.
    Returns a value in [0, 1] where 1 = perfectly synchronised movement.
    """
    def speed_series(positions: list[tuple]) -> np.ndarray:
        if len(positions) < 2:
            return np.zeros(1)
        xs = np.array([p[1] for p in positions])
        ys = np.array([p[2] for p in positions])
        ts = np.array([p[0] for p in positions]) / 1000.0
        dt = np.maximum(np.diff(ts), 1e-6)
        return np.sqrt(np.diff(xs)**2 + np.diff(ys)**2) / dt

    sa = speed_series(pos_a)
    sb = speed_series(pos_b)
    min_len = min(len(sa), len(sb))
    if min_len < 2:
        return 0.0
    sa, sb = sa[:min_len], sb[:min_len]
    # Normalise
    for arr in [sa, sb]:
        std = arr.std()
        if std > 0:
            arr -= arr.mean()
            arr /= std
    corr = float(np.corrcoef(sa, sb)[0, 1])
    return float(np.clip((corr + 1) / 2, 0.0, 1.0))   # map [-1,1] → [0,1]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_match_analytics(
    match_id: str,
    track_positions: dict[int, list[tuple[float, float, float]]],
    shot_events: list,
    team_map: dict[int, int] | None = None,
) -> MatchAnalyticsResult:
    """
    Compute analytics for all tracked players.

    Args:
        match_id:        Match identifier.
        track_positions: {track_id: [(ts_ms, court_x, court_y), ...]}
        shot_events:     list[ShotEvent]
        team_map:        {track_id: 0|1}  — team assignment for zone calculation.
                         If None, all players treated as team 0.
    """
    if team_map is None:
        team_map = {tid: 0 for tid in track_positions}

    stats_list: list[PlayerStats] = []
    for player_id, positions in track_positions.items():
        if not positions:
            continue

        dist, avg_spd, max_spd = _compute_distance_and_speed(positions)
        heatmap  = _compute_heatmap(positions)
        side     = team_map.get(player_id, 0)
        atk, dfn, trn = _compute_zones(positions, team_side=side)
        shots    = _compute_shot_counts(shot_events, player_id)

        stats_list.append(PlayerStats(
            match_id=match_id,
            player_id=player_id,
            distance_m=round(dist, 2),
            avg_speed_ms=round(avg_spd, 3),
            max_speed_ms=round(max_spd, 3),
            attack_pct=round(atk, 1),
            defense_pct=round(dfn, 1),
            transition_pct=round(trn, 1),
            shots_json=json.dumps(shots),
            heatmap_json=json.dumps(heatmap),
        ))
        logger.info(
            "Player %d: %.1f m  avg %.2f m/s  max %.2f m/s  atk %.0f%%  def %.0f%%  shots %s",
            player_id, dist, avg_spd, max_spd, atk, dfn, json.dumps(shots),
        )

    # Sync score: two players of the same team (fallback: first two found)
    sync = 0.0
    ids  = list(track_positions.keys())
    teammates = [tid for tid in ids if team_map.get(tid, 0) == 0]
    pair = teammates if len(teammates) >= 2 else ids
    if len(pair) >= 2:
        sync = _sync_score(track_positions[pair[0]], track_positions[pair[1]])

    return MatchAnalyticsResult(player_stats=stats_list, sync_score=round(sync, 3))
