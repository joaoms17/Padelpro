"""
"Useful time" endpoint: upload a match video and get back a condensed video
containing only the active play (rallies), with the dead time removed.

This is a *cheap* pass — it uses audio + low-res motion segmentation only
(OpenCV + numpy + ffmpeg), with no detection/torch — so it runs fast on the
backend without a GPU.
"""

from __future__ import annotations
import asyncio
import glob
import json
import logging
import os
import shutil
import time
import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

# Keep disk usage minimal: anything in data/uploads older than this is swept.
_MAX_AGE_S = 3600  # 1 hour

router = APIRouter(prefix="/condense", tags=["condense"])
logger = logging.getLogger(__name__)

_jobs: dict[str, dict] = {}

_UPLOAD_DIR = Path("data/uploads")


def _ensure_ffmpeg() -> None:
    """Best-effort: make sure ffmpeg is on PATH (Windows winget installs it
    outside the default PATH of an already-running process)."""
    from padelpro_vision.io.ffmpeg import ensure_ffmpeg
    ensure_ffmpeg()


def _rm(path: Path) -> None:
    """Delete a file or directory, ignoring errors."""
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink()
    except Exception:
        pass


def _sweep_old() -> None:
    """Remove anything in data/uploads older than _MAX_AGE_S so we never
    accumulate stale videos (important on ephemeral hosts)."""
    if not _UPLOAD_DIR.exists():
        return
    cutoff = time.time() - _MAX_AGE_S
    for entry in _UPLOAD_DIR.iterdir():
        try:
            if entry.stat().st_mtime < cutoff:
                _rm(entry)
        except Exception:
            pass


@router.get("/capabilities")
async def capabilities():
    """What this backend can do. `analyze` requires torch/torchvision;
    `max_upload_mb` lets the deployment cap uploads (tunnels/free tiers)."""
    if os.environ.get("MODAL_ANALYZE_URL", "").strip():
        analyze = True          # análise delegada na GPU cloud
    else:
        try:
            from padelpro_vision.analysis import analysis_available
            analyze = analysis_available()
        except Exception:
            analyze = False
    try:
        max_mb = int(os.environ.get("API_MAX_UPLOAD_MB", "150"))
    except ValueError:
        max_mb = 150
    return {"analyze": analyze, "max_upload_mb": max_mb}


@router.post("/upload")
async def upload_and_condense(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    analyze: bool = Form(False),
    court_id: str = Form("court1"),
    deep: bool = Form(False),
):
    """Upload a video; returns a job_id to poll. The condensed video is produced
    in the background. With analyze=true (and torch installed) a player report
    is also computed."""
    job_id = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _sweep_old()

    in_path = _UPLOAD_DIR / f"{job_id}.mp4"
    out_path = _UPLOAD_DIR / f"{job_id}_useful.mp4"

    # Stream to disk in chunks (don't load the whole video into memory).
    with open(in_path, "wb") as f:
        shutil.copyfileobj(file.file, f, length=1024 * 1024)

    _jobs[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "phase": "segmentação",
        "filename": file.filename,
        "output": str(out_path),
    }
    logger.info(
        "Condense job %s: uploaded %s (analyze=%s, deep=%s)",
        job_id, file.filename, analyze, deep,
    )

    background_tasks.add_task(_condense_bg, job_id, in_path, out_path, analyze, court_id, deep)
    return {"job_id": job_id}


@router.get("/{job_id}/status")
async def condense_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _jobs[job_id]


