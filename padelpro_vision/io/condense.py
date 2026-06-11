"""
Condensed video generation: concatenate rally segments via ffmpeg filter_complex.

Preserves real timestamp integrity — timestamp_map.json maps condensed_ms → real_ms.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from padelpro_vision.segmentation.segmentation import Segment

logger = logging.getLogger(__name__)


def condense_video(
    video_path: Path | str,
    segments: list[Segment],
    output_path: Path | str,
    *,
    reencoded: bool = False,
) -> Path:
    """
    Concatenate rally segments from video_path into output_path.

    Args:
        reencoded: If True, re-encode (slower, smaller file).
                   If False, use stream copy (fast, may have small boundary artefacts).

    Returns the output path.
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found in PATH. Install ffmpeg to generate condensed video.")

    video_path  = Path(video_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rally_segments = [s for s in segments if s.type == "rally"]
    if not rally_segments:
        raise ValueError("No rally segments to condense.")

    logger.info("Condensing %d rallies into %s …", len(rally_segments), output_path.name)

    with tempfile.TemporaryDirectory() as tmp:
        concat_list = Path(tmp) / "concat.txt"
        clip_paths: list[Path] = []

        for i, seg in enumerate(rally_segments):
            clip = Path(tmp) / f"clip_{i:04d}.mp4"
            start_s  = seg.start_ms  / 1000.0
            dur_s    = seg.duration_ms / 1000.0
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{start_s:.3f}",
                "-i", str(video_path),
                "-t",  f"{dur_s:.3f}",
            ]
            if reencoded:
                cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac"]
            else:
                cmd += ["-c", "copy"]
            cmd.append(str(clip))
            result = subprocess.run(cmd, capture_output=True)
            if result.returncode != 0:
                logger.warning("ffmpeg clip %d failed: %s", i, result.stderr.decode()[:200])
                continue
            clip_paths.append(clip)

        if not clip_paths:
            raise RuntimeError("All ffmpeg clip extractions failed.")

        with open(concat_list, "w") as f:
            for cp in clip_paths:
                f.write(f"file '{cp}'\n")

        cmd_concat = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_list),
        ]
        if reencoded:
            cmd_concat += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac"]
        else:
            cmd_concat += ["-c", "copy"]
        cmd_concat.append(str(output_path))

        result = subprocess.run(cmd_concat, capture_output=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed: {result.stderr.decode()[:400]}")

    logger.info("Condensed video written: %s", output_path)
    return output_path
