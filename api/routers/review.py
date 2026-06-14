"""
Review & feedback endpoints — correcting the AI's read of a match.

After an analysis finishes, the dashboard shows a review page where each
detected stroke (type + outcome, from Gemini) is confirmed or corrected.
Submitted corrections are persisted and turned into a golden set
(scripts/evaluate.py) used to measure how well the AI reads the game.

Works for both flows:
  - full pipeline matches  → outputs in data/output/{rid}/
  - fast condense+analyze  → report in the condense job store
"""

from __future__ import annotations
import logging
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/review", tags=["review"])
logger = logging.getLogger(__name__)

_FEEDBACK_DIR = Path("data/feedback")
_OUTPUT_DIR = Path("data/output")
_VIDEO_DIR = Path("data/videos")


class CorrectionIn(BaseModel):
    ts_ms: float
    player_id: int
    verdict: str                        # correct | wrong_class | not_a_shot | missed
    predicted_type: str | None = None
    corrected_type: str | None = None
    frame_idx: int | None = None


class ReviewSubmission(BaseModel):
    corrections: list[CorrectionIn]


# ---------------------------------------------------------------------------
# Item sources: full pipeline output dir, or fast-path condense job report
# ---------------------------------------------------------------------------

def _items_from_pipeline(rid: str) -> list[dict] | None:
    events_path = _OUTPUT_DIR / rid / f"{rid}_shot_events.json"
    if not events_path.exists():
        return None
    with open(events_path) as f:
        events = json.load(f)
    return [
        {
            "ts_ms": ev["ts_ms"],
            "player_id": ev["player_id"],
            "stroke_type": ev["stroke_type"],
            "outcome": ev.get("outcome"),
            "confidence": ev.get("confidence"),
            "audio_onset": ev.get("audio_onset"),
            "frame_idx": ev.get("frame_idx"),
        }
        for ev in events
    ]


def _items_from_condense(rid: str) -> list[dict] | None:
    from api.db import get_job
    job = get_job("condense", rid)
    report = (job or {}).get("report")
    if not report or "shots" not in report:
        return None
    return [
        {
            "ts_ms": s["t_s"] * 1000.0,
            "player_id": s["player_id"],
            "stroke_type": s.get("type", "other"),
            "outcome": s.get("outcome"),
            "confidence": None,
            "audio_onset": True,   # fast-path hits come from audio onsets
            "frame_idx": None,
        }
        for s in report["shots"]
    ]


def _gemini_block(rid: str) -> dict | None:
    """The Gemini semantic block (summary, tactics, outcomes) for this analysis,
    from the live job if still in memory, else the persisted gemini.json."""
    try:
        from api.db import get_job
        job = get_job("condense", rid) or {}
        report = job.get("report")
        if report and report.get("gemini"):
            return report["gemini"]
        gr = job.get("gemini_report")
        if gr:
            return {k: gr.get(k) for k in
                    ("tactics", "summary", "dominant_side", "n_rallies", "n_strokes")}
    except Exception:
        pass
    p = _OUTPUT_DIR / rid / "gemini.json"
    if p.exists():
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            return None
    return None


def _video_path(rid: str) -> Path | None:
    for candidate in (_VIDEO_DIR / f"{rid}.mp4", Path("data/uploads") / f"{rid}.mp4"):
        if candidate.exists():
            return candidate
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{rid}")
async def get_review_items(rid: str):
    """Detected strokes to confirm/correct, plus any previous submission."""
    items = _items_from_pipeline(rid)
    if items is None:
        items = _items_from_condense(rid)
    if items is None:
        raise HTTPException(status_code=404, detail="Sem análise para rever neste ID.")

    from padelpro_vision.feedback.store import load_corrections
    previous = [vars(c) for c in load_corrections(rid, _FEEDBACK_DIR)]
    return {
        "rid": rid,
        "items": items,
        "previous_corrections": previous,
        "video_available": _video_path(rid) is not None,
        "stroke_classes": _stroke_classes(),
        "gemini": _gemini_block(rid),
    }


def _stroke_classes() -> list[str]:
    from padelpro_vision.strokes.classifier import STROKE_CLASSES
    return [c for c in STROKE_CLASSES if c != "other"]


@router.post("/{rid}")
async def submit_review(rid: str, body: ReviewSubmission):
    """Persist corrections and write the golden set used to evaluate the AI."""
    from padelpro_vision.feedback.store import (
        Correction, VERDICTS, save_corrections, corrections_to_golden_hits,
    )

    corrections = []
    for c in body.corrections:
        if c.verdict not in VERDICTS:
            raise HTTPException(status_code=400, detail=f"Verdict inválido: {c.verdict}")
        if c.verdict in ("wrong_class", "missed") and not c.corrected_type:
            raise HTTPException(
                status_code=400,
                detail=f"'{c.verdict}' precisa de corrected_type (evento em {c.ts_ms:.0f} ms).",
            )
        corrections.append(Correction(**c.model_dump()))

    save_corrections(rid, corrections, _FEEDBACK_DIR)

    # Golden-set hits for evaluate.py (the reference set that keeps the AI honest)
    hits = corrections_to_golden_hits(corrections)
    golden_dir = _FEEDBACK_DIR / "golden"
    golden_dir.mkdir(parents=True, exist_ok=True)
    with open(golden_dir / f"{rid}.json", "w") as f:
        json.dump({"clip_id": rid, "hits": hits}, f, indent=2)

    return {
        "rid": rid,
        "saved": len(corrections),
        "golden_hits": len(hits),
    }


# ---------------------------------------------------------------------------
# Video streaming with Range support (the review page seeks constantly)
# ---------------------------------------------------------------------------


@router.get("/{rid}/video")
async def stream_video(rid: str, request: Request):
    path = _video_path(rid)
    if path is None:
        raise HTTPException(status_code=404, detail="Vídeo já não está disponível.")
    from api.streaming import range_stream_response
    return range_stream_response(path, request)
