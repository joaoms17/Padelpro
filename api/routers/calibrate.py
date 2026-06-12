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

from api.models import CalibrateRequest

router = APIRouter(prefix="/calibrate", tags=["calibrate"])
logger = logging.getLogger(__name__)


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
