"""
Retrain the TCN stroke classifier from the accumulated feedback dataset.

Called from the API after a review submission (background task) or manually:

    python -c "from padelpro_vision.feedback.retrain import retrain_from_feedback; \\
               print(retrain_from_feedback())"

The new checkpoint lands in checkpoints/stroke_tcn.pth (+ .meta.json), which
the pipeline picks up automatically on the next run.
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MIN_SAMPLES_TO_TRAIN = 40   # below this the TCN just memorises noise
MIN_CLASSES = 2


def retrain_from_feedback(
    feedback_dir: Path | str = Path("data/feedback"),
    base_dataset: Path | str | None = Path("data/annotations/strokes_coco.json"),
    output_path: Path | str | None = None,
    epochs: int = 50,
    feature_mode: str = "posvel",
) -> dict:
    """
    Merge feedback samples with the base dataset (if any) and retrain.
    Returns a status dict: {"status": "ok"|"skipped"|"error", "detail": ...}.
    """
    feedback_dir = Path(feedback_dir)
    if output_path is None:
        from config import ROOT
        output_path = ROOT / "checkpoints" / "stroke_tcn.pth"
    output_path = Path(output_path)

    samples: list[dict] = []
    fb_path = feedback_dir / "training_data.json"
    if fb_path.exists():
        with open(fb_path) as f:
            samples.extend(json.load(f))
    n_feedback = len(samples)

    if base_dataset is not None and Path(base_dataset).exists():
        with open(base_dataset) as f:
            samples.extend(json.load(f))

    labels = {s["label"] for s in samples}
    if len(samples) < MIN_SAMPLES_TO_TRAIN or len(labels) < MIN_CLASSES:
        detail = (
            f"{len(samples)} amostras ({n_feedback} de feedback), "
            f"{len(labels)} classes — mínimo {MIN_SAMPLES_TO_TRAIN} amostras "
            f"e {MIN_CLASSES} classes. Continua a corrigir análises."
        )
        logger.info("Retrain skipped: %s", detail)
        return {"status": "skipped", "detail": detail, "n_samples": len(samples)}

    try:
        import torch  # noqa: F401
    except ImportError:
        return {"status": "error", "detail": "PyTorch não instalado no servidor."}

    # Write the merged dataset and reuse the canonical training script logic.
    merged_path = feedback_dir / "_merged_train.json"
    with open(merged_path, "w") as f:
        json.dump(samples, f)

    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from scripts.train_stroke_classifier import train
        train(merged_path, epochs=epochs, output_path=output_path,
              feature_mode=feature_mode)
    except SystemExit as exc:
        return {"status": "error", "detail": f"Treino abortado (exit {exc.code})."}
    except Exception as exc:
        logger.exception("Retrain failed")
        return {"status": "error", "detail": str(exc)}
    finally:
        merged_path.unlink(missing_ok=True)

    metrics_path = output_path.with_suffix(output_path.suffix + ".metrics.json")
    metrics = None
    if metrics_path.exists():
        with open(metrics_path) as f:
            metrics = json.load(f)

    return {
        "status": "ok",
        "detail": f"Modelo treinado com {len(samples)} amostras "
                  f"({n_feedback} de feedback).",
        "n_samples": len(samples),
        "weights": str(output_path),
        "metrics": metrics,
    }
