"""
Clip indexing — Index = tempo, não ficheiros.

Princípio: guardar intervalos (t_start_ms, t_end_ms) e deixar o player saltar
para o instante no vídeo-mestre. Só renderizar vídeo físico em montagens.

Inputs:
  - shot_events: list[ShotEvent]  (com court_x/court_y do M3)
  - segments:    list[Segment]    (rallies do pipeline de segmentação)

Outputs:
  - list[Rally]   — tabela de rallies
  - list[Clip]    — tabela de clips (intervalos + metadados)
  - query_clips() — filtragem sem I/O de vídeo
  - build_montage() — único sítio onde se renderiza vídeo físico
  - thumbnails    — 1 frame por clip via ffmpeg
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from padelpro_vision.constants.court import (
    COURT_LENGTH_M,
    COURT_WIDTH_M,
    ZONE_NET_DEPTH_M,
    ZONE_MID_DEPTH_M,
)

logger = logging.getLogger(__name__)

# Default clip window around each shot event
CLIP_WINDOW_BEFORE_MS: float = 1500.0
CLIP_WINDOW_AFTER_MS:  float = 1500.0

Zone = Literal["net_left", "net_right", "mid_left", "mid_right", "back_left", "back_right", "unknown"]
RallyPhase = Literal["early", "mid", "late", "unknown"]


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Rally:
    rally_id:   int
    match_id:   str
    start_ms:   float
    end_ms:     float
    num_shots:  int
    winner_team: int | None = None  # V2


@dataclass
class Clip:
    clip_id:      int
    match_id:     str
    rally_id:     int
    player_id:    int
    stroke_type:  str
    t_start_ms:   float
    t_end_ms:     float
    zone:         Zone
    rally_phase:  RallyPhase
    thumbnail_url: str | None = None


# ---------------------------------------------------------------------------
# Zone derivation
# ---------------------------------------------------------------------------

def derive_zone(court_x: float | None, court_y: float | None) -> Zone:
    """
    Classify a court position into a named zone.

    Court layout (standard camera perspective, y=0 at top):
      net zone:  y < ZONE_NET_DEPTH_M
      mid zone:  ZONE_NET_DEPTH_M <= y < ZONE_MID_DEPTH_M
      back zone: y >= ZONE_MID_DEPTH_M
      left/right: x < COURT_WIDTH_M/2
    """
    if court_x is None or court_y is None:
        return "unknown"
    side = "left" if court_x < COURT_WIDTH_M / 2 else "right"
    if court_y < ZONE_NET_DEPTH_M:
        return f"net_{side}"   # type: ignore[return-value]
    if court_y < ZONE_MID_DEPTH_M:
        return f"mid_{side}"   # type: ignore[return-value]
    return f"back_{side}"      # type: ignore[return-value]


def derive_rally_phase(ts_ms: float, rally_start_ms: float, rally_end_ms: float) -> RallyPhase:
    dur = max(1.0, rally_end_ms - rally_start_ms)
    rel = (ts_ms - rally_start_ms) / dur
    if rel < 0.33:
        return "early"
    if rel < 0.66:
        return "mid"
    return "late"


# ---------------------------------------------------------------------------
# Build rallies + clips
# ---------------------------------------------------------------------------

def build_rallies(match_id: str, segments: list) -> list[Rally]:
    """
    Build Rally list from segmentation Segment list.
    Only rally-type segments are included.
    """
    rallies: list[Rally] = []
    for i, seg in enumerate(segments):
        if getattr(seg, "type", None) != "rally":
            continue
        rallies.append(Rally(
            rally_id=i,
            match_id=match_id,
            start_ms=seg.start_ms,
            end_ms=seg.end_ms,
            num_shots=0,  # filled below
        ))
    return rallies


def build_clips(
    match_id: str,
    shot_events: list,
    rallies: list[Rally],
    *,
    window_before_ms: float = CLIP_WINDOW_BEFORE_MS,
    window_after_ms:  float = CLIP_WINDOW_AFTER_MS,
    video_duration_ms: float = float("inf"),
) -> list[Clip]:
    """
    Build a Clip for each ShotEvent.
    Also updates Rally.num_shots in place.
    """
    rally_map = {r.rally_id: r for r in rallies}
    # shot count per rally
    shot_counts: dict[int, int] = {}

    clips: list[Clip] = []
    for i, ev in enumerate(shot_events):
        rally   = rally_map.get(ev.rally_id)
        r_start = rally.start_ms if rally else 0.0
        r_end   = rally.end_ms   if rally else float("inf")

        t_start = max(0.0, ev.ts_ms - window_before_ms)
        t_end   = min(video_duration_ms, ev.ts_ms + window_after_ms)

        zone  = derive_zone(getattr(ev, "court_x", None), getattr(ev, "court_y", None))
        phase = derive_rally_phase(ev.ts_ms, r_start, r_end)

        clips.append(Clip(
            clip_id=i,
            match_id=match_id,
            rally_id=ev.rally_id,
            player_id=ev.player_id,
            stroke_type=ev.stroke_type,
            t_start_ms=t_start,
            t_end_ms=t_end,
            zone=zone,
            rally_phase=phase,
        ))
        shot_counts[ev.rally_id] = shot_counts.get(ev.rally_id, 0) + 1

    for rally_id, count in shot_counts.items():
        if rally_id in rally_map:
            rally_map[rally_id].num_shots = count

    return clips


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

def query_clips(
    clips: list[Clip],
    *,
    player_id: int | None = None,
    stroke: str | None = None,
    zone: Zone | None = None,
    rally_phase: RallyPhase | None = None,
    rally_id: int | None = None,
) -> list[Clip]:
    """
    Filter clips by any combination of attributes.
    Pure in-memory — no video I/O.
    """
    result = clips
    if player_id is not None:
        result = [c for c in result if c.player_id == player_id]
    if stroke is not None:
        result = [c for c in result if c.stroke_type == stroke]
    if zone is not None:
        result = [c for c in result if c.zone == zone]
    if rally_phase is not None:
        result = [c for c in result if c.rally_phase == rally_phase]
    if rally_id is not None:
        result = [c for c in result if c.rally_id == rally_id]
    return result


# ---------------------------------------------------------------------------
# Montage (only place where physical video is rendered)
# ---------------------------------------------------------------------------

def build_montage(
    video_path: Path | str,
    clips: list[Clip],
    output_path: Path | str,
    *,
    reencoded: bool = False,
) -> Path:
    """
    Render a montage video from a list of clips via ffmpeg concat.
    This is the ONLY function that touches the disk for video output.

    Args:
        video_path:   Source video (match master video or condensed).
        clips:        Clip list from query_clips().
        output_path:  Output MP4 path.
        reencoded:    Re-encode (smaller, slower) vs stream-copy (fast, lossless).
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found in PATH.")

    video_path  = Path(video_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not clips:
        raise ValueError("No clips to render.")

    logger.info("Rendering montage of %d clips → %s", len(clips), output_path.name)

    with tempfile.TemporaryDirectory() as tmp:
        clip_paths: list[Path] = []
        for i, clip in enumerate(clips):
            out = Path(tmp) / f"clip_{i:05d}.mp4"
            dur = max(0.1, (clip.t_end_ms - clip.t_start_ms) / 1000.0)
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{clip.t_start_ms / 1000:.3f}",
                "-i", str(video_path),
                "-t",  f"{dur:.3f}",
            ]
            if reencoded:
                cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac"]
            else:
                cmd += ["-c", "copy"]
            cmd.append(str(out))
            r = subprocess.run(cmd, capture_output=True)
            if r.returncode == 0:
                clip_paths.append(out)
            else:
                logger.warning("Clip %d failed: %s", i, r.stderr.decode()[:120])

        if not clip_paths:
            raise RuntimeError("All clip extractions failed.")

        concat = Path(tmp) / "concat.txt"
        with open(concat, "w") as f:
            for cp in clip_paths:
                f.write(f"file '{cp}'\n")

        cmd_concat = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat),
        ]
        if reencoded:
            cmd_concat += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac"]
        else:
            cmd_concat += ["-c", "copy"]
        cmd_concat.append(str(output_path))

        r = subprocess.run(cmd_concat, capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed: {r.stderr.decode()[:400]}")

    logger.info("Montage written: %s", output_path)
    return output_path


# ---------------------------------------------------------------------------
# Thumbnails
# ---------------------------------------------------------------------------

def extract_thumbnails(
    video_path: Path | str,
    clips: list[Clip],
    output_dir: Path | str,
) -> list[Clip]:
    """
    Extract one thumbnail frame per clip (at the shot timestamp).
    Sets clip.thumbnail_url and returns updated clip list.
    """
    if not shutil.which("ffmpeg"):
        logger.warning("ffmpeg not available — thumbnails skipped.")
        return clips

    video_path = Path(video_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    updated: list[Clip] = []

    for clip in clips:
        t_sec = (clip.t_start_ms + clip.t_end_ms) / 2 / 1000.0
        fname = f"thumb_clip{clip.clip_id:05d}.jpg"
        out   = output_dir / fname
        cmd   = [
            "ffmpeg", "-y",
            "-ss", f"{t_sec:.3f}",
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "4",
            str(out),
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0:
            clip.thumbnail_url = str(out)
        updated.append(clip)

    logger.info("Thumbnails: %d extracted to %s", len([c for c in updated if c.thumbnail_url]), output_dir)
    return updated


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def save_index(
    rallies: list[Rally],
    clips: list[Clip],
    output_dir: Path,
) -> tuple[Path, Path]:
    """Save rallies.json and clips.json."""
    output_dir.mkdir(parents=True, exist_ok=True)
    r_path = output_dir / "rallies.json"
    c_path = output_dir / "clips.json"
    with open(r_path, "w") as f:
        json.dump([asdict(r) for r in rallies], f, indent=2)
    with open(c_path, "w") as f:
        json.dump([asdict(c) for c in clips], f, indent=2)
    logger.info("Index saved: %d rallies, %d clips", len(rallies), len(clips))
    return r_path, c_path


def load_index(output_dir: Path) -> tuple[list[Rally], list[Clip]]:
    with open(output_dir / "rallies.json") as f:
        rallies = [Rally(**d) for d in json.load(f)]
    with open(output_dir / "clips.json") as f:
        clips   = [Clip(**d) for d in json.load(f)]
    return rallies, clips
