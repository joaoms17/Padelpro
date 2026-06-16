"""Scan de formacao ao longo do tempo: conta jogadores na rede vs fundo PELOS PES.
Serve = arranque de uma formacao 1/3 (1 na rede, 3 no fundo)."""
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(override=True)

import cv2
from google import genai
from google.genai import types

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")
START = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
END = float(sys.argv[3]) if len(sys.argv) > 3 else 332.0
STEP = 2.0

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"].strip())

cap = cv2.VideoCapture(str(V))
samples = []
t = START
while t <= END:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, fr = cap.read()
    if ok:
        h, w = fr.shape[:2]
        if w > 720:
            fr = cv2.resize(fr, (720, int(h * 720 / w)))
        ok, buf = cv2.imencode(".jpg", fr, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if ok:
            samples.append((t, buf.tobytes()))
    t += STEP
cap.release()
print(f"{len(samples)} frames amostrados ({START:.0f}-{END:.0f}s, cada {STEP:.0f}s)")

PROMPT = (
    "Recebes {n} fotogramas de um jogo de padel (court em primeiro plano, 4 jogadores), "
    "cada um precedido de 'FRAME k'. Para CADA frame conta os jogadores pela posicao dos "
    "PES (onde os pes tocam o court, NAO pelo corpo):\n"
    "- na_rede: pes na metade da FRENTE (entre a rede/linha do meio e a linha de servico)\n"
    "- no_fundo: pes na metade de TRAS (entre a linha de servico e os vidros do fundo)\n"
    'Responde SO JSON: [{{"n":1,"na_rede":1,"no_fundo":3}}, ...] ({n} itens)'
)

def ask(batch):
    contents = []
    for k, (_, img) in enumerate(batch, 1):
        contents.append(f"FRAME {k}:")
        contents.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=img)))
    contents.append(PROMPT.format(n=len(batch)))
    for _ in range(5):
        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash", contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=3000,
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

timeline = []
B = 10
for i in range(0, len(samples), B):
    batch = samples[i:i + B]
    out = ask(batch)
    for j, (ts, _) in enumerate(batch, 1):
        x = out.get(j, {})
        timeline.append((ts, x.get("na_rede"), x.get("no_fundo")))
    if i + B < len(samples):
        time.sleep(12)

print("\n tempo  rede/fundo")
serves = []
prev_serve = False
for ts, nr, nf in timeline:
    is_serve = (nr == 1 and nf == 3)
    if is_serve and not prev_serve:
        serves.append(ts)
    prev_serve = is_serve
    flag = "  <<< inicio 1/3 (servico?)" if (is_serve and ts in serves) else ""
    print(f"{hhmmss(ts):>5}   {nr}/{nf}{flag}")

print(f"\nServicos (arranques de 1/3): {len(serves)}  -> {[hhmmss(t) for t in serves]}")
