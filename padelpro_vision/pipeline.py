"""
Pipeline: video → [segmentation] → detection → tracking → [pose+strokes] → [analytics] → outputs.

Flags:
  --segment   : remove dead time before heavy processing (saves 50–70% compute)
  --condense  : produce condensed video (requires --segment)
  --pose      : RTMPose + stroke classifier (M2)
  --analytics : 2D projection + per-player stats + Supabase write (M3)
"""

from __future__ import annotations
import csv
import json
import logging
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import AppConfig, DEFAULT_CONFIG
from padelpro_vision.io.video import VideoReader, VideoWriter, get_video_info
from padelpro_vision.tracking.tracker import Track, Tracker
from padelpro_vision.viz.visualizer import annotate_frame, draw_mini_court

logger = logging.getLogger(__name__)


@dataclass
class FrameResult:
    frame_idx: int
    timestamp_ms: float
    tracks: list[Track] = field(default_factory=list)
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
    analytics_path: Path | None = None


class Pipeline:
    """Orchestrates the full analysis pipeline (M1 + Seg + M2 + M3)."""

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
        analytics: bool = False,
        homography_path: Path | None = None,
        team_map: dict[int, int] | None = None,
        supabase: bool = False,
    ) -> PipelineResult:
        """
        Full pipeline.

        Args:
            segment:          Segmentation (skip dead time).
            condense:         Write condensed video.
            pose:             Pose estimation + stroke classification.
            analytics:        2D projection, per-player stats, chart outputs.
            homography_path:  Path to court homography JSON (required for analytics).
            team_map:         {track_id: 0|1} for zone computation. Auto-assigned if None.
            supabase:         Push results to Supabase.
        """
        video_path = Path(video_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        t_start = time.monotonic()

        info = get_video_info(video_path)
        logger.info(
            "Processing %s  [%dx%d @ %.1f fps, %.1fs]",
            video_path.name, info["width"], info["height"],
            info["fps"], info["duration_ms"] / 1000,
        )

        # ----------------------------------------------------------------
        # Segmentation
        # ----------------------------------------------------------------
        active_intervals: list[tuple[float, float]] | None = None
        rally_index: list[tuple[float, float]] = []
        segments_path: Path | None = None
        condensed_path: Path | None = None
        segs_for_supabase = []

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
            rally_index       = active_intervals
            segments_path     = output_dir / "segments.json"
            segs_for_supabase = segs
            skipped = 100.0 * (1.0 - sum(e - s for s, e in active_intervals) / max(1, info["duration_ms"]))
            logger.info("Segmentation: %d rallies, skipping %.0f%% of video.", len(active_intervals), skipped)

            if condense:
                from padelpro_vision.io.condense import condense_video
                condensed_path = output_dir / f"{match_id}_condensed.mp4"
                try:
                    condense_video(video_path, segs, condensed_path)
                except Exception as exc:
                    logger.warning("Condense failed: %s", exc)
                    condensed_path = None

        # ----------------------------------------------------------------
        # Load homography (analytics + court gating of detections)
        # ----------------------------------------------------------------
        H: np.ndarray | None = None
        homography_quality: dict | None = None
        if homography_path and Path(homography_path).exists():
            from padelpro_vision.calibration.calibration import CourtCalibrator
            cal = CourtCalibrator(Path(homography_path).parent)
            court_id = Path(homography_path).stem
            H = cal.load(court_id)
            homography_quality = cal.load_quality(court_id)
        if analytics and H is None:
            logger.warning(
                "No homography available for analytics — court positions will be pixel-based. "
                "Run scripts/calibrate_court.py first."
            )

        # Court gate: drop detections whose feet land far off the court
        # (spectators, neighbouring courts) before they pollute tracking.
        if H is not None:
            from padelpro_vision.tracking.tracker import make_court_gate
            self._tracker.detection_filter = make_court_gate(
                H,
                margin_x_m=self._cfg.quality.court_margin_x_m,
                margin_y_m=self._cfg.quality.court_margin_y_m,
            )

        # ----------------------------------------------------------------
        # Pose + stroke setup
        # ----------------------------------------------------------------
        pose_estimator = None
        stroke_clf     = None

        if pose:
            from padelpro_vision.pose.estimator import PoseEstimator
            from padelpro_vision.strokes.classifier import StrokeClassifier
            pose_estimator = PoseEstimator(
                config_path=self._cfg.model.pose_config,
                weights_path=self._cfg.model.pose_weights,
                device=self._cfg.model.device,
            )
            # Use the trained TCN when available (feedback loop retrains it);
            # StrokeClassifier falls back to rules if loading fails.
            tcn_weights = self._cfg.model.checkpoints_dir / "stroke_tcn.pth"
            if tcn_weights.exists():
                stroke_clf = StrokeClassifier(mode="tcn", weights_path=tcn_weights,
                                              device=self._cfg.model.device)
            else:
                stroke_clf = StrokeClassifier(mode="rules")

        # ----------------------------------------------------------------
        # Detection + tracking loop
        # ----------------------------------------------------------------
        csv_path       = output_dir / f"{match_id}_positions.csv"
        annotated_path = output_dir / f"{match_id}_annotated.mp4"
        frame_results: list[FrameResult] = []
        all_shot_events: list = []
        # {track_id: [(ts_ms, px, py)]}  — pixel foot positions
        pixel_positions: dict[int, list] = {}
        # {"player:frame": normalised 17x2 keypoint window} — training features
        # for the feedback loop (saved only for events that survive fusion)
        pose_windows: dict[str, list] = {}

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
                if active_intervals is not None:
                    in_rally = any(s <= ts_ms <= e for s, e in active_intervals)
                    if not in_rally:
                        writer.write(frame)
                        continue

                tracks = self._tracker.track(frame, frame_idx, ts_ms)
                fr     = FrameResult(frame_idx, ts_ms, tracks)

                # Collect pixel positions for analytics
                for t in tracks:
                    from padelpro_vision.projection.projection import foot_point
                    px, py = foot_point(t.box)
                    pixel_positions.setdefault(t.track_id, []).append((ts_ms, px, py))

                # M2: pose + strokes
                if pose_estimator is not None and stroke_clf is not None:
                    from padelpro_vision.strokes.classifier import pose_to_features
                    from padelpro_vision.strokes.shot_event import ShotEvent
                    for t in tracks:
                        p = pose_estimator.estimate(frame, t.box)
                        stroke_clf.update(t.track_id, p)
                        stroke_type, conf = stroke_clf.classify(t.track_id)
                        if stroke_type != "other":
                            window = list(stroke_clf._windows.get(t.track_id, []))
                            pose_windows[f"{t.track_id}:{frame_idx}"] = [
                                pose_to_features(pw).reshape(17, 2).tolist()
                                for pw in window
                            ]
                            rally_id = next(
                                (i for i, (s, e) in enumerate(rally_index) if s <= ts_ms <= e), -1
                            )
                            ev = ShotEvent(
                                match_id=match_id,
                                player_id=t.track_id,
                                rally_id=rally_id,
                                ts_ms=ts_ms,
                                stroke_type=stroke_type,
                                confidence=conf,
                                frame_idx=frame_idx,
                                wrist_speed=stroke_clf.wrist_speed(t.track_id),
                            )
                            fr.shot_events.append(ev)
                            all_shot_events.append(ev)

                frame_results.append(fr)

                # Annotate: boxes + mini court (if H available)
                annotated = annotate_frame(frame, tracks)
                if H is not None:
                    from padelpro_vision.projection.projection import project_point
                    court_pts = {}
                    for t in tracks:
                        from padelpro_vision.projection.projection import foot_point
                        fpx, fpy = foot_point(t.box)
                        cx, cy   = project_point(H, fpx, fpy)
                        court_pts[t.track_id] = (cx, cy)
                    annotated = draw_mini_court(annotated, court_pts)
                writer.write(annotated)

        self._write_csv(frame_results, csv_path)

        # ----------------------------------------------------------------
        # Shot events: consolidate per-frame bursts + audio onset cross-check
        # ----------------------------------------------------------------
        shot_events_path: Path | None = None
        if all_shot_events:
            from padelpro_vision.strokes.audio_fusion import (
                consolidate_shot_events,
                fuse_events_with_onsets,
            )
            n_raw = len(all_shot_events)
            all_shot_events = consolidate_shot_events(
                all_shot_events, min_gap_ms=self._cfg.strokes.event_min_gap_ms
            )
            try:
                from padelpro_vision.segmentation.segmentation import get_audio_onsets
                onsets = get_audio_onsets(video_path)
            except Exception as exc:
                logger.warning("Audio onset extraction failed: %s", exc)
                onsets = []
            all_shot_events = fuse_events_with_onsets(
                all_shot_events,
                onsets,
                tolerance_ms=self._cfg.strokes.audio_onset_tolerance_ms,
                drop_without_onset=self._cfg.strokes.drop_events_without_onset,
            )
            logger.info(
                "Shot events: %d raw → %d after consolidation + audio fusion.",
                n_raw, len(all_shot_events),
            )
        if all_shot_events:
            from padelpro_vision.strokes.shot_event import save_shot_events
            # Fill court positions if H is available
            if H is not None:
                from padelpro_vision.projection.projection import project_point
                for ev in all_shot_events:
                    pos = pixel_positions.get(ev.player_id, [])
                    closest = min(pos, key=lambda p: abs(p[0] - ev.ts_ms), default=None)
                    if closest:
                        ev.court_x, ev.court_y = project_point(H, closest[1], closest[2])
            shot_events_path = output_dir / f"{match_id}_shot_events.json"
            save_shot_events(all_shot_events, shot_events_path)
            logger.info("Shot events: %d → %s", len(all_shot_events), shot_events_path)

            # Keep the pose windows of surviving events — these are the
            # training features the review page corrections attach to.
            if pose_windows:
                keys = {f"{ev.player_id}:{ev.frame_idx}" for ev in all_shot_events}
                kept = {k: v for k, v in pose_windows.items() if k in keys}
                with open(output_dir / f"{match_id}_pose_windows.json", "w") as f:
                    json.dump(kept, f)
                logger.info("Pose windows kept for %d events.", len(kept))

        # ----------------------------------------------------------------
        # Projection to court coordinates (when calibrated)
        # ----------------------------------------------------------------
        track_positions = self._project_positions(pixel_positions, H)

        # ----------------------------------------------------------------
        # Analytics (M3)
        # ----------------------------------------------------------------
        analytics_path: Path | None = None
        if analytics:
            analytics_path = self._run_analytics(
                match_id, track_positions, all_shot_events,
                team_map, output_dir, supabase, segs_for_supabase,
            )

        # ----------------------------------------------------------------
        # Quality telemetry + active-learning review queue
        # ----------------------------------------------------------------
        try:
            from padelpro_vision.quality.report import build_quality_report, save_quality_report
            report = build_quality_report(
                match_id,
                frame_results,
                track_positions if H is not None else None,
                all_shot_events,
                expected_players=self._cfg.quality.expected_players,
                max_plausible_speed_ms=self._cfg.quality.max_plausible_speed_ms,
                teleport_jump_m=self._cfg.quality.teleport_jump_m,
                homography_quality=homography_quality,
                processing_elapsed_s=time.monotonic() - t_start,
                video_duration_s=info["duration_ms"] / 1000.0,
            )
            save_quality_report(report, output_dir)
        except Exception as exc:
            logger.warning("Quality report failed: %s", exc)

        if pose:
            try:
                from padelpro_vision.quality.active_learning import (
                    build_review_queue, save_review_queue,
                )
                queue = build_review_queue(
                    all_shot_events,
                    frame_results,
                    confidence_threshold=self._cfg.strokes.review_confidence_threshold,
                    expected_players=self._cfg.quality.expected_players,
                )
                save_review_queue(queue, output_dir)
            except Exception as exc:
                logger.warning("Review queue failed: %s", exc)

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
            analytics_path=analytics_path,
        )

    # ------------------------------------------------------------------

    @staticmethod
    def _project_positions(
        pixel_positions: dict[int, list],
        H: np.ndarray | None,
    ) -> dict[int, list]:
        """Project pixel foot positions to court metres (or pass through pixels)."""
        if H is None:
            return pixel_positions
        from padelpro_vision.projection.projection import project_points
        track_positions: dict[int, list] = {}
        for tid, pts in pixel_positions.items():
            arr = np.array([[p[1], p[2]] for p in pts], dtype=np.float64)
            court = project_points(H, arr)
            track_positions[tid] = [
                (pts[i][0], float(court[i, 0]), float(court[i, 1]))
                for i in range(len(pts))
            ]
        return track_positions

    def _run_analytics(
        self,
        match_id: str,
        track_positions: dict[int, list],
        shot_events: list,
        team_map: dict[int, int] | None,
        output_dir: Path,
        supabase: bool,
        segs: list,
    ) -> Path:
        from padelpro_vision.analytics.analytics import compute_match_analytics

        # Auto team_map: sort track IDs, assign first half to team 0
        if team_map is None:
            ids = sorted(track_positions.keys())
            half = max(1, len(ids) // 2)
            team_map = {tid: (0 if i < half else 1) for i, tid in enumerate(ids)}

        result = compute_match_analytics(match_id, track_positions, shot_events, team_map)

        # Save analytics JSON
        out_data = {
            "match_id": match_id,
            "sync_score": result.sync_score,
            "player_stats": [asdict(ps) for ps in result.player_stats],
        }
        analytics_path = output_dir / f"{match_id}_analytics.json"
        with open(analytics_path, "w") as f:
            json.dump(out_data, f, indent=2)
        logger.info("Analytics saved to %s", analytics_path)

        # Generate charts
        try:
            from padelpro_vision.viz.visualizer import heatmap_image, shot_distribution_chart
            import cv2
            for ps in result.player_stats:
                hm = heatmap_image(ps.heatmap_json, ps.player_id)
                cv2.imwrite(str(output_dir / f"heatmap_player{ps.player_id}.png"), hm)
            if result.player_stats:
                chart = shot_distribution_chart(result.player_stats)
                cv2.imwrite(str(output_dir / "shot_distribution.png"), chart)
        except Exception as exc:
            logger.warning("Chart generation failed: %s", exc)

        # Build clip index (Indexing milestone)
        from padelpro_vision.indexing.indexer import build_rallies, build_clips, save_index
        rallies = build_rallies(match_id, segs)
        clips   = build_clips(match_id, shot_events, rallies)
        save_index(rallies, clips, output_dir)
        logger.info("Index: %d rallies, %d clips", len(rallies), len(clips))

        # Supabase push
        if supabase:
            self._push_to_supabase(match_id, result, shot_events, segs, rallies, clips)

        return analytics_path

    def _push_to_supabase(
        self, match_id: str, result, shot_events: list, segs: list,
        rallies: list | None = None, clips: list | None = None,
    ) -> None:
        from padelpro_vision.io.supabase_client import SupabaseClient
        db = SupabaseClient()
        if not db.connected:
            logger.warning("Supabase not connected — skipping push.")
            return
        db.upsert_player_stats(result.player_stats)
        if shot_events:
            db.upsert_shot_events(shot_events)
        if segs:
            db.upsert_segments(match_id, segs)
        if rallies:
            db.upsert_rallies(match_id, [vars(r) for r in rallies])
        if clips:
            from dataclasses import asdict
            db.upsert_clips([asdict(c) for c in clips])

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
