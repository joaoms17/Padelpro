"""
Visualisation utilities.

M1:  annotate_frame   — bounding boxes + track IDs.
M3:  draw_mini_court  — 2D court overlay with player dots.
M3:  heatmap_image    — coloured occupancy heatmap (matplotlib → numpy BGR).
M3:  shot_distribution_chart — bar chart of stroke counts per player.
"""

from __future__ import annotations
import json
import logging
from pathlib import Path

import cv2
import numpy as np

from padelpro_vision.constants.court import COURT_LENGTH_M, COURT_WIDTH_M

logger = logging.getLogger(__name__)

# Colour palette per track_id (BGR)
_PALETTE = [
    (0, 255, 0), (0, 128, 255), (0, 255, 255), (255, 0, 128),
    (255, 128, 0), (128, 0, 255), (0, 200, 100), (200, 0, 200),
]


def _track_colour(track_id: int) -> tuple[int, int, int]:
    return _PALETTE[track_id % len(_PALETTE)]


# ---------------------------------------------------------------------------
# Frame-level annotation
# ---------------------------------------------------------------------------

def annotate_frame(frame: np.ndarray, tracks: list) -> np.ndarray:
    """Draw bounding boxes and track IDs (returns a copy)."""
    out = frame.copy()
    for t in tracks:
        b   = t.box
        col = _track_colour(t.track_id)
        x1, y1, x2, y2 = int(b.x1), int(b.y1), int(b.x2), int(b.y2)
        cv2.rectangle(out, (x1, y1), (x2, y2), col, 2)
        cv2.putText(out, f"#{t.track_id}  {b.confidence:.2f}",
                    (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 2)
    return out


def draw_skeleton(frame: np.ndarray, pose, track_id: int = 0) -> np.ndarray:
    """Draw COCO 17-keypoint skeleton onto frame."""
    # COCO skeleton pairs
    SKELETON = [
        (0, 1), (0, 2), (1, 3), (2, 4),           # head
        (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # arms
        (5, 11), (6, 12), (11, 12),                # torso
        (11, 13), (13, 15), (12, 14), (14, 16),    # legs
    ]
    col = _track_colour(track_id)
    kps = pose.keypoints
    out = frame.copy()
    for a, b in SKELETON:
        if pose.scores[a] > 0.3 and pose.scores[b] > 0.3:
            pt1 = (int(kps[a, 0]), int(kps[a, 1]))
            pt2 = (int(kps[b, 0]), int(kps[b, 1]))
            cv2.line(out, pt1, pt2, col, 2)
    for i in range(len(kps)):
        if pose.scores[i] > 0.3:
            cv2.circle(out, (int(kps[i, 0]), int(kps[i, 1])), 3, col, -1)
    return out


# ---------------------------------------------------------------------------
# Mini court overlay (2D top-down view)
# ---------------------------------------------------------------------------

def draw_mini_court(
    frame: np.ndarray,
    player_positions: dict[int, tuple[float, float]],
    *,
    court_w_px: int = 120,
    court_h_px: int = 240,
    margin: int = 10,
    corner: str = "bottom-right",
) -> np.ndarray:
    """
    Draw a top-down 2D court overlay in a corner of the frame.

    Args:
        player_positions: {track_id: (court_x_m, court_y_m)}
    """
    H, W = frame.shape[:2]
    out  = frame.copy()

    # Court background
    court_img = np.zeros((court_h_px, court_w_px, 3), dtype=np.uint8)
    cv2.rectangle(court_img, (0, 0), (court_w_px - 1, court_h_px - 1), (40, 40, 40), -1)
    cv2.rectangle(court_img, (1, 1), (court_w_px - 2, court_h_px - 2), (255, 255, 255), 1)

    # Net line
    net_y = int(court_h_px / 2)
    cv2.line(court_img, (0, net_y), (court_w_px, net_y), (0, 200, 255), 1)

    # Player dots
    for tid, (cx, cy) in player_positions.items():
        px = int(np.clip(cx / COURT_WIDTH_M  * court_w_px, 2, court_w_px  - 3))
        py = int(np.clip(cy / COURT_LENGTH_M * court_h_px, 2, court_h_px - 3))
        col = _track_colour(tid)
        cv2.circle(court_img, (px, py), 5, col, -1)
        cv2.putText(court_img, str(tid), (px + 5, py + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)

    # Place in corner
    if corner == "bottom-right":
        rx, ry = W - court_w_px - margin, H - court_h_px - margin
    elif corner == "top-right":
        rx, ry = W - court_w_px - margin, margin
    elif corner == "bottom-left":
        rx, ry = margin, H - court_h_px - margin
    else:
        rx, ry = margin, margin

    rx, ry = max(0, rx), max(0, ry)
    out[ry: ry + court_h_px, rx: rx + court_w_px] = court_img
    return out


# ---------------------------------------------------------------------------
# Static charts (matplotlib → numpy BGR)
# ---------------------------------------------------------------------------

def heatmap_image(
    heatmap_json: str,
    player_id: int,
    width_px: int = 400,
    height_px: int = 800,
) -> np.ndarray:
    """
    Convert a heatmap JSON (list-of-lists, normalised) to a coloured BGR image.
    Returns a numpy array ready to be written with cv2.imwrite or VideoWriter.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.cm as cm
        from io import BytesIO
    except ImportError:
        logger.warning("matplotlib not installed — heatmap_image unavailable.")
        return np.zeros((height_px, width_px, 3), dtype=np.uint8)

    grid = np.array(json.loads(heatmap_json), dtype=np.float32)
    fig, ax = plt.subplots(figsize=(width_px / 100, height_px / 100), dpi=100)
    ax.imshow(grid, cmap="hot", vmin=0, vmax=1, origin="upper",
              extent=[0, COURT_WIDTH_M, COURT_LENGTH_M, 0])
    ax.set_title(f"Player {player_id} — Heatmap", fontsize=10)
    ax.set_xlabel("Court width (m)")
    ax.set_ylabel("Court length (m)")
    plt.colorbar(ax.images[0], ax=ax, fraction=0.03)
    plt.tight_layout()

    buf = BytesIO()
    plt.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    img_arr = np.frombuffer(buf.getvalue(), np.uint8)
    img_bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    return cv2.resize(img_bgr, (width_px, height_px))


def shot_distribution_chart(
    stats_list: list,
    width_px: int = 600,
    height_px: int = 400,
) -> np.ndarray:
    """
    Bar chart of stroke distribution per player.
    stats_list: list[PlayerStats]
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from io import BytesIO
    except ImportError:
        logger.warning("matplotlib not installed — shot_distribution_chart unavailable.")
        return np.zeros((height_px, width_px, 3), dtype=np.uint8)

    from padelpro_vision.strokes.classifier import STROKE_CLASSES

    fig, ax = plt.subplots(figsize=(width_px / 100, height_px / 100), dpi=100)
    x     = np.arange(len(STROKE_CLASSES))
    width = 0.8 / max(1, len(stats_list))

    for i, ps in enumerate(stats_list):
        counts = json.loads(ps.shots_json)
        vals   = [counts.get(s, 0) for s in STROKE_CLASSES]
        offset = (i - len(stats_list) / 2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=f"P{ps.player_id}")

    ax.set_xticks(x)
    ax.set_xticklabels(STROKE_CLASSES, rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("Count")
    ax.set_title("Shot Distribution")
    ax.legend(fontsize=8)
    plt.tight_layout()

    buf = BytesIO()
    plt.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    img_arr = np.frombuffer(buf.getvalue(), np.uint8)
    img_bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    return cv2.resize(img_bgr, (width_px, height_px))
