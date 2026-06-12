"""
Evaluation metrics: pure functions comparing pipeline outputs against golden
annotations. All time values in milliseconds, all distances in metres.
"""

from __future__ import annotations

import numpy as np

Interval = tuple[float, float]


# ---------------------------------------------------------------------------
# Rally segmentation
# ---------------------------------------------------------------------------

def _total_overlap(gt: list[Interval], pred: list[Interval]) -> float:
    total = 0.0
    for gs, ge in gt:
        for ps, pe in pred:
            total += max(0.0, min(ge, pe) - max(gs, ps))
    return total


def interval_metrics(gt: list[Interval], pred: list[Interval]) -> dict:
    """
    Temporal precision/recall/F1/IoU between ground-truth and predicted
    intervals, plus per-rally detection rate (a GT rally counts as detected
    when some predicted interval covers ≥50% of it).
    """
    gt_dur = sum(e - s for s, e in gt)
    pred_dur = sum(e - s for s, e in pred)
    overlap = _total_overlap(gt, pred)
    union = gt_dur + pred_dur - overlap

    precision = overlap / pred_dur if pred_dur > 0 else 0.0
    recall = overlap / gt_dur if gt_dur > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    detected = 0
    for gs, ge in gt:
        covered = sum(max(0.0, min(ge, pe) - max(gs, ps)) for ps, pe in pred)
        if (ge - gs) > 0 and covered / (ge - gs) >= 0.5:
            detected += 1

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "iou": round(overlap / union, 4) if union > 0 else 0.0,
        "n_gt": len(gt),
        "n_pred": len(pred),
        "rallies_detected": detected,
        "rally_detection_rate": round(detected / len(gt), 4) if gt else 0.0,
    }


# ---------------------------------------------------------------------------
# Event (hit) matching
# ---------------------------------------------------------------------------

def match_events(
    gt_ts: list[float],
    pred_ts: list[float],
    tolerance_ms: float = 300.0,
) -> list[tuple[int, int, float]]:
    """
    Greedy one-to-one matching of predicted to GT timestamps by smallest |dt|.
    Returns list of (gt_idx, pred_idx, dt_ms) with dt = pred - gt.
    """
    pairs: list[tuple[float, int, int]] = []
    for gi, g in enumerate(gt_ts):
        for pi, p in enumerate(pred_ts):
            if abs(p - g) <= tolerance_ms:
                pairs.append((abs(p - g), gi, pi))
    pairs.sort(key=lambda x: x[0])

    used_gt: set[int] = set()
    used_pred: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    for _, gi, pi in pairs:
        if gi in used_gt or pi in used_pred:
            continue
        used_gt.add(gi)
        used_pred.add(pi)
        matches.append((gi, pi, pred_ts[pi] - gt_ts[gi]))
    return matches


def confusion_matrix(
    labels: list[str],
    gt: list[str],
    pred: list[str],
) -> dict[str, dict[str, int]]:
    """Nested dict confusion matrix: matrix[gt_label][pred_label] = count."""
    matrix = {g: {p: 0 for p in labels} for g in labels}
    for g, p in zip(gt, pred):
        if g in matrix and p in matrix[g]:
            matrix[g][p] += 1
    return matrix


def hit_metrics(
    gt_hits: list,            # objects with .ts_ms and optional .stroke_type
    pred_events: list,        # objects with .ts_ms and .stroke_type
    tolerance_ms: float = 300.0,
    stroke_classes: list[str] | None = None,
) -> dict:
    """
    Hit detection P/R/F1, mean |temporal offset| of matched hits, and stroke
    classification accuracy + confusion matrix over the matched pairs.
    """
    gt_ts = [h.ts_ms for h in gt_hits]
    pred_ts = [e.ts_ms for e in pred_events]
    matches = match_events(gt_ts, pred_ts, tolerance_ms)

    tp = len(matches)
    fp = len(pred_ts) - tp
    fn = len(gt_ts) - tp
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    mae_ms = float(np.mean([abs(dt) for _, _, dt in matches])) if matches else 0.0

    out = {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "n_gt": len(gt_ts),
        "n_pred": len(pred_ts),
        "n_matched": tp,
        "mean_abs_offset_ms": round(mae_ms, 1),
    }

    # Stroke-type agreement over matched pairs that have a GT label
    labelled = [
        (gt_hits[gi].stroke_type, pred_events[pi].stroke_type)
        for gi, pi, _ in matches
        if getattr(gt_hits[gi], "stroke_type", None)
    ]
    if labelled:
        gt_labels = [g for g, _ in labelled]
        pred_labels = [p for _, p in labelled]
        correct = sum(1 for g, p in labelled if g == p)
        out["stroke_accuracy"] = round(correct / len(labelled), 4)
        classes = stroke_classes or sorted(set(gt_labels) | set(pred_labels))
        out["stroke_confusion"] = confusion_matrix(classes, gt_labels, pred_labels)
    return out


# ---------------------------------------------------------------------------
# Position error
# ---------------------------------------------------------------------------

def _position_at(track: list[tuple[float, float, float]], ts_ms: float,
                 max_gap_ms: float) -> tuple[float, float] | None:
    """Nearest sample of a (ts, x, y) track within max_gap_ms, else None."""
    if not track:
        return None
    best = min(track, key=lambda p: abs(p[0] - ts_ms))
    if abs(best[0] - ts_ms) > max_gap_ms:
        return None
    return best[1], best[2]


def position_error_metrics(
    gt_positions: list,                                  # GoldenPosition-like
    track_positions: dict[int, list[tuple[float, float, float]]],
    max_gap_ms: float = 200.0,
) -> dict:
    """
    For each annotated keyframe, greedily match GT players to the nearest
    predicted track position at that timestamp and accumulate the error in
    metres. GT players carry letters, predictions carry track IDs, so the
    assignment is per-keyframe nearest-neighbour (one-to-one per timestamp).
    """
    errors: list[float] = []
    n_unmatched = 0

    by_ts: dict[float, list] = {}
    for gp in gt_positions:
        by_ts.setdefault(gp.ts_ms, []).append(gp)

    for ts_ms, gps in by_ts.items():
        candidates: dict[int, tuple[float, float]] = {}
        for tid, track in track_positions.items():
            pos = _position_at(track, ts_ms, max_gap_ms)
            if pos is not None:
                candidates[tid] = pos

        pairs: list[tuple[float, int, int]] = []
        for gi, gp in enumerate(gps):
            for tid, (x, y) in candidates.items():
                d = float(np.hypot(x - gp.court_x, y - gp.court_y))
                pairs.append((d, gi, tid))
        pairs.sort(key=lambda x: x[0])

        used_g: set[int] = set()
        used_t: set[int] = set()
        for d, gi, tid in pairs:
            if gi in used_g or tid in used_t:
                continue
            used_g.add(gi)
            used_t.add(tid)
            errors.append(d)
        n_unmatched += len(gps) - len(used_g)

    return {
        "n_keyframes": len(gt_positions),
        "n_matched": len(errors),
        "n_unmatched": n_unmatched,
        "mean_error_m": round(float(np.mean(errors)), 3) if errors else None,
        "median_error_m": round(float(np.median(errors)), 3) if errors else None,
        "p90_error_m": round(float(np.percentile(errors, 90)), 3) if errors else None,
    }
