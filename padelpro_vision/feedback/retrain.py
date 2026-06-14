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


MIN_BALL_ANNOTATIONS = 20
MIN_PLAYER_CORRECTIONS = 15


def retrain_ball_detector(
    feedback_dir: Path | str = Path("data/feedback"),
    dataset_dir: Path | str = Path("data/dataset/ball"),
    output_path: Path | str | None = None,
    epochs: int = 15,
) -> dict:
    """
    Fine-tune a lightweight RetinaNet (MobileNetV3) on annotated ball frames.
    Needs ≥ MIN_BALL_ANNOTATIONS annotations that have a saved frame.
    """
    from padelpro_vision.feedback.store import load_all_ball_annotations
    feedback_dir = Path(feedback_dir)
    dataset_dir = Path(dataset_dir)

    if output_path is None:
        from config import ROOT
        output_path = ROOT / "checkpoints" / "ball_detector.pth"
    output_path = Path(output_path)

    annotations = [
        a for a in load_all_ball_annotations(feedback_dir)
        if a.get("frame_path") and (dataset_dir / a["frame_path"]).exists()
    ]

    if len(annotations) < MIN_BALL_ANNOTATIONS:
        return {
            "status": "skipped",
            "detail": f"{len(annotations)} anotações de bola com frame — mínimo {MIN_BALL_ANNOTATIONS}.",
            "n_samples": len(annotations),
        }

    try:
        import torch
        from PIL import Image
        from torch.utils.data import DataLoader, Dataset
        import torchvision.transforms as T
        from torchvision.models.detection import retinanet_mobilenet_v3_large_fpn
        from torchvision.models.detection.retinanet import RetinaNetHead
    except ImportError as e:
        return {"status": "error", "detail": f"Dependência em falta: {e}"}

    class _BallDS(Dataset):
        def __init__(self, anns, base_dir):
            self.anns = anns
            self.base = Path(base_dir)
            self.tfm = T.Compose([T.ToTensor()])

        def __len__(self):
            return len(self.anns)

        def __getitem__(self, idx):
            a = self.anns[idx]
            img = Image.open(self.base / a["frame_path"]).convert("RGB")
            w, h = img.size
            r = a["radius_norm"] * min(w, h)
            cx, cy = a["x_norm"] * w, a["y_norm"] * h
            box = torch.tensor([[
                max(0.0, cx - r), max(0.0, cy - r),
                min(float(w), cx + r), min(float(h), cy + r),
            ]])
            return self.tfm(img), {"boxes": box, "labels": torch.ones(1, dtype=torch.int64)}

    def _collate(b):
        return tuple(zip(*b))

    loader = DataLoader(_BallDS(annotations, dataset_dir), batch_size=4,
                        shuffle=True, collate_fn=_collate, num_workers=0)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = retinanet_mobilenet_v3_large_fpn(weights="DEFAULT")
    num_anchors = model.head.classification_head.num_anchors
    model.head = RetinaNetHead(256, num_anchors, num_classes=2)
    model = model.to(device)

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=5e-5, weight_decay=1e-4
    )
    model.train()
    for epoch in range(epochs):
        total = 0.0
        for imgs, targets in loader:
            imgs = [i.to(device) for i in imgs]
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            loss_dict = model(imgs, targets)
            loss = sum(loss_dict.values())
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += loss.item()
        logger.info("Ball epoch %d/%d loss=%.4f", epoch + 1, epochs, total / max(len(loader), 1))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_state": model.state_dict(), "num_classes": 2, "type": "ball"}, str(output_path))
    return {
        "status": "ok",
        "detail": f"Ball detector treinado com {len(annotations)} frames anotados.",
        "n_samples": len(annotations),
        "weights": str(output_path),
    }


def retrain_player_detector(
    feedback_dir: Path | str = Path("data/feedback"),
    dataset_dir: Path | str = Path("data/dataset/players"),
    output_path: Path | str | None = None,
    epochs: int = 10,
) -> dict:
    """
    Fine-tune Faster R-CNN (MobileNetV3) on player bounding boxes saved from
    corrected-id annotations.  Falls back gracefully when no data is available.
    """
    feedback_dir = Path(feedback_dir)
    dataset_dir = Path(dataset_dir)

    if output_path is None:
        from config import ROOT
        output_path = ROOT / "checkpoints" / "player_detector.pth"
    output_path = Path(output_path)

    # Collect player frame annotations
    player_files = list(feedback_dir.glob("*_player_ids.json"))
    all_pid = []
    for p in player_files:
        with open(p) as f:
            all_pid.extend(json.load(f))

    if len(all_pid) < MIN_PLAYER_CORRECTIONS:
        return {
            "status": "skipped",
            "detail": f"{len(all_pid)} correções de ID de jogador — mínimo {MIN_PLAYER_CORRECTIONS}.",
            "n_samples": len(all_pid),
        }

    # If no saved frames, just report the corrections are saved (useful for analysis)
    frame_files = list(dataset_dir.glob("*.jpg")) if dataset_dir.exists() else []
    if not frame_files:
        return {
            "status": "skipped",
            "detail": f"{len(all_pid)} correções guardadas, mas sem frames de jogadores para treino. "
                      "Os frames são guardados automaticamente na anotação de bola.",
            "n_samples": len(all_pid),
        }

    try:
        import torch
        from PIL import Image
        from torch.utils.data import DataLoader, Dataset
        import torchvision.transforms as T
        from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn
        from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
    except ImportError as e:
        return {"status": "error", "detail": f"Dependência em falta: {e}"}

    # Use whatever frame files we have as positive examples (person class = 1)
    class _PlayerDS(Dataset):
        def __init__(self, files):
            self.files = files
            self.tfm = T.Compose([T.ToTensor()])

        def __len__(self):
            return len(self.files)

        def __getitem__(self, idx):
            img = Image.open(self.files[idx]).convert("RGB")
            w, h = img.size
            # Full-frame box as weak label (real boxes need bbox annotator)
            box = torch.tensor([[0.0, 0.0, float(w), float(h)]])
            return self.tfm(img), {"boxes": box, "labels": torch.ones(1, dtype=torch.int64)}

    def _collate(b):
        return tuple(zip(*b))

    loader = DataLoader(_PlayerDS(frame_files[:200]), batch_size=2,
                        shuffle=True, collate_fn=_collate, num_workers=0)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = fasterrcnn_mobilenet_v3_large_fpn(weights="DEFAULT")
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, 2)
    model = model.to(device)

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=5e-5
    )
    model.train()
    for epoch in range(epochs):
        total = 0.0
        for imgs, targets in loader:
            imgs = [i.to(device) for i in imgs]
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            loss_dict = model(imgs, targets)
            loss = sum(loss_dict.values())
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += loss.item()
        logger.info("Player epoch %d/%d loss=%.4f", epoch + 1, epochs, total / max(len(loader), 1))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_state": model.state_dict(), "num_classes": 2, "type": "player"}, str(output_path))
    return {
        "status": "ok",
        "detail": f"Player detector treinado com {len(frame_files)} frames.",
        "n_samples": len(frame_files),
        "weights": str(output_path),
    }
