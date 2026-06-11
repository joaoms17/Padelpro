"""Video I/O utilities using OpenCV."""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def get_video_info(path: Path | str) -> dict:
    """Return basic metadata for a video file."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Video not found: {path}")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    duration_ms = (total_frames / fps * 1000) if fps > 0 else 0.0
    return {
        "fps": fps,
        "width": width,
        "height": height,
        "total_frames": total_frames,
        "duration_ms": duration_ms,
    }


class VideoReader:
    """Iterate over video frames as (frame_idx, timestamp_ms, frame_bgr)."""

    def __init__(self, path: Path | str, skip_frames: int = 1) -> None:
        self.path = Path(path)
        self.skip_frames = max(1, skip_frames)
        self._cap: cv2.VideoCapture | None = None

    def __enter__(self) -> "VideoReader":
        if not self.path.exists():
            raise FileNotFoundError(f"Video not found: {self.path}")
        self._cap = cv2.VideoCapture(str(self.path))
        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open video: {self.path}")
        return self

    def __exit__(self, *_) -> None:
        if self._cap:
            self._cap.release()

    def __iter__(self) -> Iterator[tuple[int, float, np.ndarray]]:
        assert self._cap is not None, "Use VideoReader as a context manager."
        fps = self._cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_idx = 0
        while True:
            ret, frame = self._cap.read()
            if not ret:
                break
            if frame_idx % self.skip_frames == 0:
                timestamp_ms = (frame_idx / fps) * 1000.0
                yield frame_idx, timestamp_ms, frame
            frame_idx += 1


class VideoWriter:
    """Write frames to an output video file."""

    def __init__(
        self,
        path: Path | str,
        fps: float,
        width: int,
        height: int,
        fourcc: str = "mp4v",
    ) -> None:
        self.path = Path(path)
        self.fps = fps
        self.width = width
        self.height = height
        self.fourcc = fourcc
        self._writer: cv2.VideoWriter | None = None

    def __enter__(self) -> "VideoWriter":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        cc = cv2.VideoWriter_fourcc(*self.fourcc)
        self._writer = cv2.VideoWriter(str(self.path), cc, self.fps, (self.width, self.height))
        return self

    def __exit__(self, *_) -> None:
        if self._writer:
            self._writer.release()

    def write(self, frame: np.ndarray) -> None:
        assert self._writer is not None, "Use VideoWriter as a context manager."
        self._writer.write(frame)
