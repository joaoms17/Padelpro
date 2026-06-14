"""
PadelPro Vision — FastAPI backend (Gemini AI rewrite).

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

from api.routers import matches
from api.routers import report

app = FastAPI(
    title="PadelPro Vision API",
    description="Padel match analysis powered by Gemini AI.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(matches.router)
app.include_router(report.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
