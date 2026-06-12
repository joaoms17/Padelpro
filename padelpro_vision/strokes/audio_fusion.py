"""
Shot-event post-processing:

1. consolidate_shot_events — the classifier fires on every frame while a
   stroke is visible, producing dozens of duplicate events per real hit.
   Merge per-player bursts into one event, keeping the frame where the
   dominant wrist was fastest (closest to the real impact moment).

2. fuse_events_with_onsets — a real padel hit makes a sharp sound. Events
   with an audio onset nearby are confirmed (confidence boosted); events
   without one are downweighted or dropped.
"""

from __future__ import annotations
import logging

logger = logging.getLogger(__name__)


def consolidate_shot_events(events: list, min_gap_ms: float = 700.0) -> list:
    """
    Merge consecutive events of the same player closer than min_gap_ms into a
    single event. Representative = highest wrist_speed (fallback: confidence).
    Input order does not matter; output is sorted by ts_ms.
    """
    by_player: dict[int, list] = {}
    for ev in events:
        by_player.setdefault(ev.player_id, []).append(ev)

    out: list = []
    for evs in by_player.values():
        evs.sort(key=lambda e: e.ts_ms)
        group: list = []
        for ev in evs:
            if group and (ev.ts_ms - group[-1].ts_ms) > min_gap_ms:
                out.append(_pick_representative(group))
                group = []
            group.append(ev)
        if group:
            out.append(_pick_representative(group))

    out.sort(key=lambda e: e.ts_ms)
    return out


def _pick_representative(group: list):
    def key(ev):
        ws = getattr(ev, "wrist_speed", None)
        return (ws if ws is not None else -1.0, ev.confidence)
    return max(group, key=key)


def fuse_events_with_onsets(
    events: list,
    onsets_ms: list[float],
    tolerance_ms: float = 200.0,
    drop_without_onset: bool = False,
    no_onset_confidence_factor: float = 0.5,
) -> list:
    """
    Cross-check stroke events against audio onsets. Each event gets
    .audio_onset = True/False; events without a nearby onset are either
    dropped or have their confidence multiplied by no_onset_confidence_factor.

    With no onsets at all (silent video / no audio track) events pass through
    unchanged — absence of audio is not evidence against the strokes.
    """
    if not onsets_ms:
        return events

    kept: list = []
    n_confirmed = 0
    for ev in events:
        has_onset = any(abs(o - ev.ts_ms) <= tolerance_ms for o in onsets_ms)
        ev.audio_onset = has_onset
        if has_onset:
            n_confirmed += 1
            kept.append(ev)
        elif drop_without_onset:
            continue
        else:
            ev.confidence = round(ev.confidence * no_onset_confidence_factor, 4)
            kept.append(ev)

    logger.info(
        "Audio fusion: %d/%d events confirmed by onsets (%d dropped).",
        n_confirmed, len(events), len(events) - len(kept),
    )
    return kept
