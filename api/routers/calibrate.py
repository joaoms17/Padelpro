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


@router.post("/extract-frame")
async def extract_frame(file: UploadFile = File(...)):
    """
    Extract a single frame (mid-video) server-side with OpenCV/ffmpeg, which
    decodes formats the browser can't (HEVC/H.265 from iPhone/WhatsApp). Returns
    a JPEG; the real frame size travels in X-Frame-Width/Height so the page can
    map clicks back to the original video pixels.
    """
    import os
    import tempfile

    import cv2

    raw = await file.read()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Não consegui abrir o vídeo.")
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total > 1:
            cap.set(cv2.CAP_PROP_POS_FRAMES, total // 2)
        ok, frame = cap.read()
        cap.release()
        if not ok or frame is None:
            raise HTTPException(status_code=400, detail="Não consegui ler um frame do vídeo.")
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise HTTPException(status_code=500, detail="Falha a codificar o frame.")
        h, w = frame.shape[:2]
        return Response(
            content=buf.tobytes(),
            media_type="image/jpeg",
            headers={
                "X-Frame-Width": str(w),
                "X-Frame-Height": str(h),
                "Access-Control-Expose-Headers": "X-Frame-Width, X-Frame-Height",
            },
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


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
