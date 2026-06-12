"""
Lightweight player re-identification: keep "Jogador 1–4" stable for the
whole match even when tracking loses someone behind a partner or the glass.

How it works (no learned model needed for a V1):
  1. During the pipeline loop, accumulate an HSV colour histogram of each
     track's torso (shirt colour is the strongest cheap cue on a padel court).
  2. After the loop, merge fragmented tracks: two track IDs are the same
     player when their time ranges don't overlap, their shirt histograms
     match, and the player could plausibly cover the gap between where one
     track ended and the other began.

Fragmented tracks split a player's stats across phantom IDs — merging them
is what keeps per-player distance/zones/strokes honest.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Histogram: hue × saturation (value channel dropped — lighting invariance)
_H_BINS = 16
_S_BINS = 8

# Merge thresholds
SIMILARITY_THRESHOLD = 0.80     # cosine similarity of shirt histograms
MAX_GAP_SPEED_MS = 6.0          # player can't cover the gap faster than this
MIN_SAMPLES = 5                 # ignore tracks with fewer histogram samples


def torso_histogram(frame: np.ndarray, box) -> np.ndarray | None:
    """
    Normalised HSV histogram of the torso region (upper half of the bbox,
    central 60% width — avoids arms/background). Returns (H_BINS*S_BINS,)
    or None when the crop is degenerate.
    """
    h, w = frame.shape[:2]
    x1 = int(max(0, box.x1 + 0.2 * box.width))
    x2 = int(min(w, box.x2 - 0.2 * box.width))
    y1 = int(max(0, box.y1 + 0.15 * box.height))
    y2 = int(min(h, box.y1 + 0.55 * box.height))
    if x2 - x1 < 4 or y2 - y1 < 4:
        return None
    crop = frame[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [_H_BINS, _S_BINS],
                        [0, 180, 0, 256]).flatten()
    total = hist.sum()
    if total <= 0:
        return None
    return (hist / total).astype(np.float32)


@dataclass
class TrackAppearance:
    """Accumulated appearance + spatio-temporal extent of one track ID."""
    track_id: int
    hist_sum: np.ndarray = field(default_factory=lambda: np.zeros(_H_BINS * _S_BINS, np.float64))
    n_samples: int = 0
    first_ms: float = float("inf")
    last_ms: float = float("-inf")
    first_pos: tuple[float, float] | None = None   # pixel foot point
    last_pos: tuple[float, float] | None = None

    def add(self, hist: np.ndarray, ts_ms: float, pos: tuple[float, float]) -> None:
        self.hist_sum += hist
        self.n_samples += 1
        if ts_ms < self.first_ms:
            self.first_ms = ts_ms
            self.first_pos = pos
        if ts_ms > self.last_ms:
            self.last_ms = ts_ms
            self.last_pos = pos

    @property
    def mean_hist(self) -> np.ndarray:
        return (self.hist_sum / max(1, self.n_samples)).astype(np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na <= 0 or nb <= 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _can_merge(a: TrackAppearance, b: TrackAppearance,
               px_per_m: float | None) -> bool:
    """b starts after a ends; shirts match; gap physically coverable."""
    if b.first_ms < a.last_ms:          # time overlap → different people
        return False
    if a.n_samples < MIN_SAMPLES or b.n_samples < MIN_SAMPLES:
        return False
    if _cosine(a.mean_hist, b.mean_hist) < SIMILARITY_THRESHOLD:
        return False
    # Plausibility of covering the gap (only when we can convert px → m)
    if px_per_m and a.last_pos and b.first_pos:
        gap_s = max(0.1, (b.first_ms - a.last_ms) / 1000.0)
        dist_m = float(np.hypot(b.first_pos[0] - a.last_pos[0],
                                b.first_pos[1] - a.last_pos[1])) / px_per_m
        if dist_m / gap_s > MAX_GAP_SPEED_MS:
            return False
    return True


def merge_fragmented_tracks(
    appearances: dict[int, TrackAppearance],
    px_per_m: float | None = None,
) -> dict[int, int]:
    """
    Compute {old_track_id: canonical_track_id}. Tracks are processed in
    start-time order; each new fragment is greedily attached to the best
    compatible earlier chain (highest shirt similarity).
    """
    ordered = sorted(appearances.values(), key=lambda t: t.first_ms)
    mapping: dict[int, int] = {}
    # chains: canonical id → appearance of the chain's latest fragment
    chains: dict[int, TrackAppearance] = {}

    for app in ordered:
        best_canon = None
        best_sim = SIMILARITY_THRESHOLD
        for canon_id, tail in chains.items():
            if _can_merge(tail, app, px_per_m):
                sim = _cosine(tail.mean_hist, app.mean_hist)
                if sim >= best_sim:
                    best_sim = sim
                    best_canon = canon_id
        if best_canon is None:
            mapping[app.track_id] = app.track_id
            chains[app.track_id] = app
        else:
            mapping[app.track_id] = best_canon
            chains[best_canon] = app   # chain tail advances

    n_merged = sum(1 for k, v in mapping.items() if k != v)
    if n_merged:
        logger.info("Re-ID: merged %d fragmented tracks → %d players.",
                    n_merged, len(chains))
    return mapping


def remap_ids(mapping: dict[int, int], *collections) -> None:
    """
    Apply the mapping in place to pipeline collections:
      - dicts keyed by track_id (positions): entries are concatenated
      - lists of objects with .player_id (shot events)
      - lists of objects with .track_id (tracks in FrameResults)
    """
    for col in collections:
        if isinstance(col, dict):
            for old_id in [k for k in col if mapping.get(k, k) != k]:
                new_id = mapping[old_id]
                col.setdefault(new_id, [])
                col[new_id].extend(col.pop(old_id))
                col[new_id].sort(key=lambda p: p[0])
        elif isinstance(col, list):
            for item in col:
                if hasattr(item, "player_id"):
                    item.player_id = mapping.get(item.player_id, item.player_id)
                elif hasattr(item, "track_id"):
                    item.track_id = mapping.get(item.track_id, item.track_id)
