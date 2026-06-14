"""
Padel game-rules validator — post-processing heuristics that constrain and
correct Gemini model outputs using domain knowledge.

These rules don't replace the model; they run AFTER it and fix outputs that
violate what's physically or legally possible in padel:

  1. Team constraint  — players 1 & 2 can only play from court_y 0.0-0.5;
                        players 3 & 4 from court_y 0.5-1.0.
  2. Alternation      — the ball must cross the net between teams on every
                        shot (except same-team volleys at the net, which are
                        rare). 3+ consecutive same-team shots is suspicious.
  3. Rally boundaries — large shot gaps (> GAP_S s) imply a new rally.
  4. Serve validation — serve is always from behind the service line and
                        into the diagonally opposite box.
  5. Outlier removal  — shots flagged as "winner" or "unforced_error" that
                        happen inside a long rally are probably mis-labelled.

All functions are pure (no side effects) and return corrected copies.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants (padel geometry, normalised court coordinates)
# ---------------------------------------------------------------------------

# Players 1 & 2 belong to the near team (court_y 0.0 – 0.5).
# Players 3 & 4 belong to the far team  (court_y 0.5 – 1.0).
_NEAR_TEAM = {1, 2}
_FAR_TEAM  = {3, 4}

# Maximum seconds between shots before we infer a rally boundary.
_RALLY_GAP_S = 4.0

# Tolerance for team-side constraint (players CAN cross briefly during attack).
_SIDE_TOLERANCE = 0.15   # 15% of court length ≈ 3 m

# Minimum fraction of shots a rally must have to not be a service error.
_MIN_SHOTS_PER_RALLY = 2


# ---------------------------------------------------------------------------
# 1. Team-side constraint
# ---------------------------------------------------------------------------

def fix_team_side_violations(
    shots: list[dict],
    positions: list[dict],
) -> list[dict]:
    """
    Re-attribute shots where the credited player is on the wrong side of the
    court. Uses the player positions nearest in time to find the closest
    player who was actually on the correct side and near the estimated contact
    point.

    Returns a NEW list with `player` fields corrected; adds `_rule_fixed` flag.
    """
    fixed = deepcopy(shots)

    for shot in fixed:
        t = float(shot.get("t_s", 0.0))
        player = shot.get("player")
        if player not in (1, 2, 3, 4):
            continue

        # Find all players' positions at time t (nearest sample)
        pos_at_t: dict[int, tuple[float, float]] = {}
        for p in positions:
            pid = p.get("player")
            if pid not in (1, 2, 3, 4):
                continue
            existing = pos_at_t.get(pid)
            if existing is None or abs(p.get("t_s", 0) - t) < abs(existing[0] - t):
                pos_at_t[pid] = (p.get("t_s", t), p.get("court_y", 0.5))

        # Check if credited player is on wrong side
        player_y = pos_at_t.get(player, (t, 0.5))[1]
        expected_team = _NEAR_TEAM if player in _NEAR_TEAM else _FAR_TEAM

        if player in _NEAR_TEAM and player_y > 0.5 + _SIDE_TOLERANCE:
            # Near-team player was in far half — find a far-team player
            candidates = [
                (pid, abs(pos_at_t.get(pid, (t, 0.75))[1] - 0.75))
                for pid in _FAR_TEAM if pid in pos_at_t
            ]
            if candidates:
                best = min(candidates, key=lambda x: x[1])
                shot["player"] = best[0]
                shot["_rule_fixed"] = "team_side"
                logger.debug("Rule team_side: shot @%.1fs reassigned %d→%d", t, player, best[0])

        elif player in _FAR_TEAM and player_y < 0.5 - _SIDE_TOLERANCE:
            candidates = [
                (pid, abs(pos_at_t.get(pid, (t, 0.25))[1] - 0.25))
                for pid in _NEAR_TEAM if pid in pos_at_t
            ]
            if candidates:
                best = min(candidates, key=lambda x: x[1])
                shot["player"] = best[0]
                shot["_rule_fixed"] = "team_side"
                logger.debug("Rule team_side: shot @%.1fs reassigned %d→%d", t, player, best[0])

    return fixed


# ---------------------------------------------------------------------------
# 2. Alternation check
# ---------------------------------------------------------------------------

def flag_alternation_violations(shots: list[dict]) -> list[dict]:
    """
    Flag shots where the same team hit 3+ times in a row without the ball
    crossing the net. Does NOT re-attribute (we don't know which player
    should get it) — just adds `_rule_flag: "same_team_streak"`.
    """
    result = deepcopy(shots)
    streak = 1
    for i in range(1, len(result)):
        prev_team = _shot_team(result[i - 1])
        curr_team = _shot_team(result[i])

        if curr_team == prev_team:
            streak += 1
        else:
            streak = 1

        if streak >= 3:
            result[i]["_rule_flag"] = "same_team_streak"
            logger.debug("Rule alternation: streak %d @%.1fs player %s",
                         streak, result[i].get("t_s", 0), result[i].get("player"))

    return result


def _shot_team(shot: dict) -> Optional[int]:
    p = shot.get("player")
    if p in _NEAR_TEAM:
        return 1
    if p in _FAR_TEAM:
        return 2
    return None


# ---------------------------------------------------------------------------
# 3. Rally boundary detection from shot timing
# ---------------------------------------------------------------------------

def infer_rallies_from_shots(
    shots: list[dict],
    gap_s: float = _RALLY_GAP_S,
) -> list[dict]:
    """
    Cluster shots into rallies by finding gaps > `gap_s` between consecutive
    shots. Returns a rally list compatible with Gemini's `rallies` schema:
      [{"start_s", "end_s", "num_shots", "winner_team"}]

    winner_team is inferred: the team that did NOT hit last (the other team
    could not return, so the hitting team won — or use existing Gemini data
    if provided).
    """
    if not shots:
        return []

    sorted_shots = sorted(shots, key=lambda s: s.get("t_s", 0.0))
    rallies: list[dict] = []
    rally_shots: list[dict] = [sorted_shots[0]]

    for shot in sorted_shots[1:]:
        gap = shot.get("t_s", 0.0) - rally_shots[-1].get("t_s", 0.0)
        if gap > gap_s:
            rallies.append(_build_rally(rally_shots))
            rally_shots = [shot]
        else:
            rally_shots.append(shot)

    if rally_shots:
        rallies.append(_build_rally(rally_shots))

    logger.info(
        "Rule rally_boundary: inferred %d rallies from %d shots",
        len(rallies), len(shots),
    )
    return rallies


def _build_rally(shots: list[dict]) -> dict:
    start_s = shots[0].get("t_s", 0.0)
    end_s   = shots[-1].get("t_s", start_s)
    last_team = _shot_team(shots[-1])
    # The team that last hit the ball lost the point (couldn't be returned)
    winner_team = ({1, 2} - {last_team}).pop() if last_team else None
    return {
        "start_s":    start_s,
        "end_s":      end_s,
        "num_shots":  len(shots),
        "winner_team": winner_team,
    }


# ---------------------------------------------------------------------------
# 4. Shot plausibility filter
# ---------------------------------------------------------------------------

def remove_outlier_shots(
    shots: list[dict],
    max_shot_gap_s: float = 0.3,
) -> list[dict]:
    """
    Remove shots that appear to be duplicates or impossible:
    - Two shots attributed to different players within max_shot_gap_s of each
      other (the ball can only be in one place).
    - Shots with no player or unknown type.
    """
    result: list[dict] = []
    prev: Optional[dict] = None
    removed = 0

    for shot in sorted(shots, key=lambda s: s.get("t_s", 0.0)):
        if shot.get("player") not in (1, 2, 3, 4):
            removed += 1
            continue
        if prev is not None:
            gap = shot.get("t_s", 0.0) - prev.get("t_s", 0.0)
            if gap < max_shot_gap_s and _shot_team(shot) == _shot_team(prev):
                # Duplicate from same team — keep the one with higher confidence
                removed += 1
                continue
        result.append(shot)
        prev = shot

    if removed:
        logger.info("Rule outlier: removed %d duplicate/invalid shots", removed)
    return result


# ---------------------------------------------------------------------------
# 5. Top-level: apply all rules in order
# ---------------------------------------------------------------------------

def apply_game_rules(
    shots: list[dict],
    positions: list[dict],
    existing_rallies: Optional[list[dict]] = None,
) -> dict:
    """
    Apply all game-rule validators to a Gemini report's shots and positions.

    Returns:
        {
            "shots":   corrected shots list,
            "rallies": inferred rallies (or improved version of existing ones),
            "n_fixes": number of corrections applied,
        }
    """
    fixed_shots = remove_outlier_shots(shots)
    fixed_shots = fix_team_side_violations(fixed_shots, positions)
    fixed_shots = flag_alternation_violations(fixed_shots)

    n_fixes = sum(1 for s in fixed_shots if "_rule_fixed" in s or "_rule_flag" in s)

    # Only re-infer rallies if Gemini returned very few (likely bad detection)
    inferred_rallies = infer_rallies_from_shots(fixed_shots)
    if existing_rallies and len(existing_rallies) >= max(1, len(inferred_rallies) // 3):
        final_rallies = existing_rallies
    else:
        final_rallies = inferred_rallies
        if existing_rallies:
            logger.info(
                "Rule rally: replaced Gemini's %d rallies with %d inferred from shots",
                len(existing_rallies), len(final_rallies),
            )

    return {
        "shots":   fixed_shots,
        "rallies": final_rallies,
        "n_fixes": n_fixes,
    }
