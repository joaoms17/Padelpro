"""
A/B compare two pipeline configurations on the golden set.

Runs scripts/evaluate.py twice with config overrides applied via dotted paths
(e.g. video.input_skip_frames=2) and prints a metric-by-metric diff, so the
quality/speed trade-off of any knob is measured instead of guessed.

Usage:
    python scripts/ab_compare.py \
        --a video.input_skip_frames=1 \
        --b video.input_skip_frames=2 model.score_threshold=0.4 \
        --golden data/golden --out outputs/ab
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s  %(message)s")
logger = logging.getLogger("ab_compare")


def apply_overrides(cfg, overrides: list[str]) -> None:
    """Apply 'section.field=value' overrides in place, casting to the field's type."""
    for ov in overrides:
        path, _, raw = ov.partition("=")
        if not _:
            raise ValueError(f"Override must be section.field=value, got: {ov}")
        section_name, _, field_name = path.partition(".")
        section = getattr(cfg, section_name)
        current = getattr(section, field_name)   # raises if the field is unknown
        if isinstance(current, bool):
            value = raw.lower() in ("1", "true", "yes")
        elif isinstance(current, int):
            value = int(raw)
        elif isinstance(current, float):
            value = float(raw)
        elif isinstance(current, Path):
            value = Path(raw)
        else:
            value = raw
        setattr(section, field_name, value)
        logger.info("  %s.%s = %s", section_name, field_name, value)


def run_variant(name: str, overrides: list[str], golden: Path, out: Path, no_pose: bool) -> dict:
    import copy
    from config import DEFAULT_CONFIG
    import scripts.evaluate as ev
    from padelpro_vision.evaluation.golden import load_golden_set
    from padelpro_vision.pipeline import Pipeline

    cfg = copy.deepcopy(DEFAULT_CONFIG)
    logger.info("Variant %s:", name)
    apply_overrides(cfg, overrides)

    clips = load_golden_set(golden)
    per_clip = []
    t0 = time.monotonic()
    for clip in clips:
        if clip.video_path is None or not clip.video_path.exists():
            logger.warning("[%s] video not found — skipped.", clip.clip_id)
            continue
        clip_out = out / name / clip.clip_id
        homography_path = None
        if clip.court_id:
            homography_path = cfg.calibration.homography_cache_dir / f"{clip.court_id}.json"
        Pipeline(cfg).run(
            clip.video_path, clip_out, match_id=clip.clip_id,
            segment=True, pose=not no_pose, analytics=True,
            homography_path=homography_path,
        )
        per_clip.append(ev.evaluate_clip(clip, clip_out, cfg))
    elapsed = time.monotonic() - t0

    summary = ev.aggregate(per_clip)
    summary["_meta"] = {"elapsed_s": round(elapsed, 1), "n_clips": len(per_clip)}
    return summary


def print_diff(sa: dict, sb: dict) -> None:
    print(f"\n{'métrica':<45} {'A':>10} {'B':>10} {'Δ (B-A)':>10}")
    print("-" * 78)
    sections = sorted(set(sa) | set(sb))
    for section in sections:
        for key in sorted(set(sa.get(section, {})) | set(sb.get(section, {}))):
            a = sa.get(section, {}).get(key)
            b = sb.get(section, {}).get(key)
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                print(f"{section + '.' + key:<45} {a:>10.3f} {b:>10.3f} {b - a:>+10.3f}")
            else:
                print(f"{section + '.' + key:<45} {str(a):>10} {str(b):>10}")


def main() -> None:
    parser = argparse.ArgumentParser(description="A/B compare two configs on the golden set.")
    parser.add_argument("--a", nargs="*", default=[], help="Overrides for variant A.")
    parser.add_argument("--b", nargs="*", default=[], help="Overrides for variant B.")
    parser.add_argument("--golden", type=Path, default=Path("data/golden"))
    parser.add_argument("--out", type=Path, default=Path("outputs/ab"))
    parser.add_argument("--no-pose", action="store_true")
    args = parser.parse_args()

    summary_a = run_variant("A", args.a, args.golden, args.out, args.no_pose)
    summary_b = run_variant("B", args.b, args.golden, args.out, args.no_pose)

    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "ab_result.json", "w") as f:
        json.dump({"A": {"overrides": args.a, **summary_a},
                   "B": {"overrides": args.b, **summary_b}}, f, indent=2)

    print_diff(summary_a, summary_b)
    logger.info("Full result → %s", args.out / "ab_result.json")


if __name__ == "__main__":
    main()
