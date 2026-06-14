"""
Full-match Gemini report: upload a whole match video (file or link) and get a
single self-contained report — heatmap positions, score guess, shot counts,
formation %, example key frames and rallies. The extracted key frames double as
candidate training images (see /training).

No torch needed — runs on the light backend image (google-genai + ffmpeg/cv2).
"""

from __future__ import annotations
import asyncio
import io
import json
import logging
import os
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

router = APIRouter(prefix="/report", tags=["report"])
logger = logging.getLogger(__name__)

_jobs: dict[str, dict] = {}

_UPLOAD_DIR = Path("data/uploads")
_OUTPUT_DIR = Path("data/output")
_FRAMES_DATASET = Path("data/dataset/match_frames")


def _report_path(rid: str) -> Path:
    return _OUTPUT_DIR / rid / "match_report.json"


def _frames_dir(rid: str) -> Path:
    return _OUTPUT_DIR / rid / "match_frames"


# ── Create / ingest ──────────────────────────────────────────────────────────

@router.get("/capabilities")
async def report_capabilities():
    """Lightweight probe so the frontend can check server availability and limits."""
    max_mb = int(os.environ.get("API_MAX_UPLOAD_MB", "500"))
    gemini_ok = bool(os.environ.get("GEMINI_API_KEY", ""))
    return {"max_upload_mb": max_mb, "gemini": gemini_ok}