@router.get("/{job_id}/download")
async def download_condensed(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = _jobs[job_id]
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Not ready (status: {job['status']}).")
    path = Path(job["output"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Output file not found (já foi limpo — corre de novo).")

    # Delete the output once it has been sent — nothing is kept around.
    def _cleanup():
        _rm(path)
        _jobs.pop(job_id, None)

    return FileResponse(
        str(path), media_type="video/mp4",
        filename=f"tempo_util_{path.stem}.mp4",
        background=BackgroundTask(_cleanup),
    )


def _condense_sync(
    job_id: str, in_path: Path, out_path: Path,
    analyze: bool = False, court_id: str = "court1", deep: bool = False,
) -> None:
    from padelpro_vision.segmentation.segmentation import get_active_segments
    from padelpro_vision.io.condense import condense_video

    _ensure_ffmpeg()

    cap = cv2.VideoCapture(str(in_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_s = (cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps) if fps else 0.0
    cap.release()

    segs = get_active_segments(in_path, output_dir=_UPLOAD_DIR / job_id)
    rallies = [s for s in segs if s.type == "rally"]
    useful_s = sum(s.duration_ms for s in rallies) / 1000.0

    _jobs[job_id].update(
        total_s=round(total_s, 1),
        useful_s=round(useful_s, 1),
        useful_pct=round(100.0 * useful_s / total_s, 1) if total_s else 0.0,
        rallies=len(rallies),
    )

    if not rallies:
        _rm(in_path)
        _rm(_UPLOAD_DIR / job_id)
        raise RuntimeError(
            "Não foi detetado tempo de jogo ativo neste vídeo. "
            "Pode ser preciso afinar os limiares de segmentação."
        )

    # Player analysis runs on the ORIGINAL video (needs the source frames),
    # so it must happen before cleanup.
    if analyze:
        modal_url = os.environ.get("MODAL_ANALYZE_URL", "").strip()
        if modal_url:
            try:
                _jobs[job_id]["phase"] = "análise na GPU (cloud)"
                _jobs[job_id]["report"] = _analyze_via_modal(
                    modal_url, in_path, court_id, deep
                )
            except Exception as exc:
                logger.exception("Modal analysis failed for job %s", job_id)
                _jobs[job_id]["report_error"] = f"Análise GPU falhou: {exc}"
        else:
            _run_local_analysis(job_id, in_path, court_id, deep, segs)

    _jobs[job_id]["phase"] = "corte do vídeo"
    condense_video(in_path, segs, out_path)

    # Source video + segmentation side-outputs are no longer needed.
    _rm(in_path)
    _rm(_UPLOAD_DIR / job_id)


def _analyze_via_modal(url: str, video: Path, court_id: str, deep: bool) -> dict:
    """Send the clip to the Modal GPU endpoint; returns the report dict."""
    import requests
    from config import DEFAULT_CONFIG
    from padelpro_vision.calibration.calibration import CourtCalibrator

    H = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir).load(court_id)
    court_h = H.tolist() if H is not None else None
    with open(video, "rb") as f:
        r = requests.post(
            url.rstrip("/"),
            files={"file": (video.name, f, "video/mp4")},
            data={"court_h": json.dumps(court_h), "deep": "true" if deep else "false"},
            timeout=1800,
        )
    r.raise_for_status()
    return r.json()


def _persist_for_review(job_id: str, report: dict) -> None:
    """
    Copy the analysis artifacts to data/output/{job_id}/ so the review page
    treats this clip like a full-pipeline match: shot events + pose windows
    (when the deep pass produced them) — making corrections trainable.
    Survives the upload-dir cleanup that runs right after analysis.
    """
    try:
        import json
        out_dir = Path("data/output") / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        shots = report.get("shots", [])
        events = [
            {
                "match_id": job_id,
                "player_id": s.get("player_id"),
                "rally_id": s.get("rally", -1),
                "ts_ms": float(s.get("t_s", 0.0)) * 1000.0,
                "stroke_type": s.get("type", "other"),
                "confidence": 1.0,
                "frame_idx": s.get("frame_idx"),
                "court_x": (s.get("pos") or [None, None])[0],
                "court_y": (s.get("pos") or [None, None])[1],
            }
            for s in shots
        ]
        with open(out_dir / f"{job_id}_shot_events.json", "w") as f:
            json.dump(events, f)

        pw_src = _UPLOAD_DIR / job_id / "pose_windows.json"
        if pw_src.exists():
            shutil.copy(pw_src, out_dir / f"{job_id}_pose_windows.json")
    except Exception:
        logger.exception("Could not persist review artifacts for job %s", job_id)


def _run_local_analysis(
    job_id: str, in_path: Path, court_id: str, deep: bool, segs: list
) -> None:
    try:
        from padelpro_vision.analysis import analyze_clip, analysis_available
        if analysis_available():
            _jobs[job_id]["phase"] = "análise de jogadores"

            def _progress(p: float) -> None:
                _jobs[job_id]["progress"] = round(p * 100)

            def _phase(name: str) -> None:
                _jobs[job_id]["phase"] = name
                _jobs[job_id]["progress"] = 0

            report = analyze_clip(
                in_path, _UPLOAD_DIR / job_id, court_id=court_id,
                segments=segs, deep=deep,
                progress_cb=_progress, phase_cb=_phase,
            )
            _jobs[job_id]["report"] = report
            _persist_for_review(job_id, report)
        else:
            _jobs[job_id]["report_error"] = (
                "Este servidor não tem o motor de análise (torch) instalado."
            )
    except Exception as exc:
        logger.exception("Analysis failed for job %s", job_id)
        _jobs[job_id]["report_error"] = f"Análise falhou: {exc}"


async def _condense_bg(
    job_id: str, in_path: Path, out_path: Path,
    analyze: bool = False, court_id: str = "court1", deep: bool = False,
) -> None:
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _condense_sync(job_id, in_path, out_path, analyze, court_id, deep)
        )
        _jobs[job_id]["status"] = "done"
        logger.info("Condense job %s done.", job_id)
    except Exception as exc:
        logger.exception("Condense job %s failed", job_id)
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(exc)
