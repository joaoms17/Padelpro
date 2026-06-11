"""
Rally segmentation: remove dead time (between points and sets) before the heavy pipeline.

Approach (cheap, no ball tracking):
  1. Audio: ffmpeg → WAV → short-time energy + onset detection (ball impacts).
  2. Video: low-res + ~5 fps frame differencing → motion energy in court region.
  3. Combine into play_score per second [0..1]; state machine with hysteresis.

Outputs:
  - segments.json : [{start_ms, end_ms, type: "rally"|"break"}]
  - timestamp_map.json : [{condensed_ms, real_ms}]
"""

from __future__ import annotations

import json
import logging
import shutil
import struct
import subprocess
import tempfile
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SegmentType = Literal["rally", "break"]


@dataclass
class Segment:
    start_ms: float
    end_ms: float
    type: SegmentType

    @property
    def duration_ms(self) -> float:
        return self.end_ms - self.start_ms


# ---------------------------------------------------------------------------
# Audio analysis
# ---------------------------------------------------------------------------

def _extract_audio_wav(video_path: Path, out_wav: Path) -> bool:
    """Extract mono 16-kHz WAV from video using ffmpeg. Returns True on success."""
    if not shutil.which("ffmpeg"):
        logger.warning("ffmpeg not found — audio signal disabled.")
        return False
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-ac", "1", "-ar", "16000", "-vn",
        str(out_wav),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        logger.warning("ffmpeg audio extraction failed: %s", result.stderr.decode()[:200])
        return False
    return True


