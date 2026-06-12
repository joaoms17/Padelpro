"""
Zero-annotation sanity checks: catch tracking/projection regressions using
physics alone (a padel player does not run 12 m/s or teleport across court).
Inputs are court-space tracks {track_id: [(ts_ms, x_m, y_m), ...]}.
"""

from __future__ import annotations

import numpy as np

from padelpro_vision.constants.court import COURT_LENGTH_M, COURT_WIDTH_M


def physics_sanity(
    track_positions: dict[int, list[tuple[float, float, float]]],
    max_plausible_speed_ms: float = 8.0,
    teleport_jump_m: float = 3.0,
    teleport_window_ms: float = 200.0,
    court_margin_m: float = 1.5,
) -> dict:
    """
    Returns a dict of physics-violation rates. High values mean tracking or
    homography problems — useful as a regression signal with zero labels.
    """
    speeds: list[float] = []
    n_teleports = 0
    n_samples = 0
    n_out_of_court = 0

    for track in track_positions.values():
        if len(track) < 2:
            n_samples += len(track)
            continue
        ts = np.array([p[0] for p in track]) / 1000.0
        xs = np.array([p[1] for p in track])
        ys = np.array([p[2] for p in track])
        n_samples += len(track)

        out_x = (xs < -court_margin_m) | (xs > COURT_WIDTH_M + court_margin_m)
        out_y = (ys < -court_margin_m) | (ys > COURT_LENGTH_M + court_margin_m)
        n_out_of_court += int((out_x | out_y).sum())

        dt = np.diff(ts)
        step = np.hypot(np.diff(xs), np.diff(ys))
        valid = dt > 1e-6
        spd = step[valid] / dt[valid]
        speeds.extend(spd.tolist())

        close_in_time = (np.diff(ts) * 1000.0) <= teleport_window_ms
        n_teleports += int(((step > teleport_jump_m) & close_in_time).sum())

    speeds_arr = np.array(speeds) if speeds else np.zeros(0)
    n_speed = len(speeds_arr)
    n_implausible = int((speeds_arr > max_plausible_speed_ms).sum()) if n_speed else 0

    return {
        "n_position_samples": n_samples,
        "pct_implausible_speed": round(100.0 * n_implausible / n_speed, 2) if n_speed else 0.0,
        "max_observed_speed_ms": round(float(speeds_arr.max()), 2) if n_speed else 0.0,
        "p99_speed_ms": round(float(np.percentile(speeds_arr, 99)), 2) if n_speed else 0.0,
        "teleport_count": n_teleports,
        "pct_out_of_court": round(100.0 * n_out_of_court / n_samples, 2) if n_samples else 0.0,
    }


def tracking_stability(
    track_positions: dict[int, list[tuple[float, float, float]]],
    expected_players: int = 4,
) -> dict:
    """
    Proxy tracking-quality metrics that need no ground truth. With 4 players
    on court, an ideal tracker produces exactly 4 long tracks; fragmentation
    (many short tracks) signals ID switches and lost tracks.
    """
    if not track_positions:
        return {
            "n_tracks": 0,
            "tracks_per_minute": 0.0,
            "avg_track_duration_s": 0.0,
            "pct_time_with_expected_players": 0.0,
        }

    durations = []
    t_min, t_max = float("inf"), float("-inf")
    for track in track_positions.values():
        if not track:
            continue
        start, end = track[0][0], track[-1][0]
        durations.append((end - start) / 1000.0)
        t_min = min(t_min, start)
        t_max = max(t_max, end)

    span_s = max(1e-6, (t_max - t_min) / 1000.0)

    # Per-second concurrency: how many tracks are alive each second
    n_seconds = int(np.ceil(span_s))
    alive = np.zeros(n_seconds, dtype=np.int32)
    for track in track_positions.values():
        if not track:
            continue
        s = int((track[0][0] - t_min) / 1000.0)
        e = int((track[-1][0] - t_min) / 1000.0)
        alive[s: e + 1] += 1
    pct_expected = 100.0 * float((alive >= expected_players).mean()) if n_seconds else 0.0

    return {
        "n_tracks": len(durations),
        "tracks_per_minute": round(len(durations) / (span_s / 60.0), 2),
        "avg_track_duration_s": round(float(np.mean(durations)), 1) if durations else 0.0,
        "pct_time_with_expected_players": round(pct_expected, 1),
    }
