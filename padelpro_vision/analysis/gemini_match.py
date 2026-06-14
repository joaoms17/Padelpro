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
- Within each team: player 1 and 3 are on the LEFT side, 2 and 4 on the RIGHT side
- Each SET has multiple GAMES; each GAME has multiple POINTS; each POINT = one RALLY
- A typical padel match has 50-200 individual rallies across 2-3 sets

COORDINATE SYSTEM (all values 0.0–1.0):
  court_x: 0.0 = left edge, 1.0 = right edge (as seen from camera)
  court_y: 0.0 = near baseline (camera side), 0.5 = net, 1.0 = far baseline

Return ONLY a single valid JSON object — NO markdown fences, NO text before or after.

{
  "duration_s": <total video length in seconds, float>,

  "player_positions": [
    // MANDATORY: record ALL 4 players EVERY 5 SECONDS throughout the video.
    // Total entries MUST be at least ceil(duration_s / 5) * 4.
    // For a 5-minute video that is at least 240 entries.
    // If a player is briefly off-screen, estimate their most likely position.
    // Players 1 & 2 are always in the court_y 0.0-0.5 half; 3 & 4 in 0.5-1.0.
    {"t_s": <float>, "player": <1|2|3|4>, "court_x": <0.0-1.0>, "court_y": <0.0-1.0>},
    ...
  ],

  "shots": [
    // Every single racket-ball contact = 1 shot entry (serves, volleys, groundstrokes…).
    // Attribute to the player whose racket touched the ball.
    // ALL 4 players should have shots if they played the whole match.
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
5. Return ONLY the raw JSON object. No explanation, no markdown.
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

    cfg_kwargs = dict(
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=65536,
    )
    try:
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    except Exception:
        pass

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_file, _MATCH_PROMPT],
        config=types.GenerateContentConfig(**cfg_kwargs),
    )

    try:
        client.files.delete(name=video_file.name)
    except Exception:
        pass

    report = _parse_match_json(response.text)
    logger.info(
        "Gemini full-match: %d positions, %d shots, %d rallies",
        len(report.get("player_positions", [])),
        len(report.get("shots", [])),
        len(report.get("rallies", [])),
    )
    return report


def _parse_match_json(text: str) -> dict:
    """Parse the report JSON, tolerating truncation by falling back to the
    shared salvage parser and filling any missing top-level keys with defaults."""
    import json

    data: dict
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Match JSON truncated (%d chars) — salvaging", len(text))
        data = _parse_gemini_json(text)  # best-effort; returns at least {}

    data.setdefault("duration_s", 0.0)
    for key in ("player_positions", "shots", "formation_samples",
                "score_timeline", "key_frames", "rallies"):
        data.setdefault(key, [])
    data.setdefault("final_score", {"team1_sets": 0, "team2_sets": 0, "detail": ""})
    data.setdefault("match_summary", "")
    data.setdefault("confidence", 0.0)
    return data


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
