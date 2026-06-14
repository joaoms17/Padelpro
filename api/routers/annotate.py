"""
Annotation endpoints for multi-type training data collection:
  - Ball position: extract frame → user clicks → saves annotation + frame
  - Shot outcome: winner / error / let / continuation
  - Player identity: correct mis-assigned player IDs
  - Retrain triggers: ball detector, player detector
"""

from __future__ import annotations
import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix="/annotate", tags=["annotate"])
logger = logging.getLogger(__name__)

_FEEDBACK_DIR = Path("data/feedback")
_DATASET_DIR  = Path("data/dataset/ball")
_VIDEO_DIR    = Path("data/videos")
_OUTPUT_DIR   = Path("data/output")

_retrain_state: dict[str, dict] = {}


# ── Pydantic models ──────────────────────────────────────────────────────────

class BallIn(BaseModel):
    ts_ms: float
    x_norm: float
    y_norm: float
    radius_norm: float
    frame_w: int
    frame_h: int
    court_x: float | None = None
    court_y: float | None = None


class OutcomeIn(BaseModel):
    ts_ms: float
    player_id: int
    outcome: str


class PlayerIdIn(BaseModel):
    ts_ms: float
    original_player_id: int
    corrected_player_id: int


class AnnotationSubmission(BaseModel):
    balls: list[BallIn] = []
    outcomes: list[OutcomeIn] = []
    player_ids: list[PlayerIdIn] = []


# ── Helpers ──────────────────────────────────────────────────────────────────

def _video_path(rid: str) -> Path | None:
    for p in (_VIDEO_DIR / f"{rid}.mp4", Path("data/uploads") / f"{rid}.mp4"):
        if p.exists():
            return p
    return None


def _shots_for_rid(rid: str) -> list[dict] | None:
    events = _OUTPUT_DIR / rid / f"{rid}_shot_events.json"
    if events.exists():
        import json
        with open(events) as f:
            return json.load(f)
    try:
        from api.routers.condense import _jobs
        job = _jobs.get(rid)
        report = (job or {}).get("report")
        if report and "shots" in report:
            return [
                {
                    "ts_ms": s["t_s"] * 1000,
                    "player_id": s.get("player_id", 0),
                    "stroke_type": s.get("type", "other"),
                    "pos": s.get("pos"),
                }
                for s in report["shots"]
            ]
    except Exception:
        pass
    return None


def _count_ball_annotations(rid: str) -> int:
    import json
    p = _FEEDBACK_DIR / f"{rid}_ball.json"
    if not p.exists():
        return 0
    with open(p) as f:
        return len(json.load(f))


# ── Endpoints — retrain MUST come before /{rid} so FastAPI doesn't shadow them

@router.get("/retrain/status")
async def retrain_status():
    return _retrain_state


@router.post("/retrain/ball")
async def trigger_ball_retrain(background_tasks: BackgroundTasks):
    if _retrain_state.get("ball", {}).get("status") == "running":
        raise HTTPException(status_code=409, detail="Treino de bola já a decorrer.")
    _retrain_state["ball"] = {"status": "running"}
    background_tasks.add_task(_ball_bg)
    return {"status": "running"}


@router.post("/retrain/player")
async def trigger_player_retrain(background_tasks: BackgroundTasks):
    if _retrain_state.get("player", {}).get("status") == "running":
        raise HTTPException(status_code=409, detail="Treino de jogador já a decorrer.")
    _retrain_state["player"] = {"status": "running"}
    background_tasks.add_task(_player_bg)
    return {"status": "running"}


@router.get("/{rid}")
async def get_annotation_data(rid: str):
    shots = _shots_for_rid(rid)
    if shots is None:
        raise HTTPException(status_code=404, detail="Sem análise para anotar neste ID.")
    return {
        "rid": rid,
        "shots": shots,
        "video_available": _video_path(rid) is not None,
        "n_ball_annotations": _count_ball_annotations(rid),
    }


@router.get("/{rid}/frame")
async def get_frame(rid: str, ts_ms: float = Query(...)):
    """Extract a single frame from the stored condensed video."""
    import asyncio
    vp = _video_path(rid)
    if vp is None:
        raise HTTPException(status_code=404, detail="Vídeo não disponível.")

    def _extract():
        import cv2
        cap = cv2.VideoCapture(str(vp))
        cap.set(cv2.CAP_PROP_POS_MSEC, ts_ms)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            return None, 0, 0
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        h, w = frame.shape[:2]
        return bytes(buf), w, h

    data, w, h = await asyncio.to_thread(_extract)
    if data is None:
        raise HTTPException(status_code=404, detail="Frame não disponível neste timestamp.")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            "X-Frame-Width": str(w),
            "X-Frame-Height": str(h),
            "Access-Control-Expose-Headers": "X-Frame-Width, X-Frame-Height",
        },
    )


@router.post("/{rid}/submit")
async def submit_annotations(rid: str, body: AnnotationSubmission):
    """Save all annotation types for this clip."""
    import cv2
    from padelpro_vision.feedback.store import (
        BallAnnotation, OutcomeAnnotation, PlayerIdAnnotation,
        save_ball_annotations, save_outcomes, save_player_id_annotations,
    )

    if _shots_for_rid(rid) is None:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")

    _FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    _DATASET_DIR.mkdir(parents=True, exist_ok=True)
    vp = _video_path(rid)

    saved_balls: list[BallAnnotation] = []
    for b in body.balls:
        fname = f"{rid}_{int(b.ts_ms)}.jpg"
        fpath = _DATASET_DIR / fname
        if not fpath.exists() and vp:
            cap = cv2.VideoCapture(str(vp))
            cap.set(cv2.CAP_PROP_POS_MSEC, b.ts_ms)
            ok, frame = cap.read()
            cap.release()
            if ok:
                cv2.imwrite(str(fpath), frame)
        saved_balls.append(BallAnnotation(
            ts_ms=b.ts_ms, x_norm=b.x_norm, y_norm=b.y_norm, radius_norm=b.radius_norm,
            frame_w=b.frame_w, frame_h=b.frame_h, court_x=b.court_x, court_y=b.court_y,
            frame_path=fname if fpath.exists() else None,
        ))
    if saved_balls:
        save_ball_annotations(rid, saved_balls, _FEEDBACK_DIR)

    if body.outcomes:
        save_outcomes(rid, [OutcomeAnnotation(**o.model_dump()) for o in body.outcomes], _FEEDBACK_DIR)

    if body.player_ids:
        save_player_id_annotations(rid, [PlayerIdAnnotation(**p.model_dump()) for p in body.player_ids], _FEEDBACK_DIR)

    return {
        "balls": len(saved_balls),
        "outcomes": len(body.outcomes),
        "player_ids": len(body.player_ids),
    }


# ── Background retrain tasks ─────────────────────────────────────────────────

def _ball_bg() -> None:
    try:
        from padelpro_vision.feedback.retrain import retrain_ball_detector
        _retrain_state["ball"] = retrain_ball_detector(
            feedback_dir=_FEEDBACK_DIR, dataset_dir=_DATASET_DIR
        )
    except Exception as exc:
        logger.exception("Ball retrain failed")
        _retrain_state["ball"] = {"status": "error", "detail": str(exc)}


def _player_bg() -> None:
    try:
        from padelpro_vision.feedback.retrain import retrain_player_detector
        _retrain_state["player"] = retrain_player_detector(feedback_dir=_FEEDBACK_DIR)
    except Exception as exc:
        logger.exception("Player retrain failed")
        _retrain_state["player"] = {"status": "error", "detail": str(exc)}
