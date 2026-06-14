"""
Kalman-filter ball tracker for padel video analysis.

Two use cases:
  1. Frame-by-frame (dense): WASB/RetinaNet detects ball at ~30fps with gaps
     and noise → KalmanBallTracker smooths and fills missing frames.
  2. Sparse (Gemini shots): we know ball contact times from Gemini; interpolate
     the trajectory between contacts using physics.

Coordinate system: normalised court (0-1 in both axes), time in seconds.
The filter is intentionally 2D (court projection) — we don't model ball HEIGHT
because a behind-the-court camera doesn't show it directly. High process noise
handles bounces and spin naturally.

Usage (dense, frame-by-frame):
    tracker = KalmanBallTracker()
    for frame_idx, (frame, detections) in enumerate(video):
        t_s = frame_idx / fps
        meas = detections[0] if detections else None
        state = tracker.step(t_s, meas)
        draw_ball(frame, state.x, state.y, state.predicted)

Usage (sparse, from Gemini shots):
    traj = interpolate_shot_trajectory(shots, player_positions, duration_s)
    # traj[i] = {"t_s", "x", "y", "vx", "vy", "conf"}
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class BallMeasurement:
    """Single ball detection from a frame."""
    x: float        # normalised court_x (0-1)
    y: float        # normalised court_y (0-1)
    conf: float = 1.0


@dataclass
class BallState:
    """Kalman state + metadata."""
    t_s: float
    x: float
    y: float
    vx: float = 0.0   # velocity in court_x / second
    vy: float = 0.0   # velocity in court_y / second
    conf: float = 1.0  # 0 = pure prediction, 1 = fresh measurement
    predicted: bool = False


# ---------------------------------------------------------------------------
# Core Kalman filter
# ---------------------------------------------------------------------------

class KalmanBallTracker:
    """
    2D constant-velocity Kalman filter for ball tracking.

    State: [x, y, vx, vy]
    Measurement: [x, y]

    Process noise (Q) is intentionally large to accommodate:
      - Ball bounces (sudden velocity reversal)
      - Glass rebounds (similar)
      - Spin-induced curvature
    Measurement noise (R) should reflect detector accuracy.
    """

    def __init__(
        self,
        process_noise: float = 5e-3,
        measurement_noise: float = 2e-3,
        max_prediction_gap_s: float = 1.5,
    ):
        """
        Args:
            process_noise:         Q scale — larger = allows faster direction changes
            measurement_noise:     R scale — larger = trust detector less
            max_prediction_gap_s:  After this long without a measurement, reset.
        """
        self._Q = process_noise
        self._R = measurement_noise
        self._max_gap = max_prediction_gap_s

        # State [x, y, vx, vy] and covariance
        self._x: np.ndarray = np.zeros(4)
        self._P: np.ndarray = np.eye(4) * 1.0
        self._t: Optional[float] = None   # last update time
        self._since_measurement: float = 0.0

    # ── Public API ────────────────────────────────────────────────────────────

    def reset(self, t_s: float, meas: BallMeasurement) -> None:
        """Hard-reset state from a high-confidence measurement."""
        self._x = np.array([meas.x, meas.y, 0.0, 0.0], dtype=float)
        self._P = np.eye(4)
        self._t = t_s
        self._since_measurement = 0.0

    def step(
        self,
        t_s: float,
        meas: Optional[BallMeasurement] = None,
    ) -> BallState:
        """
        Advance the filter to `t_s`, optionally incorporating a measurement.
        Returns the current state estimate.

        On the very first call with no measurement the filter returns a
        zero-confidence state; callers should ignore it.
        """
        if self._t is None:
            if meas is None:
                return BallState(t_s=t_s, x=0.5, y=0.5, conf=0.0, predicted=True)
            self.reset(t_s, meas)
            return BallState(t_s=t_s, x=meas.x, y=meas.y, conf=meas.conf)

        dt = max(t_s - self._t, 1e-6)
        self._t = t_s

        # ── Predict ──────────────────────────────────────────────────────────
        F = np.array([
            [1, 0, dt,  0],
            [0, 1,  0, dt],
            [0, 0,  1,  0],
            [0, 0,  0,  1],
        ], dtype=float)
        # Process noise grows with dt to allow sudden direction changes
        Q = np.diag([
            self._Q * dt ** 2,
            self._Q * dt ** 2,
            self._Q * 10 * dt,
            self._Q * 10 * dt,
        ])
        self._x = F @ self._x
        self._P = F @ self._P @ F.T + Q
        self._since_measurement += dt

        # Long gap → reset on next measurement instead of predicting blindly
        if meas is None or self._since_measurement > self._max_gap:
            if meas is not None and self._since_measurement > self._max_gap:
                self.reset(t_s, meas)
                return BallState(t_s=t_s, x=meas.x, y=meas.y, conf=meas.conf)
            conf = max(0.0, 1.0 - self._since_measurement / self._max_gap)
            return BallState(
                t_s=t_s,
                x=float(self._x[0]), y=float(self._x[1]),
                vx=float(self._x[2]), vy=float(self._x[3]),
                conf=conf,
                predicted=True,
            )

        # ── Update ───────────────────────────────────────────────────────────
        H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=float)
        R = np.eye(2) * (self._R / max(meas.conf, 0.01))
        z = np.array([meas.x, meas.y])
        y = z - H @ self._x
        S = H @ self._P @ H.T + R
        K = self._P @ H.T @ np.linalg.inv(S)
        self._x = self._x + K @ y
        self._P = (np.eye(4) - K @ H) @ self._P
        self._since_measurement = 0.0

        return BallState(
            t_s=t_s,
            x=float(self._x[0]), y=float(self._x[1]),
            vx=float(self._x[2]), vy=float(self._x[3]),
            conf=meas.conf,
            predicted=False,
        )

    # ── Batch helpers ─────────────────────────────────────────────────────────

    def smooth(
        self,
        observations: list[tuple[float, BallMeasurement]],
        fps: float = 30.0,
    ) -> list[BallState]:
        """
        Given a list of (t_s, measurement|None) pairs at `fps`, return a
        smoothed dense trajectory. Gaps are filled with predictions.

        observations should be sorted by t_s.
        """
        if not observations:
            return []
        self.reset(observations[0][0], observations[0][1]
                   if observations[0][1] else BallMeasurement(0.5, 0.5, 0.0))
        states: list[BallState] = []
        for t_s, meas in observations:
            states.append(self.step(t_s, meas))
        return states


# ---------------------------------------------------------------------------
# Sparse-shot trajectory interpolation (Gemini pipeline)
# ---------------------------------------------------------------------------

def interpolate_shot_trajectory(
    shots: list[dict],
    player_positions: list[dict],
    duration_s: float,
    sample_hz: float = 5.0,
) -> list[dict]:
    """
    Given Gemini's sparse shot list and player positions, return a sampled
    ball trajectory at `sample_hz`.

    Between two consecutive shots (P1 hits at t1, P2 hits at t2):
      - At t1: ball is at P1's position
      - At t2: ball is at P2's position
      - In between: linear interpolation in court_x/y + sinusoidal height arch

    Returns list of {"t_s", "x", "y", "vx", "vy", "conf"}
    """
    if not shots:
        return []

    # Build quick lookup: player → interpolated position at time t
    def player_pos_at(player_id: int, t: float) -> tuple[float, float]:
        pts = [(p["t_s"], p["court_x"], p["court_y"])
               for p in player_positions if p.get("player") == player_id]
        if not pts:
            # Default half-court position per team
            x_def = 0.5
            y_def = 0.25 if player_id in (1, 2) else 0.75
            return x_def, y_def
        pts.sort(key=lambda p: p[0])
        if t <= pts[0][0]:
            return pts[0][1], pts[0][2]
        if t >= pts[-1][0]:
            return pts[-1][1], pts[-1][2]
        for i in range(len(pts) - 1):
            t0, x0, y0 = pts[i]
            t1, x1, y1 = pts[i + 1]
            if t0 <= t <= t1:
                frac = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
                return x0 + frac * (x1 - x0), y0 + frac * (y1 - y0)
        return pts[-1][1], pts[-1][2]

    shots_sorted = sorted(shots, key=lambda s: s.get("t_s", 0.0))
    dt = 1.0 / sample_hz
    trajectory: list[dict] = []

    n = int(math.ceil(duration_s * sample_hz))
    for i in range(n):
        t = i * dt

        # Find the surrounding shot interval [prev_shot, next_shot]
        prev_shot = next((s for s in reversed(shots_sorted) if s.get("t_s", 0) <= t), None)
        next_shot = next((s for s in shots_sorted if s.get("t_s", 0) > t), None)

        if prev_shot is None:
            # Before first shot: ball near server
            x, y = player_pos_at(shots_sorted[0].get("player", 1), t)
            trajectory.append({"t_s": t, "x": x, "y": y, "vx": 0, "vy": 0, "conf": 0.2})
            continue

        t0 = prev_shot.get("t_s", 0.0)
        x0, y0 = player_pos_at(prev_shot.get("player", 1), t0)

        if next_shot is None:
            # After last shot
            trajectory.append({"t_s": t, "x": x0, "y": y0, "vx": 0, "vy": 0, "conf": 0.1})
            continue

        t1 = next_shot.get("t_s", t0 + 1.0)
        x1, y1 = player_pos_at(next_shot.get("player", 1), t1)

        # Linear position interpolation
        if t1 > t0:
            frac = (t - t0) / (t1 - t0)
        else:
            frac = 0.0
        x = x0 + frac * (x1 - x0)
        y = y0 + frac * (y1 - y0)

        # Approximate velocities
        vx = (x1 - x0) / (t1 - t0) if t1 > t0 else 0.0
        vy = (y1 - y0) / (t1 - t0) if t1 > t0 else 0.0

        trajectory.append({"t_s": t, "x": x, "y": y, "vx": vx, "vy": vy, "conf": 0.6})

    return trajectory


# ---------------------------------------------------------------------------
# Utility: detect ball impacts from Kalman velocity reversals
# ---------------------------------------------------------------------------

def detect_impacts_from_trajectory(
    states: list[BallState],
    min_speed_change: float = 0.3,
    min_gap_s: float = 0.1,
) -> list[float]:
    """
    Heuristic: detect ball impacts (racket/wall/floor) from sharp velocity
    reversals in a dense Kalman trajectory.

    Returns list of impact timestamps in seconds.
    """
    if len(states) < 3:
        return []

    impacts: list[float] = []
    last_t = -min_gap_s * 2

    for i in range(1, len(states) - 1):
        prev, cur, nxt = states[i - 1], states[i], states[i + 1]
        if cur.predicted:
            continue

        # Speed change = dot product flip in velocity direction
        dt_b = max(cur.t_s - prev.t_s, 1e-6)
        dt_f = max(nxt.t_s - cur.t_s, 1e-6)

        dot = prev.vx * cur.vx + prev.vy * cur.vy
        speed_prev = math.sqrt(prev.vx ** 2 + prev.vy ** 2)
        speed_cur = math.sqrt(cur.vx ** 2 + cur.vy ** 2)

        if speed_prev < 1e-6 or speed_cur < 1e-6:
            continue

        cos_angle = dot / (speed_prev * speed_cur)
        speed_change = abs(1.0 - cos_angle) * max(speed_cur, speed_prev)

        if speed_change >= min_speed_change and (cur.t_s - last_t) >= min_gap_s:
            impacts.append(cur.t_s)
            last_t = cur.t_s

    return impacts
