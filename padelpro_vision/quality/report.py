"""
Per-match quality telemetry: one quality_report.json per processed match so
model/config changes can be compared across the whole fleet of matches, not
just on a single test clip.
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

import numpy as np

from padelpro_vision.evaluation.sanity import physics_sanity, tracking_stability

logger = logging.getLogger(__name__)


def build_quality_report(
    match_id: str,
    frame_results: list,                       # pipeline FrameResult list
    court_positions: dict[int, list] | None,   # {tid: [(ts, x_m, y_m)]} if homography available
    shot_events: list,
    *,
    expected_players: int = 4,
    max_plausible_speed_ms: float = 8.0,
    teleport_jump_m: float = 3.0,
    homography_quality: dict | None = None,
    processing_elapsed_s: float | None = None,
    video_duration_s: float | None = None,
) -> dict:
    """Aggregate detection/tracking/stroke health metrics for one match."""
    n_frames = len(frame_results)
    players_per_frame = np.array([len(fr.tracks) for fr in frame_results]) if n_frames else np.zeros(0)
    confidences = [t.box.confidence for fr in frame_results for t in fr.tracks]

    detection = {
        "frames_processed": n_frames,
        "mean_detection_confidence": round(float(np.mean(confidences)), 3) if confidences else 0.0,
        "mean_players_per_frame": round(float(players_per_frame.mean()), 2) if n_frames else 0.0,
        "pct_frames_with_expected_players": (
            round(100.0 * float((players_per_frame >= expected_players).mean()), 1) if n_frames else 0.0
        ),
        "pct_frames_with_zero_players": (
            round(100.0 * float((players_per_frame == 0).mean()), 1) if n_frames else 0.0
        ),
    }

    track_positions = court_positions or {}
    tracking = tracking_stability(track_positions, expected_players=expected_players)
    physics = (
        physics_sanity(
            track_positions,
            max_plausible_speed_ms=max_plausible_speed_ms,
            teleport_jump_m=teleport_jump_m,
        )
        if court_positions
        else None
    )

    stroke_confs = [ev.confidence for ev in shot_events]
    strokes = {
        "n_events": len(shot_events),
        "mean_confidence": round(float(np.mean(stroke_confs)), 3) if stroke_confs else 0.0,
        "pct_with_audio_onset": (
            round(
                100.0
                * sum(1 for ev in shot_events if getattr(ev, "audio_onset", None))
                / len(shot_events),
                1,
            )
            if shot_events
            else 0.0
        ),
    }

    report = {
        "match_id": match_id,
        "detection": detection,
        "tracking": tracking,
        "physics": physics,
        "strokes": strokes,
        "homography_quality": homography_quality,
    }
    if processing_elapsed_s is not None and video_duration_s:
        report["performance"] = {
            "elapsed_s": round(processing_elapsed_s, 1),
            "realtime_factor": round(processing_elapsed_s / video_duration_s, 2),
        }
    return report


def save_quality_report(report: dict, output_dir: Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "quality_report.json"
    with open(path, "w") as f:
        json.dump(report, f, indent=2)
    logger.info("Quality report written to %s", path)
    return path
