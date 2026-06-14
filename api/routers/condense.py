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

from api.db import save_job, get_job, update_job, prune_jobs

# Keep disk usage minimal: anything in data/uploads older than this is swept.
_MAX_AGE_S = 3600  # 1 hour

router = APIRouter(prefix="/condense", tags=["condense"])
logger = logging.getLogger(__name__)

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
    """Remove stale files from uploads and videos dirs (ephemeral host hygiene)."""
    cutoff = time.time() - _MAX_AGE_S
    for sweep_dir in (_UPLOAD_DIR, Path("data/videos")):
        if not sweep_dir.exists():
            continue
        for entry in sweep_dir.iterdir():
            try:
                if entry.stat().st_mtime < cutoff:
                    _rm(entry)
            except Exception:
                pass


@router.get("/capabilities")
async def capabilities():
    """What this backend can do. `analyze` requires torch/torchvision;
    `gemini` requires GEMINI_API_KEY; `max_upload_mb` caps uploads."""
    if os.environ.get("MODAL_ANALYZE_URL", "").strip():
        analyze = True
    else:
        try:
            from padelpro_vision.analysis import analysis_available
            analyze = analysis_available()
        except Exception:
            analyze = False
    try:
        from padelpro_vision.analysis.gemini_clip import gemini_available
        gemini = gemini_available()
    except Exception:
        gemini = False
    try:
        import yt_dlp  # noqa: F401
        youtube = True
    except Exception:
        youtube = False
    try:
        max_mb = int(os.environ.get("API_MAX_UPLOAD_MB", "150"))
    except ValueError:
        max_mb = 150
    return {"analyze": analyze, "gemini": gemini, "youtube": youtube, "max_upload_mb": max_mb}


@router.post("/upload")
async def upload_and_condense(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    analyze: bool = Form(False),
    court_id: str = Form("court1"),
    deep: bool = Form(False),
    gemini: bool = Form(False),
):
    """Upload a video; returns a job_id to poll. The condensed video is produced
    in the background. With analyze=true a CV player report is computed; with
    gemini=true Gemini semantic analysis (stroke types, tactics) is added."""
    job_id = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _sweep_old()

    in_path = _UPLOAD_DIR / f"{job_id}.mp4"
    out_path = _UPLOAD_DIR / f"{job_id}_useful.mp4"

    with open(in_path, "wb") as f:
        shutil.copyfileobj(file.file, f, length=1024 * 1024)

    save_job("condense", job_id, {
        "job_id": job_id,
        "status": "processing",
        "phase": "segmentação",
        "filename": file.filename,
        "output": str(out_path),
    })
    logger.info(
        "Condense job %s: uploaded %s (analyze=%s, deep=%s, gemini=%s)",
        job_id, file.filename, analyze, deep, gemini,
    )

    background_tasks.add_task(_condense_bg, job_id, in_path, out_path, analyze, court_id, deep, gemini)
    return {"job_id": job_id}


@router.post("/upload-url")
async def condense_from_url(
    background_tasks: BackgroundTasks,
    url: str = Form(...),
    analyze: bool = Form(False),
    court_id: str = Form("court1"),
    deep: bool = Form(False),
    gemini: bool = Form(False),
):
    """Ingest a video by URL (YouTube and any yt-dlp-supported site), then run
    the same condense pipeline. The download happens in the background; poll the
    returned job_id for status."""
    try:
        import yt_dlp  # noqa: F401
    except Exception:
        raise HTTPException(
            status_code=501,
            detail="Importação por link não disponível neste servidor (yt-dlp não instalado).",
        )
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL inválido.")

    job_id = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _sweep_old()

    in_path = _UPLOAD_DIR / f"{job_id}.mp4"
    out_path = _UPLOAD_DIR / f"{job_id}_useful.mp4"

    save_job("condense", job_id, {
        "job_id": job_id,
        "status": "processing",
        "phase": "a descarregar do link",
        "filename": url,
        "output": str(out_path),
    })
    logger.info("Condense job %s: from URL %s (analyze=%s, deep=%s, gemini=%s)",
                job_id, url, analyze, deep, gemini)

    background_tasks.add_task(
        _condense_from_url_bg, job_id, url, in_path, out_path, analyze, court_id, deep, gemini
    )
    return {"job_id": job_id}


