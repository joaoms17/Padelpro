from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).parent


@dataclass
class ModelConfig:
    detector_type: str = "yolox"  # "yolox" | "rtmdet"
    detector_config: Path = field(default_factory=lambda: ROOT / "checkpoints" / "yolox_m.py")
    detector_weights: Path = field(default_factory=lambda: ROOT / "checkpoints" / "yolox_m.pth")
    tracker_type: str = "bytetrack"
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


@dataclass
class AppConfig:
    model: ModelConfig = field(default_factory=ModelConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    calibration: CalibrationConfig = field(default_factory=CalibrationConfig)
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)


DEFAULT_CONFIG = AppConfig()
