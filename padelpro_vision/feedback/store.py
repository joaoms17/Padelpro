"""
Feedback store: corrections submitted from the review page become training
labels for the stroke classifier and golden-set hits for evaluation.

Each correction refers to one detected (or missed) stroke:

    verdict = "correct"     prediction confirmed             → training label
    verdict = "wrong_class" stroke, but another type         → training label
    verdict = "not_a_shot"  false positive                   → trains "other"
    verdict = "missed"      hit the model didn't see (added in the UI)
                            → golden-set hit (no pose window to train on)

Layout on disk:
    data/feedback/{rid}.json            corrections per match/job
    data/feedback/training_data.json    accumulated TCN training samples
"""

from __future__ import annotations
import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

VERDICTS = ("correct", "wrong_class", "not_a_shot", "missed")


@dataclass
class Correction:
    ts_ms: float
    player_id: int
    verdict: str                       # one of VERDICTS
    predicted_type: str | None = None
    corrected_type: str | None = None  # required for wrong_class and missed
    frame_idx: int | None = None       # links to the saved pose window

    def final_label(self) -> str | None:
        """The training label this correction yields, or None if untrainable."""
        if self.verdict == "correct":
            return self.predicted_type
        if self.verdict == "wrong_class":
            return self.corrected_type
        if self.verdict == "not_a_shot":
            return "other"
        return None   # "missed": no pose window was captured for it


def save_corrections(rid: str, corrections: list[Correction], feedback_dir: Path) -> Path:
    feedback_dir = Path(feedback_dir)
    feedback_dir.mkdir(parents=True, exist_ok=True)
    path = feedback_dir / f"{rid}.json"
    with open(path, "w") as f:
        json.dump([asdict(c) for c in corrections], f, indent=2)
    logger.info("Saved %d corrections for '%s' → %s", len(corrections), rid, path)
    return path


def load_corrections(rid: str, feedback_dir: Path) -> list[Correction]:
    path = Path(feedback_dir) / f"{rid}.json"
    if not path.exists():
        return []
    with open(path) as f:
        return [Correction(**d) for d in json.load(f)]


def build_training_samples(
    corrections: list[Correction],
    pose_windows: dict[str, list],
) -> list[dict]:
    """
    Join corrections with the pose windows the pipeline saved. Returns samples
    in the train_stroke_classifier.py format:
        {"label": str, "keypoints_sequence": [[ [x,y] x17 ] x T]}
    """
    samples: list[dict] = []
    for c in corrections:
        label = c.final_label()
        if label is None or c.frame_idx is None:
            continue
        window = pose_windows.get(f"{c.player_id}:{c.frame_idx}")
        if not window or len(window) < 2:
            continue
        samples.append({
            "label": label,
            "keypoints_sequence": window,
            "source": "feedback",
        })
    return samples


def append_training_samples(samples: list[dict], rid: str, feedback_dir: Path) -> int:
    """
    Merge new samples into the accumulated dataset. Samples from the same rid
    are replaced (re-submitting a review must not duplicate labels).
    """
    feedback_dir = Path(feedback_dir)
    feedback_dir.mkdir(parents=True, exist_ok=True)
    path = feedback_dir / "training_data.json"
    existing: list[dict] = []
    if path.exists():
        with open(path) as f:
            existing = json.load(f)
    existing = [s for s in existing if s.get("rid") != rid]
    for s in samples:
        s["rid"] = rid
    existing.extend(samples)
    with open(path, "w") as f:
        json.dump(existing, f)
    logger.info("Training dataset: %d samples total (%d from '%s').",
                len(existing), len(samples), rid)
    return len(existing)


def corrections_to_golden_hits(corrections: list[Correction]) -> list[dict]:
    """
    Build golden-set "hits" from corrections: every confirmed/corrected/missed
    stroke is ground truth usable by scripts/evaluate.py.
    """
    hits: list[dict] = []
    for c in corrections:
        if c.verdict == "not_a_shot":
            continue
        label = c.corrected_type if c.verdict in ("wrong_class", "missed") else c.predicted_type
        hit: dict = {"ts_ms": c.ts_ms, "player": str(c.player_id)}
        if label and label != "other":
            hit["stroke_type"] = label
        hits.append(hit)
    return hits
