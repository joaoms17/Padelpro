"""
Supabase client — idempotent writes for all pipeline outputs.

Idempotency: all upserts use on_conflict strategies keyed on match_id
(or match_id + player_id / rally_id + ts_ms) so re-processing the same
match never produces duplicate rows.

Install: pip install supabase
"""

from __future__ import annotations
import json
import logging
import os
from dataclasses import asdict
from pathlib import Path

logger = logging.getLogger(__name__)


def _load_env() -> tuple[str, str]:
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent.parent / ".env")
    except ImportError:
        pass
    return os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_KEY", "")


class SupabaseClient:
    """
    Thin wrapper around supabase-py (MIT).
    Falls back gracefully when the package is not installed or credentials are missing.
    """

    def __init__(self) -> None:
        self._client = None
        url, key = _load_env()
        if url and key:
            self._try_connect(url, key)
        else:
            logger.warning("SUPABASE_URL / SUPABASE_KEY not set — writes disabled.")

    def _try_connect(self, url: str, key: str) -> None:
        try:
            from supabase import create_client
            self._client = create_client(url, key)
            logger.info("Supabase connected: %s", url)
        except ImportError:
            logger.warning("supabase not installed — run: pip install supabase")
        except Exception as exc:
            logger.warning("Supabase connection failed: %s", exc)

    @property
    def connected(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------
    # Upserts
    # ------------------------------------------------------------------

    def upsert_match(self, match: dict) -> None:
        """Insert or update a match row."""
        self._upsert("matches", [match], conflict="id")

    def upsert_player_stats(self, stats_list: list) -> None:
        """
        Upsert player_stats rows.
        stats_list: list[PlayerStats] or list[dict]
        """
        rows = [asdict(s) if not isinstance(s, dict) else s for s in stats_list]
        self._upsert("player_stats", rows, conflict="match_id,player_id")

    def upsert_shot_events(self, events: list) -> None:
        """
        Upsert shot_event rows.
        events: list[ShotEvent] or list[dict]
        """
        rows = [asdict(e) if not isinstance(e, dict) else e for e in events]
        self._upsert("shot_events", rows, conflict="match_id,player_id,ts_ms")

    def upsert_segments(self, match_id: str, segments: list) -> None:
        """
        Upsert segmentation rows.
        segments: list[Segment] or list[dict]
        """
        rows = []
        for s in segments:
            d = asdict(s) if not isinstance(s, dict) else dict(s)
            d["match_id"] = match_id
            rows.append(d)
        self._upsert("segments", rows, conflict="match_id,start_ms")

    def upsert_rallies(self, match_id: str, rallies: list[dict]) -> None:
        rows = [{**r, "match_id": match_id} for r in rallies]
        self._upsert("rallies", rows, conflict="match_id,start_ms")

    def upsert_clips(self, clips: list[dict]) -> None:
        self._upsert("clips", clips, conflict="match_id,player_id,t_start_ms")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _upsert(self, table: str, rows: list[dict], conflict: str) -> None:
        if not self.connected or not rows:
            if not self.connected:
                logger.debug("Supabase not connected — skipping upsert to '%s'.", table)
            return
        try:
            self._client.table(table).upsert(rows, on_conflict=conflict).execute()
            logger.info("Upserted %d rows into '%s'.", len(rows), table)
        except Exception as exc:
            logger.error("Supabase upsert to '%s' failed: %s", table, exc)
