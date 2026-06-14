"""
Model-progression endpoints: how close are we to training OUR OWN models, and a
way to check/test them against Gemini.

The goal of the whole product loop is to graduate from Gemini (per-match cost,
runs in the cloud) to our own models trained from the labels users confirm. This
router exposes the accumulated dataset as levels (1-5) plus the readiness of any
trained checkpoint, so the UI can gamify "build a better model than Gemini".
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/training", tags=["training"])
logger = logging.getLogger(__name__)

_CHECKPOINTS = Path("checkpoints")
_CHECKPOINT_FILES = {
    "ball": "ball_detector.pth",
    "player": "player_detector.pth",
    "stroke": "stroke_tcn.pth",
}


@router.get("/status")
async def training_status():
    """Per-track annotation counts mapped to levels 1-5, plus trained-model state."""
    from padelpro_vision.training.dataset import count_dataset

    data = count_dataset()
    models = _trained_models()

    # Attach trained-model info to each track.
    for track in data["tracks"]:
        track["model"] = models.get(track["key"], {"trained": False})
    data["models"] = models
    return data


@router.get("/test")
async def training_test():
    """Report which of our own models exist and whether they can be tested
    against Gemini yet. Honest about readiness — real inference comparison needs
    a trained checkpoint and a GPU worker (Modal)."""
    from padelpro_vision.training.dataset import count_dataset, MIN_TO_TRAIN

    models = _trained_models()
    data = count_dataset()
    results = []
    for track in data["tracks"]:
        key = track["key"]
        model = models.get(key, {"trained": False})
        min_needed = MIN_TO_TRAIN.get(key, 0)
        if model.get("trained"):
            status = "ready"
            message = "Modelo treinado — pronto para comparar com o Gemini."
        elif track["count"] >= min_needed:
            status = "trainable"
            message = f"Tens {track['count']} amostras (mínimo {min_needed}). Treina o modelo para o poderes testar."
        else:
            status = "collecting"
            message = f"Faltam {min_needed - track['count']} amostras para poderes treinar este modelo."
        results.append({
            "key": key,
            "label": track["label"],
            "status": status,
            "message": message,
            "count": track["count"],
            "min_to_train": min_needed,
            "trained": model.get("trained", False),
        })
    return {"results": results}


def _trained_models() -> dict:
    """Look for trained checkpoints on disk and read their metadata if present."""
    out: dict[str, dict] = {}
    for key, fname in _CHECKPOINT_FILES.items():
        path = _CHECKPOINTS / fname
        info: dict = {"trained": path.exists()}
        if path.exists():
            info["weights"] = str(path)
            for meta_name in (f"{fname}.metrics.json", f"{fname}.meta.json"):
                meta = _CHECKPOINTS / meta_name
                if meta.exists():
                    try:
                        with open(meta) as f:
                            info["metrics"] = json.load(f)
                    except Exception:
                        pass
                    break
        out[key] = info
    return out
