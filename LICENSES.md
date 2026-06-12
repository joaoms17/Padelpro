# Dependency Licenses

All dependencies must be permissive (Apache 2.0 / MIT / BSD). No AGPL, GPL, or NC.
**Verify weight-file licenses separately at download time — they may differ from the code license.**

| Component | Library / Source | License | Notes |
|-----------|-----------------|---------|-------|
| Deep learning framework | PyTorch | BSD-3-Clause | ✅ |
| Computer vision | OpenCV | Apache 2.0 | ✅ |
| Detection | torchvision (Faster R-CNN, COCO weights) | BSD-3-Clause | ✅ |
| Tracking | supervision (ByteTrack) | MIT | ✅ |
| Pose estimation (code) | MMPose (RTMPose / ViTPose) | Apache 2.0 | ✅ Verify weights at download |
| Video I/O | ffmpeg | LGPL 2.1+ / GPL | Used as subprocess only — not linked. Commercial OK. |
| Numerical | NumPy | BSD-3-Clause | ✅ |
| Validation | Pydantic | MIT | ✅ |
| API | FastAPI | MIT | ✅ |
| Backend | supabase-py | MIT | ✅ |
| Config | python-dotenv | BSD-3-Clause | ✅ |
| Progress | tqdm | MIT / MPL 2.0 | ✅ |

## ⚠️ Before Production

Before shipping any model weights, confirm their specific license at the source:
- torchvision models: https://pytorch.org/vision/stable/models.html
- MMPose model zoo: https://github.com/open-mmlab/mmpose/blob/main/docs/en/model_zoo/body_2d_keypoint.md
- supervision: https://github.com/roboflow/supervision

## Prohibited

- **Ultralytics YOLO** — AGPL-3.0. Do NOT add.
- Any `NonCommercial` or `ShareAlike` dependency.
