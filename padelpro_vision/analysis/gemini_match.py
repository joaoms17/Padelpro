"""
Full-match Gemini analysis — the whole video in a single pass.

Unlike `gemini_clip.py` (which only extracts stroke type/outcome and merges
them onto CV-detected hits), this module asks Gemini to read the ENTIRE match
and return a self-contained report:

  - player_positions over time      → court heatmap
  - final_score (Gemini's guess)     → user validates the model's accuracy
  - shot_counts per player and type  → who hit what, how often
  - formation_samples over time      → % time in each net/back configuration
  - key_frames (4 players + ball)    → example frames we can show and reuse
  - rallies (active-play segments)   → useful-time stats and training segments

Everything here runs with NO torch — only google-genai + ffmpeg/cv2 — so it
works on the light Render image. The outputs double as labels for training our
own models (see padelpro_vision.training.dataset).
"""

from __future__ import annotations
import logging
import os
import time
from pathlib import Path

from padelpro_vision.analysis.gemini_clip import _parse_gemini_json

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"

# How the report's normalised court coordinates are oriented:
#   court_x: 0.0 = left edge, 1.0 = right edge (as seen from the camera)
#   court_y: 0.0 = near baseline (closest to camera), 1.0 = far baseline
# Players 1 & 2 are the near team; players 3 & 4 are the far team.

SHOT_TYPES = ("forehand", "backhand", "volley", "smash", "bandeja",
              "vibora", "serve", "lob", "other")

FORMATIONS = ("both_net", "both_back", "split_near_net", "split_far_net", "mixed")

