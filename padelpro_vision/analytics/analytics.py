"""Analytics stub — Milestone 3."""

from __future__ import annotations


class MatchAnalytics:
    """
    TODO (M3): per-player, per-match metrics:
      - distance_m, avg_speed_ms, max_speed_ms
      - heatmap (grid occupancy, normalised)
      - attack_pct, defense_pct, transition_pct
      - couple synchronisation score
    """

    def compute(self, tracks: list, homography, court_dims: tuple) -> dict:
        raise NotImplementedError("TODO M3: implement analytics.")
