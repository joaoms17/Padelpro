"""
Pose-based stroke classification for the fast (condense) analysis path.

The fast path knows WHEN each hit happened (audio onsets) and WHO hit it
(tracking). This adds WHAT: around each hit it runs the real pose on the
hitter, classifies the stroke type, and returns the pose windows so the
correction/training loop works from the fast flow too.

Cheap by design — pose runs only on a short window of frames per hit (like
the ball pass), not on every frame. Fully defensive: any failure returns
empty results and the caller keeps the geometric stroke type.
"""

from __future__ import annotations
import logging

logger = logging.getLogger(__name__)


def _pixel_at(pts: list, t_s: float, max_gap_ms: float = 400.0):
    """Hitter's (centre_x, centre_y) in pixels nearest in time to t_s."""
    if not pts or len(pts[0]) < 7:
        return None
    t_ms = t_s * 1000.0
    p = min(pts, key=lambda p: abs(p[0] - t_ms))
    if abs(p[0] - t_ms) > max_gap_ms:
        return None
    return p[4], p[5]


def classify_clip_strokes(
    video_path,
    hit_records: list[dict],
    player_tracks: dict[int, list],
    *,
    sampled_fps: float,
    device: str = "cpu",
    window: int = 8,
    weights_path=None,
) -> tuple[dict[int, tuple[str, float]], dict[str, list]]:
    """
    Returns (types_by_hit_index, pose_windows).
      types_by_hit_index: {hit_idx: (stroke_type, confidence)} for hits the
                          pose classifier was confident about (!= "other").
      pose_windows:       {f"{player_id}:{frame_idx}": [[ [x,y]x17 ] x T]} —
                          bbox-normalised keypoints, for training.
    On any failure (no real pose backend, read error) returns ({}, {}).
    """
    try:
        import cv2

        from padelpro_vision.detection.detector import TorchvisionDetector
        from padelpro_vision.pose.estimator import PoseEstimator
        from padelpro_vision.strokes.classifier import (
            StrokeClassifier, pose_to_features, WINDOW_SIZE,
        )
    except Exception as exc:   # noqa: BLE001
        logger.warning("clip_strokes deps unavailable: %s", exc)
        return {}, {}

    estimator = PoseEstimator(device=device)
    if getattr(estimator, "backend", "stub") == "stub":
        logger.info("No real pose backend — skipping pose stroke classification.")
        return {}, {}

    detector = TorchvisionDetector(score_thr=0.35, device=device)
    clf = StrokeClassifier(
        mode="tcn" if weights_path else "rules",
        weights_path=weights_path,
        device=device,
    )

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    dt = 1.0 / max(1.0, sampled_fps)

    types: dict[int, tuple[str, float]] = {}
    pose_windows: dict[str, list] = {}

    for hi, hr in enumerate(hit_records):
        pid = hr.get("player_id")
        t = hr.get("t_s")
        pts = player_tracks.get(pid)
        if pid is None or t is None or not pts:
            continue

        clf.reset(pid)
        win_poses = []
        for k in range(window):
            tt = t - (window - 1 - k) * dt
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, tt * 1000.0))
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            pp = _pixel_at(pts, tt)
            if pp is None:
                continue
            hx, hy = pp
            dets = detector.detect(frame)
            if not dets:
                continue
            box = min(dets, key=lambda d: (d.center[0] - hx) ** 2 + (d.center[1] - hy) ** 2)
            pose = estimator.estimate(frame, box)
            clf.update(pid, pose)
            win_poses.append(pose)

        if len(win_poses) >= 2:
            stype, conf = clf.classify(pid)
            fidx = int(t * fps)
            hr["frame_idx"] = fidx
            pose_windows[f"{pid}:{fidx}"] = [
                pose_to_features(p).reshape(17, 2).tolist() for p in win_poses[-WINDOW_SIZE:]
            ]
            if stype != "other":
                types[hi] = (stype, float(conf))

    cap.release()
    logger.info(
        "Pose strokes: classified %d/%d hits, %d pose windows saved.",
        len(types), len(hit_records), len(pose_windows),
    )
    return types, pose_windows
