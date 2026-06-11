"""
Supabase client — writes player_stats, shot_events, segments.
Idempotent per match_id (reprocess without duplicating rows).

TODO (M3): implement upsert logic for all tables.
"""

from __future__ import annotations
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def _load_env() -> tuple[str, str]:
    """Load Supabase URL and key from .env or environment."""
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent.parent / ".env")
    except ImportError:
        pass
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    return url, key


class SupabaseClient:
    """
    Thin wrapper around supabase-py (MIT).

    Install: pip install supabase
    """

    def __init__(self) -> None:
        self._client = None
        url, key = _load_env()
        if url and key:
            self._try_connect(url, key)
        else:
            logger.warning("SUPABASE_URL / SUPABASE_KEY not set — Supabase writes disabled.")

    def _try_connect(self, url: str, key: str) -> None:
        try:
            from supabase import create_client
            self._client = create_client(url, key)
            logger.info("Supabase connected to %s", url)
        except ImportError:
            logger.warning("supabase package not installed — run: pip install supabase")

    @property
    def connected(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------
    # TODO (M3): implement these methods
    # ------------------------------------------------------------------

    def upsert_match(self, match: dict) -> None:
        raise NotImplementedError("TODO M3")

    def upsert_player_stats(self, stats: list[dict]) -> None:
        raise NotImplementedError("TODO M3")

    def upsert_shot_events(self, events: list[dict]) -> None:
        raise NotImplementedError("TODO M3")

    def upsert_segments(self, match_id: str, segments: list[dict]) -> None:
        raise NotImplementedError("TODO M3")
