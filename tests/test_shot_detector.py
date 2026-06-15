"""Tests for the optical-flow + audio shot detector."""
from __future__ import annotations

import numpy as np
import pytest

from padelpro_vision.analysis.shot_detector import (
    _find_peaks,
    _t_to_hhmmss,
    format_shot_hints,
    merge_signals,
)


def test_find_peaks_basic():
    times = np.array([0.0, 1.0, 2.0, 3.0, 4.0, 5.0])
    mags  = np.array([0.1, 0.5, 0.1, 0.1, 0.6, 0.1])
    peaks = _find_peaks(times, mags, threshold=0.4, min_gap_s=1.5, zone="near")
    assert len(peaks) == 2
    t_s = [p["t_s"] for p in peaks]
    assert 1.0 in t_s
    assert 4.0 in t_s
    assert all(p["zone"] == "near" for p in peaks)


def test_find_peaks_clusters_nearby():
    # Two above-threshold frames very close together → one cluster → one peak
    times = np.array([0.0, 1.0, 1.25, 5.0])
    mags  = np.array([0.1, 0.6,  0.8, 0.1])
    peaks = _find_peaks(times, mags, threshold=0.5, min_gap_s=1.5, zone="far")
    assert len(peaks) == 1
    assert peaks[0]["t_s"] == 1.25   # highest magnitude in the cluster
    assert peaks[0]["magnitude"] == pytest.approx(0.8)


def test_find_peaks_none_above_threshold():
    times = np.array([0.0, 1.0, 2.0])
    mags  = np.array([0.1, 0.2, 0.1])
    assert _find_peaks(times, mags, threshold=0.9, min_gap_s=1.5, zone="near") == []


def test_t_to_hhmmss():
    assert _t_to_hhmmss(0)    == "00:00:00"
    assert _t_to_hhmmss(65)   == "00:01:05"
    assert _t_to_hhmmss(3661) == "01:01:01"


def test_format_shot_hints_empty():
    assert format_shot_hints([]) == ""


def test_format_shot_hints_visual_only():
    shots = [
        {"t_s": 5.0,  "zone": "near", "magnitude": 1.0},
        {"t_s": 7.0,  "zone": "far",  "magnitude": 1.2},
        {"t_s": 12.0, "zone": "near", "magnitude": 0.9},
    ]
    hint = format_shot_hints(shots)
    assert "PRÉ-DETECÇÃO" in hint
    assert "3 BATIMENTOS" in hint
    assert "00:00:05" in hint
    assert "00:00:07" in hint
    assert "00:00:12" in hint
    assert "Equipa próxima (A)" in hint
    assert "Equipa afastada (B)" in hint
    assert "áudio" not in hint


def test_format_shot_hints_with_audio():
    visual = [
        {"t_s": 5.0,  "zone": "near", "magnitude": 1.0},
        {"t_s": 12.0, "zone": "far",  "magnitude": 1.2},
    ]
    audio = [
        {"t_s": 5.2,  "zone": "audio", "magnitude": 0.8},   # confirms visual@5.0
        {"t_s": 20.0, "zone": "audio", "magnitude": 0.7},   # audio-only
    ]
    hint = format_shot_hints(visual, audio)
    assert "optical flow" in hint
    assert "sugestivo" in hint
    assert "00:00:20" in hint          # audio-only timestamp present
    assert "campos vizinhos" in hint


def test_merge_signals_confirmed():
    visual = [{"t_s": 5.0,  "zone": "near", "magnitude": 1.0},
              {"t_s": 10.0, "zone": "far",  "magnitude": 1.2}]
    audio  = [{"t_s": 5.3,  "zone": "audio", "magnitude": 0.8},
              {"t_s": 20.0, "zone": "audio", "magnitude": 0.7}]
    m = merge_signals(visual, audio)
    assert 5.0 in m["confirmed"]
    assert 10.0 in m["visual_only"]
    assert 20.0 in m["audio_only"]
    assert len(m["confirmed"]) == 1


def test_merge_signals_no_audio():
    visual = [{"t_s": 5.0, "zone": "near", "magnitude": 1.0}]
    m = merge_signals(visual, [])
    assert m["confirmed"] == []
    assert 5.0 in m["visual_only"]
    assert m["audio_only"] == []
