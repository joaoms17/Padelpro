"""
Gemini 2.5 Flash video analysis for padel semantics.

What Gemini contributes (better than our CV pipeline today):
  - Stroke type per hit: forehand, backhand, bandeja, vibora, smash, serve
  - Shot outcome: winner / unforced_error / forced_error / let / continuation
  - Tactical summary and dominant player pair

What stays in the CV pipeline:
  - Player positions, heatmaps, distances, speeds
  - Court zones and rally segmentation (audio+motion — more precise timestamps)

The merge strategy: CV hit timestamps (from audio onset) are the ground truth
for *when* each hit happened.  Gemini stroke events are matched by proximity
(≤ MATCH_WINDOW_S) to assign *type* and *outcome*.  If no Gemini event is
close enough, the hit keeps its CV-derived type.
"""

from __future__ import annotations
import json
import logging
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

MATCH_WINDOW_S = 2.5   # max gap to accept a Gemini stroke as a CV-hit match
GEMINI_MODEL   = "gemini-2.5-flash"

_STROKE_PROMPT = """
You are an expert padel analyst. Watch this padel match clip carefully.

For EVERY stroke/hit you observe, output one entry with:
  - t_s: time in seconds from the start of THIS video clip (float, 1 decimal)
  - player_pos: field quadrant of the player hitting the ball:
      "NL" near-left, "NR" near-right, "FL" far-left, "FR" far-right
      (near = the side closer to the camera)
  - type: one of forehand | backhand | bandeja | vibora | smash | serve | other
  - outcome: one of winner | unforced_error | forced_error | let | continuation

ALSO provide:
  - n_rallies: integer count of distinct rallies
  - dominant_side: "near" | "far" | "balanced" — which pair controls the net more
  - tactics: 2-3 sentence tactical summary in Portuguese (pt-PT)
  - summary: 1 sentence overall summary in Portuguese (pt-PT)

Respond ONLY with a JSON object matching exactly this schema — no markdown:
{
  "strokes": [{"t_s": float, "player_pos": str, "type": str, "outcome": str}],
  "n_rallies": int,
  "dominant_side": str,
  "tactics": str,
  "summary": str
}
"""


