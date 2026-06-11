"""
Run the M1 pipeline on a match video.

Usage:
    python scripts/run_match.py \\
        --video data/videos/match_001.mp4 \\
        --match-id match_001 \\
        --court-id sintra_court1 \\
        --output data/output/match_001
"""

from __future__ import annotations
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import DEFAULT_CONFIG
from padelpro_vision.pipeline import Pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="PadelPro Vision M1 — processar vídeo de jogo.")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--match-id", required=True)
    parser.add_argument("--court-id", required=True)
    parser.add_argument("--output", type=Path, default=Path("data/output"))
    parser.add_argument("--device", default="cpu", help="'cpu' ou 'cuda:0'")
    args = parser.parse_args()

    cfg = DEFAULT_CONFIG
    cfg.model.device = args.device

    output_dir = args.output / args.match_id
    pipeline = Pipeline(cfg)
    result = pipeline.run(args.video, output_dir, args.match_id)

    print(f"\nM1 concluído — match '{args.match_id}'")
    print(f"  CSV de posições : {result.csv_path}")
    print(f"  Vídeo anotado   : {result.annotated_video_path}")
    print(f"  Frames processados : {len(result.frame_results)}")
    total_tracks = sum(len(fr.tracks) for fr in result.frame_results)
    print(f"  Deteções totais : {total_tracks}")
    if total_tracks == 0:
        print("\n  ⚠ Nenhuma deteção — instala os pesos YOLOX/RTMDet (ver README.md).")


if __name__ == "__main__":
    main()
