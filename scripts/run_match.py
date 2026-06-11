"""
Run the full PadelPro Vision pipeline on a match video.

Usage (M1 only):
    python scripts/run_match.py --video data/videos/jogo.mp4 --match-id match_001 --court-id sintra_court1

With all stages:
    python scripts/run_match.py --video data/videos/jogo.mp4 --match-id match_001 --court-id sintra_court1 \\
        --segment --condense --pose --analytics --supabase
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
    parser = argparse.ArgumentParser(description="PadelPro Vision — processar vídeo de jogo.")
    parser.add_argument("--video",     required=True, type=Path)
    parser.add_argument("--match-id",  required=True)
    parser.add_argument("--court-id",  required=True)
    parser.add_argument("--output",    type=Path, default=Path("data/output"))
    parser.add_argument("--device",    default="cpu", help="'cpu' ou 'cuda:0'")
    parser.add_argument("--segment",   action="store_true", help="Segmentação — salta tempo morto.")
    parser.add_argument("--condense",  action="store_true", help="Vídeo condensado sem tempo morto.")
    parser.add_argument("--pose",      action="store_true", help="Pose + classificador de pancadas (M2).")
    parser.add_argument("--analytics", action="store_true", help="Analytics 2D + stats por jogador (M3).")
    parser.add_argument("--supabase",  action="store_true", help="Enviar resultados para Supabase.")
    args = parser.parse_args()

    cfg = DEFAULT_CONFIG
    cfg.model.device = args.device

    # Locate homography cache for this court
    hom_path = cfg.calibration.homography_cache_dir / f"{args.court_id}.json"

    output_dir = args.output / args.match_id
    pipeline   = Pipeline(cfg)
    result     = pipeline.run(
        args.video, output_dir, args.match_id,
        segment=args.segment,
        condense=args.condense,
        pose=args.pose,
        analytics=args.analytics,
        homography_path=hom_path if hom_path.exists() else None,
        supabase=args.supabase,
    )

    print(f"\nPipeline concluído — match '{args.match_id}'")
    print(f"  CSV de posições   : {result.csv_path}")
    print(f"  Vídeo anotado     : {result.annotated_video_path}")

    if result.shot_events_path:
        print(f"  Shot events       : {result.shot_events_path}")
    if result.segments_path:
        print(f"  Segmentos         : {result.segments_path}")
    if result.condensed_video_path:
        print(f"  Vídeo condensado  : {result.condensed_video_path}")
    if result.analytics_path:
        print(f"  Analytics         : {result.analytics_path}")

    total_tracks = sum(len(fr.tracks) for fr in result.frame_results)
    print(f"  Frames processados: {len(result.frame_results)}")
    print(f"  Deteções totais   : {total_tracks}")

    if total_tracks == 0:
        print("\n  ⚠ Nenhuma deteção — instala os pesos YOLOX/RTMDet (ver README.md).")
    if args.analytics and not hom_path.exists():
        print(f"\n  ⚠ Homografia não encontrada para '{args.court_id}'.")
        print( "    Corre: python scripts/calibrate_court.py --video <video> --court-id", args.court_id)


if __name__ == "__main__":
    main()
