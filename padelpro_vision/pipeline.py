"""
M1 Pipeline: video → detection → tracking → CSV of positions + annotated video.

Segmentation, pose, analytics, Supabase: TODO (M2/M3/Seg milestones).
"""

from __future__ import annotations
import csv
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import AppConfig, DEFAULT_CONFIG
from padelpro_vision.io.video import VideoReader, VideoWriter, get_video_info
from padelpro_vision.tracking.tracker import Track, Tracker
from padelpro_vision.viz.visualizer import annotate_frame

logger = logging.getLogger(__name__)


@dataclass
class FrameResult:
    frame_idx: int
    timestamp_ms: float
    tracks: list[Track] = field(default_factory=list)


@dataclass
class PipelineResult:
    match_id: str
    video_path: Path
    frame_results: list[FrameResult] = field(default_factory=list)
    csv_path: Path | None = None
    annotated_video_path: Path | None = None


class Pipeline:
    """Orchestrates the M1 analysis pipeline."""

    def __init__(self, cfg: AppConfig | None = None) -> None:
        self._cfg = cfg or DEFAULT_CONFIG
        self._tracker = Tracker(self._cfg)

    def run(self, video_path: Path, output_dir: Path, match_id: str) -> PipelineResult:
        """M1: ingest → detect → track → CSV + annotated video."""
        video_path = Path(video_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        info = get_video_info(video_path)
        logger.info(
            "Processing %s  [%dx%d @ %.1f fps, %.1fs]",
            video_path.name, info["width"], info["height"],
            info["fps"], info["duration_ms"] / 1000,
        )

        csv_path = output_dir / f"{match_id}_positions.csv"
        annotated_path = output_dir / f"{match_id}_annotated.mp4"
        frame_results: list[FrameResult] = []

        try:
            from tqdm import tqdm
            use_tqdm = True
        except ImportError:
            use_tqdm = False

        with (
            VideoReader(video_path, skip_frames=self._cfg.video.input_skip_frames) as reader,
            VideoWriter(
                annotated_path,
                fps=info["fps"],
                width=info["width"],
                height=info["height"],
            ) as writer,
        ):
            total = info["total_frames"] // max(1, self._cfg.video.input_skip_frames)
            frames_iter = tqdm(reader, total=total, desc="M1 pipeline") if use_tqdm else reader
            for frame_idx, ts_ms, frame in frames_iter:
                tracks = self._tracker.track(frame, frame_idx, ts_ms)
                frame_results.append(FrameResult(frame_idx, ts_ms, tracks))
                writer.write(annotate_frame(frame, tracks))

        self._write_csv(frame_results, csv_path)
        logger.info("Done. CSV: %s | Video: %s", csv_path, annotated_path)

        return PipelineResult(
            match_id=match_id,
            video_path=video_path,
            frame_results=frame_results,
            csv_path=csv_path,
            annotated_video_path=annotated_path,
        )

    def _write_csv(self, results: list[FrameResult], output_path: Path) -> None:
        with open(output_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["frame_idx", "timestamp_ms", "track_id", "x1", "y1", "x2", "y2", "confidence"])
            for fr in results:
                for t in fr.tracks:
                    w.writerow([
                        fr.frame_idx, f"{fr.timestamp_ms:.1f}", t.track_id,
                        f"{t.box.x1:.1f}", f"{t.box.y1:.1f}",
                        f"{t.box.x2:.1f}", f"{t.box.y2:.1f}",
                        f"{t.box.confidence:.3f}",
                    ])
