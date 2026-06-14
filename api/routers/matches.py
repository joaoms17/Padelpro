"""Match management endpoints."""

from __future__ import annotations
import asyncio
import json
import logging
import uuid
from pathlib import Path

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Body

from api.models import MatchCreate, MatchStatus

router = APIRouter(prefix="/matches", tags=["matches"])
logger = logging.getLogger(__name__)

# In-memory job store (replace with DB in production)
_jobs: dict[str, dict] = {}


@router.post("/", response_model=MatchStatus, status_code=201)
async def create_match(body: MatchCreate, background_tasks: BackgroundTasks):
    """Register a new match. If youtube_url provided, start download+analysis immediately."""
    match_id = str(uuid.uuid4())
    _jobs[match_id] = {
        "status": "queued",
        "court_id": body.court_id,
        "progress": None,
        "error": None,
    }

    if body.youtube_url:
        video_dir = Path("data/videos")
        video_dir.mkdir(parents=True, exist_ok=True)
        video_path = str(video_dir / f"{match_id}.mp4")
        _jobs[match_id]["status"] = "downloading"
        _jobs[match_id]["progress"] = "A descarregar vídeo do YouTube…"
        background_tasks.add_task(_download_and_analyze_bg, match_id, body.youtube_url, video_path)

    return MatchStatus(match_id=match_id, status=_jobs[match_id]["status"])


@router.post("/{match_id}/upload")
async def upload_video(
    match_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(None),
    youtube_url: str = Body(None),
):
    """Upload a match video file OR provide youtube_url. Starts Gemini analysis in background."""
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found. POST /matches first.")

    video_dir = Path("data/videos")
    video_dir.mkdir(parents=True, exist_ok=True)
    video_path = str(video_dir / f"{match_id}.mp4")

    if file is not None:
        content = await file.read()
        with open(video_path, "wb") as f:
            f.write(content)
        _jobs[match_id]["video_path"] = video_path
        _jobs[match_id]["status"] = "uploading"
        _jobs[match_id]["progress"] = "A enviar para Gemini…"
        background_tasks.add_task(_analyze_bg, match_id, video_path)
        return {"match_id": match_id, "video_path": video_path, "size_bytes": len(content)}

    elif youtube_url:
        _jobs[match_id]["status"] = "downloading"
        _jobs[match_id]["progress"] = "A descarregar vídeo do YouTube…"
        background_tasks.add_task(_download_and_analyze_bg, match_id, youtube_url, video_path)
        return {"match_id": match_id, "status": "downloading"}

    else:
        raise HTTPException(status_code=400, detail="Provide either a file or youtube_url.")


@router.get("/{match_id}/status", response_model=MatchStatus)
async def get_status(match_id: str):
    if match_id not in _jobs:
        raise HTTPException(status_code=404, detail="Match not found.")
    job = _jobs[match_id]
    return MatchStatus(
        match_id=match_id,
        status=job["status"],
        error_message=job.get("error"),
        progress=job.get("progress"),
    )


@router.get("/", response_model=list[MatchStatus])
async def list_matches():
    return [
        MatchStatus(
            match_id=mid,
            status=job["status"],
            error_message=job.get("error"),
            progress=job.get("progress"),
        )
        for mid, job in _jobs.items()
    ]


# ---------------------------------------------------------------------------

async def _download_and_analyze_bg(match_id: str, youtube_url: str, video_path: str) -> None:
    """Background task: download YouTube video then analyze."""
    try:
        _jobs[match_id]["status"] = "downloading"
        _jobs[match_id]["progress"] = "A descarregar vídeo do YouTube…"

        ydl_opts = {
            "format": "best[ext=mp4]/best",
            "outtmpl": video_path,
        }
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: yt_dlp.YoutubeDL(ydl_opts).download([youtube_url])
        )

        _jobs[match_id]["video_path"] = video_path
        await _analyze_bg(match_id, video_path)

    except Exception as exc:
        logger.exception("Download failed for match %s", match_id)
        _jobs[match_id]["status"] = "error"
        _jobs[match_id]["error"] = str(exc)


async def _analyze_bg(match_id: str, video_path: str) -> None:
    """Background task: upload to Gemini, analyze, save results."""
    try:
        from api.gemini_analysis import GeminiAnalyzer

        analyzer = GeminiAnalyzer()

        # Upload to Gemini Files API
        _jobs[match_id]["status"] = "uploading"
        _jobs[match_id]["progress"] = "A enviar para Gemini…"
        file_uri = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: analyzer.upload_video(video_path)
        )

        # Analyze
        _jobs[match_id]["status"] = "analyzing"
        _jobs[match_id]["progress"] = "Gemini a analisar…"
        filename = Path(video_path).name
        report = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: analyzer.analyze_match(file_uri, filename)
        )

        # Save report
        output_dir = Path("data/output") / match_id
        output_dir.mkdir(parents=True, exist_ok=True)
        report["match_id"] = match_id
        with open(output_dir / "report.json", "w") as f:
            json.dump(report, f, indent=2)

        # Extract key frames
        frames_dir = output_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        key_frames = report.get("key_frames", [])
        for idx, kf in enumerate(key_frames):
            frame_path = str(frames_dir / f"frame_{idx:04d}.jpg")
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda p=frame_path, t=kf["time_s"]: analyzer.extract_frame(video_path, t, p)
                )
            except Exception as exc:
                logger.warning("Could not extract frame %d: %s", idx, exc)

        _jobs[match_id]["status"] = "done"
        _jobs[match_id]["progress"] = None
        _jobs[match_id]["output_dir"] = str(output_dir)
        logger.info("Analysis done for match %s", match_id)

    except Exception as exc:
        logger.exception("Analysis failed for match %s", match_id)
        _jobs[match_id]["status"] = "error"
        _jobs[match_id]["error"] = str(exc)
