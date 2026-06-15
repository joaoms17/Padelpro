"""Detetar pancadas (movimento) e classifica-las com o Gemini em LOTES.

- 5 fotogramas por pancada (2 antes + contacto + 2 depois)
- envia ~10 pancadas por pedido (cabe no plano gratis)
- abranda entre pedidos e repete se bater no limite (429)
- devolve tipo + se e' servico
Le GEMINI_API_KEY do .env.
"""
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
from padelpro_vision.analysis.shot_detector import detect_shots

V = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\joaom\Downloads\WhatsApp Video 2026-06-12 at 21.33.15.mp4")
OUT = Path(r"C:\Users\joaom\Downloads\pancadas_classificadas.txt")

BATCH = 10          # pancadas por pedido
GAP_START_S = 4.0   # gap maior que isto => provavel inicio de ponto
PAUSE_S = 13        # espera entre pedidos (plano gratis = 5/min)

key = os.environ.get("GEMINI_API_KEY", "").strip()
if not key:
    print("FALTA GEMINI_API_KEY no .env"); sys.exit(1)
client = genai.Client(api_key=key)

shots = detect_shots(V)
print(f"detetadas {len(shots)} pancadas. A extrair fotogramas...")

cap = cv2.VideoCapture(str(V))

def frames_around(t, dt=0.2):
    out = []
    for o in (-2 * dt, -dt, 0.0, dt, 2 * dt):
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t + o) * 1000)
        ok, fr = cap.read()
        if not ok:
            continue
        h, w = fr.shape[:2]
        if w > 448:
            fr = cv2.resize(fr, (448, int(h * 448 / w)))
        ok, buf = cv2.imencode(".jpg", fr, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if ok:
            out.append(buf.tobytes())
    return out

prev_t = -999.0
for s in shots:
    t = float(s.get("t_s", 0.0))
    s["_start"] = (t - prev_t) > GAP_START_S
    s["_frames"] = frames_around(t)
    prev_t = t
cap.release()

PROMPT = (
    "Recebeste {n} pancadas de padel deste jogo. Cada pancada vem como 5 imagens "
    "consecutivas (~0.2s entre elas) a volta do contacto, precedidas de uma linha "
    "'PANCADA k, lado=..., inicio_de_ponto=...'.\n"
    "Para CADA pancada, olha o jogador que bate e decide:\n"
    "- tipo: forehand | backhand | volley | overhead | serve | lob | indefinido\n"
    "- servico: true se for um SERVICO (primeira pancada do ponto, batida por baixo "
    "atras da linha, com a bola a bater no chao antes), senao false\n"
    "Responde SO em JSON, uma entrada por pancada e por ordem:\n"
    '[{{"n":1,"tipo":"...","servico":true}}, ...]  (exatamente {n} itens)'
)

def classify(batch):
    contents = []
    for k, s in enumerate(batch, 1):
        lado = "perto" if s.get("zone") == "near" else "longe"
        contents.append(f"PANCADA {k}, lado={lado}, inicio_de_ponto={'sim' if s['_start'] else 'nao'}:")
        for b in s["_frames"]:
            contents.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=b)))
    contents.append(PROMPT.format(n=len(batch)))
    for attempt in range(4):
        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash", contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=4000,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            return json.loads(r.text or "[]")
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                print("   (limite atingido — espero 60s e tento de novo)")
                time.sleep(60); continue
            print("   erro:", str(e)[:120]); return []
    return []

rows = []
batches = [shots[i:i + BATCH] for i in range(0, len(shots), BATCH)]
for bi, batch in enumerate(batches, 1):
    print(f"lote {bi}/{len(batches)} ({len(batch)} pancadas)...")
    res = classify(batch)
    by_n = {int(x.get("n", i + 1)): x for i, x in enumerate(res)} if isinstance(res, list) else {}
    for i, s in enumerate(batch, 1):
        x = by_n.get(i, {})
        tipo = str(x.get("tipo", "?")).lower()
        serv = bool(x.get("servico", False)) or tipo == "serve"
        rows.append((float(s["t_s"]), "perto" if s.get("zone") == "near" else "longe", tipo, serv))
    if bi < len(batches):
        time.sleep(PAUSE_S)

# Output
lines = ["Pancadas classificadas (movimento deteta, Gemini diz o tipo)\n"]
for i, (t, lado, tipo, serv) in enumerate(rows, 1):
    mm, ss = int(t // 60), int(t % 60)
    flag = "  [SERVICO]" if serv else ""
    lines.append(f"{i:2d}. {mm}:{ss:02d}  {lado:5s}  {tipo}{flag}")
text = "\n".join(lines)
print("\n" + text)
OUT.write_text(text, encoding="utf-8")
n_serv = sum(1 for r in rows if r[3])
print(f"\nTotal: {len(rows)} pancadas, {n_serv} servicos. Guardado em: {OUT}")
