"""Testar deteção de SERVIÇO pela postura, via Gemini (por pancada, 5 frames)."""
import json
import os
import shutil
import sys
import tempfile
import time
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

from dotenv import load_dotenv
load_dotenv(override=True)

import cv2
from google import genai
from google.genai import types
from padelpro_vision.analysis.shot_pipeline import build_candidates, _burst

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"].strip())

cands, _ = build_candidates(V, mode="confirmed")
cap = cv2.VideoCapture(str(V))
for c in cands:
    c["_frames"] = _burst(cap, c["t_s"])
cap.release()

PROMPT = (
    "Recebes {n} candidatos a pancada de padel (court em primeiro plano), cada um com "
    "5 imagens (~0.2s) precedidas de 'CANDIDATO k'. Para CADA um diz se e um SERVICO.\n"
    "SERVICO = o jogador esta no FUNDO do court e inicia o ponto batendo a bola POR BAIXO "
    "(abaixo da cintura) depois de a deixar bater no chao. Volei, pancada de fundo durante "
    "o ponto, ou remate NAO sao servico.\n"
    'Responde SO JSON: [{{"n":1,"servico":true}}, ...] ({n} itens)'
)

def ask(batch):
    contents = []
    for k, c in enumerate(batch, 1):
        contents.append(f"CANDIDATO {k}:")
        for b in c["_frames"]:
            contents.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=b)))
    contents.append(PROMPT.format(n=len(batch)))
    for _ in range(4):
        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash", contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=2000,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=0)))
            arr = json.loads(r.text or "[]")
            return {int(x.get("n", i + 1)): bool(x.get("servico", False)) for i, x in enumerate(arr)}
        except Exception as e:
            if any(s in str(e) for s in ("429", "RESOURCE_EXHAUSTED")):
                time.sleep(60); continue
            if any(s in str(e) for s in ("503", "UNAVAILABLE")):
                time.sleep(15); continue
            print("erro:", str(e)[:120]); return {}
    return {}

def hhmmss(t):
    s = int(t); return f"{s // 60}:{s % 60:02d}"

res = {}
B = 10
for i in range(0, len(cands), B):
    batch = cands[i:i + B]
    out = ask(batch)
    for j, c in enumerate(batch, 1):
        res[c["t_s"]] = out.get(j, False)
    if i + B < len(cands):
        time.sleep(12)

n_serv = sum(1 for v in res.values() if v)
print(f"\nPancadas: {len(cands)}   Servicos (Gemini postura): {n_serv}\n")
print(" tempo  zona   servico?")
for c in cands:
    print(f"{hhmmss(c['t_s']):>5}  {c['zone']:5s}  {'<<< SERVICO' if res.get(c['t_s']) else ''}")
