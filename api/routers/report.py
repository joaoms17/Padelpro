"""Report endpoints — read analysis results, serve frames, generate training data."""

from __future__ import annotations
import io
import json
import logging
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from api.models import AnalysisReport

router = APIRouter(prefix="/report", tags=["report"])
logger = logging.getLogger(__name__)


def _compute_rally_stats(rallies: list[dict], duration_s: float) -> dict:
    """Compute aggregate stats from rally list."""
    total_play = sum(r.get("duration_s", 0) for r in rallies)
    return {
        "total_rallies": len(rallies),
        "avg_duration_s": round(total_play / len(rallies), 2) if rallies else 0,
        "total_play_time_s": round(total_play, 2),
        "play_time_pct": round(total_play / duration_s * 100, 1) if duration_s else 0,
    }


def _compute_formation_pct(formation_samples: list[dict]) -> dict:
    """Compute percentage time in each formation type."""
    counts: dict[str, int] = {
        "both_net": 0,
        "both_back": 0,
        "t1_net_t2_back": 0,
        "t1_back_t2_net": 0,
        "mixed": 0,
    }
    for sample in formation_samples:
        t = sample.get("type", "mixed")
        if t in counts:
            counts[t] += 1
        else:
            counts["mixed"] += 1

    total = sum(counts.values())
    if total == 0:
        return {k: 0.0 for k in counts}
    return {k: round(v / total * 100, 1) for k, v in counts.items()}


@router.get("/{match_id}", response_model=AnalysisReport)
async def get_report(match_id: str):
    """Read analysis report for a match."""
    report_path = Path("data/output") / match_id / "report.json"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found. Analysis may still be running.")

    with open(report_path) as f:
        data = json.load(f)

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
async def get_frame(match_id: str, frame_id: int):
    """Serve an extracted frame image."""
    frame_path = Path("data/output") / match_id / "frames" / f"frame_{frame_id:04d}.jpg"
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail=f"Frame {frame_id} not found.")
    return FileResponse(str(frame_path), media_type="image/jpeg")


@router.get("/{match_id}/training-data")
async def get_training_data(match_id: str):
    """Generate YOLO training data zip and return as download."""
    report_path = Path("data/output") / match_id / "report.json"
    video_path = Path("data/videos") / f"{match_id}.mp4"

    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found.")

    with open(report_path) as f:
        report = json.load(f)

    # Generate training data
    training_dir = Path("data/output") / match_id / "training"
    training_dir.mkdir(parents=True, exist_ok=True)

    if video_path.exists():
        try:
            from api.gemini_analysis import GeminiAnalyzer
            analyzer = GeminiAnalyzer()
            analyzer.generate_training_data(report, str(video_path), str(training_dir))
        except Exception as exc:
            logger.warning("Could not generate training data: %s", exc)

    # Write rallies.json as additional training data
    rallies = report.get("rallies", [])
    rallies_path = training_dir / "rallies.json"
    rallies_path.write_text(json.dumps(rallies, ensure_ascii=False, indent=2))

    # Create zip from training directory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in training_dir.rglob("*"):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(training_dir))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=training_{match_id}.zip"},
    )
