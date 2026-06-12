"""
Review & feedback endpoints — the human-in-the-loop training cycle.

After an analysis finishes, the dashboard shows a review page where each
detected stroke is confirmed or corrected. Submitted corrections become:
  1. training labels for the TCN stroke classifier (when the pipeline saved
     pose windows for the events), and
  2. golden-set hits usable by scripts/evaluate.py.

Works for both flows:
  - full pipeline matches  → outputs in data/output/{rid}/
  - fast condense+analyze  → report in the condense job store

POST /review/{rid}/retrain retrains the TCN in the background; the pipeline
picks the new weights up automatically on the next run.
"""

from __future__ import annotations
import logging
import json
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/review", tags=["review"])
logger = logging.getLogger(__name__)

_FEEDBACK_DIR = Path("data/feedback")
_OUTPUT_DIR = Path("data/output")
_VIDEO_DIR = Path("data/videos")

# Single retrain at a time; results visible at GET /review/retrain/status
_retrain_state: dict = {"status": "idle"}


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
    has_windows = (_OUTPUT_DIR / rid / f"{rid}_pose_windows.json").exists()
    return [
        {
            "ts_ms": ev["ts_ms"],
            "player_id": ev["player_id"],
            "stroke_type": ev["stroke_type"],
            "confidence": ev.get("confidence"),
            "audio_onset": ev.get("audio_onset"),
            "frame_idx": ev.get("frame_idx") if has_windows else None,
            "trainable": has_windows and ev.get("frame_idx") is not None,
        }
        for ev in events
    ]


def _items_from_condense(rid: str) -> list[dict] | None:
    from api.routers.condense import _jobs as condense_jobs
    job = condense_jobs.get(rid)
    report = (job or {}).get("report")
    if not report or "shots" not in report:
        return None
    return [
        {
            "ts_ms": s["t_s"] * 1000.0,
            "player_id": s["player_id"],
            "stroke_type": s.get("type", "other"),
            "confidence": None,
            "audio_onset": True,   # fast-path hits come from audio onsets
            "frame_idx": None,
            "trainable": False,    # no pose in the fast path
        }
        for s in report["shots"]
    ]


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
    }


def _stroke_classes() -> list[str]:
    from padelpro_vision.strokes.classifier import STROKE_CLASSES
    return [c for c in STROKE_CLASSES if c != "other"]


@router.post("/{rid}")
async def submit_review(rid: str, body: ReviewSubmission):
    """Persist corrections; turn them into training samples + golden hits."""
    from padelpro_vision.feedback.store import (
        Correction, VERDICTS, save_corrections,
        build_training_samples, append_training_samples,
        corrections_to_golden_hits,
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

    # Training samples (only when the pipeline saved pose windows)
    n_samples = 0
    windows_path = _OUTPUT_DIR / rid / f"{rid}_pose_windows.json"
    if windows_path.exists():
        with open(windows_path) as f:
            pose_windows = json.load(f)
        samples = build_training_samples(corrections, pose_windows)
        if samples:
            append_training_samples(samples, rid, _FEEDBACK_DIR)
        n_samples = len(samples)

    # Golden-set hits for evaluate.py
    hits = corrections_to_golden_hits(corrections)
    golden_dir = _FEEDBACK_DIR / "golden"
    golden_dir.mkdir(parents=True, exist_ok=True)
    with open(golden_dir / f"{rid}.json", "w") as f:
        json.dump({"clip_id": rid, "hits": hits}, f, indent=2)

    return {
        "rid": rid,
        "saved": len(corrections),
        "training_samples": n_samples,
        "golden_hits": len(hits),
    }


@router.post("/{rid}/retrain")
async def trigger_retrain(rid: str, background_tasks: BackgroundTasks):
    """Retrain the stroke classifier from all accumulated feedback."""
    if _retrain_state.get("status") == "running":
        raise HTTPException(status_code=409, detail="Já há um treino a decorrer.")
    _retrain_state.clear()
    _retrain_state.update({"status": "running", "triggered_by": rid})
    background_tasks.add_task(_retrain_bg)
    return {"status": "running"}


@router.get("/retrain/status")
async def retrain_status():
    return _retrain_state


def _retrain_bg() -> None:
    try:
        from padelpro_vision.feedback.retrain import retrain_from_feedback
        result = retrain_from_feedback(feedback_dir=_FEEDBACK_DIR)
        _retrain_state.update(result)
    except Exception as exc:
        logger.exception("Retrain failed")
        _retrain_state.update({"status": "error", "detail": str(exc)})


# ---------------------------------------------------------------------------
# Video streaming with Range support (the review page seeks constantly)
# ---------------------------------------------------------------------------

_CHUNK = 1024 * 1024


@router.get("/{rid}/video")
async def stream_video(rid: str, request: Request):
    path = _video_path(rid)
    if path is None:
        raise HTTPException(status_code=404, detail="Vídeo já não está disponível.")

    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    start, end = 0, file_size - 1
    status_code = 200
    if range_header and range_header.startswith("bytes="):
        spec = range_header[len("bytes="):].split("-")
        try:
            if spec[0]:
                start = int(spec[0])
            if len(spec) > 1 and spec[1]:
                end = min(int(spec[1]), file_size - 1)
            status_code = 206
        except ValueError:
            raise HTTPException(status_code=416, detail="Range inválido.")
        if start > end or start >= file_size:
            raise HTTPException(status_code=416, detail="Range fora do ficheiro.")

    length = end - start + 1

    def reader():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    return StreamingResponse(reader(), status_code=status_code,
                             media_type="video/mp4", headers=headers)
