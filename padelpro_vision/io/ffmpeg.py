"""Locate ffmpeg even when it isn't on PATH (e.g. winget installs on Windows)."""

from __future__ import annotations

import glob
import logging
import os
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


def ensure_ffmpeg() -> bool:
    """Make sure ffmpeg is reachable on PATH. Returns True if available."""
    if shutil.which("ffmpeg"):
        return True
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        pattern = os.path.join(
            local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "**", "bin"
        )
        for bin_dir in glob.glob(pattern, recursive=True):
            if Path(bin_dir, "ffmpeg.exe").exists():
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]
                logger.info("ffmpeg located at %s and added to PATH.", bin_dir)
                return True
    logger.warning("ffmpeg not found — audio features disabled.")
    return False