def _audio_energy_per_second(wav_path: Path) -> np.ndarray:
    """Return RMS energy per second from a mono 16-kHz WAV file."""
    with wave.open(str(wav_path), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    fmt = {1: "B", 2: "h", 4: "i"}.get(sampwidth, "h")
    samples = np.array(struct.unpack(f"{n_frames * n_channels}{fmt}", raw), dtype=np.float32)
    if n_channels > 1:
        samples = samples.reshape(-1, n_channels).mean(axis=1)
    if sampwidth == 1:
        samples = samples - 128.0  # unsigned 8-bit → signed

    # Normalise
    peak = np.abs(samples).max()
    if peak > 0:
        samples /= peak

    # RMS per second
    n_seconds = max(1, int(np.ceil(n_frames / framerate)))
    energy = np.zeros(n_seconds, dtype=np.float32)
    for i in range(n_seconds):
        s = samples[i * framerate: (i + 1) * framerate]
        if len(s) > 0:
            energy[i] = float(np.sqrt(np.mean(s ** 2)))
    return energy


# ---------------------------------------------------------------------------
# Motion analysis
# ---------------------------------------------------------------------------

def _motion_energy_per_second(video_path: Path, target_fps: float = 5.0, scale: float = 0.25) -> np.ndarray:
    """
    Return mean absolute frame-difference per second at low resolution.
    Uses every Nth frame to approximate target_fps.
    """
    cap = cv2.VideoCapture(str(video_path))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_s = total_frames / src_fps
    step = max(1, int(src_fps / target_fps))

    n_seconds = max(1, int(np.ceil(duration_s)))
    motion = np.zeros(n_seconds, dtype=np.float32)
    counts = np.zeros(n_seconds, dtype=np.int32)

    prev_gray: np.ndarray | None = None
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            small = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
            if prev_gray is not None:
                diff = np.abs(gray - prev_gray).mean()
                sec = int(frame_idx / src_fps)
                if sec < n_seconds:
                    motion[sec] += diff
                    counts[sec] += 1
            prev_gray = gray
        frame_idx += 1
    cap.release()

    nonzero = counts > 0
    motion[nonzero] /= counts[nonzero]
    peak = motion.max()
    if peak > 0:
        motion /= peak
    return motion


# ---------------------------------------------------------------------------
# Play score + state machine
# ---------------------------------------------------------------------------

def _compute_play_score(
    audio_energy: np.ndarray | None,
    motion_energy: np.ndarray,
    audio_weight: float = 0.5,
) -> np.ndarray:
    n = len(motion_energy)
    if audio_energy is not None and len(audio_energy) > 0:
        # align lengths
        a = audio_energy[:n] if len(audio_energy) >= n else np.pad(audio_energy, (0, n - len(audio_energy)))
        score = audio_weight * a + (1.0 - audio_weight) * motion_energy
    else:
        score = motion_energy.copy()
    return np.clip(score, 0.0, 1.0)


def _state_machine(
    play_score: np.ndarray,
    enter_thresh: float,
    exit_thresh: float,
    min_rally_s: float,
    gap_merge_s: float,
    padding_before_s: float,
    padding_after_s: float,
    break_gap_s: float,
) -> list[Segment]:
    """Hysteresis state machine over per-second play_score → list[Segment]."""
    n = len(play_score)
    in_rally = False
    rally_start: int | None = None
    raw_rallies: list[tuple[int, int]] = []

    # Minimum consecutive seconds to enter/exit
    enter_confirm = max(1, int(1.0))   # 1 s high
    exit_confirm  = max(1, int(2.5))   # 2.5 s low

    high_streak = 0
    low_streak = 0

    for i, score in enumerate(play_score):
        if not in_rally:
            if score >= enter_thresh:
                high_streak += 1
                low_streak = 0
            else:
                high_streak = 0
            if high_streak >= enter_confirm:
                rally_start = max(0, i - high_streak + 1)
                in_rally = True
                high_streak = 0
        else:
            if score < exit_thresh:
                low_streak += 1
                high_streak = 0
            else:
                low_streak = 0
            if low_streak >= exit_confirm:
                rally_end = i - low_streak + 1
                raw_rallies.append((rally_start, rally_end))  # type: ignore[arg-type]
                in_rally = False
                low_streak = 0
                rally_start = None

    if in_rally and rally_start is not None:
        raw_rallies.append((rally_start, n))

    # Discard short rallies
    rallies = [(s, e) for s, e in raw_rallies if (e - s) >= min_rally_s]

    # Merge rallies with small gap
    merged: list[tuple[int, int]] = []
    for s, e in rallies:
        if merged and (s - merged[-1][1]) <= gap_merge_s:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))

    # Apply padding and convert to Segment (ms)
    segments: list[Segment] = []
    prev_end_ms = 0.0
    for s, e in merged:
        start_ms = max(0.0, (s - padding_before_s) * 1000.0)
        end_ms   = min(n * 1000.0, (e + padding_after_s) * 1000.0)

        # Insert break if gap is large enough
        if prev_end_ms > 0 and (start_ms - prev_end_ms) > break_gap_s * 1000.0:
            segments.append(Segment(prev_end_ms, start_ms, "break"))

        segments.append(Segment(start_ms, end_ms, "rally"))
        prev_end_ms = end_ms

    return segments


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_active_segments(
    video_path: Path | str,
    *,
    enter_thresh: float = 0.6,
    exit_thresh: float = 0.3,
    min_rally_s: float = 3.0,
    gap_merge_s: float = 3.0,
    padding_before_s: float = 2.0,
    padding_after_s: float = 1.0,
    break_gap_s: float = 45.0,
    audio_weight: float = 0.5,
    output_dir: Path | None = None,
) -> list[Segment]:
    """
    Analyse a video and return active rally segments.
    Optionally write segments.json and timestamp_map.json to output_dir.
    """
    video_path = Path(video_path)
    logger.info("Segmenting %s …", video_path.name)

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        has_audio = _extract_audio_wav(video_path, wav)
        audio_energy = _audio_energy_per_second(wav) if has_audio and wav.exists() else None

    motion_energy = _motion_energy_per_second(video_path)
    play_score    = _compute_play_score(audio_energy, motion_energy, audio_weight)

    segments = _state_machine(
        play_score,
        enter_thresh=enter_thresh,
        exit_thresh=exit_thresh,
        min_rally_s=min_rally_s,
        gap_merge_s=gap_merge_s,
        padding_before_s=padding_before_s,
        padding_after_s=padding_after_s,
        break_gap_s=break_gap_s,
    )

    rally_count = sum(1 for s in segments if s.type == "rally")
    total_rally_s = sum(s.duration_ms for s in segments if s.type == "rally") / 1000
    logger.info(
        "Found %d rallies (%.1f s total) out of %.1f s video.",
        rally_count, total_rally_s, len(play_score),
    )

    if output_dir is not None:
        _write_outputs(segments, play_score, Path(output_dir))

    return segments


def build_timestamp_map(segments: list[Segment]) -> list[dict]:
    """
    Build a condensed_ms → real_ms mapping from rally segments.
    Condensed time starts at 0 and advances only during rallies.
    """
    mapping: list[dict] = []
    condensed_ms = 0.0
    for seg in segments:
        if seg.type != "rally":
            continue
        # Sample every 100 ms
        t = seg.start_ms
        while t <= seg.end_ms:
            mapping.append({"condensed_ms": condensed_ms, "real_ms": t})
            condensed_ms += 100.0
            t += 100.0
    return mapping


def _write_outputs(segments: list[Segment], play_score: np.ndarray, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    seg_path = output_dir / "segments.json"
    with open(seg_path, "w") as f:
        json.dump([asdict(s) for s in segments], f, indent=2)
    logger.info("Segments written to %s", seg_path)

    ts_map = build_timestamp_map(segments)
    ts_path = output_dir / "timestamp_map.json"
    with open(ts_path, "w") as f:
        json.dump(ts_map, f, indent=2)
    logger.info("Timestamp map written to %s (%d entries)", ts_path, len(ts_map))

    score_path = output_dir / "play_score.json"
    with open(score_path, "w") as f:
        json.dump({"play_score_per_second": play_score.tolist()}, f, indent=2)