@router.get("/{job_id}/status")
async def condense_status(job_id: str):
    job = get_job("condense", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("/{job_id}/download")
async def download_condensed(job_id: str):
    job = get_job("condense", job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Not ready (status: {job['status']}).")
    path = Path(job["output"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Output file not found (já foi limpo — corre de novo).")

    # Delete the output once it has been sent — nothing is kept around.
    def _cleanup():
        _rm(path)

    return FileResponse(
        str(path), media_type="video/mp4",
        filename=f"tempo_util_{path.stem}.mp4",
        background=BackgroundTask(_cleanup),
    )


def _condense_sync(
    job_id: str, in_path: Path, out_path: Path,
    analyze: bool = False, court_id: str = "court1",
    deep: bool = False, gemini: bool = False,
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

    update_job("condense", job_id,
               total_s=round(total_s, 1),
               useful_s=round(useful_s, 1),
               useful_pct=round(100.0 * useful_s / total_s, 1) if total_s else 0.0,
               rallies=len(rallies))

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
                update_job("condense", job_id, phase="análise na GPU (cloud)")
                report = _analyze_via_modal(modal_url, in_path, court_id, deep)
                update_job("condense", job_id, report=report)
            except Exception as exc:
                logger.exception("Modal analysis failed for job %s", job_id)
                update_job("condense", job_id, report_error=f"Análise GPU falhou: {exc}")
        else:
            _run_local_analysis(job_id, in_path, court_id, deep, segs)

    # Gemini semantic analysis — runs on the ORIGINAL video (same timeline as
    # the CV hits) and must happen before the original is deleted.
    if gemini:
        job = get_job("condense", job_id)
        _run_gemini_analysis(job_id, in_path, cv_report=(job or {}).get("report"))

    # Persist review artifacts AFTER Gemini so the saved report carries the
    # semantic layer (types, outcomes, tactics) when the user revisits later.
    job = get_job("condense", job_id)
    _persist_for_review(
        job_id,
        report=(job or {}).get("report"),
        gemini_report=(job or {}).get("gemini_report"),
    )

    update_job("condense", job_id, phase="corte do vídeo")
    condense_video(in_path, segs, out_path)

    # Keep condensed video in data/videos/ for the review page (video available
    # there until the user finishes review; swept after _MAX_AGE_S like uploads).
    videos_dir = Path("data/videos")
    videos_dir.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy(out_path, videos_dir / f"{job_id}.mp4")
    except Exception:
        logger.warning("Could not copy condensed video for review (job %s)", job_id)

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


# Gemini quadrant (player_pos) → a stable pseudo player id for the Gemini-only
# path (no CV tracking to give real ids).
_POS_TO_PID = {"NL": 1, "NR": 2, "FL": 3, "FR": 4}


def _persist_for_review(
    job_id: str,
    report: dict | None = None,
    gemini_report: dict | None = None,
) -> None:
    """
    Copy analysis artifacts to data/output/{job_id}/ so the review page works
    after the job leaves memory:
      - shot events (with Gemini type/outcome merged in)
      - the Gemini block (summary, tactics, outcomes) → gemini.json
      - a quality report for the fleet quality page (CV path only)
    Survives the upload-dir cleanup that runs after analysis.
    """
    try:
        import json, time
        if report is None and gemini_report is None:
            return
        out_dir = Path("data/output") / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        if report is not None:
            shots = report.get("shots", [])
            events = [
                {
                    "match_id": job_id,
                    "player_id": s.get("player_id"),
                    "rally_id": s.get("rally", -1),
                    "ts_ms": float(s.get("t_s", 0.0)) * 1000.0,
                    "stroke_type": s.get("type", "other"),
                    "outcome": s.get("outcome"),
                    "confidence": 1.0,
                    "frame_idx": s.get("frame_idx"),
                    "court_x": (s.get("pos") or [None, None])[0],
                    "court_y": (s.get("pos") or [None, None])[1],
                }
                for s in shots
            ]
        else:
            # Gemini-only: build a reviewable list straight from Gemini strokes.
            shots = gemini_report.get("strokes", [])
            events = [
                {
                    "match_id": job_id,
                    "player_id": _POS_TO_PID.get(s.get("player_pos", ""), 1),
                    "rally_id": -1,
                    "ts_ms": float(s.get("t_s", 0.0)) * 1000.0,
                    "stroke_type": s.get("type", "other"),
                    "outcome": s.get("outcome"),
                    "confidence": None,
                    "frame_idx": None,
                    "court_x": None,
                    "court_y": None,
                }
                for s in shots
            ]
        with open(out_dir / f"{job_id}_shot_events.json", "w") as f:
            json.dump(events, f)

        # Gemini semantic block (summary/tactics/outcomes) for the review page.
        gemini_block = (report or {}).get("gemini")
        if gemini_block is None and gemini_report is not None:
            gemini_block = {
                k: gemini_report.get(k)
                for k in ("tactics", "summary", "dominant_side", "n_rallies", "n_strokes")
            }
        if gemini_block:
            with open(out_dir / "gemini.json", "w") as f:
                json.dump(gemini_block, f)

        pw_src = _UPLOAD_DIR / job_id / "pose_windows.json"
        if pw_src.exists():
            shutil.copy(pw_src, out_dir / f"{job_id}_pose_windows.json")

        # Quality report for the fleet quality page (needs CV stats).
        if report is None:
            return
        clip = report.get("clip", {})
        players = report.get("players", [])
        timings = report.get("timings_s", {})
        duration_s = clip.get("duration_s", 0) or 1
        elapsed_s = sum(timings.values()) if timings else 0
        n_players = len(players)
        quality = {
            "match_id": job_id,
            "generated_at": time.time(),
            "tracking": {
                "n_tracks": n_players,
                "tracks_per_minute": round(n_players / (duration_s / 60), 2),
                "avg_track_duration_s": round(clip.get("useful_s", 0), 1),
                "pct_time_with_expected_players": round(
                    sum(p.get("coverage_pct", 0) for p in players) / max(n_players, 1), 1
                ),
            },
            "strokes": {
                "n_events": len(shots),
                "mean_confidence": 1.0,
                "pct_with_audio_onset": 100.0,
            },
            "performance": {
                "elapsed_s": round(elapsed_s, 1),
                "realtime_factor": round(elapsed_s / duration_s, 2),
            },
        }
        with open(out_dir / "quality_report.json", "w") as f:
            json.dump(quality, f)

    except Exception:
        logger.exception("Could not persist review artifacts for job %s", job_id)


def _run_gemini_analysis(job_id: str, video: Path, cv_report: dict | None) -> None:
    """Run Gemini semantic analysis and merge into the existing CV report."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    try:
        from padelpro_vision.analysis.gemini_clip import analyze_with_gemini, gemini_available
        if not gemini_available(api_key):
            update_job("condense", job_id,
                       gemini_error="GEMINI_API_KEY não configurada ou google-genai não instalado.")
            return
        update_job("condense", job_id, phase="análise Gemini (semântica)")
        cv_hits = cv_report.get("shots") if cv_report else None
        result = analyze_with_gemini(video, api_key, cv_hits=cv_hits)

        gemini_meta = {
            "tactics":       result.get("tactics", ""),
            "summary":       result.get("summary", ""),
            "dominant_side": result.get("dominant_side"),
            "n_rallies":     result.get("n_rallies"),
            "n_strokes":     len(result.get("gemini_strokes", [])),
        }
        if cv_report is not None:
            if "merged_hits" in result:
                cv_report["shots"] = result["merged_hits"]
            cv_report["gemini"] = gemini_meta
            update_job("condense", job_id, report=cv_report)
        else:
            # Gemini-only (no CV analysis requested)
            update_job("condense", job_id, gemini_report={
                **gemini_meta,
                "strokes": result.get("gemini_strokes", []),
            })
        logger.info("Gemini analysis done for job %s (%d strokes)", job_id, gemini_meta["n_strokes"])
    except Exception as exc:
        logger.exception("Gemini analysis failed for job %s", job_id)
        update_job("condense", job_id, gemini_error=f"Gemini falhou: {exc}")


def _run_local_analysis(
    job_id: str, in_path: Path, court_id: str, deep: bool, segs: list
) -> None:
    try:
        from padelpro_vision.analysis import analyze_clip, analysis_available
        if analysis_available():
            update_job("condense", job_id, phase="análise de jogadores")

            def _progress(p: float) -> None:
                update_job("condense", job_id, progress=round(p * 100))

            def _phase(name: str) -> None:
                update_job("condense", job_id, phase=name, progress=0)

            report = analyze_clip(
                in_path, _UPLOAD_DIR / job_id, court_id=court_id,
                segments=segs, deep=deep,
                progress_cb=_progress, phase_cb=_phase,
            )
            update_job("condense", job_id, report=report)
        else:
            update_job("condense", job_id,
                       report_error="Este servidor não tem o motor de análise (torch) instalado.")
    except Exception as exc:
        logger.exception("Analysis failed for job %s", job_id)
        update_job("condense", job_id, report_error=f"Análise falhou: {exc}")


def _download_video(url: str, dest: Path) -> None:
    """Download a video by URL (YouTube etc.) to `dest` (mp4) via yt-dlp.
    Caps resolution to keep it fast/cheap on the free tier; keeps audio (needed
    for onset detection)."""
    import yt_dlp

    _ensure_ffmpeg()
    try:
        max_mb = int(os.environ.get("API_MAX_UPLOAD_MB", "150"))
    except ValueError:
        max_mb = 150

    tmpl = str(dest.with_suffix("")) + ".%(ext)s"
    ydl_opts = {
        "outtmpl": tmpl,
        "format": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": max_mb * 1024 * 1024,
        "retries": 2,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    # yt-dlp may write <stem>.mp4 (or another ext if merge fell back) — locate it.
    if not dest.exists():
        produced = sorted(dest.parent.glob(dest.stem + ".*"))
        produced = [p for p in produced if p.suffix.lower() in (".mp4", ".mkv", ".webm")]
        if not produced:
            raise RuntimeError(
                "Não consegui descarregar este link. O YouTube por vezes bloqueia "
                "downloads a partir de servidores — tenta carregar o vídeo do PC."
            )
        produced[0].rename(dest)


async def _condense_bg(
    job_id: str, in_path: Path, out_path: Path,
    analyze: bool = False, court_id: str = "court1",
    deep: bool = False, gemini: bool = False,
) -> None:
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _condense_sync(job_id, in_path, out_path, analyze, court_id, deep, gemini)
        )
        update_job("condense", job_id, status="done")
        logger.info("Condense job %s done.", job_id)
    except Exception as exc:
        logger.exception("Condense job %s failed", job_id)
        update_job("condense", job_id, status="error", error=str(exc))


async def _condense_from_url_bg(
    job_id: str, url: str, in_path: Path, out_path: Path,
    analyze: bool = False, court_id: str = "court1",
    deep: bool = False, gemini: bool = False,
) -> None:
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: _download_video(url, in_path))
        await loop.run_in_executor(
            None, lambda: _condense_sync(job_id, in_path, out_path, analyze, court_id, deep, gemini)
        )
        update_job("condense", job_id, status="done")
        logger.info("Condense job %s (url) done.", job_id)
    except Exception as exc:
        logger.exception("Condense job %s (url) failed", job_id)
        update_job("condense", job_id, status="error", error=str(exc))
