"""Testar deteção de serviço: pontos = blocos de movimento; servico = 1a pancada de cada bloco.
Sem Gemini — rapido."""
import os
import shutil
import sys
import tempfile
from pathlib import Path

try:
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    bindir = Path(tempfile.gettempdir()) / "pp_ffmpeg"
    bindir.mkdir(exist_ok=True)
    dst = bindir / "ffmpeg.exe"
    if not dst.exists():
        shutil.copy(exe, dst)
    os.environ["PATH"] = str(bindir) + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

from padelpro_vision.analysis.shot_pipeline import build_candidates, detect_points, mark_serves

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")

def hhmmss(t):
    s = int(t); return f"{s // 60}:{s % 60:02d}"

print("A construir candidatos limpos (intersecao)...")
cands, stats = build_candidates(V, mode="confirmed")
print("A detetar blocos de jogo (movimento)...")
blocks = detect_points(V)

print(f"\nBLOCOS DE JOGO (pontos) detetados: {len(blocks)}")
for i, (s, e) in enumerate(blocks, 1):
    print(f"  ponto {i:2d}: {hhmmss(s)} - {hhmmss(e)}  ({int(e - s)}s)")

mark_serves(cands, blocks)
serves = [c for c in cands if c["servico"]]

print(f"\nPancadas limpas: {len(cands)}   Servicos marcados: {len(serves)}")
print("\n tempo  zona   servico?")
for c in cands:
    print(f"{hhmmss(c['t_s']):>5}  {c['zone']:5s}  {'<<< SERVICO' if c['servico'] else ''}")
