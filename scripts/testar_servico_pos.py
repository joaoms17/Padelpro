"""Detetar SERVICO pela FORMACAO: serve = 1 jogador na rede, 3 no fundo.
As posicoes veem-se a 480p (ao contrario do gesto). Via Gemini, 1 frame por momento."""
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
from padelpro_vision.analysis.shot_pipeline import build_candidates

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"].strip())
cands, _ = build_candidates(V, mode="confirmed")

# 1 frame (no contacto) por candidato, em 720px para se verem bem as posicoes
cap = cv2.VideoCapture(str(V))
for c in cands:
    cap.set(cv2.CAP_PROP_POS_MSEC, c["t_s"] * 1000)
    ok, fr = cap.read()
    if ok:
        h, w = fr.shape[:2]
        if w > 720:
            fr = cv2.resize(fr, (720, int(h * 720 / w)))
        ok, buf = cv2.imencode(".jpg", fr, [cv2.IMWRITE_JPEG_QUALITY, 82])
        c["_img"] = buf.tobytes() if ok else None
    else:
        c["_img"] = None
cap.release()

PROMPT = (
    "Recebes {n} momentos de um jogo de padel (court em primeiro plano, 4 jogadores), "
    "cada um precedido de 'MOMENTO k'. Para CADA momento conta os jogadores por posicao:\n"
    "- na_rede: jogadores JUNTO A REDE (a frente, perto da linha do meio)\n"
    "- no_fundo: jogadores no FUNDO (atras, perto dos vidros)\n"
    "E SERVICO se a formacao for a de inicio de ponto: exatamente 1 jogador na rede e 3 no fundo.\n"
    'Responde SO JSON: [{{"n":1,"na_rede":1,"no_fundo":3,"servico":true}}, ...] ({n} itens)'
)

def ask(batch):
    contents = []
    for k, c in enumerate(batch, 1):
        contents.append(f"MOMENTO {k}:")
        if c.get("_img"):
            contents.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=c["_img"])))
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
            return {int(x.get("n", i + 1)): x for i, x in enumerate(arr)}
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
        res[c["t_s"]] = out.get(j, {})
    if i + B < len(cands):
        time.sleep(12)

n_serv = sum(1 for v in res.values() if v.get("servico"))
print(f"\nMomentos: {len(cands)}   Servicos (formacao 1-rede/3-fundo): {n_serv}\n")
print(" tempo  zona   rede/fundo   servico?")
for c in cands:
    x = res.get(c["t_s"], {})
    rf = f"{x.get('na_rede','?')}/{x.get('no_fundo','?')}"
    print(f"{hhmmss(c['t_s']):>5}  {c['zone']:5s}   {rf:>9}   {'<<< SERVICO' if x.get('servico') else ''}")
