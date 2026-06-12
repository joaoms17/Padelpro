"""
Harvest TCN training samples from labelled hit clips.

Walks data/dataset/hits/<label>/*.mp4 (the tree produced by the /label page),
runs detection+pose on each clip, extracts the hitter's keypoint sequence and
writes train_stroke_classifier.py-compatible samples.

The hitter heuristic: the person whose wrist moves fastest across the clip
(clips are short and centred on the hit, so this is reliable in practice).

Usage:
    python scripts/harvest_pose_from_clips.py \
        --clips data/dataset/hits \
        --output data/annotations/clips_dataset.json \
        --label-map '{"rede":"forehand_volley"}'    # optional folder→class map

Requires real pose weights (MMPose) — aborts cleanly on the geometric stub,
because zero-confidence keypoints would only teach the model noise.
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
logger = logging.getLogger("harvest")

UNLABELLED_DIRS = {"por_classificar", "unsorted", "unlabeled", "unlabelled"}


def resolve_label(folder: str, label_map: dict[str, str]) -> str | None:
    """Folder name → stroke class, honouring the user map. None = skip."""
    from padelpro_vision.strokes.classifier import STROKE_CLASSES
    name = folder.strip().lower()
    if name in label_map:
        name = label_map[name]
    return name if name in STROKE_CLASSES else None


def clip_to_sample(video_path: Path, detector, estimator) -> list | None:
    """
    Extract the hitter's normalised keypoint window from a short clip.
    Returns keypoints_sequence [[ [x,y] ×17 ] × T] or None when unusable.
    """
    import cv2
    from padelpro_vision.strokes.classifier import (
        WINDOW_SIZE, pose_to_features, _wrist_speeds,
    )

    cap = cv2.VideoCapture(str(video_path))
    poses_per_person: dict[int, list] = {}   # naive slot per detection rank
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        detections = detector.detect(frame)
        # Sort by box area: the players near the action are the biggest
        detections = sorted(
            detections, key=lambda d: d.width * d.height, reverse=True
        )[:4]
        for rank, det in enumerate(detections):
            pose = estimator.estimate(frame, det)
            poses_per_person.setdefault(rank, []).append(pose)
    cap.release()

    best_seq = None
    best_speed = 0.0
    for poses in poses_per_person.values():
        if len(poses) < 4:
            continue
        speeds = _wrist_speeds(poses)
        peak = float(speeds.max()) if len(speeds) else 0.0
        if peak > best_speed:
            best_speed = peak
            best_seq = poses

    if best_seq is None or best_speed <= 0.0:
        return None

    window = best_seq[-WINDOW_SIZE:] if len(best_seq) >= WINDOW_SIZE else best_seq
    return [pose_to_features(p).reshape(17, 2).tolist() for p in window]


def main() -> None:
    parser = argparse.ArgumentParser(description="Labelled clips → TCN training samples.")
    parser.add_argument("--clips", type=Path, default=Path("data/dataset/hits"))
    parser.add_argument("--output", type=Path, default=Path("data/annotations/clips_dataset.json"))
    parser.add_argument("--label-map", type=str, default="{}",
                        help='JSON folder→class map, e.g. \'{"rede":"forehand_volley"}\'')
    args = parser.parse_args()

    from config import DEFAULT_CONFIG
    from padelpro_vision.detection.detector import build_detector
    from padelpro_vision.pose.estimator import PoseEstimator

    estimator = PoseEstimator(
        config_path=DEFAULT_CONFIG.model.pose_config,
        weights_path=DEFAULT_CONFIG.model.pose_weights,
        device=DEFAULT_CONFIG.model.device,
    )
    if estimator._model is None:
        logger.error(
            "Pose real não disponível (stub geométrico ativo) — instala MMPose e "
            "descarrega os pesos antes de fazer harvest, senão só geras ruído."
        )
        sys.exit(1)
    detector = build_detector(DEFAULT_CONFIG)

    label_map = json.loads(args.label_map)
    samples: list[dict] = []
    skipped_folders: set[str] = set()

    for clip in sorted(args.clips.rglob("*.mp4")):
        folder = clip.parent.name
        if folder.lower() in UNLABELLED_DIRS or clip.parent == args.clips:
            continue
        label = resolve_label(folder, label_map)
        if label is None:
            skipped_folders.add(folder)
            continue
        seq = clip_to_sample(clip, detector, estimator)
        if seq is None:
            logger.warning("Sem pose utilizável em %s — ignorado.", clip.name)
            continue
        samples.append({"label": label, "keypoints_sequence": seq, "source": str(clip)})
        logger.info("%s → %s (%d frames)", clip.name, label, len(seq))

    for folder in sorted(skipped_folders):
        logger.warning(
            "Pasta '%s' não corresponde a nenhuma classe — usa --label-map "
            '\'{"%s": "<classe>"}\' para a incluir.', folder, folder,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(samples, f)
    logger.info("%d amostras → %s", len(samples), args.output)
    logger.info(
        "Treinar: python scripts/train_stroke_classifier.py --data %s", args.output
    )


if __name__ == "__main__":
    main()
