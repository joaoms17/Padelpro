"""Testar o motor novo (candidatos -> Gemini confirma+classifica) numa janela."""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# ffmpeg embutido (para o audio funcionar sem ffmpeg no sistema)
import imageio_ffmpeg
exe = imageio_ffmpeg.get_ffmpeg_exe()
bindir = Path(tempfile.gettempdir()) / "pp_ffmpeg"
bindir.mkdir(exist_ok=True)
dst = bindir / "ffmpeg.exe"
if not dst.exists():
    shutil.copy(exe, dst)
os.environ["PATH"] = str(bindir) + os.pathsep + os.environ.get("PATH", "")

from dotenv import load_dotenv
load_dotenv(override=True)

from padelpro_vision.analysis.shot_pipeline import build_candidates, detect_and_classify

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")
MODE = sys.argv[2] if len(sys.argv) > 2 else "confirmed"

print(f"A construir candidatos (modo={MODE})...")
cands, stats = build_candidates(V, mode=MODE)
print("totais:", stats)
print(f"\nA classificar {len(cands)} candidatos (video todo)\n")

out = detect_and_classify(V, candidates=cands,
                          progress_cb=lambda b, n: print(f"  lote {b}/{n}..."))

def hhmmss(t):
    s = int(t); return f"{s // 60}:{s % 60:02d}"

serves = {round(r["t_s"], 3) for r in out["shots"] if r.get("servico")}

print("\n tempo  zona   resultado")
for r in out["all"]:
    if r["ha_pancada"]:
        sv = "  [SERVICO]" if round(r["t_s"], 3) in serves else ""
        mark = f">> {r['tipo']}{sv}"
    else:
        mark = "xx FILTRADO (sem pancada neste court)"
    print(f"{hhmmss(r['t_s']):>5}  {r['zone']:5s}  {mark}")

s = out["stats"]
print(f"\ncandidatos={len(out['all'])}  confirmadas={s['confirmadas']}  "
      f"filtradas={s['filtradas']}  servicos={s.get('servicos')}")
