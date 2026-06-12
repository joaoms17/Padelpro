"""
Evaluate the pipeline against the golden set (data/golden/*.json).

For each annotated clip, runs the pipeline (or reuses existing outputs with
--no-run) and compares against ground truth:
  - rally segmentation: temporal precision/recall/F1/IoU
  - hit detection: P/R/F1 + mean temporal offset (ms)
  - stroke classification: accuracy + confusion (over matched hits)
  - position error: metres at annotated keyframes (needs court_id homography)
  - physics sanity + tracking stability (no annotation needed)

Outputs <out>/scorecard.json and <out>/scorecard.md. Run it before and after
any model/config change — that diff IS the result of the change.

Usage:
    python scripts/evaluate.py --golden data/golden --out outputs/eval
    python scripts/evaluate.py --golden data/golden --out outputs/eval --no-run
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s  %(message)s")
logger = logging.getLogger("evaluate")


def evaluate_clip(clip, clip_out: Path, cfg) -> dict:
    """Compute all applicable metrics for one golden clip from pipeline outputs."""
    from padelpro_vision.evaluation.metrics import (
        interval_metrics, hit_metrics, position_error_metrics,
    )
    from padelpro_vision.evaluation.sanity import physics_sanity, tracking_stability
    from padelpro_vision.strokes.classifier import STROKE_CLASSES

    result: dict = {"clip_id": clip.clip_id}

    # --- Segmentation ---
    seg_path = clip_out / "segments.json"
    if clip.has_rallies and seg_path.exists():
        with open(seg_path) as f:
            segs = json.load(f)
        pred = [(s["start_ms"], s["end_ms"]) for s in segs if s["type"] == "rally"]
        result["segmentation"] = interval_metrics(clip.rallies, pred)

    # --- Hits + strokes ---
    events_path = next(clip_out.glob("*_shot_events.json"), None)
    if clip.has_hits:
        events = []
        if events_path is not None:
            from padelpro_vision.strokes.shot_event import load_shot_events
            events = load_shot_events(events_path)
        result["hits"] = hit_metrics(
            clip.hits, events,
            tolerance_ms=300.0,
            stroke_classes=list(STROKE_CLASSES),
        )

    # --- Positions (court space) + sanity ---
    track_positions = _load_track_positions(clip_out, clip.court_id, cfg)
    if track_positions:
        if clip.has_positions:
            result["positions"] = position_error_metrics(clip.positions, track_positions)
        result["physics"] = physics_sanity(
            track_positions,
            max_plausible_speed_ms=cfg.quality.max_plausible_speed_ms,
            teleport_jump_m=cfg.quality.teleport_jump_m,
        )
        result["tracking"] = tracking_stability(
            track_positions, expected_players=cfg.quality.expected_players
        )
    return result


def _load_track_positions(clip_out: Path, court_id: str | None, cfg) -> dict | None:
    """Rebuild {tid: [(ts, x_m, y_m)]} from the positions CSV + homography."""
    import csv as _csv
    csv_path = next(clip_out.glob("*_positions.csv"), None)
    if csv_path is None or court_id is None:
        return None
    from padelpro_vision.calibration.calibration import CourtCalibrator
    from padelpro_vision.projection.projection import project_point
    cal = CourtCalibrator(cfg.calibration.homography_cache_dir)
    H = cal.load(court_id)
    if H is None:
        logger.warning("No homography for court '%s' — court-space metrics skipped.", court_id)
        return None

    positions: dict[int, list] = {}
    with open(csv_path) as f:
        for row in _csv.DictReader(f):
            px = (float(row["x1"]) + float(row["x2"])) / 2.0
            py = float(row["y2"])
            cx, cy = project_point(H, px, py)
            positions.setdefault(int(row["track_id"]), []).append(
                (float(row["timestamp_ms"]), cx, cy)
            )
    return positions


def aggregate(per_clip: list[dict]) -> dict:
    """Mean of every numeric leaf metric across clips (sections present in any clip)."""
    summary: dict = {}
    for section in ("segmentation", "hits", "positions", "physics", "tracking"):
        values: dict[str, list[float]] = {}
        for r in per_clip:
            sec = r.get(section)
            if not sec:
                continue
            for k, v in sec.items():
                if isinstance(v, (int, float)) and v is not None:
                    values.setdefault(k, []).append(float(v))
        if values:
            summary[section] = {k: round(float(np.mean(v)), 4) for k, v in values.items()}
    return summary


def write_markdown(scorecard: dict, path: Path) -> None:
    lines = ["# PadelPro — Scorecard de avaliação", ""]
    lines.append(f"Clips avaliados: **{len(scorecard['clips'])}**")
    lines.append("")
    for section, metrics in scorecard["summary"].items():
        lines.append(f"## {section}")
        lines.append("")
        lines.append("| métrica | valor |")
        lines.append("|---|---|")
        for k, v in metrics.items():
            lines.append(f"| {k} | {v} |")
        lines.append("")
    lines.append("## Por clip")
    lines.append("")
    for r in scorecard["clips"]:
        lines.append(f"### {r['clip_id']}")
        lines.append("```json")
        lines.append(json.dumps({k: v for k, v in r.items() if k != "clip_id"}, indent=2))
        lines.append("```")
        lines.append("")
    path.write_text("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate pipeline against the golden set.")
    parser.add_argument("--golden", type=Path, default=Path("data/golden"))
    parser.add_argument("--out", type=Path, default=Path("outputs/eval"))
    parser.add_argument("--no-run", action="store_true",
                        help="Skip the pipeline; evaluate existing outputs in --out.")
    parser.add_argument("--no-pose", action="store_true",
                        help="Run without pose/strokes (faster; hit metrics skipped).")
    args = parser.parse_args()

    from config import DEFAULT_CONFIG
    from padelpro_vision.evaluation.golden import load_golden_set

    clips = load_golden_set(args.golden)
    # Corrections submitted on the review page are golden hits too — every
    # reviewed match becomes evaluation ground truth for free.
    feedback_golden = Path("data/feedback/golden")
    if feedback_golden.exists():
        extra = load_golden_set(feedback_golden)
        known = {c.clip_id for c in clips}
        extra = [c for c in extra if c.clip_id not in known]
        if extra:
            logger.info("Including %d reviewed matches from %s.", len(extra), feedback_golden)
            clips.extend(extra)
    if not clips:
        logger.error(
            "No golden annotations found in %s. See data/golden/README.md "
            "and example_annotation.json for the format.", args.golden,
        )
        sys.exit(1)
    logger.info("Golden set: %d annotated clips.", len(clips))

    cfg = DEFAULT_CONFIG
    per_clip: list[dict] = []
    for clip in clips:
        clip_out = args.out / clip.clip_id

        if not args.no_run:
            if clip.video_path is None or not clip.video_path.exists():
                logger.warning("[%s] video not found (%s) — skipped.", clip.clip_id, clip.video_path)
                continue
            from padelpro_vision.pipeline import Pipeline
            homography_path = None
            if clip.court_id:
                homography_path = cfg.calibration.homography_cache_dir / f"{clip.court_id}.json"
            logger.info("[%s] running pipeline …", clip.clip_id)
            Pipeline(cfg).run(
                clip.video_path,
                clip_out,
                match_id=clip.clip_id,
                segment=True,
                pose=not args.no_pose,
                analytics=True,
                homography_path=homography_path,
            )
        elif not clip_out.exists():
            # Reviewed matches keep their pipeline outputs in data/output/<id>
            alt = Path("data/output") / clip.clip_id
            if alt.exists():
                clip_out = alt
            else:
                logger.warning("[%s] no outputs in %s — skipped.", clip.clip_id, clip_out)
                continue

        per_clip.append(evaluate_clip(clip, clip_out, cfg))

    if not per_clip:
        logger.error("Nothing evaluated.")
        sys.exit(1)

    scorecard = {"summary": aggregate(per_clip), "clips": per_clip}
    args.out.mkdir(parents=True, exist_ok=True)
    json_path = args.out / "scorecard.json"
    with open(json_path, "w") as f:
        json.dump(scorecard, f, indent=2)
    write_markdown(scorecard, args.out / "scorecard.md")

    logger.info("Scorecard → %s", json_path)
    for section, metrics in scorecard["summary"].items():
        headline = {
            k: metrics[k] for k in ("f1", "iou", "mean_error_m", "pct_implausible_speed")
            if k in metrics
        }
        logger.info("  %s: %s", section, headline or metrics)


if __name__ == "__main__":
    main()
