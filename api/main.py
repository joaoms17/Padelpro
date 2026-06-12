"""
PadelPro Vision — FastAPI backend.

Start:
    uvicorn api.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import matches, analytics, clips, condense, calibrate, review

app = FastAPI(
    title="PadelPro Vision API",
    description="Padel match analysis — detection, tracking, pose, analytics, clips.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(matches.router)
app.include_router(analytics.router)
app.include_router(clips.router)
app.include_router(condense.router)
app.include_router(calibrate.router)
app.include_router(review.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
