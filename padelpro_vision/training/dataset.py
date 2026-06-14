"""
Training-data accounting and model-progression levels.

The product turns every annotation the user makes into progress towards training
OUR OWN models (ball detector, player detector, stroke classifier) — instead of
depending on Gemini forever. This module counts the accumulated labels and maps
them to levels 1-5 so the UI can show a clear "how far am I" picture and what is
still needed for the next level.

Counts are read from the same on-disk layout the annotation/feedback pipeline
already writes (data/feedback + data/dataset), so nothing here duplicates state.
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Images/labels required to reach level 1..5 (index 0 → level 1).
LEVEL_THRESHOLDS = [20, 50, 100, 250, 500]
MAX_LEVEL = len(LEVEL_THRESHOLDS)

_FEEDBACK_DIR = Path("data/feedback")
_BALL_DIR = Path("data/dataset/ball")
_PLAYER_DIR = Path("data/dataset/players")
_FRAMES_DIR = Path("data/dataset/match_frames")

# Minimums each model needs before a (meaningful) training run is worthwhile.
# Kept in sync with padelpro_vision.feedback.retrain.
MIN_TO_TRAIN = {"ball": 20, "player": 15, "stroke": 40}

TRACK_LABELS = {
    "ball": "Detetor de bola",
    "player": "Detetor de jogadores",
    "stroke": "Classificador de pancadas",
}


def level_for(count: int) -> int:
    """Highest level (0..5) whose threshold the count has reached."""
    level = 0
    for threshold in LEVEL_THRESHOLDS:
        if count >= threshold:
            level += 1
        else:
            break
    return level


def next_threshold(count: int) -> int | None:
    """The count needed for the next level, or None once max level is reached."""
    for threshold in LEVEL_THRESHOLDS:
        if count < threshold:
            return threshold
    return None


def _count_ball(feedback_dir: Path, ball_dir: Path) -> int:
    """Ball annotations that have a saved frame on disk (usable for training)."""
    n = 0
    for p in feedback_dir.glob("*_ball.json"):
        try:
            with open(p) as f:
                items = json.load(f)
        except Exception:
            continue
        for a in items:
            fp = a.get("frame_path")
            if fp and (ball_dir / fp).exists():
                n += 1
    return n


def _count_player(feedback_dir: Path, player_dir: Path) -> int:
    """Player-id corrections collected from review/annotation."""
    n = 0
    for p in feedback_dir.glob("*_player_ids.json"):
        try:
            with open(p) as f:
                n += len(json.load(f))
        except Exception:
            continue
    return n


def _count_stroke(feedback_dir: Path) -> int:
    """Accumulated stroke training samples (from review corrections)."""
    p = feedback_dir / "training_data.json"
    if not p.exists():
        return 0
    try:
        with open(p) as f:
            return len(json.load(f))
    except Exception:
        return 0


def _count_match_frames(frames_dir: Path) -> int:
    """Confirmed key-frame images contributed from full-match reports."""
    if not frames_dir.exists():
        return 0
    return sum(1 for _ in frames_dir.rglob("*.jpg"))


def _track(key: str, count: int) -> dict:
    return {
        "key": key,
        "label": TRACK_LABELS.get(key, key),
        "count": count,
        "level": level_for(count),
        "max_level": MAX_LEVEL,
        "next_at": next_threshold(count),
        "min_to_train": MIN_TO_TRAIN.get(key),
        "can_train": count >= MIN_TO_TRAIN.get(key, 1_000_000),
        "thresholds": LEVEL_THRESHOLDS,
    }


def count_dataset(
    feedback_dir: Path | str = _FEEDBACK_DIR,
    ball_dir: Path | str = _BALL_DIR,
    player_dir: Path | str = _PLAYER_DIR,
    frames_dir: Path | str = _FRAMES_DIR,
) -> dict:
    """Return per-track counts, levels and the overall progression summary."""
    feedback_dir = Path(feedback_dir)
    ball_dir = Path(ball_dir)
    player_dir = Path(player_dir)
    frames_dir = Path(frames_dir)

    ball = _count_ball(feedback_dir, ball_dir) if feedback_dir.exists() else 0
    player = _count_player(feedback_dir, player_dir) if feedback_dir.exists() else 0
    stroke = _count_stroke(feedback_dir) if feedback_dir.exists() else 0
    match_frames = _count_match_frames(frames_dir)

    tracks = [_track("ball", ball), _track("player", player), _track("stroke", stroke)]
    total_images = ball + match_frames
    overall_count = ball + player + stroke + match_frames

    return {
        "tracks": tracks,
        "total_images": total_images,
        "match_frames": match_frames,
        "overall_count": overall_count,
        "overall_level": level_for(overall_count),
        "max_level": MAX_LEVEL,
        "overall_next_at": next_threshold(overall_count),
        "thresholds": LEVEL_THRESHOLDS,
    }
