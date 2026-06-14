#!/usr/bin/env bash
# Train the TCN stroke classifier from PadelTracker100 dataset.
# Requires: pip install -e . first
# Dataset: download from https://zenodo.org/record/XXXXXXXX and unzip to ~/Downloads/padeltracker100/
set -e

DATASET_DIR="${1:-$HOME/Downloads/padeltracker100}"
OUTPUT_JSON="data/annotations/padeltracker100.json"
CHECKPOINT="checkpoints/stroke_tcn.pth"

if [ ! -d "$DATASET_DIR" ]; then
  echo "Dataset not found at $DATASET_DIR"
  echo "Download from https://zenodo.org and pass the path as first argument:"
  echo "  $0 /path/to/padeltracker100"
  exit 1
fi

mkdir -p data/annotations checkpoints

echo "==> Inspecting dataset structure..."
python scripts/convert_padeltracker100.py "$DATASET_DIR" --inspect

echo "==> Converting to TCN training format..."
python scripts/convert_padeltracker100.py "$DATASET_DIR" --output "$OUTPUT_JSON"

echo "==> Training TCN stroke classifier..."
python scripts/train_stroke_classifier.py \
  --data "$OUTPUT_JSON" \
  --epochs 80 \
  --output "$CHECKPOINT"

echo "Done. Checkpoint saved to $CHECKPOINT"
echo "  The pipeline will auto-load it on next analysis run."
