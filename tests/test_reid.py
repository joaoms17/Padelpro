"""Tests for shirt-colour re-identification (track fragment merging)."""

from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from padelpro_vision.detection.detector import PlayerBox
from padelpro_vision.tracking.reid import (
    TrackAppearance,
    torso_histogram,
    merge_fragmented_tracks,
    remap_ids,
)


def _frame_with_shirt(bgr: tuple[int, int, int]) -> tuple[np.ndarray, PlayerBox]:
    frame = np.full((400, 600, 3), 30, dtype=np.uint8)   # dark court
    box = PlayerBox(200.0, 100.0, 300.0, 320.0, 0.9)
    frame[100:320, 200:300] = bgr
    return frame, box


def _appearance(tid: int, bgr, t0: float, t1: float,
                pos0=(100.0, 100.0), pos1=(110.0, 100.0), n: int = 10) -> TrackAppearance:
    frame, box = _frame_with_shirt(bgr)
    hist = torso_histogram(frame, box)
    assert hist is not None
    app = TrackAppearance(tid)
    for i in range(n):
        ts = t0 + (t1 - t0) * i / max(1, n - 1)
        pos = pos0 if i == 0 else pos1
        app.add(hist, ts, pos)
    return app


RED = (40, 40, 220)
BLUE = (220, 60, 40)


def test_torso_histogram_separates_colours():
    f1, b1 = _frame_with_shirt(RED)
    f2, b2 = _frame_with_shirt(BLUE)
    h_red = torso_histogram(f1, b1)
    h_blue = torso_histogram(f2, b2)
    cos = float(np.dot(h_red, h_blue) /
                (np.linalg.norm(h_red) * np.linalg.norm(h_blue)))
    assert cos < 0.5, "different shirt colours must not look alike"


def test_torso_histogram_degenerate_box():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    assert torso_histogram(frame, PlayerBox(50.0, 50.0, 52.0, 53.0, 0.9)) is None


def test_merges_same_shirt_disjoint_times():
    apps = {
        1: _appearance(1, RED, 0.0, 10_000.0),
        2: _appearance(2, RED, 12_000.0, 20_000.0),   # same shirt, later
    }
    mapping = merge_fragmented_tracks(apps)
    assert mapping[2] == 1


def test_does_not_merge_different_shirts():
    apps = {
        1: _appearance(1, RED, 0.0, 10_000.0),
        2: _appearance(2, BLUE, 12_000.0, 20_000.0),
    }
    mapping = merge_fragmented_tracks(apps)
    assert mapping[2] == 2


def test_does_not_merge_overlapping_times():
    # Two players with the same kit on court at the same time
    apps = {
        1: _appearance(1, RED, 0.0, 10_000.0),
        2: _appearance(2, RED, 5_000.0, 20_000.0),
    }
    mapping = merge_fragmented_tracks(apps)
    assert mapping[2] == 2


def test_gap_speed_blocks_impossible_merge():
    # Same shirt, but reappears 50 m away (in px) 1 s later → not the same guy
    apps = {
        1: _appearance(1, RED, 0.0, 10_000.0, pos1=(100.0, 100.0)),
        2: _appearance(2, RED, 11_000.0, 20_000.0, pos0=(5100.0, 100.0)),
    }
    mapping = merge_fragmented_tracks(apps, px_per_m=100.0)  # gap = 50 m in 1 s
    assert mapping[2] == 2
    # Without scale information the merge is allowed (similarity only)
    assert merge_fragmented_tracks(apps, px_per_m=None)[2] == 1


def test_chain_of_three_fragments():
    apps = {
        1: _appearance(1, RED, 0.0, 5_000.0),
        2: _appearance(2, RED, 6_000.0, 10_000.0),
        3: _appearance(3, RED, 11_000.0, 15_000.0),
    }
    mapping = merge_fragmented_tracks(apps)
    assert mapping == {1: 1, 2: 1, 3: 1}


def test_remap_ids_positions_and_events():
    positions = {
        1: [(0.0, 1.0, 1.0), (1000.0, 2.0, 2.0)],
        7: [(2000.0, 3.0, 3.0)],
    }

    class Ev:
        def __init__(self, pid): self.player_id = pid
    events = [Ev(7), Ev(1)]

    remap_ids({1: 1, 7: 1}, positions, events)
    assert set(positions.keys()) == {1}
    assert [p[0] for p in positions[1]] == [0.0, 1000.0, 2000.0]   # time-sorted
    assert [e.player_id for e in events] == [1, 1]
