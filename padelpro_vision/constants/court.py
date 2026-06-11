"""Standard padel court dimensions and zone boundaries (ITF specification)."""

COURT_LENGTH_M: float = 20.0
COURT_WIDTH_M: float = 10.0
SERVICE_LINE_FROM_BACK_M: float = 6.95
NET_HEIGHT_CENTER_M: float = 0.88
NET_HEIGHT_POST_M: float = 0.92

ZONE_NET_DEPTH_M: float = 4.0   # 0–4 m from net
ZONE_MID_DEPTH_M: float = 9.0   # 4–9 m from net

# Canonical 2D corner keypoints for homography (image → court mapping).
# Order: top-left, top-right, bottom-right, bottom-left (from camera perspective).
COURT_CORNERS_M: list[tuple[float, float]] = [
    (0.0, 0.0),
    (COURT_WIDTH_M, 0.0),
    (COURT_WIDTH_M, COURT_LENGTH_M),
    (0.0, COURT_LENGTH_M),
]
