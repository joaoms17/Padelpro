"""
Court calibration endpoint.

The browser extracts a frame from the video locally and the user clicks the
4 court corners (top-left, top-right, bottom-right, bottom-left). Only those
4 points are sent here — no video upload — and we compute + store the
image→court homography for that court_id.
"""

from __future__ import annotations
import logging

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from api.models import CalibrateRequest

router = APIRouter(prefix="/calibrate", tags=["calibrate"])
logger = logging.getLogger(__name__)


def _extract_frame_ffmpeg(raw: bytes, suffix: str) -> tuple[bytes, int, int]:
    """
    Pull one frame from a video with ffmpeg (decodes HEVC/H.265 from
    iPhone/WhatsApp, which OpenCV's bundled codecs often can't). Runs as a
    subprocess with a timeout so it can never hang the API. Returns
    (jpeg_bytes, width, height).
    """
    import os
    import shutil
    import subprocess
    import tempfile

    import cv2
    import numpy as np

    from padelpro_vision.io.ffmpeg import ensure_ffmpeg

    ensure_ffmpeg()
    ff = shutil.which("ffmpeg") or "ffmpeg"

    tmp_in = tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as t:
            t.write(raw)
            tmp_in = t.name
        tmp_out = tmp_in + ".jpg"

        # Try a frame ~3 s in (avoids black intros); fall back to the first.
        for ss in ("3", "0"):
            cmd = [ff, "-y", "-ss", ss, "-i", tmp_in,
                   "-frames:v", "1", "-q:v", "2", tmp_out]
            try:
                subprocess.run(cmd, capture_output=True, timeout=120)
            except subprocess.TimeoutExpired:
                continue
            if os.path.exists(tmp_out) and os.path.getsize(tmp_out) > 0:
                break

        if not (tmp_out and os.path.exists(tmp_out) and os.path.getsize(tmp_out) > 0):
            raise HTTPException(status_code=400, detail="Não consegui extrair um frame do vídeo.")

        data = open(tmp_out, "rb").read()
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Frame extraído mas ilegível.")
        h, w = img.shape[:2]
        return data, w, h
    finally:
        for p in (tmp_in, tmp_out):
            if p and os.path.exists(p):
                os.unlink(p)


@router.post("/extract-frame")
async def extract_frame(file: UploadFile = File(...)):
    """
    Extract a single frame server-side (ffmpeg → handles any codec the browser
    can't). The heavy work runs in a thread so it never blocks the event loop.
    Real frame size travels in X-Frame-Width/Height for click mapping.
    """
    import asyncio
    from pathlib import Path

    raw = await file.read()
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    data, w, h = await asyncio.to_thread(_extract_frame_ffmpeg, raw, suffix)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            "X-Frame-Width": str(w),
            "X-Frame-Height": str(h),
            "Access-Control-Expose-Headers": "X-Frame-Width, X-Frame-Height",
        },
    )


@router.post("/auto")
async def auto_detect_corners(file: UploadFile = File(...)):
    """
    Detect the 4 court corners in an uploaded frame (classic CV). Returns the
    points + homography quality for the user to confirm — nothing is saved
    until POST /calibrate/save. 422 when no trustworthy quad is found, so the
    UI falls back to manual clicking.
    """
    import cv2
    from padelpro_vision.calibration.auto import auto_calibrate

    raw = await file.read()
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Imagem inválida.")

    result = auto_calibrate(frame)
    if result is None:
        raise HTTPException(
            status_code=422,
            detail="Não encontrei os cantos do campo — clica-os manualmente.",
        )
    return {"points": result["points"], "quality": result["quality"]}


@router.post("/save")
async def save_calibration(body: CalibrateRequest):
    """Compute and persist the homography from 4 clicked court corners."""
    if len(body.points) < 4:
        raise HTTPException(status_code=400, detail="São precisos 4 pontos (cantos do campo).")

    from config import DEFAULT_CONFIG
    from padelpro_vision.calibration.calibration import CourtCalibrator, validate_homography
    from padelpro_vision.constants.court import COURT_CORNERS_M

    cal = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
    court_pts = list(COURT_CORNERS_M[: len(body.points)])
    try:
        H = cal._compute_homography(body.points, court_pts)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Não foi possível calcular a homografia: {exc}")
    quality = validate_homography(H, body.points, court_pts)
    cal.save(H, body.court_id, quality=quality)
    logger.info("Calibração guardada para campo '%s' (%s).", body.court_id, quality["rating"])
    return {"court_id": body.court_id, "saved": True, "H": H.tolist(), "quality": quality}


@router.get("/{court_id}")
async def get_calibration(court_id: str):
    """Return whether a court already has a saved homography."""
    from config import DEFAULT_CONFIG
    from padelpro_vision.calibration.calibration import CourtCalibrator

    cal = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
    H = cal.load(court_id)
    return {"court_id": court_id, "calibrated": H is not None}
