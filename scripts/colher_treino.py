"""Colher pancadas limpas de um video para treino do nosso modelo.

Guarda, por pancada: os 5 fotogramas + tipo sugerido pelo Gemini, e um
manifest.json para confirmares (Gemini sugere, tu confirmas → label de treino).

Uso:
    .venv\\Scripts\\python.exe scripts\\colher_treino.py ["caminho do video"]
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# ffmpeg embutido (audio sem depender do ffmpeg do sistema)
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

from dotenv import load_dotenv
load_dotenv(override=True)

from padelpro_vision.analysis.shot_pipeline import harvest_training_shots

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")

print(f"A colher pancadas de: {V.name}\n")
res = harvest_training_shots(V)
print("\nstats:", res["stats"])
print(f"\n{res['n_shots']} pancadas guardadas em: {res['out_dir']}")
print("Cada pasta shot_NN_<tipo> tem 5 frames. Confirma/corrige no manifest.json.")
