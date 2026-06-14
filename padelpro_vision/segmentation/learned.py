"""
Learned segmentation: logistic regression on per-second audio+motion features,
trained from Gemini rally annotations. Replaces fixed enter/exit thresholds.

Checkpoint: checkpoints/segmentation_clf.pkl
- Does not exist → fall back to fixed thresholds (no change to existing behaviour)
- Exists → get_active_segments() uses classifier probability as play_score

To retrain manually:
    from padelpro_vision.segmentation.learned import train_from_rallies
    train_from_rallies("path/to/video.mp4", rallies_list)
"""
from __future__ import annotations
import logging
import pickle
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)
_CLF_PATH = Path("checkpoints/segmentation_clf.pkl")


def load_classifier():
    """Return the saved LogisticRegression or None."""
    if not _CLF_PATH.exists():
        return None
    try:
        with open(_CLF_PATH, "rb") as f:
            clf = pickle.load(f)
        logger.debug("Segmentation classifier loaded from %s", _CLF_PATH)
        return clf
    except Exception as exc:
        logger.warning("Could not load segmentation classifier: %s", exc)
        return None


def _build_features(audio_energy: np.ndarray | None, motion_energy: np.ndarray) -> np.ndarray:
    """Build (n, 5) feature matrix: audio, motion, combined, Δaudio, Δmotion."""
    n = len(motion_energy)
    me = np.clip(motion_energy[:n], 0.0, 1.0)
    if audio_energy is not None and len(audio_energy) > 0:
        ae_raw = audio_energy
        ae = np.zeros(n, dtype=np.float32)
        m = min(n, len(ae_raw))
        ae[:m] = ae_raw[:m]
    else:
        ae = np.zeros(n, dtype=np.float32)
    combo = 0.5 * ae + 0.5 * me
    d_ae = np.diff(ae, prepend=ae[:1])
    d_me = np.diff(me, prepend=me[:1])
    return np.column_stack([ae, me, combo, d_ae, d_me]).astype(np.float32)


def predict_play_score(clf, audio_energy: np.ndarray | None, motion_energy: np.ndarray) -> np.ndarray:
    """Return per-second P(rally) from the classifier."""
    features = _build_features(audio_energy, motion_energy)
    proba = clf.predict_proba(features)
    return proba[:, 1].astype(np.float32)


def train_from_rallies(video_path, rallies: list[dict]) -> bool:
    """Train/update the segmentation classifier from Gemini rally boundaries.

    Returns True on success, False if training was skipped (too few samples,
    sklearn missing, etc.).
    """
    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        logger.warning("sklearn not installed — segmentation classifier training skipped.")
        return False

    if len(rallies) < 3:
        logger.info("Too few rallies (%d) to train segmentation classifier.", len(rallies))
        return False

    try:
        # Import lazily to avoid circular imports
        from padelpro_vision.segmentation.segmentation import (
            _extract_audio_wav, _audio_energy_per_second, _motion_energy_per_second,
        )
        import tempfile
        from pathlib import Path as _Path

        vpath = _Path(video_path)
        with tempfile.TemporaryDirectory() as tmp:
            wav = _Path(tmp) / "audio.wav"
            has_audio = _extract_audio_wav(vpath, wav)
            audio_energy = _audio_energy_per_second(wav) if has_audio and wav.exists() else None

        motion_energy = _motion_energy_per_second(vpath)
        n = len(motion_energy)

        # Build labels (1 = rally, 0 = break)
        labels = np.zeros(n, dtype=np.int32)
        for r in rallies:
            s = max(0, int(float(r.get("start_s", 0))))
            e = min(n, int(float(r.get("end_s", 0))) + 1)
            if e > s:
                labels[s:e] = 1

        n_rally = int(labels.sum())
        n_break = int((labels == 0).sum())
        if n_rally < 5 or n_break < 5:
            logger.info("Not enough labelled samples (rally=%d, break=%d) — skipping.", n_rally, n_break)
            return False

        features = _build_features(audio_energy, motion_energy)
        clf = LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced")
        clf.fit(features, labels)

        _CLF_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_CLF_PATH, "wb") as f:
            pickle.dump(clf, f)

        logger.info(
            "Segmentation classifier trained: %d rallies, %.0f%% rally time. Saved to %s",
            len(rallies), 100.0 * n_rally / n, _CLF_PATH,
        )
        return True

    except Exception as exc:
        logger.exception("Segmentation classifier training failed: %s", exc)
        return False
