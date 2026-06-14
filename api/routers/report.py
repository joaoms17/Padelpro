"""Report retrieval endpoints."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from api.gemini_analysis import GeminiAnalyzer
from api.models import AnalysisReport

router = APIRouter(prefix="/report", tags=["report"])

OUTPUT_DIR = Path("data/output")
VIDEOS_DIR = Path("data/videos")


def _compute_rally_stats(rallies: list[dict], duration_s: float) -> dict:
    total_play = sum(r.get("duration_s", 0) for r in rallies)
    return {
        "total_rallies": len(rallies),
        "avg_duration_s": round(total_play / len(rallies), 2) if rallies else 0,
        "total_play_time_s": round(total_play, 2),
        "play_time_pct": round(total_play / duration_s * 100, 1) if duration_s else 0,
    }


def _compute_formation_pct(formation_samples: list[dict]) -> dict:
    keys = ["both_net", "both_back", "t1_net_t2_back", "t1_back_t2_net", "mixed"]
    counts = {k: 0 for k in keys}
    total = len(formation_samples)
    if total == 0:
        return {k: 0.0 for k in keys}
    for sample in formation_samples:
        t = sample.get("type", "mixed")
        if t in counts:
            counts[t] += 1
        else:
            counts["mixed"] += 1
    return {k: round(v / total * 100, 1) for k, v in counts.items()}


@router.get("/{match_id}", response_model=AnalysisReport)
async def get_report(match_id: str) -> AnalysisReport:
    report_path = OUTPUT_DIR / match_id / "report.json"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found")

    data = json.loads(report_path.read_text())
    formation_pct = _compute_formation_pct(data.get("formation_samples", []))
    rallies = data.get("rallies", [])
    duration_s = data.get("duration_s", 0.0)
    rally_stats = _compute_rally_stats(rallies, duration_s)

    return AnalysisReport(
        match_id=match_id,
        duration_s=duration_s,
        final_score=data.get("final_score", {}),
        shot_counts=data.get("shot_counts", {}),
        match_summary=data.get("match_summary", ""),
        confidence=data.get("confidence", 0.0),
        formation_pct=formation_pct,
        player_positions=data.get("player_positions", []),
        shots=data.get("shots", []),
        score_timeline=data.get("score_timeline", []),
        key_frames=data.get("key_frames", []),
        rallies=rallies,
        rally_stats=rally_stats,
    )


@router.get("/{match_id}/frames/{frame_id}")
async def get_frame(match_id: str, frame_id: int) -> FileResponse:
    frame_path = OUTPUT_DIR / match_id / "frames" / f"frame_{frame_id:04d}.jpg"
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    return FileResponse(str(frame_path), media_type="image/jpeg")


@router.get("/{match_id}/training-data")
async def get_training_data(match_id: str) -> StreamingResponse:
    report_path = OUTPUT_DIR / match_id / "report.json"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found")

    data = json.loads(report_path.read_text())
    video_path = str(VIDEOS_DIR / f"{match_id}.mp4")
    training_dir = OUTPUT_DIR / match_id / "training"
    training_dir.mkdir(parents=True, exist_ok=True)

    analyzer = GeminiAnalyzer()
    try:
        analyzer.generate_training_data(data, video_path, str(training_dir))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training data generation failed: {e}")

    # Write rallies.json as additional training data
    rallies = data.get("rallies", [])
    rallies_path = training_dir / "rallies.json"
    rallies_path.write_text(json.dumps(rallies, ensure_ascii=False, indent=2))

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in training_dir.rglob("*"):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(training_dir))
    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=training_{match_id}.zip"},
    )
