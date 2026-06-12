"""End-to-end training tests — exercises the exact path behind the
'Retreinar modelo' button with real PyTorch: train → checkpoint + sidecars →
load in StrokeClassifier → classify.

Skipped automatically when torch isn't installed.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

torch = pytest.importorskip("torch")


def _synthetic_samples(n_per_class: int = 30) -> list[dict]:
    """Two separable classes: 'smash' has a fast-rising wrist, 'serve' is flat."""
    rng = np.random.default_rng(42)
    samples = []
    for label, motion in (("smash", 0.5), ("serve", 0.0)):
        for _ in range(n_per_class):
            seq = rng.normal(0.5, 0.05, size=(16, 17, 2)).astype(float)
            seq[:, 10, 1] -= motion * np.linspace(0, 1, 16)[:, None][:, 0]  # right wrist rises
            samples.append({"label": label, "keypoints_sequence": seq.tolist()})
    return samples


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    """Train once for the whole module (a few seconds on CPU)."""
    from scripts.train_stroke_classifier import train
    tmp = tmp_path_factory.mktemp("train")
    data_path = tmp / "data.json"
    with open(data_path, "w") as f:
        json.dump(_synthetic_samples(), f)
    out = tmp / "stroke_tcn.pth"
    train(data_path, epochs=3, output_path=out, feature_mode="posvel")
    return out


def test_train_writes_checkpoint_and_sidecars(trained):
    assert trained.exists()
    meta = json.loads(trained.with_suffix(".pth.meta.json").read_text())
    assert meta["feature_mode"] == "posvel"
    assert "smash" in meta["classes"]
    metrics = json.loads(trained.with_suffix(".pth.metrics.json").read_text())
    assert "confusion_matrix" in metrics
    assert "per_class" in metrics
    assert 0.0 <= metrics["accuracy"] <= 1.0


def test_classifier_loads_and_classifies(trained):
    from padelpro_vision.detection.detector import PlayerBox
    from padelpro_vision.pose.estimator import PoseEstimator
    from padelpro_vision.strokes.classifier import StrokeClassifier, STROKE_CLASSES

    clf = StrokeClassifier(mode="tcn", weights_path=trained)
    assert clf.mode == "tcn", "must NOT fall back to rules with valid weights"
    assert clf.feature_mode == "posvel", "sidecar metadata must win"

    est = PoseEstimator()  # stub poses are fine — we only need a forward pass
    box = PlayerBox(0.0, 0.0, 100.0, 200.0, 0.9)
    for _ in range(16):
        clf.update(track_id=1, pose=est._stub_pose(box))
    stroke, conf = clf.classify(track_id=1)
    assert stroke in STROKE_CLASSES
    assert 0.0 <= conf <= 1.0


def test_retrain_from_feedback_full_path(tmp_path):
    """The exact function behind POST /review/{rid}/retrain."""
    from padelpro_vision.feedback.retrain import retrain_from_feedback

    feedback_dir = tmp_path / "feedback"
    feedback_dir.mkdir()
    with open(feedback_dir / "training_data.json", "w") as f:
        json.dump(_synthetic_samples(n_per_class=25), f)

    out = tmp_path / "checkpoints" / "stroke_tcn.pth"
    result = retrain_from_feedback(
        feedback_dir=feedback_dir,
        base_dataset=None,
        output_path=out,
        epochs=2,
    )
    assert result["status"] == "ok", result
    assert out.exists()
    assert result["metrics"] is not None
    assert result["n_samples"] == 50
    # The merged temp dataset must not linger
    assert not (feedback_dir / "_merged_train.json").exists()
