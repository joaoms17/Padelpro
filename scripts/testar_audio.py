"""Testar recall: movimento (optical flow) + audio, e quanto o audio acrescenta.

Usa o ffmpeg embutido (imageio-ffmpeg) para nao depender do ffmpeg do sistema.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Tornar o ffmpeg embutido acessivel como "ffmpeg" no PATH deste processo.
try:
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    bindir = Path(tempfile.gettempdir()) / "pp_ffmpeg"
    bindir.mkdir(exist_ok=True)
    dst = bindir / "ffmpeg.exe"
    if not dst.exists():
        shutil.copy(exe, dst)
    os.environ["PATH"] = str(bindir) + os.pathsep + os.environ.get("PATH", "")
    print("ffmpeg pronto:", dst)
except Exception as e:
    print("aviso: nao consegui preparar o ffmpeg embutido:", e)

from padelpro_vision.analysis.shot_detector import (
    detect_shots, detect_shots_audio, merge_signals,
)

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")

print("\nA detetar (movimento)...")
vis = detect_shots(V)
print("A detetar (audio)...")
aud = detect_shots_audio(V)

m = merge_signals(vis, aud)
total = len(vis) + len(m["audio_only"])

print("\n================ RECALL ================")
print(f"movimento (optical flow): {len(vis)}")
print(f"audio:                    {len(aud)}")
print(f"  - confirmadas (os dois concordam): {len(m['confirmed'])}")
print(f"  - so movimento:                    {len(m['visual_only'])}")
print(f"  - so audio (NOVAS, que faltavam):  {len(m['audio_only'])}")
print(f"TOTAL combinado:          {total}   (movimento sozinho dava {len(vis)})")

def hhmmss(t):
    s = int(t); return f"{s//60}:{s%60:02d}"

if m["audio_only"]:
    print("\nNovas pancadas que SO o audio apanhou (tempo):")
    print("  " + "  ".join(hhmmss(t) for t in m["audio_only"]))