_MATCH_PROMPT = """
You are an expert padel coach analysing a match video. Watch the ENTIRE video from
start to finish before answering. Be precise and count carefully.

PADEL BASICS:
- 2v2 sport on an enclosed glass court (10m wide × 20m long)
- Players 1 & 2 = NEAR team (the pair on the half closest to the camera, court_y 0.0-0.5)
- Players 3 & 4 = FAR team (the pair on the far half, court_y 0.5-1.0)
- Within each team: player 1 and 3 are on the LEFT side (court_x ≈ 0.1-0.45),
                    player 2 and 4 are on the RIGHT side (court_x ≈ 0.55-0.9)
- Each SET has multiple GAMES; each GAME has multiple POINTS; each POINT = one RALLY
- A typical padel match has 50-200 individual rallies across 2-3 sets

COORDINATE SYSTEM (all values 0.0–1.0):
  court_x: 0.0 = left edge, 1.0 = right edge (as seen from camera)
  court_y: 0.0 = near baseline (camera side), 0.5 = net, 1.0 = far baseline

PLAYER POSITION RULES — VERY IMPORTANT:
- Player 1: court_y ALWAYS 0.0-0.5, court_x USUALLY 0.1-0.45 (left side of near court)
- Player 2: court_y ALWAYS 0.0-0.5, court_x USUALLY 0.55-0.9 (right side of near court)
- Player 3: court_y ALWAYS 0.5-1.0, court_x USUALLY 0.1-0.45 (left side of far court)
- Player 4: court_y ALWAYS 0.5-1.0, court_x USUALLY 0.55-0.9 (right side of far court)
- Teammates are ALWAYS on OPPOSITE sides — the difference in court_x between player 1
  and player 2 (or 3 and 4) MUST be at least 0.25 at any given time.
- NEVER give two different players the same court_x AND court_y values simultaneously.
- When a player moves (to follow the ball), their court_x changes — track this movement.
- Typical attacking position (at net): court_y ≈ 0.35-0.45 for near team, 0.55-0.65 for far team
- Typical defending position (at back): court_y ≈ 0.05-0.20 for near team, 0.80-0.95 for far team

Return ONLY a single valid JSON object — NO markdown fences, NO text before or after.

{
  "duration_s": <total video length in seconds, float>,

  "player_positions": [
    // MANDATORY: record ALL 4 players EVERY 5 SECONDS throughout the video.
    // Total entries MUST be at least ceil(duration_s / 5) * 4.
    // For a 5-minute video that is at least 240 entries.
    // If a player is briefly off-screen, estimate their most likely position.
    // CRITICAL: Players 1&2 MUST have different court_x values (≥0.25 apart).
    //           Players 3&4 MUST have different court_x values (≥0.25 apart).
    //           Players 1&2 MUST have court_y < 0.5. Players 3&4 MUST have court_y > 0.5.
    {"t_s": <float>, "player": <1|2|3|4>, "court_x": <0.0-1.0>, "court_y": <0.0-1.0>},
    ...
  ],

  "shots": [
    // Every single racket-ball contact = 1 shot entry (serves, volleys, groundstrokes…).
    // Attribute to the player whose racket touched the ball.
    // ALL 4 players should have shots if they played the whole match.
    // Shots MUST alternate between teams (team 1 hits, then team 2, then team 1...).
    {"t_s": <float>, "player": <1|2|3|4>,
     "type": "<forehand|backhand|volley|smash|bandeja|vibora|serve|lob|other>",
     "outcome": "<winner|unforced_error|forced_error|let|continuation>"},
    ...
  ],

  "formation_samples": [
    // MANDATORY: record the formation EVERY 5 SECONDS.
    // Total entries MUST be at least ceil(duration_s / 5).
    // Formation describes the NEAR team (players 1 & 2) relative to the net (court_y=0.5):
    //   "both_net"        — both near-team players are within 2m of the net (attacking)
    //   "both_back"       — both near-team players are near their own baseline (defending)
    //   "split_near_net"  — one near player at net, one at back (transition)
    //   "split_far_net"   — far team has one up, one back (near team both at baseline)
    //   "mixed"           — other configurations
    // NOTE: in padel, "both_net" for the attacking team is VERY COMMON (not rare).
    //       A healthy match typically has 30-50% "both_net" samples.
    {"t_s": <float>, "type": "<both_net|both_back|split_near_net|split_far_net|mixed>"},
    ...
  ],

  "score_timeline": [
    // Record score after each game (not every point — too many).
    {"t_s": <float>, "team1_games": <int>, "team2_games": <int>},
    ...
  ],

  "key_frames": [
    // 8-12 moments where ALL 4 players AND the ball are clearly visible simultaneously.
    {"t_s": <float>, "n_players": <0-4>, "ball_visible": <bool>,
     "description": "<one-sentence description in Portuguese>"},
    ...
  ],

  "rallies": [
    // One entry PER POINT PLAYED (not per game or set).
    // start_s = the moment the server's racket hits the ball.
    // end_s   = the moment the point ends (ball hits wall/floor twice/net/out).
    // A single padel game of 5 points has 5 rally entries.
    // Typical rally duration: 5-25 seconds. Very short rallies (<3s) may be service errors.
    {"start_s": <float>, "end_s": <float>, "num_shots": <int>, "winner_team": <1|2|null>},
    ...
  ],

  "final_score": {
    "team1_sets": <int>,
    "team2_sets": <int>,
    "detail": "<e.g. '6-3 4-6 7-5' or '6-2 6-1'>"
  },
  "match_summary": "<2-3 sentences in Portuguese summarising the match and who won>",
  "confidence": <0.0-1.0 overall confidence in this analysis>
}

CRITICAL — read before answering:
1. player_positions MUST have ≥ ceil(duration_s/5) × 4 entries. Do NOT skip intervals.
2. formation_samples MUST have ≥ ceil(duration_s/5) entries. Do NOT skip intervals.
3. Every player who touched the ball MUST appear in shots with a non-zero count.
4. rallies must cover the actual points played — count them from the video carefully.
5. Player 1 and 2 MUST have different court_x at every timestamp (≥0.25 apart).
6. Player 3 and 4 MUST have different court_x at every timestamp (≥0.25 apart).
7. Return ONLY the raw JSON object. No explanation, no markdown.
""".strip()


