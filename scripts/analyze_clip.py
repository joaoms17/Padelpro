"""
CLI: analyse a short clip → player indicators report.

Usage (from repo root, inside the torch venv):
    .venv\\Scripts\\python.exe scripts\\analyze_clip.py data\\test\\clip4min.mp4 --court court1
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def main() -> None:
    ap = argparse.ArgumentParser(description="Analyse a padel clip (CPU).")
    ap.add_argument("video", type=Path)
    ap.add_argument("--court", default="court1", help="court_id with saved calibration")
    ap.add_argument("--deep", action="store_true", help="ball detection at hit instants (slower, better attribution)")
    ap.add_argument("--out", type=Path, default=None, help="output dir (default: data/output/<stem>)")
    args = ap.parse_args()

    out = args.out or Path("data/output") / f"analysis_{args.video.stem}"

    from padelpro_vision.analysis import analyze_clip, analysis_available
    if not analysis_available():
        sys.exit("torch/torchvision não disponíveis — corre dentro do .venv.")

    report = analyze_clip(args.video, out, court_id=args.court, deep=args.deep)

    print("\n================ RELATÓRIO ================")
    c = report["clip"]
    print(f"Vídeo: {c['duration_s']}s | útil {c['useful_s']}s ({c['useful_pct']}%) | {c['rallies']} rallies")
    h = report["hits"]
    print(f"Pancadas: {h['total']} (média {h['avg_per_rally']}/rally, {h['per_min_useful']}/min útil)")
    if h.get("ball_found_pct") is not None:
        print(f"Bola encontrada em {h['ball_found_pct']}% das pancadas (atribuição: {h['attribution']})")
    print(f"Calibrado: {report['calibrated']}")
    for p in report["players"]:
        z = p["zones"]
        print(
            f"  {p['label']} [{p['team']}/{p['side']}] cobertura {p['coverage_pct']}% | "
            f"{p['distance_m']}m | méd {p['avg_speed_ms']}m/s máx {p['max_speed_ms']}m/s | "
            f"rede {z['rede_pct']}% meio {z['meio_pct']}% fundo {z['fundo_pct']}% | "
            f"pancadas {p['hits']} ({p.get('hit_share_pct', 0)}%)"
        )
    t = report["timings_s"]
    print(f"Tempos: seg {t['segmentation']}s, áudio {t['audio']}s, deteção {t['detection']}s, total {t['total']}s")
    print(f"JSON: {out / 'report.json'}")


if __name__ == "__main__":
    main()
