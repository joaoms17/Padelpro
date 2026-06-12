"""
Corta um mini-clip por pancada a partir de um report.json — a semente do
dataset de treino (classificador de tipos de pancada, validação de áudio).

Uso:
    .venv\\Scripts\\python.exe scripts\\extract_hit_clips.py ^
        data\\test\\clip4min.mp4 data\\output\\analysis_clip4min\\report.json

Saída: data/dataset/hits/<tipo>/<n>_p<jogador>_t<segundos>.mp4 (±1.2 s).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from padelpro_vision.io.ffmpeg import ensure_ffmpeg

PAD_BEFORE = 1.2
PAD_AFTER = 1.2


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("report", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/dataset/hits"))
    args = ap.parse_args()

    if not ensure_ffmpeg():
        sys.exit("ffmpeg não encontrado.")

    report = json.loads(args.report.read_text(encoding="utf-8"))
    shots = report.get("shots", [])
    if not shots:
        sys.exit("O report não tem pancadas (corre a análise primeiro).")

    n_ok = 0
    for i, s in enumerate(shots):
        t = float(s["t_s"])
        tipo = s.get("type") or "desconhecido"
        for ch in '<>:"/\\|?*':
            tipo = tipo.replace(ch, "")
        tipo = tipo.strip() or "desconhecido"
        out_dir = args.out / tipo
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{i:03d}_p{s.get('player_id', 0)}_t{t:.1f}.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{max(0.0, t - PAD_BEFORE):.2f}",
            "-i", str(args.video),
            "-t", f"{PAD_BEFORE + PAD_AFTER:.2f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac",
            str(out),
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0:
            n_ok += 1

    print(f"{n_ok}/{len(shots)} clips de pancadas em {args.out}")
    print("Organizados por tipo — corrige pastas erradas à mão: isso é anotação.")


if __name__ == "__main__":
    main()
