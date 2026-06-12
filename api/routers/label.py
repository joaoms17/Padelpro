"""
Clip labelling endpoints — sort extracted hit clips into classes from the
browser instead of moving files between folders by hand.

Layout (root configurable via PADELPRO_HITS_DIR, default data/dataset/hits):

    data/dataset/hits/
        por_classificar/clip_0001.mp4    ← unlabelled queue
        smash/clip_0002.mp4              ← folder name = label
        bandeja/…

Labelling a clip MOVES the file into the label's folder, so the directory
tree IS the dataset — compatible with whatever extraction script produced
the clips, and trivially exportable to any training pipeline.
"""

from __future__ import annotations
import logging
import os
import random
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/label", tags=["label"])
logger = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"^[\w\-. ]+\.(mp4|webm|mov)$", re.IGNORECASE)
_SAFE_LABEL = re.compile(r"^[\w\-]+$")

# Folder names treated as "still to label"
_UNLABELLED = {"por_classificar", "unsorted", "unlabeled", "unlabelled", ""}


def _root() -> Path:
    return Path(os.environ.get("PADELPRO_HITS_DIR", "data/dataset/hits"))


def _default_labels() -> list[str]:
    from padelpro_vision.strokes.classifier import STROKE_CLASSES
    return [c for c in STROKE_CLASSES if c != "other"]


class LabelIn(BaseModel):
    label: str


def _scan(root: Path) -> list[dict]:
    """All clips under root: [{name, label|None, rel}]."""
    clips: list[dict] = []
    if not root.exists():
        return clips
    for path in sorted(root.rglob("*")):
        if not path.is_file() or not _SAFE_NAME.match(path.name):
            continue
        folder = path.parent.relative_to(root).as_posix() if path.parent != root else ""
        label = None if folder.lower() in _UNLABELLED else folder
        clips.append({"name": path.name, "label": label})
    return clips


def _find(root: Path, name: str) -> Path | None:
    if not _SAFE_NAME.match(name):
        return None
    for path in root.rglob(name):
        if path.is_file():
            return path
    return None


@router.get("/queue")
async def get_queue():
    """Clips to label (unlabelled first), available labels, per-label counts."""
    root = _root()
    clips = _scan(root)
    existing_labels = sorted({c["label"] for c in clips if c["label"]})
    labels = sorted(set(existing_labels) | set(_default_labels()))

    counts: dict[str, int] = {}
    for c in clips:
        key = c["label"] or "por_classificar"
        counts[key] = counts.get(key, 0) + 1

    # Unlabelled first, in random order per request: several validators
    # working at once start on different clips instead of colliding.
    unlabelled = [c for c in clips if c["label"] is None]
    labelled = sorted((c for c in clips if c["label"]), key=lambda c: c["name"])
    random.shuffle(unlabelled)
    clips = unlabelled + labelled
    return {
        "root": str(root),
        "labels": labels,
        "clips": clips,
        "counts": counts,
        "n_unlabelled": sum(1 for c in clips if c["label"] is None),
    }


@router.get("/clip/{name}")
async def stream_clip(name: str, request: Request):
    path = _find(_root(), name)
    if path is None:
        raise HTTPException(status_code=404, detail="Clip não encontrado.")
    from api.streaming import range_stream_response
    return range_stream_response(path, request)


@router.post("/clip/{name}")
async def label_clip(name: str, body: LabelIn):
    """Move a clip into its label folder (the labelling action itself)."""
    label = body.label.strip().lower()
    if not _SAFE_LABEL.match(label):
        raise HTTPException(status_code=400, detail=f"Label inválida: '{body.label}'")

    root = _root()
    path = _find(root, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Clip não encontrado.")

    dest_dir = root / label
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    if dest == path:
        return {"name": name, "label": label, "moved": False}
    shutil.move(str(path), str(dest))
    logger.info("Labelled %s → %s", name, label)
    return {"name": name, "label": label, "moved": True}
