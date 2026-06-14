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
You are an expert padel coach with 20 years of experience. You are analysing a match
video filmed from behind the near baseline. Be methodical — never guess or average data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — PLAYER IDENTIFICATION (first 10 seconds)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pause on the opening seconds. Note each player's shirt colour:
  Player 1 = NEAR team, LEFT side   court_x ≈ 0.15-0.45, court_y < 0.5
  Player 2 = NEAR team, RIGHT side  court_x ≈ 0.55-0.85, court_y < 0.5
  Player 3 = FAR  team, LEFT side   court_x ≈ 0.15-0.45, court_y > 0.5
  Player 4 = FAR  team, RIGHT side  court_x ≈ 0.55-0.85, court_y > 0.5

NEAR team = closer to the camera. FAR team = far end of the court.
For the rest of the video, identify each hitter by shirt colour — NOT by position.
If teammates swap sides, follow the COLOUR.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — COURT AND PHYSICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Padel court: 10 m wide × 20 m long, enclosed by glass back walls and metal side mesh.
The net divides at y = 0.5. Glass back wall: y = 0.0 (near) and y = 1.0 (far).

IMPORTANT: The ball CAN and DOES bounce off the glass walls — this is legal and common.
A ball hitting the back glass and rebounding is NOT a new shot.
Shot count increments ONLY when a RACKET contacts the ball.

Coordinate system (all 0.0–1.0):
  court_x: 0.0 = left edge  → 1.0 = right edge  (as seen from camera)
  court_y: 0.0 = near baseline → 0.5 = net → 1.0 = far baseline

Typical positions by role:
  Back-left player (P1 or P3):   court_x ≈ 0.25, court_y ≈ 0.10 (near) / 0.90 (far)
  Back-right player (P2 or P4):  court_x ≈ 0.75, court_y ≈ 0.10 (near) / 0.90 (far)
  Net-left player:                court_x ≈ 0.25, court_y ≈ 0.38 (near) / 0.62 (far)
  Net-right player:               court_x ≈ 0.75, court_y ≈ 0.38 (near) / 0.62 (far)
  Defending deep:                 court_y ≈ 0.05-0.18 (near) / 0.82-0.95 (far)
  Attacking at net:               court_y ≈ 0.32-0.45 (near) / 0.55-0.68 (far)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — SHOT TYPE VISUAL GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identify EACH racket-ball contact:

serve    — underarm swing; the ball bounces in the diagonal service box. Always the
           FIRST shot of a point. Hitter is near the back glass.
forehand — swing with dominant arm on the dominant side of body, at low-to-mid height.
           Player faces the ball, weight transfers forward.
backhand — swing crossing the body to the non-dominant side, at low-to-mid height.
           Compact rotation, often two-handed.
volley   — player is at the net (court_y ≈ 0.33-0.45 or 0.55-0.67).
           Ball hit WITHOUT letting it bounce. Short, punching motion.
smash    — overhead hit with full arm extension, ball above shoulder level.
           Aggressive power shot — intended winner or to force the opponent back.
bandeja  — defensive overhead at shoulder height with slice, pushing the ball
           deep and cross-court. Player stays near the net after hitting.
           Less arm extension than smash. Ball goes high and soft.
vibora   — offensive overhead with sharp wrist snap/topspin, aimed at the side glass.
           Player moves FORWARD after hitting. Generates spin, low bounce.
lob      — high, slow, arching shot aimed to pass OVER the net players.
           Trajectory: very high arc, lands deep near the far baseline.
other    — any contact that doesn't fit the above categories.

Outcome of each shot:
  winner        — opponent team cannot return the ball legally (point won directly).
  unforced_error — hitter makes a mistake NOT caused by opponent's pressure.
                   e.g. easy ball sent into the net or out.
  forced_error  — hitter makes a mistake BECAUSE of opponent's difficult shot.
  continuation  — the rally continues normally after this shot.
  let           — serve clips the net and lands correctly in service box (redo serve).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — SCAN METHODOLOGY (do this before writing JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scan the video in 30-second segments. For EACH segment mentally note:
  a) How many shots occurred and WHO hit each one (identify by shirt colour).
  b) Position of each player at the midpoint of the segment.
  c) Formation (both teams at net? both back? split?).

