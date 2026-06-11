"""
Pipeline: video → [segmentation] → detection → tracking → [pose + strokes] → CSV + outputs.

--segment   : run segmentation first, process only rally frames (saves 50–70% compute).
--condense  : produce condensed video without dead time.
--pose      : run RTMPose + stroke classifier on tracked players (M2).
Analytics and Supabase: TODO (M3).
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
    # M2 additions: poses and shot events emitted this frame
    shot_events: list = field(default_factory=list)


@dataclass
class PipelineResult:
    match_id: str
    video_path: Path
    frame_results: list[FrameResult] = field(default_factory=list)
    csv_path: Path | None = None
    annotated_video_path: Path | None = None
    segments_path: Path | None = None
    condensed_video_path: Path | None = None
    shot_events_path: Path | None = None


class Pipeline:
    """Orchestrates the full analysis pipeline (M1 + Segmentation + M2 pose/strokes)."""

    def __init__(self, cfg: AppConfig | None = None) -> None:
        self._cfg = cfg or DEFAULT_CONFIG
        self._tracker = Tracker(self._cfg)

    def run(
        self,
        video_path: Path,
        output_dir: Path,
        match_id: str,
        *,
        segment: bool = False,
        condense: bool = False,
        pose: bool = False,
    ) -> PipelineResult:
        """
        Full pipeline run.

        Args:
            segment: Run segmentation first (faster processing).
            condense: Write condensed video (requires segment=True).
            pose:     Run RTMPose + stroke classifier (M2).
        """
        video_path = Path(video_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        info = get_video_info(video_path)
        logger.info(
            "Processing %s  [%dx%d @ %.1f fps, %.1fs]",
            video_path.name, info["width"], info["height"],
            info["fps"], info["duration_ms"] / 1000,
        )

        # ----------------------------------------------------------------
        # Segmentation (optional)
        # ----------------------------------------------------------------
        active_intervals: list[tuple[float, float]] | None = None
        rally_index: list[tuple[float, float]] = []   # for assigning rally_id
        segments_path: Path | None = None
        condensed_path: Path | None = None

        if segment:
            from padelpro_vision.segmentation.segmentation import get_active_segments
            segs = get_active_segments(
                video_path,
                enter_thresh=self._cfg.segmentation.play_score_threshold_enter,
                exit_thresh=self._cfg.segmentation.play_score_threshold_exit,
                min_rally_s=self._cfg.segmentation.min_rally_duration_s,
                gap_merge_s=self._cfg.segmentation.gap_merge_threshold_s,
                padding_before_s=self._cfg.segmentation.padding_before_s,
                padding_after_s=self._cfg.segmentation.padding_after_s,
                break_gap_s=self._cfg.segmentation.break_gap_threshold_s,
                output_dir=output_dir,
            )
            active_intervals = [(s.start_ms, s.end_ms) for s in segs if s.type == "rally"]
            rally_index = active_intervals
            segments_path = output_dir / "segments.json"
            skipped_pct = 100.0 * (1.0 - sum(e - s for s, e in active_intervals) / max(1, info["duration_ms"]))
            logger.info("Segmentation: %d rallies, skipping %.0f%% of video.", len(active_intervals), skipped_pct)

            if condense:
                from padelpro_vision.io.condense import condense_video
                condensed_path = output_dir / f"{match_id}_condensed.mp4"
                try:
                    condense_video(video_path, segs, condensed_path)
                except Exception as exc:
                    logger.warning("Condense failed: %s", exc)
                    condensed_path = None

        # ----------------------------------------------------------------
        # M2: pose + stroke classifier setup (optional)
        # ----------------------------------------------------------------
        pose_estimator = None
        stroke_clf     = None
        all_shot_events: list = []

        if pose:
            from padelpro_vision.pose.estimator import PoseEstimator
            from padelpro_vision.strokes.classifier import StrokeClassifier
            from padelpro_vision.strokes.shot_event import ShotEvent

            pose_estimator = PoseEstimator(
                config_path=self._cfg.model.pose_config,
                weights_path=self._cfg.model.pose_weights,
                device=self._cfg.model.device,
            )
            stroke_clf = StrokeClassifier(mode="rules")   # switch to "tcn" once weights are ready

        # ----------------------------------------------------------------
        # Detection + tracking (+ optional M2)
        # ----------------------------------------------------------------
        csv_path       = output_dir / f"{match_id}_positions.csv"
        annotated_path = output_dir / f"{match_id}_annotated.mp4"
        frame_results: list[FrameResult] = []

        try:
            from tqdm import tqdm
            use_tqdm = True
        except ImportError:
            use_tqdm = False

        with (
            VideoReader(video_path, skip_frames=self._cfg.video.input_skip_frames) as reader,
            VideoWriter(annotated_path, fps=info["fps"], width=info["width"], height=info["height"]) as writer,
        ):
            total       = info["total_frames"] // max(1, self._cfg.video.input_skip_frames)
            frames_iter = tqdm(reader, total=total, desc="Pipeline") if use_tqdm else reader

            for frame_idx, ts_ms, frame in frames_iter:
                # Skip non-rally frames when segmentation is active
                if active_intervals is not None:
                    in_rally = any(s <= ts_ms <= e for s, e in active_intervals)
                    if not in_rally:
                        writer.write(frame)
                        continue

                tracks = self._tracker.track(frame, frame_idx, ts_ms)
                fr     = FrameResult(frame_idx, ts_ms, tracks)

                # M2: pose + strokes
                if pose_estimator is not None and stroke_clf is not None:
                    from padelpro_vision.strokes.shot_event import ShotEvent
                    for t in tracks:
                        p = pose_estimator.estimate(frame, t.box)
                        stroke_clf.update(t.track_id, p)
                        stroke_type, conf = stroke_clf.classify(t.track_id)
                        if stroke_type != "other" and conf > 0.0:
                            # Determine rally_id
                            rally_id = next(
                                (i for i, (s, e) in enumerate(rally_index) if s <= ts_ms <= e),
                                -1,
                            )
                            ev = ShotEvent(
                                match_id=match_id,
                                player_id=t.track_id,
                                rally_id=rally_id,
                                ts_ms=ts_ms,
                                stroke_type=stroke_type,
                                confidence=conf,
                                frame_idx=frame_idx,
                            )
                            fr.shot_events.append(ev)
                            all_shot_events.append(ev)

                frame_results.append(fr)
                writer.write(annotate_frame(frame, tracks))

        self._write_csv(frame_results, csv_path)

        # Save shot events (M2)
        shot_events_path: Path | None = None
        if all_shot_events:
            from padelpro_vision.strokes.shot_event import save_shot_events
            shot_events_path = output_dir / f"{match_id}_shot_events.json"
            save_shot_events(all_shot_events, shot_events_path)
            logger.info("Shot events: %d → %s", len(all_shot_events), shot_events_path)

        logger.info("Done. CSV: %s | Video: %s", csv_path, annotated_path)

        return PipelineResult(
            match_id=match_id,
            video_path=video_path,
            frame_results=frame_results,
            csv_path=csv_path,
            annotated_video_path=annotated_path,
            segments_path=segments_path,
            condensed_video_path=condensed_path,
            shot_events_path=shot_events_path,
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