def analyze_full_match(video_path: str | Path, api_key: str | None = None) -> dict:
    """Upload the full video to Gemini and return a parsed match report dict.

    Raises RuntimeError on configuration/processing failure. The returned dict
    follows the prompt schema above (already JSON-parsed, truncation-salvaged).
    """
    if api_key is None:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY não configurada.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise RuntimeError("google-genai não instalado. Corre: pip install google-genai")

    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_path}")

    # The new google-genai SDK (unlike legacy google-generativeai) accepts the
    # current "AQ." API-key format.
    client = genai.Client(api_key=api_key)

    logger.info("Uploading %s to Gemini Files API…", video_path.name)
    t0 = time.time()
    try:
        video_file = client.files.upload(file=str(video_path))
    except TypeError:
        video_file = client.files.upload(path=str(video_path))

    while video_file.state and video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)

    if not video_file.state or video_file.state.name != "ACTIVE":
        state = video_file.state.name if video_file.state else "UNKNOWN"
        raise RuntimeError(f"Processamento do vídeo no Gemini falhou: {state}")
    logger.info("Gemini file ready (%.1fs)", time.time() - t0)

    cfg_kwargs: dict = dict(
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=65536,
    )
    # Use a moderate thinking budget so Gemini reasons about player positions
    # and shot attribution before committing to JSON. thinking_budget=0 (off)
    # was the main cause of low-quality analysis. Thinking tokens are separate
    # from the output-token budget so this doesn't reduce the JSON space.
    try:
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=8192)
    except Exception:
        pass  # older SDK version — proceed without thinking config

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_file, _MATCH_PROMPT],
        config=types.GenerateContentConfig(**cfg_kwargs),
    )

    try:
        client.files.delete(name=video_file.name)
    except Exception:
        pass

    report = _parse_match_json(response.text or "")
    n_pos = len(report.get("player_positions", []))
    n_shots = len(report.get("shots", []))
    n_rallies = len(report.get("rallies", []))
    dur = report.get("duration_s", 0.0)
    min_pos = max(4, int(dur / 5) * 4) if dur else 4
    if n_pos < min_pos:
        logger.warning(
            "Gemini returned only %d positions for %.0fs video (expected ≥%d) — "
            "heatmap will be sparse. Consider re-analysing.",
            n_pos, dur, min_pos,
        )
    logger.info(
        "Gemini full-match: %d positions, %d shots, %d rallies (duration=%.0fs)",
        n_pos, n_shots, n_rallies, dur,
    )
    return report


def _parse_match_json(text: str) -> dict:
    """Parse the full-match report JSON with robust truncation recovery.

    When Gemini truncates mid-array, standard json.loads fails.  We try
    a series of progressively more aggressive recovery strategies:
      1. json.loads as-is (ideal path)
      2. Close open brackets/braces and retry
      3. Extract whatever top-level keys parsed before the truncation point
    """
    import json, re

    data: dict = {}

    # Strategy 1: clean parse
    try:
        data = json.loads(text)
        _fill_defaults(data)
        return data
    except json.JSONDecodeError:
        logger.warning("Match JSON truncated (%d chars) — attempting recovery", len(text))

    # Strategy 2: close unclosed brackets then retry
    repaired = text.rstrip()
    # Count open vs close brackets/braces
    opens  = repaired.count("[") - repaired.count("]")
    opens_b = repaired.count("{") - repaired.count("}")
    # Trim to the last complete top-level comma-separated entry if inside an array
    # by backing up to the last '},' boundary
    last_obj = repaired.rfind("},")
    if last_obj > len(repaired) // 2:
        repaired = repaired[: last_obj + 1]
        opens   = repaired.count("[") - repaired.count("]")
        opens_b = repaired.count("{") - repaired.count("}")
    repaired += "]" * max(0, opens) + "}" * max(0, opens_b)
    try:
        data = json.loads(repaired)
        logger.info("Recovery strategy 2 succeeded (%d chars)", len(repaired))
        _fill_defaults(data)
        return data
    except json.JSONDecodeError:
        pass

    # Strategy 3: extract top-level scalar fields + whatever arrays parsed
    for key_match in re.finditer(r'"(\w+)"\s*:\s*', text):
        key = key_match.group(1)
        rest = text[key_match.end():]
        # Try scalars first (numbers, strings, booleans)
        scalar = re.match(r'(-?\d+(?:\.\d+)?|"[^"]*"|true|false|null)', rest)
        if scalar:
            try:
                data[key] = json.loads(scalar.group(1))
            except Exception:
                pass
        elif rest.startswith("["):
            # Try to parse the array up to first failure
            objs: list = []
            for m in re.finditer(r'\{[^{}]*\}', rest):
                try:
                    objs.append(json.loads(m.group(0)))
                except Exception:
                    pass
            if objs:
                data[key] = objs

    if data:
        logger.info("Recovery strategy 3: extracted keys %s", list(data.keys()))
    _fill_defaults(data)
    return data


def _fill_defaults(data: dict) -> None:
    data.setdefault("duration_s", 0.0)
    for key in ("player_positions", "shots", "formation_samples",
                "score_timeline", "key_frames", "rallies"):
        data.setdefault(key, [])
    data.setdefault("final_score", {"team1_sets": 0, "team2_sets": 0, "detail": ""})
    data.setdefault("match_summary", "")
    data.setdefault("confidence", 0.0)