@router.post("/upload")
async def upload_for_report(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Upload a match video; returns a job id to poll. Gemini analyses the whole
    video in the background."""
    max_mb = int(os.environ.get("API_MAX_UPLOAD_MB", "500"))
    max_bytes = max_mb * 1024 * 1024

    rid = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    in_path = _UPLOAD_DIR / f"{rid}.mp4"

    written = 0
    chunk = 1024 * 1024  # 1 MB chunks
    with open(in_path, "wb") as f:
        while True:
            data = await file.read(chunk)
            if not data:
                break
            written += len(data)
            if written > max_bytes:
                in_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Ficheiro demasiado grande (máx. {max_mb} MB). Exporta em 720p e tenta de novo.",
                )
            f.write(data)

    _jobs[rid] = {"rid": rid, "status": "processing", "phase": "na fila",
                  "filename": file.filename}
    background_tasks.add_task(_analyze_bg, rid, in_path)
    return {"rid": rid}


@router.post("/upload-url")
async def upload_url_for_report(
    background_tasks: BackgroundTasks,
    url: str = Form(...),
):
    """Ingest a match video by link (YouTube etc.) then analyse the whole video."""
    try:
        import yt_dlp  # noqa: F401
    except Exception:
        raise HTTPException(status_code=501,
                            detail="Importação por link não disponível (yt-dlp em falta).")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL inválido.")

    rid = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    in_path = _UPLOAD_DIR / f"{rid}.mp4"
    _jobs[rid] = {"rid": rid, "status": "processing",
                  "phase": "a descarregar do link", "filename": url}
    background_tasks.add_task(_download_and_analyze_bg, rid, url, in_path)
    return {"rid": rid}


def _condensed_path(rid: str) -> Path:
    return _OUTPUT_DIR / rid / "condensed.mp4"


@router.get("/{rid}/status")
async def report_status(rid: str):
    if rid in _jobs:
        job = dict(_jobs[rid])
        if job.get("status") == "done" and "condensed_available" not in job:
            job["condensed_available"] = _condensed_path(rid).exists()
        return job
    if _report_path(rid).exists():
        return {"rid": rid, "status": "done", "phase": "concluído",
                "condensed_available": _condensed_path(rid).exists()}
    raise HTTPException(status_code=404, detail="Relatório não encontrado.")


@router.get("/{rid}")
async def get_report(rid: str):
    """Return the enriched match report (counts, formation %, rally stats)."""
    path = _report_path(rid)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Relatório ainda não disponível.")
    with open(path) as f:
        report = json.load(f)
    report["rid"] = rid
    report["condensed_available"] = _condensed_path(rid).exists()
    return report


@router.get("/{rid}/condensed")
async def get_condensed_video(rid: str):
    """Download the Gemini-cut tempo útil — only the rally segments, dead time removed."""
    cpath = _condensed_path(rid)
    if not cpath.exists():
        raise HTTPException(status_code=404, detail="Vídeo de tempo útil ainda não disponível.")

    def iterfile():
        with open(cpath, "rb") as f:
            while chunk := f.read(1024 * 1024):
                yield chunk

    size = cpath.stat().st_size
    return StreamingResponse(
        iterfile(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f"attachment; filename=tempo_util_{rid[:8]}.mp4",
            "Content-Length": str(size),
        },
    )


@router.get("/{rid}/frames/{idx}")
async def get_report_frame(rid: str, idx: int):
    fpath = _frames_dir(rid) / f"frame_{idx:04d}.jpg"
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="Frame não encontrado.")
    return Response(content=fpath.read_bytes(), media_type="image/jpeg")


@router.get("/{rid}/training-data")
async def report_training_data(rid: str):
    """Bundle the report's training-usable outputs into a downloadable zip:
    key-frame images, a YOLO-style positions CSV, the shot labels and rallies."""
    path = _report_path(rid)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Relatório não encontrado.")
    with open(path) as f:
        report = json.load(f)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Key-frame images
        fdir = _frames_dir(rid)
        if fdir.exists():
            for img in sorted(fdir.glob("*.jpg")):
                zf.write(img, f"images/{img.name}")

        # Player positions (court-normalised) as CSV
        pos_lines = ["t_s,player,court_x,court_y"]
        for p in report.get("player_positions", []):
            pos_lines.append(
                f"{p.get('t_s', '')},{p.get('player', '')},"
                f"{p.get('court_x', '')},{p.get('court_y', '')}"
            )
        zf.writestr("positions.csv", "\n".join(pos_lines))

        # Shot labels as CSV
        shot_lines = ["t_s,player,type,outcome"]
        for s in report.get("shots", []):
            shot_lines.append(
                f"{s.get('t_s', '')},{s.get('player', '')},"
                f"{s.get('type', '')},{s.get('outcome', '')}"
            )
        zf.writestr("shots.csv", "\n".join(shot_lines))

        zf.writestr("rallies.json", json.dumps(report.get("rallies", []), indent=2))
        zf.writestr("key_frames.json", json.dumps(report.get("key_frames", []), indent=2))

    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=training_{rid}.zip"},
    )


# ── Background work ──────────────────────────────────────────────────────────

async def _download_and_analyze_bg(rid: str, url: str, in_path: Path) -> None:
    try:
        from api.routers.condense import _download_video
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _download_video(url, in_path))
        await _analyze_bg(rid, in_path)
    except Exception as exc:
        logger.exception("Report download failed for %s", rid)
        _jobs[rid].update(status="error", error=str(exc))


async def _analyze_bg(rid: str, in_path: Path) -> None:
    try:
        _jobs[rid].update(status="processing", phase="análise Gemini (vídeo todo)")
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()

        report = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _run_analysis(in_path, api_key))

        out_dir = _OUTPUT_DIR / rid
        out_dir.mkdir(parents=True, exist_ok=True)
        report["rid"] = rid
        with open(_report_path(rid), "w") as f:
            json.dump(report, f, indent=2)

        _jobs[rid]["phase"] = "extração de frames de exemplo"
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _extract_key_frames(rid, in_path, report))

        _jobs[rid]["phase"] = "a cortar tempo útil"
        condensed_ok = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _create_condensed_video(
                in_path, report.get("rallies", []), _condensed_path(rid)))

        _jobs[rid].update(status="done", phase="concluído", condensed_available=condensed_ok)
        logger.info("Report %s done (condensed=%s).", rid, condensed_ok)
    except Exception as exc:
        logger.exception("Report analysis failed for %s", rid)
        _jobs[rid].update(status="error", error=str(exc))
    finally:
        # Keep a copy for the annotation screen, drop the raw upload.
        try:
            videos_dir = Path("data/videos")
            videos_dir.mkdir(parents=True, exist_ok=True)
            if in_path.exists():
                shutil.copy(in_path, videos_dir / f"{rid}.mp4")
                in_path.unlink(missing_ok=True)
        except Exception:
            pass


def _run_analysis(in_path: Path, api_key: str) -> dict:
    from padelpro_vision.analysis.gemini_match import analyze_full_match, enrich_report
    raw = analyze_full_match(in_path, api_key)
    return enrich_report(raw)


def _create_condensed_video(video: Path, rallies: list, output: Path) -> bool:
    """Cut the rally segments out of the original video using ffmpeg's select filter.
    Returns True if the condensed file was created successfully."""
    segments = [
        (float(r["start_s"]), float(r["end_s"]))
        for r in rallies
        if float(r.get("end_s", 0)) - float(r.get("start_s", 0)) > 1.0
    ]
    if not segments or not video.exists():
        return False

    # Build a single select expression covering all rally windows
    expr = "+".join(f"between(t,{s},{e})" for s, e in segments)

    # Try with audio; fall back to video-only (some recordings lack audio)
    for maps, fc in [
        (
            ["-map", "[outv]", "-map", "[outa]"],
            f"[0:v]select='{expr}',setpts=N/FRAME_RATE/TB[outv];"
            f"[0:a]aselect='{expr}',asetpts=N/SR/TB[outa]",
        ),
        (
            ["-map", "[outv]"],
            f"[0:v]select='{expr}',setpts=N/FRAME_RATE/TB[outv]",
        ),
    ]:
        cmd = [
            "ffmpeg", "-y", "-i", str(video),
            "-filter_complex", fc,
            *maps,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
            str(output),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=600)
            if result.returncode == 0 and output.exists() and output.stat().st_size > 1000:
                logger.info("Condensed video created: %s", output)
                return True
        except subprocess.TimeoutExpired:
            logger.warning("Condensed video timed out for %s", video)
            return False
        except Exception as exc:
            logger.warning("Condensed video attempt failed: %s", exc)

    return False


def _extract_key_frames(rid: str, video: Path, report: dict) -> None:
    """Extract each key frame to disk (for display) and seed the training-frame
    candidate pool the /training progression counts."""
    import cv2

    key_frames = report.get("key_frames", [])
    if not key_frames:
        return
    fdir = _frames_dir(rid)
    fdir.mkdir(parents=True, exist_ok=True)
    cand_dir = _FRAMES_DATASET / rid
    cand_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video))
    for idx, kf in enumerate(key_frames):
        t_s = float(kf.get("t_s", 0.0))
        cap.set(cv2.CAP_PROP_POS_MSEC, t_s * 1000.0)
        ok, frame = cap.read()
        if not ok:
            continue
        out = fdir / f"frame_{idx:04d}.jpg"
        cv2.imwrite(str(out), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    cap.release()
