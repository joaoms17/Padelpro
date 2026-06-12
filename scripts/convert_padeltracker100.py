"""
Convert PadelTracker100 annotations into the TCN training format.

PadelTracker100 (Zenodo 10.5281/zenodo.14653706, CC BY): ~100k frames of two
WPT Finals 2022 matches with pose + stroke events in 6 classes. Download it
manually (Zenodo blocks automated fetches), then:

    # 1. See what the archive actually contains
    python scripts/convert_padeltracker100.py --inspect ~/Downloads/padeltracker100

    # 2. Convert (adjust --pose-file/--events-file to the real names)
    python scripts/convert_padeltracker100.py ~/Downloads/padeltracker100 \
        --output data/annotations/padeltracker100.json

Their classes map to ours conservatively (overhead nuances like bandeja/víbora
don't exist in their taxonomy):

    forehand → forehand_volley   backhand → backhand_volley
    smash → smash                serve/service → serve
    dropshot → other             other → other

Atribuição obrigatória (CC BY): citar o dataset PadelTracker100 e o paper
associado em qualquer distribuição.
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
logger = logging.getLogger("convert")

DEFAULT_CLASS_MAP = {
    "forehand": "forehand_volley",
    "backhand": "backhand_volley",
    "smash": "smash",
    "serve": "serve",
    "service": "serve",
    "dropshot": "other",
    "other": "other",
}


def inspect(root: Path, max_files: int = 40) -> None:
    """Print the tree and the JSON/CSV schema of sampled files."""
    print(f"\n=== {root} ===")
    files = [p for p in sorted(root.rglob("*")) if p.is_file()]
    for p in files[:max_files]:
        print(f"  {p.relative_to(root)}  ({p.stat().st_size // 1024} KB)")
    if len(files) > max_files:
        print(f"  … +{len(files) - max_files} ficheiros")

    for p in files:
        if p.suffix.lower() == ".json" and p.stat().st_size < 200 * 1024 * 1024:
            try:
                with open(p) as f:
                    data = json.load(f)
            except Exception:
                continue
            print(f"\n--- {p.name} ---")
            _describe(data, depth=0)
            break
    for p in files:
        if p.suffix.lower() == ".csv":
            with open(p) as f:
                header = f.readline().strip()
            print(f"\n--- {p.name} (CSV) ---\n  colunas: {header}")
            break


def _describe(obj, depth: int, max_depth: int = 3) -> None:
    pad = "  " * (depth + 1)
    if depth > max_depth:
        return
    if isinstance(obj, dict):
        for k, v in list(obj.items())[:12]:
            print(f"{pad}{k}: {type(v).__name__}"
                  f"{f' [{len(v)}]' if isinstance(v, (list, dict)) else ''}")
            if isinstance(v, (dict, list)):
                _describe(v, depth + 1)
    elif isinstance(obj, list) and obj:
        print(f"{pad}[0]:")
        _describe(obj[0], depth + 1)


def convert(
    pose_file: Path,
    events_file: Path | None,
    output: Path,
    class_map: dict[str, str],
    window: int,
) -> None:
    """
    Convert from a per-frame pose JSON (+ optional events file). Supports:
      A) ready-made samples: [{"label", "keypoints_sequence"}] — passthrough
      B) frame records with keypoints + event label fields — windowed around
         each labelled event
    Run --inspect first if this fails: the loader tells you which field names
    it could not find.
    """
    with open(pose_file) as f:
        data = json.load(f)

    samples: list[dict] = []

    # Layout A: already in training format
    if isinstance(data, list) and data and "keypoints_sequence" in data[0]:
        for s in data:
            label = class_map.get(str(s.get("label", "")).lower())
            if label:
                samples.append({"label": label,
                                "keypoints_sequence": s["keypoints_sequence"]})
        _write(samples, output)
        return

    # Layout B: frame-level records
    records = data if isinstance(data, list) else data.get("annotations", [])
    if not records:
        logger.error("Estrutura desconhecida em %s — corre com --inspect e "
                     "ajusta o conversor (campos esperados: keypoints + label/"
                     "event + frame + player).", pose_file)
        sys.exit(1)

    events = []
    if events_file is not None and events_file.exists():
        with open(events_file) as f:
            events = json.load(f)
            if isinstance(events, dict):
                events = events.get("events", events.get("annotations", []))

    def field(rec: dict, *names):
        for n in names:
            if n in rec:
                return rec[n]
        return None

    # Index poses by (player, frame)
    poses: dict[tuple, list] = {}
    for rec in records:
        kps = field(rec, "keypoints", "pose", "skeleton")
        frame = field(rec, "frame", "frame_id", "frame_idx", "image_id")
        player = field(rec, "player", "player_id", "track_id") or 0
        if kps is None or frame is None:
            continue
        arr = np.array(kps, dtype=np.float32).reshape(-1)
        # COCO triplets (x,y,v) or pairs (x,y)
        kp17 = arr.reshape(17, 3)[:, :2] if arr.size == 51 else arr.reshape(17, 2)
        poses[(player, int(frame))] = kp17.tolist()

    if not poses:
        logger.error("Nenhum keypoint reconhecido — corre com --inspect.")
        sys.exit(1)

    event_records = events or [r for r in records if field(r, "label", "event", "stroke")]
    for ev in event_records:
        raw = str(field(ev, "label", "event", "stroke", "class") or "").lower()
        label = class_map.get(raw)
        frame = field(ev, "frame", "frame_id", "frame_idx", "image_id")
        player = field(ev, "player", "player_id", "track_id") or 0
        if label is None or frame is None:
            continue
        seq = [poses.get((player, f)) for f in range(int(frame) - window + 1, int(frame) + 1)]
        seq = [s for s in seq if s is not None]
        if len(seq) >= max(4, window // 2):
            samples.append({"label": label, "keypoints_sequence": seq})

    _write(samples, output)


def _write(samples: list[dict], output: Path) -> None:
    if not samples:
        logger.error("0 amostras convertidas — verifica o mapeamento de classes.")
        sys.exit(1)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        json.dump(samples, f)
    by_label: dict[str, int] = {}
    for s in samples:
        by_label[s["label"]] = by_label.get(s["label"], 0) + 1
    logger.info("%d amostras → %s  (%s)", len(samples), output,
                ", ".join(f"{k}: {v}" for k, v in sorted(by_label.items())))
    logger.info("Treinar: python scripts/train_stroke_classifier.py --data %s", output)


def main() -> None:
    from padelpro_vision.strokes.classifier import WINDOW_SIZE
    parser = argparse.ArgumentParser(description="PadelTracker100 → formato de treino TCN.")
    parser.add_argument("root", type=Path, help="Pasta do dataset descarregado.")
    parser.add_argument("--inspect", action="store_true", help="Só mostrar a estrutura.")
    parser.add_argument("--pose-file", type=Path, default=None,
                        help="JSON com poses/eventos (default: primeiro .json encontrado).")
    parser.add_argument("--events-file", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("data/annotations/padeltracker100.json"))
    parser.add_argument("--class-map", type=str, default=None,
                        help="JSON para substituir o mapeamento de classes por defeito.")
    args = parser.parse_args()

    if not args.root.exists():
        logger.error("Pasta não encontrada: %s", args.root)
        sys.exit(1)

    if args.inspect:
        inspect(args.root)
        return

    pose_file = args.pose_file
    if pose_file is None:
        pose_file = next(iter(sorted(args.root.rglob("*.json"))), None)
        if pose_file is None:
            logger.error("Nenhum .json em %s — corre com --inspect.", args.root)
            sys.exit(1)
        logger.info("A usar %s (especifica --pose-file para mudar).", pose_file)

    class_map = dict(DEFAULT_CLASS_MAP)
    if args.class_map:
        class_map.update({k.lower(): v for k, v in json.loads(args.class_map).items()})

    convert(pose_file, args.events_file, args.output, class_map, WINDOW_SIZE)


if __name__ == "__main__":
    main()
