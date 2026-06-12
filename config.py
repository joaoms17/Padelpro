from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).parent


@dataclass
class ModelConfig:
    detector_type: str = "torchvision"   # torchvision Faster R-CNN (BSD)
    checkpoints_dir: Path = field(default_factory=lambda: ROOT / "checkpoints")
    pose_config: Path = field(default_factory=lambda: ROOT / "checkpoints" / "rtmpose_m.py")
    pose_weights: Path = field(default_factory=lambda: ROOT / "checkpoints" / "rtmpose_m.pth")
    score_threshold: float = 0.5
    device: str = "cpu"


@dataclass
class VideoConfig:
    input_skip_frames: int = 1
    output_fps: int = 25
    resize_width: int = 1280
    resize_height: int = 720


@dataclass
class CalibrationConfig:
    homography_cache_dir: Path = field(default_factory=lambda: ROOT / "data" / "homographies")
    ransac_threshold: float = 5.0
    min_points: int = 4


@dataclass
class SegmentationConfig:
    play_score_threshold_enter: float = 0.8
    play_score_threshold_exit: float = 0.55
    min_rally_duration_s: float = 3.0
    gap_merge_threshold_s: float = 1.0
    padding_before_s: float = 1.0
    padding_after_s: float = 0.6
    break_gap_threshold_s: float = 45.0
    enter_confirm_s: float = 1.0    # consecutive high seconds to start a rally
    exit_confirm_s: float = 2.5     # consecutive low seconds to end a rally


@dataclass
class StrokeConfig:
    audio_onset_tolerance_ms: float = 200.0   # max gap between stroke and audio onset
    event_min_gap_ms: float = 700.0           # merge stroke events closer than this
    drop_events_without_onset: bool = False   # if True, discard strokes with no onset nearby
    review_confidence_threshold: float = 0.6  # below this → active-learning review queue


@dataclass
class QualityConfig:
    max_plausible_speed_ms: float = 8.0   # above this a speed sample is implausible
    teleport_jump_m: float = 3.0          # position jump flagged as tracking error
    court_margin_x_m: float = 1.5         # gating margin outside court width
    court_margin_y_m: float = 2.0         # gating margin outside court length
    expected_players: int = 4
    reid_enabled: bool = True             # merge fragmented tracks by shirt colour


@dataclass
class AppConfig:
    model: ModelConfig = field(default_factory=ModelConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    calibration: CalibrationConfig = field(default_factory=CalibrationConfig)
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    strokes: StrokeConfig = field(default_factory=StrokeConfig)
    quality: QualityConfig = field(default_factory=QualityConfig)


DEFAULT_CONFIG = AppConfig()
