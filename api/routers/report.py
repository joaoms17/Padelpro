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

@router.post("/upload")
async def upload_for_report(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Upload a match video; returns a job id to poll. Gemini analyses the whole
    video in the background."""
    rid = str(uuid.uuid4())
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    in_path = _UPLOAD_DIR / f"{rid}.mp4"
    with open(in_path, "wb") as f:
        shutil.copyfileobj(file.file, f, length=1024 * 1024)

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


@router.get("/{rid}/status")
async def report_status(rid: str):
    if rid in _jobs:
        return _jobs[rid]
    # Job left memory but the report persisted — report it as done.
    if _report_path(rid).exists():
        return {"rid": rid, "status": "done", "phase": "concluído"}
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
    return report


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

        _jobs[rid].update(status="done", phase="concluído")
        logger.info("Report %s done.", rid)
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