def analyze_with_gemini(
    video_path: Path,
    api_key: str,
    cv_hits: list[dict] | None = None,
) -> dict:
    """
    Send the condensed video to Gemini and return a merged report addition.

    Parameters
    ----------
    video_path : Path
        Condensed video (already stripped of dead time — shorter = cheaper).
    api_key : str
        Gemini API key (GEMINI_API_KEY env var).
    cv_hits : list[dict] | None
        Existing hits from the CV pipeline: list of {t_s, player_id, type, ...}.
        If supplied, Gemini stroke types are merged into these by timestamp.

    Returns
    -------
    dict with keys:
        gemini_strokes  – raw Gemini output
        n_rallies       – Gemini rally count (fallback for CV segmentation)
        dominant_side   – tactical insight
        tactics         – Portuguese tactical paragraph
        summary         – one-sentence summary
        merged_hits     – cv_hits with type/outcome overridden from Gemini
                          (only present when cv_hits was provided)
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise RuntimeError(
            "google-genai not installed. Run: pip install google-genai"
        )

    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    # The new google-genai SDK (unlike the legacy google-generativeai) accepts
    # the current "AQ." API-key format and skips the $discovery endpoint.
    client = genai.Client(api_key=api_key)

    # ── Upload to Gemini Files API ───────────────────────────────────────────
    logger.info("Uploading %s to Gemini Files API…", video_path.name)
    t0 = time.time()

    try:
        video_file = client.files.upload(file=str(video_path))
    except TypeError:
        # older google-genai builds used path= instead of file=
        video_file = client.files.upload(path=str(video_path))

    # Wait for processing (Gemini needs to transcode the video)
    while video_file.state and video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)

    if not video_file.state or video_file.state.name != "ACTIVE":
        state = video_file.state.name if video_file.state else "UNKNOWN"
        raise RuntimeError(f"Gemini file processing failed: {state}")

    logger.info("Gemini file ready (upload+process %.1fs)", time.time() - t0)

    # ── Inference ────────────────────────────────────────────────────────────
    cfg_kwargs = dict(
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=65536,   # 2.5-flash max; long matches = many strokes
    )
    # 2.5-flash "thinks" by default, which eats the output budget and truncated
    # our JSON. Structured extraction needs no reasoning — turn it off.
    try:
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    except Exception:
        pass

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_file, _STROKE_PROMPT],
        config=types.GenerateContentConfig(**cfg_kwargs),
    )

    # Clean up the uploaded file (we don't need it anymore)
    try:
        client.files.delete(name=video_file.name)
    except Exception:
        pass

    # ── Parse (robust to truncation) ─────────────────────────────────────────
    raw = _parse_gemini_json(response.text)
    strokes: list[dict] = raw.get("strokes", [])
    logger.info("Gemini returned %d strokes", len(strokes))

    result: dict = {
        "gemini_strokes": strokes,
        "n_rallies":      raw.get("n_rallies"),
        "dominant_side":  raw.get("dominant_side"),
        "tactics":        raw.get("tactics", ""),
        "summary":        raw.get("summary", ""),
    }

    # ── Merge with CV hits ───────────────────────────────────────────────────
    if cv_hits is not None:
        result["merged_hits"] = _merge_hits(cv_hits, strokes)

    return result


def _parse_gemini_json(text: str) -> dict:
    """
    Parse Gemini's JSON response. If the response was truncated (e.g. the model
    hit the output-token limit mid-array), salvage as many complete stroke
    objects as possible instead of failing the whole analysis.
    """
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Gemini JSON truncated (%d chars) — salvaging strokes", len(text))

    strokes: list[dict] = []
    for m in re.finditer(r"\{[^{}]*\}", text):
        try:
            obj = json.loads(m.group(0))
        except Exception:
            continue
        if "t_s" in obj or "type" in obj:
            strokes.append(obj)

    # Recover top-level scalar fields if they made it into the text.
    def _grab(key: str):
        m = re.search(rf'"{key}"\s*:\s*"([^"]*)"', text)
        return m.group(1) if m else ""

    return {
        "strokes": strokes,
        "n_rallies": None,
        "dominant_side": _grab("dominant_side") or None,
        "tactics": _grab("tactics"),
        "summary": _grab("summary"),
    }


def _merge_hits(cv_hits: list[dict], gemini_strokes: list[dict]) -> list[dict]:
    """
    Assign Gemini stroke type/outcome to each CV hit by nearest timestamp.
    CV hits that have no Gemini match within MATCH_WINDOW_S keep their
    existing type (from our audio-onset heuristic).
    """
    import copy
    hits = copy.deepcopy(cv_hits)

    # Build a lookup: for each Gemini stroke, which CV hit is nearest?
    used: set[int] = set()  # indices into gemini_strokes already consumed

    for hit in hits:
        t = hit.get("t_s", 0.0)
        best_idx, best_gap = None, MATCH_WINDOW_S
        for gi, gs in enumerate(gemini_strokes):
            if gi in used:
                continue
            gap = abs(gs.get("t_s", 0.0) - t)
            if gap < best_gap:
                best_gap, best_idx = gap, gi
        if best_idx is not None:
            gs = gemini_strokes[best_idx]
            hit["type"]    = gs.get("type", hit.get("type", "other"))
            hit["outcome"] = gs.get("outcome")
            hit["gemini_matched"] = True
            used.add(best_idx)
        else:
            hit["gemini_matched"] = False

    return hits


def gemini_available(api_key: str | None = None) -> bool:
    """Return True when google-genai is installed and a key is set."""
    if api_key is None:
        import os
        api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return False
    try:
        from google import genai  # noqa: F401
        return True
    except ImportError:
        return False
