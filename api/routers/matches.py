"""Match management endpoints."""

from __future__ import annotations
import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Form

from api.models import MatchCreate, MatchStatus, RunPipelineRequest

router = APIRouter(prefix="/matches", tags=["matches"])
logger = logging.getLogger(__name__)

# In-memory job store (replace with DB in production)
_jobs: dict[str, dict] = {}


@router.post("/", response_model=MatchStatus, status_code=201)
async def create_match(body: MatchCreate):
    """Register a new match (before video upload)."""
    match_id = str(uuid.uuid4())
    _jobs[match_id] = {"status": "queued", "court_id": body.court_id}
    return MatchStatus(match_id=match_id, status="queued")


@router.post("/{match_id}/upload")
async def upload_video(
    match_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """
    Upload a match video. Saves to data/videos/<match_id>.mp4.
    Returns 404 if match_id not registered.
    """
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found. POST /matches first.")

    video_dir = Path("data/videos")
    video_dir.mkdir(parents=True, exist_ok=True)
    video_path = video_dir / f"{match_id}.mp4"

    content = await file.read()
    with open(video_path, "wb") as f:
        f.write(content)

    _jobs[match_id]["video_path"] = str(video_path)
    _jobs[match_id]["status"] = "queued"

    logger.info("Video uploaded for match %s → %s", match_id, video_path)
    return {"match_id": match_id, "video_path": str(video_path), "size_bytes": len(content)}


@router.post("/{match_id}/run", response_model=MatchStatus)
async def run_pipeline(
    match_id: str,
    body: RunPipelineRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger the analysis pipeline for a match (runs in background)."""
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found.")

    job = _jobs[match_id]
    video_path = job.get("video_path")
    if not video_path:
        raise HTTPException(status_code=400, detail="No video uploaded for this match.")

    court_id = job.get("court_id", "unknown")
    _jobs[match_id]["status"] = "processing"
    _jobs[match_id]["last_request"] = body   # kept for /retry
    _jobs[match_id].pop("error", None)

    background_tasks.add_task(
        _run_pipeline_bg, match_id, video_path, court_id, body
    )
    return MatchStatus(match_id=match_id, status="processing")


@router.post("/{match_id}/retry", response_model=MatchStatus)
async def retry_pipeline(match_id: str, background_tasks: BackgroundTasks):
    """
    Re-run the analysis with the same options as the last run (defaults with
    everything on when there was none). Useful after a failed run — the
    uploaded video is reused, no new upload needed.
    """
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found.")
    job = _jobs[match_id]
    if job.get("status") == "processing":
        raise HTTPException(status_code=409, detail="Análise ainda a decorrer.")
    video_path = job.get("video_path")
    if not video_path or not Path(video_path).exists():
        raise HTTPException(
            status_code=400,
            detail="O vídeo já não está disponível — carrega-o de novo.",
        )

    req = job.get("last_request") or RunPipelineRequest(
        match_id=match_id, segment=True, pose=True, analytics=True
    )
    job["status"] = "processing"
    job.pop("error", None)
    job["last_request"] = req

    background_tasks.add_task(
        _run_pipeline_bg, match_id, video_path, job.get("court_id", "unknown"), req
    )
    return MatchStatus(match_id=match_id, status="processing")


@router.get("/{match_id}/status", response_model=MatchStatus)
async def get_status(match_id: str):
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found.")
    job = _jobs[match_id]
    return MatchStatus(
        match_id=match_id,
        status=job["status"],
        error_message=job.get("error"),
    )


@router.get("/", response_model=list[MatchStatus])
async def list_matches():
    return [
        MatchStatus(match_id=mid, status=job["status"], error_message=job.get("error"))
        for mid, job in _jobs.items()
    ]


# ---------------------------------------------------------------------------

async def _run_pipeline_bg(
    match_id: str,
    video_path: str,
    court_id: str,
    req: RunPipelineRequest,
) -> None:
    """Background task: run the full pipeline."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))

    try:
        from config import DEFAULT_CONFIG
        from padelpro_vision.pipeline import Pipeline

        cfg = DEFAULT_CONFIG
        cfg.model.device = req.device

        hom_path = cfg.calibration.homography_cache_dir / f"{court_id}.json"
        output_dir = Path("data/output") / match_id

        pipeline = Pipeline(cfg)
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: pipeline.run(
                Path(video_path), output_dir, match_id,
                segment=req.segment,
                condense=req.condense,
                pose=req.pose,
                analytics=req.analytics,
                homography_path=hom_path if hom_path.exists() else None,
                supabase=req.supabase,
            )
        )
        _jobs[match_id]["status"] = "done"
        _jobs[match_id]["output_dir"] = str(output_dir)
        logger.info("Pipeline done for match %s", match_id)

    except Exception as exc:
        logger.exception("Pipeline failed for match %s", match_id)
        _jobs[match_id]["status"] = "error"
        _jobs[match_id]["error"]  = str(exc)