# ── Position quality fixes ───────────────────────────────────────────────────

# Default side for each player (court_x) when Gemini collapses them together.
_DEFAULT_X = {1: 0.25, 2: 0.75, 3: 0.25, 4: 0.75}
_DEFAULT_Y = {1: 0.25, 2: 0.25, 3: 0.75, 4: 0.75}
_MIN_X_SPREAD = 0.20   # minimum court_x difference between teammates


def fix_collapsed_positions(positions: list[dict]) -> list[dict]:
    """
    Detect and repair timestamps where Gemini put two players on the same
    team at identical (or nearly identical) court_x coordinates.

    Common failure mode: Gemini outputs (0.5, 0.25) for both player 1 and
    player 2 at every timestamp → heatmap shows one blob per team instead
    of two individual player zones.

    Fix: when teammates are within _MIN_X_SPREAD of each other in court_x,
    nudge them apart to their canonical sides (left: 0.25, right: 0.75).
    The y-coordinate is kept as-is (it encodes attack/defend depth).
    """
    from copy import deepcopy
    fixed = deepcopy(positions)
    n_fixed = 0

    # Group by timestamp
    by_t: dict[float, list[dict]] = {}
    for p in fixed:
        t = float(p.get("t_s", 0.0))
        by_t.setdefault(t, []).append(p)

    for t, pts in by_t.items():
        by_player = {p["player"]: p for p in pts if p.get("player") in (1, 2, 3, 4)}

        # Check each team pair
        for left, right in ((1, 2), (3, 4)):
            p1 = by_player.get(left)
            p2 = by_player.get(right)
            if p1 is None or p2 is None:
                continue
            x1 = float(p1.get("court_x", _DEFAULT_X[left]))
            x2 = float(p2.get("court_x", _DEFAULT_X[right]))
            if abs(x1 - x2) < _MIN_X_SPREAD:
                # Too close — force to canonical sides
                p1["court_x"] = _DEFAULT_X[left]
                p2["court_x"] = _DEFAULT_X[right]
                n_fixed += 1

    if n_fixed:
        logger.info(
            "fix_collapsed_positions: spread %d timestamp(s) where teammates were too close",
            n_fixed,
        )
    return fixed


# ── Position gap filling ─────────────────────────────────────────────────────

def interpolate_positions(
    positions: list[dict],
    duration_s: float,
    target_interval_s: float = 5.0,
) -> list[dict]:
    """
    Fill temporal gaps in Gemini's player_positions with linear interpolation.

    Gemini sometimes samples only every 10-30s instead of the requested 5s,
    leaving the heatmap with bare patches.  This function adds synthetic
    entries between existing samples so the heatmap looks continuous.

    Only adds entries where the gap is > 1.5 × target_interval_s (i.e. not
    already dense enough).  Marks added entries with `_interpolated: True`.
    """
    if not positions:
        return positions

    # Sort and group by player
    by_player: dict[int, list[dict]] = {}
    for p in positions:
        pid = p.get("player")
        if pid not in (1, 2, 3, 4):
            continue
        by_player.setdefault(pid, []).append(p)

    result: list[dict] = list(positions)
    gap_threshold = target_interval_s * 1.5

    for pid, pts in by_player.items():
        pts_sorted = sorted(pts, key=lambda p: p.get("t_s", 0.0))

        # Fill gap at the start (if first sample is late)
        if pts_sorted and pts_sorted[0].get("t_s", 0.0) > gap_threshold:
            first = pts_sorted[0]
            t = 0.0
            while t < first.get("t_s", 0.0) - target_interval_s / 2:
                result.append({
                    "t_s": round(t, 1),
                    "player": pid,
                    "court_x": first["court_x"],
                    "court_y": first["court_y"],
                    "_interpolated": True,
                })
                t += target_interval_s

        # Fill gaps between samples
        for i in range(len(pts_sorted) - 1):
            a, b = pts_sorted[i], pts_sorted[i + 1]
            t_a, t_b = float(a.get("t_s", 0)), float(b.get("t_s", 0))
            if t_b - t_a <= gap_threshold:
                continue
            x_a, y_a = float(a.get("court_x", 0.5)), float(a.get("court_y", 0.25 if pid <= 2 else 0.75))
            x_b, y_b = float(b.get("court_x", 0.5)), float(b.get("court_y", 0.25 if pid <= 2 else 0.75))
            t = t_a + target_interval_s
            while t < t_b - target_interval_s / 2:
                frac = (t - t_a) / (t_b - t_a)
                result.append({
                    "t_s": round(t, 1),
                    "player": pid,
                    "court_x": round(x_a + frac * (x_b - x_a), 3),
                    "court_y": round(y_a + frac * (y_b - y_a), 3),
                    "_interpolated": True,
                })
                t += target_interval_s

        # Fill gap at the end
        if duration_s > 0 and pts_sorted:
            last = pts_sorted[-1]
            t = float(last.get("t_s", 0.0)) + target_interval_s
            while t <= duration_s:
                result.append({
                    "t_s": round(t, 1),
                    "player": pid,
                    "court_x": last["court_x"],
                    "court_y": last["court_y"],
                    "_interpolated": True,
                })
                t += target_interval_s

    added = len(result) - len(positions)
    if added:
        logger.info("interpolate_positions: added %d synthetic entries (was %d)", added, len(positions))
    return result


