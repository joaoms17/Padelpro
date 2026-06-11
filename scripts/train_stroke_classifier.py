"""
Train the TCN stroke classifier from annotated pose sequences.

Supports annotations in PadelTracker100 format (CC BY 4.0 — commercial OK with attribution).
PadelTracker100: https://github.com/Joao-M-Silva/padel_analytics  (check dataset README for download)
Attribution required: "PadelTracker100 dataset by Joao M. Silva, CC BY 4.0"

Usage:
    python scripts/train_stroke_classifier.py \
        --data data/annotations/strokes_coco.json \
        --epochs 50 \
        --output checkpoints/stroke_tcn.pth

Annotation format (JSON list):
    [
      {
        "label": "smash",
        "keypoints_sequence": [[[x0,y0], [x1,y1], ...], ...]  # list of 17-kp frames
      },
      ...
    ]
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
logger = logging.getLogger(__name__)


def load_dataset(data_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Load annotations → (X: N×34×T float32, y: N int64)."""
    from padelpro_vision.strokes.classifier import STROKE_CLASSES, WINDOW_SIZE
    label_to_idx = {s: i for i, s in enumerate(STROKE_CLASSES)}

    with open(data_path) as f:
        samples = json.load(f)

    X_list, y_list = [], []
    for s in samples:
        label = s["label"]
        if label not in label_to_idx:
            logger.warning("Unknown label '%s' — skipped.", label)
            continue
        seq = np.array(s["keypoints_sequence"], dtype=np.float32)  # (T, 17, 2)
        if len(seq) < 2:
            continue
        # Pad or trim to WINDOW_SIZE
        T = WINDOW_SIZE
        if len(seq) < T:
            pad = np.zeros((T - len(seq), 17, 2), dtype=np.float32)
            seq = np.concatenate([pad, seq], axis=0)
        else:
            seq = seq[-T:]
        feat = seq.reshape(T, -1).T   # (34, T)
        X_list.append(feat)
        y_list.append(label_to_idx[label])

    X = np.stack(X_list, axis=0)  # (N, 34, T)
    y = np.array(y_list, dtype=np.int64)
    return X, y


def train(data_path: Path, epochs: int, output_path: Path, lr: float = 1e-3) -> None:
    try:
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset
    except ImportError:
        logger.error("PyTorch not installed. Run: pip install torch")
        sys.exit(1)

    from padelpro_vision.strokes.classifier import STROKE_CLASSES, _build_tcn_model, FEATURE_DIM

    X, y = load_dataset(data_path)
    logger.info("Dataset: %d samples, %d classes", len(X), len(STROKE_CLASSES))

    X_t = torch.tensor(X, dtype=torch.float32)
    y_t = torch.tensor(y, dtype=torch.long)

    # 80/20 train/val split
    n_val = max(1, int(0.2 * len(X_t)))
    X_train, X_val = X_t[n_val:], X_t[:n_val]
    y_train, y_val = y_t[n_val:], y_t[:n_val]

    train_loader = DataLoader(TensorDataset(X_train, y_train), batch_size=32, shuffle=True)
    val_loader   = DataLoader(TensorDataset(X_val,   y_val),   batch_size=32)

    model = _build_tcn_model(len(STROKE_CLASSES), FEATURE_DIM)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    for epoch in range(1, epochs + 1):
        model.train()
        for xb, yb in train_loader:
            optimiser.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimiser.step()

        model.eval()
        correct = total = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                preds = model(xb).argmax(dim=-1)
                correct += (preds == yb).sum().item()
                total   += len(yb)
        val_acc = correct / max(1, total)

        if epoch % 10 == 0 or epoch == epochs:
            logger.info("Epoch %d/%d  val_acc=%.3f", epoch, epochs, val_acc)

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            output_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), output_path)

    logger.info("Training done. Best val_acc=%.3f | Saved to %s", best_val_acc, output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train TCN stroke classifier.")
    parser.add_argument("--data",    required=True, type=Path, help="Annotations JSON path.")
    parser.add_argument("--epochs",  type=int, default=50)
    parser.add_argument("--lr",      type=float, default=1e-3)
    parser.add_argument("--output",  type=Path, default=Path("checkpoints/stroke_tcn.pth"))
    args = parser.parse_args()

    if not args.data.exists():
        logger.error("Data file not found: %s", args.data)
        sys.exit(1)

    train(args.data, args.epochs, args.output, args.lr)


if __name__ == "__main__":
    main()
