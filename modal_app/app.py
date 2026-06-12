"""
PadelPro Vision — análise em GPU no Modal (serverless).

Deploy (depois de teres conta em modal.com — o free tier inclui $30/mês):
    pip install modal
    modal token new            # abre o browser para autenticar
    modal deploy modal_app/app.py

Fica disponível um endpoint HTTPS:
    POST <url>/analyze  (multipart: file=<vídeo>, court_h=<JSON da homografia 3x3>, deep=true|false)
→ devolve o report JSON (mesmo formato do analyze_clip local).

Custos (referência): T4 ≈ $0.59/h no Modal; um clip de 4 min analisa em
~1-2 min de GPU ≈ $0.01-0.02. Os créditos grátis dão para centenas de clips.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import modal

REPO = "https://github.com/joaoms17/Padelpro.git"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "git")
    .pip_install(
        "torch",
        "torchvision",
        "opencv-python-headless",
        "numpy",
        "supervision",
        "rtmlib",          # real RTMPose (ONNX) — stroke classification on GPU box
        "onnxruntime",
        "fastapi[standard]",
    )
    # CACHE_BUST changes here force a fresh clone so a deploy picks up the
    # latest main (bump the date when you want the newest code).
    .run_commands(f"echo 2026-06-12 && git clone --depth 1 {REPO} /repo")
)

app = modal.App("padelpro-analyze", image=image)


@app.function(gpu="T4", timeout=1800)
def analyze_video(video_bytes: bytes, court_h: list[list[float]] | None, deep: bool) -> dict:
    import sys
    sys.path.insert(0, "/repo")
    import numpy as np

    # Na GPU não há limitações de CPU: amostragem mais densa e modelo já em CUDA.
    import padelpro_vision.analysis.clip_report as cr
    cr.TARGET_FPS = 10.0          # 2.5× mais amostras que em CPU
    cr.DETECT_MIN_SIZE = 800

    # O detector usa device do argumento — patch simples para cuda
    from padelpro_vision.detection import detector as det_mod
    _orig = det_mod.TorchvisionDetector.__init__

    def _cuda_init(self, *a, **kw):
        kw["device"] = "cuda"
        _orig(self, *a, **kw)

    det_mod.TorchvisionDetector.__init__ = _cuda_init  # type: ignore

    with tempfile.TemporaryDirectory() as td:
        vid = Path(td) / "in.mp4"
        vid.write_bytes(video_bytes)
        H = np.array(court_h, dtype=np.float64) if court_h else None
        report = cr.analyze_clip(vid, Path(td) / "out", homography=H, deep=deep)
    return report


@app.function()
@modal.fastapi_endpoint(method="POST", label="padelpro-analyze")
async def analyze(request):  # type: ignore
    from fastapi import Request

    req: Request = request
    form = await req.form()
    up = form["file"]
    video_bytes = await up.read()
    court_h = json.loads(form.get("court_h") or "null")
    deep = str(form.get("deep", "false")).lower() == "true"
    return analyze_video.remote(video_bytes, court_h, deep)