# ── Derived metrics ──────────────────────────────────────────────────────────

def compute_shot_counts(shots: list[dict]) -> dict:
    """Build {player_N: {shot_type: count}} from the raw shots list."""
    counts = {
        f"player_{p}": {t: 0 for t in SHOT_TYPES}
        for p in (1, 2, 3, 4)
    }
    for s in shots:
        p = s.get("player")
        t = s.get("type", "other")
        if p not in (1, 2, 3, 4):
            continue
        if t not in SHOT_TYPES:
            t = "other"
        counts[f"player_{p}"][t] += 1
    return counts


def compute_formation_pct(samples: list[dict]) -> dict:
    """Percentage of sampled time spent in each formation."""
    counts = {f: 0 for f in FORMATIONS}
    for s in samples:
        t = s.get("type", "mixed")
        counts[t if t in counts else "mixed"] += 1
    total = sum(counts.values())
    if total == 0:
        return {f: 0.0 for f in FORMATIONS}
    return {f: round(100.0 * c / total, 1) for f, c in counts.items()}


def compute_rally_stats(rallies: list[dict], duration_s: float) -> dict:
    """Aggregate rally stats: count, average length, total/percentage play time."""
    durations = []
    for r in rallies:
        d = r.get("end_s", 0.0) - r.get("start_s", 0.0)
        if d > 0:
            durations.append(d)
    total_play = sum(durations)
    return {
        "total_rallies": len(rallies),
        "avg_duration_s": round(total_play / len(durations), 1) if durations else 0.0,
        "total_play_time_s": round(total_play, 1),
        "play_time_pct": round(100.0 * total_play / duration_s, 1) if duration_s else 0.0,
    }


def enrich_report(report: dict) -> dict:
    """Add derived fields the frontend consumes, then apply game-rule fixes."""
    # Fix collapsed positions first (teammates at same x), then fill gaps.
    try:
        report["player_positions"] = fix_collapsed_positions(
            report.get("player_positions", [])
        )
    except Exception:
        logger.exception("Position collapse fix failed — using raw positions")

    try:
        report["player_positions"] = interpolate_positions(
            report.get("player_positions", []),
            duration_s=report.get("duration_s", 0.0),
        )
    except Exception:
        logger.exception("Position interpolation failed — using raw positions")

    # Apply game-rule validator: fix team-side violations, infer rally boundaries
    try:
        from padelpro_vision.analysis.game_rules import apply_game_rules
        corrections = apply_game_rules(
            shots=report.get("shots", []),
            positions=report.get("player_positions", []),
            existing_rallies=report.get("rallies"),
        )
        report["shots"]   = corrections["shots"]
        report["rallies"] = corrections["rallies"]
        if corrections["n_fixes"]:
            logger.info("Game-rules validator applied %d corrections.", corrections["n_fixes"])
    except Exception:
        logger.exception("Game-rules validation failed — using raw Gemini output")

    report["shot_counts"] = compute_shot_counts(report.get("shots", []))
    report["formation_pct"] = compute_formation_pct(report.get("formation_samples", []))
    report["rally_stats"] = compute_rally_stats(
        report.get("rallies", []), report.get("duration_s", 0.0)
    )
    return report
