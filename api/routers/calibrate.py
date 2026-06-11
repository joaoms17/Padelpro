"""
Court calibration endpoint.

The browser extracts a frame from the video locally and the user clicks the
4 court corners (top-left, top-right, bottom-right, bottom-left). Only those
4 points are sent here — no video upload — and we compute + store the
image→court homography for that court_id.
"""

from __future__ import annotations
import logging

from fastapi import APIRouter, HTTPException

from api.models import CalibrateRequest

router = APIRouter(prefix="/calibrate", tags=["calibrate"])
logger = logging.getLogger(__name__)


@router.post("/save")
async def save_calibration(body: CalibrateRequest):
    """Compute and persist the homography from 4 clicked court corners."""
    if len(body.points) < 4:
        raise HTTPException(status_code=400, detail="São precisos 4 pontos (cantos do campo).")

    from config import DEFAULT_CONFIG
    from padelpro_vision.calibration.calibration import CourtCalibrator
    from padelpro_vision.constants.court import COURT_CORNERS_M

    cal = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
    court_pts = list(COURT_CORNERS_M[: len(body.points)])
    try:
        H = cal._compute_homography(body.points, court_pts)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Não foi possível calcular a homografia: {exc}")
    cal.save(H, body.court_id)
    logger.info("Calibração guardada para campo '%s'.", body.court_id)
    return {"court_id": body.court_id, "saved": True, "H": H.tolist()}


@router.get("/{court_id}")
async def get_calibration(court_id: str):
    """Return whether a court already has a saved homography."""
    from config import DEFAULT_CONFIG
    from padelpro_vision.calibration.calibration import CourtCalibrator

    cal = CourtCalibrator(DEFAULT_CONFIG.calibration.homography_cache_dir)
    H = cal.load(court_id)
    return {"court_id": court_id, "calibrated": H is not None}