This segment-by-segment method prevents you from estimating totals.
Count each segment precisely, then sum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORBIDDEN PATTERNS — ALWAYS WRONG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ All 4 players with equal or near-equal shot counts.
   Real padel is UNEVEN: the dominant player hits 25-40% of their team's shots.
   WRONG example: P1=25, P2=25, P3=25, P4=25 — this is always a hallucination.
   RIGHT example: P1=38, P2=19, P3=31, P4=22 — uneven counts are normal.

❌ Two teammates at the same court_x (or within 0.20 of each other).
   Teammates always maintain ≥0.25 horizontal (court_x) separation.

❌ Two consecutive shots by the SAME TEAM without an opponent shot between them.
   Teams MUST alternate: near→far→near→far…
   (Exception: serve followed by a let is re-served by the same team.)

❌ Near-team players (1&2) with court_y ≥ 0.5, or far-team (3&4) with court_y ≤ 0.5.
   Teams NEVER cross the net in normal play.

❌ Attributing a shot to a player who is clearly far from the ball.
   Always use shirt colour to identify the hitter — check it matches their location.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELF-CHECK BEFORE WRITING JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before writing the JSON, verify:
  □ All 4 players have DIFFERENT shirt_color values?
  □ Shot counts across 4 players are DIFFERENT (not all equal or similar)?
  □ Every player_position for P1 & P2 has court_y < 0.5?
  □ Every player_position for P3 & P4 has court_y > 0.5?
  □ P1 & P2 always differ in court_x by ≥0.25?
  □ P3 & P4 always differ in court_x by ≥0.25?
  □ No two consecutive shots belong to the same team?
If any check fails, fix the data before outputting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — single raw JSON object, NO markdown, NO text before or after
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "duration_s": <total video length in seconds, float>,

  "players": [
    {"player": 1, "shirt_color": "<cor em português, e.g. branco, azul, vermelho, preto>",
     "team": "near", "side": "left"},
    {"player": 2, "shirt_color": "<cor>", "team": "near", "side": "right"},
    {"player": 3, "shirt_color": "<cor>", "team": "far",  "side": "left"},
    {"player": 4, "shirt_color": "<cor>", "team": "far",  "side": "right"}
  ],

  "player_positions": [
    // ALL 4 players every 5 seconds. MANDATORY: ≥ ceil(duration_s/5) × 4 entries.
    // court_y: P1&P2 < 0.5, P3&P4 > 0.5. P1&P2 court_x differ ≥0.25. Same for P3&P4.
    {"t_s": <float>, "player": <1|2|3|4>, "court_x": <0.0-1.0>, "court_y": <0.0-1.0>},
    ...
  ],

  "shots": [
    // Every racket-ball contact. Counts MUST be uneven. Teams MUST alternate.
    {"t_s": <float>, "player": <1|2|3|4>,
     "type": "<forehand|backhand|volley|smash|bandeja|vibora|serve|lob|other>",
     "outcome": "<winner|unforced_error|forced_error|let|continuation>"},
    ...
  ],

  "formation_samples": [
    // MANDATORY: ≥ ceil(duration_s/5) entries, one every 5 seconds.
    // both_net | both_back | split_near_net | split_far_net | mixed
    // "both_net" (both near players at net) is COMMON in padel: expect 30-50%.
    {"t_s": <float>, "type": "<formation>"},
    ...
  ],

  "score_timeline": [
    {"t_s": <float>, "team1_games": <int>, "team2_games": <int>},
    ...
  ],

  "key_frames": [
    // 8-12 moments where all 4 players AND ball are clearly visible.
    {"t_s": <float>, "n_players": <0-4>, "ball_visible": <bool>,
     "description": "<one sentence in Portuguese>"},
    ...
  ],

  "rallies": [
    // One entry PER POINT. start_s = serve contact. end_s = point ends (ball dead).
    {"start_s": <float>, "end_s": <float>, "num_shots": <int>, "winner_team": <1|2|null>},
    ...
  ],

  "final_score": {
    "team1_sets": <int>, "team2_sets": <int>,
    "detail": "<e.g. '6-3 4-6 7-5'>"
  },
  "match_summary": "<2-3 sentences in Portuguese summarising the match and who won>",
  "confidence": <0.0-1.0>
}
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
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=16384)
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
    data.setdefault("players", [])
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
