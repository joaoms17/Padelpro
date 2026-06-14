"""Gemini-based video analysis for padel matches."""

from __future__ import annotations
import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path

import google.generativeai as genai

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """You are analyzing a padel tennis match. Padel is a racket sport played 2v2 on an enclosed court with glass walls and metal mesh.

Analyze the ENTIRE video carefully and return ONLY a valid JSON object (no markdown fences, no explanation text) with this exact structure:

{
  "duration_s": <total duration in seconds as float>,
  "player_positions": [
    {"time_s": <float>, "player": <1|2|3|4>, "court_x": <0.0-1.0>, "court_y": <0.0-1.0>}
  ],
  "shots": [
    {"time_s": <float>, "player": <1|2|3|4>, "type": "<forehand|backhand|volley|smash|bandeja|vibora|serve|lob|other>", "outcome": "<winner|error|in|out|net>"}
  ],
  "score_timeline": [
    {"time_s": <float>, "team1_games": <int>, "team2_games": <int>, "team1_points": "<0|15|30|40|AD>", "team2_points": "<0|15|30|40|AD>"}
  ],
  "formation_samples": [
    {"time_s": <float>, "type": "<both_net|both_back|t1_net_t2_back|t1_back_t2_net|mixed>"}
  ],
  "key_frames": [
    {"time_s": <float>, "description": "<brief>", "all_players_visible": <bool>, "ball_visible": <bool>}
  ],
  "final_score": {"team1_sets": <int>, "team2_sets": <int>, "detail": "<e.g. 6-3 4-6 7-5>"},
  "shot_counts": {
    "player_1": {"forehand": 0, "backhand": 0, "volley": 0, "smash": 0, "bandeja": 0, "vibora": 0, "serve": 0, "lob": 0, "other": 0},
    "player_2": {"forehand": 0, "backhand": 0, "volley": 0, "smash": 0, "bandeja": 0, "vibora": 0, "serve": 0, "lob": 0, "other": 0},
    "player_3": {"forehand": 0, "backhand": 0, "volley": 0, "smash": 0, "bandeja": 0, "vibora": 0, "serve": 0, "lob": 0, "other": 0},
    "player_4": {"forehand": 0, "backhand": 0, "volley": 0, "smash": 0, "bandeja": 0, "vibora": 0, "serve": 0, "lob": 0, "other": 0}
  },
  "rallies": [
    {"start_s": <float>, "end_s": <float>, "duration_s": <float>, "num_shots": <int>, "winner_team": <1|2|null>}
  ],
  "match_summary": "<2-3 sentence summary>",
  "confidence": <0.0-1.0 how confident you are in this analysis>
}

IMPORTANT RULES:
- player_positions: sample EVERY 3 seconds for ALL 4 players (so if video is 300s → ~400 entries)
- court_x: 0.0=left edge, 1.0=right edge of court as seen from camera
- court_y: 0.0=near net, 1.0=far baseline
- Players 1&2 are one team (start on one side), Players 3&4 are the other team
- formation_samples: sample every 5 seconds
- key_frames: identify 8-12 moments where all 4 players AND ball are clearly visible
- rallies: identify each rally (active play period). start_s = first ball contact after serve, end_s = when point ends (ball out/net/winner). Include ALL rallies in the video.
- Return ONLY the JSON, nothing else"""


class GeminiAnalyzer:
    """Analyzes padel match videos using the Gemini Files API."""

    def __init__(self) -> None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel("gemini-2.5-flash")

    def upload_video(self, path: str) -> str:
        """Upload video to Gemini Files API, wait for processing, return file URI."""
        logger.info("Uploading video to Gemini Files API: %s", path)
        video_file = genai.upload_file(path=path)

        # Wait for processing
        while video_file.state.name == "PROCESSING":
            logger.info("Waiting for Gemini to process video…")
            time.sleep(5)
            video_file = genai.get_file(video_file.name)

        if video_file.state.name == "FAILED":
            raise RuntimeError(f"Gemini file processing failed: {video_file.state.name}")

        logger.info("Video ready: %s", video_file.uri)
        return video_file.uri

    def analyze_match(self, file_uri: str, filename: str) -> dict:
        """Send video + analysis prompt to Gemini, return parsed JSON dict."""
        logger.info("Analyzing match: %s", filename)
        try:
            video_part = {"file_data": {"file_uri": file_uri, "mime_type": "video/mp4"}}
            response = self.model.generate_content(
                [video_part, ANALYSIS_PROMPT],
                generation_config={"temperature": 0.1},
            )
            text = response.text.strip()

            # Try direct JSON parse first
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass

            # Try extracting JSON from response with regex
            match = re.search(r'\{[\s\S]*\}', text)
            if match:
                return json.loads(match.group(0))

            raise ValueError(f"Could not extract JSON from Gemini response: {text[:200]}")

        except Exception as exc:
            logger.exception("analyze_match failed for %s", filename)
            raise

    def extract_frame(self, video_path: str, time_s: float, output_path: str) -> None:
        """Extract a single frame from video at given time using ffmpeg."""
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(time_s),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr}")

    def generate_training_data(self, report: dict, video_path: str, output_dir: str) -> None:
        """Generate YOLO format annotations from player_positions and key_frames."""
        out = Path(output_dir)
        images_dir = out / "images"
        labels_dir = out / "labels"
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)

        key_frames = report.get("key_frames", [])
        player_positions = report.get("player_positions", [])

        for idx, kf in enumerate(key_frames):
            time_s = kf["time_s"]
            image_path = str(images_dir / f"frame_{idx:04d}.jpg")

            try:
                self.extract_frame(video_path, time_s, image_path)
            except Exception as exc:
                logger.warning("Could not extract frame %d at %.1fs: %s", idx, time_s, exc)
                continue

            # Find player positions closest to this time
            frame_positions: dict[int, dict] = {}
            for pos in player_positions:
                player_id = pos["player"]
                if player_id not in frame_positions:
                    frame_positions[player_id] = pos
                else:
                    existing_dt = abs(frame_positions[player_id]["time_s"] - time_s)
                    new_dt = abs(pos["time_s"] - time_s)
                    if new_dt < existing_dt:
                        frame_positions[player_id] = pos

            # Write YOLO annotation file
            label_path = labels_dir / f"frame_{idx:04d}.txt"
            with open(label_path, "w") as f:
                for player_id, pos in frame_positions.items():
                    # YOLO format: class cx cy w h (normalized)
                    class_id = player_id - 1  # 0-indexed
                    cx = pos["court_x"]
                    cy = pos["court_y"]
                    w = 0.04
                    h = 0.12
                    f.write(f"{class_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")

        logger.info("Training data generated in %s", output_dir)
