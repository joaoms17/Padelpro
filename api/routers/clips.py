"""Clip query and montage endpoints."""

from __future__ import annotations
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from api.models import ClipResponse, ClipQueryParams, MontageRequest

router = APIRouter(prefix="/clips", tags=["clips"])
logger = logging.getLogger(__name__)

_montage_jobs: dict[str, dict] = {}


def _load_clips(match_id: str):
    from padelpro_vision.indexing.indexer import load_index
    index_dir = Path("data/output") / match_id
    clips_path = index_dir / "clips.json"
    if not clips_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Clip index not found. Run pipeline with --analytics first.",
        )
    _, clips = load_index(index_dir)
    return clips


@router.get("/matches/{match_id}", response_model=list[ClipResponse])
async def query_clips(
    match_id: str,
    player_id: int | None = None,
    stroke: str | None = None,
    zone: str | None = None,
    rally_phase: str | None = None,
):
    """
    Query clips for a match. All filters are optional and combinable.
    Returns time intervals — no video I/O.
    """
    from padelpro_vision.indexing.indexer import query_clips as _query

    clips = _load_clips(match_id)
    filtered = _query(
        clips,
        player_id=player_id,
        stroke=stroke,
        zone=zone,
        rally_phase=rally_phase,
    )
    return [
        ClipResponse(
            clip_id=c.clip_id,
            player_id=c.player_id,
            stroke_type=c.stroke_type,
            zone=c.zone,
            rally_phase=c.rally_phase,
            t_start_ms=c.t_start_ms,
            t_end_ms=c.t_end_ms,
            thumbnail_url=c.thumbnail_url,
        )
        for c in filtered
    ]


@router.post("/matches/{match_id}/montage")
async def create_montage(
    match_id: str,
    body: MontageRequest,
    background_tasks: BackgroundTasks,
):
    """
    Trigger montage rendering from a filtered set of clips.
    Returns a job_id to poll for status.
    """
    from padelpro_vision.indexing.indexer import query_clips as _query

    clips = _load_clips(match_id)
    filtered = _query(
        clips,
        player_id=body.player_id,
        stroke=body.stroke,
        zone=body.zone,
        rally_phase=body.rally_phase,
    )

    if not filtered:
        raise HTTPException(status_code=400, detail="No clips match the filters.")

    video_path = Path("data/videos") / f"{match_id}.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Source video not found on disk.")

    job_id = str(uuid.uuid4())
    output_path = Path("data/output") / match_id / body.output_name
    _montage_jobs[job_id] = {"status": "processing", "output": str(output_path)}

    background_tasks.add_task(_render_montage_bg, job_id, video_path, filtered, output_path)
    return {"job_id": job_id, "clips": len(filtered)}


@router.get("/montage/{job_id}/status")
async def montage_status(job_id: str):
    if job_id not in _montage_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = _montage_jobs[job_id]
    return job


@router.get("/montage/{job_id}/download")
async def download_montage(job_id: str):
    if job_id not in _montage_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = _montage_jobs[job_id]
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Montage not ready (status: {job['status']}).")
    path = Path(job["output"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Output file not found.")
    return FileResponse(str(path), media_type="video/mp4", filename=path.name)


async def _render_montage_bg(job_id: str, video_path: Path, clips: list, output_path: Path):
    import asyncio
    from padelpro_vision.indexing.indexer import build_montage
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: build_montage(video_path, clips, output_path)
        )
        _montage_jobs[job_id]["status"] = "done"
    except Exception as exc:
        logger.exception("Montage failed for job %s", job_id)
        _montage_jobs[job_id]["status"] = "error"
        _montage_jobs[job_id]["error"]  = str(exc)
