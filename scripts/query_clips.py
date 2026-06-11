"""
Query clips from an indexed match and optionally render a montage.

Usage:
    # List all smashes by player 1
    python scripts/query_clips.py --match-dir data/output/match_001 --player 1 --stroke smash

    # Render montage of all viboras in the net zone
    python scripts/query_clips.py \\
        --match-dir data/output/match_001 \\
        --stroke vibora --zone net_left net_right \\
        --video data/videos/jogo.mp4 \\
        --montage data/output/match_001/montage_viboras.mp4
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Query clips + render montagem.")
    parser.add_argument("--match-dir", required=True, type=Path,
                        help="Directório com rallies.json e clips.json.")
    parser.add_argument("--player",  type=int, default=None)
    parser.add_argument("--stroke",  default=None,
                        help="bandeja | vibora | smash | serve | forehand_volley | backhand_volley")
    parser.add_argument("--zone",    nargs="+", default=None,
                        help="Zona(s): net_left net_right mid_left mid_right back_left back_right")
    parser.add_argument("--phase",   default=None, help="early | mid | late")
    parser.add_argument("--video",   type=Path, default=None,
                        help="Vídeo fonte para renderizar montagem.")
    parser.add_argument("--montage", type=Path, default=None,
                        help="Caminho de saída da montagem MP4.")
    args = parser.parse_args()

    from padelpro_vision.indexing.indexer import load_index, query_clips, build_montage

    if not (args.match_dir / "clips.json").exists():
        print(f"⚠ clips.json não encontrado em {args.match_dir}")
        print("  Corre primeiro o pipeline com --analytics")
        sys.exit(1)

    rallies, clips = load_index(args.match_dir)
    print(f"Índice carregado: {len(rallies)} rallies, {len(clips)} clips")

    zones = args.zone  # list or None
    filtered = clips
    if args.player  is not None: filtered = [c for c in filtered if c.player_id   == args.player]
    if args.stroke  is not None: filtered = [c for c in filtered if c.stroke_type == args.stroke]
    if zones        is not None: filtered = [c for c in filtered if c.zone        in zones]
    if args.phase   is not None: filtered = [c for c in filtered if c.rally_phase == args.phase]

    print(f"\nResultados: {len(filtered)} clips")
    for c in filtered[:20]:  # preview first 20
        print(f"  clip {c.clip_id:04d}  P{c.player_id}  {c.stroke_type:<20}  {c.zone:<12}  "
              f"{c.rally_phase:<6}  [{c.t_start_ms/1000:.1f}s – {c.t_end_ms/1000:.1f}s]")
    if len(filtered) > 20:
        print(f"  ... (+{len(filtered) - 20} mais)")

    if args.montage:
        if args.video is None:
            print("\n⚠ Fornece --video para renderizar a montagem.")
            sys.exit(1)
        if not filtered:
            print("\n⚠ Nenhum clip para montar.")
            sys.exit(0)
        build_montage(args.video, filtered, args.montage)
        print(f"\nMontagem guardada: {args.montage}")


if __name__ == "__main__":
    main()
