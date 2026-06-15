"""
Motor de deteção de pancadas (novo): CANDIDATOS → CONFIRMAÇÃO/CLASSIFICAÇÃO.

Em vez de pedir ao Gemini para "ver" o jogo todo (que aluciná um molde), fazemos:

  1. Candidatos = movimento (optical flow) ∪ áudio  → recall alto, mas com ruído
     (movimento perde pancadas rápidas; áudio apanha o court do lado).
  2. Para cada candidato, recortam-se 5 fotogramas (2 antes + contacto + 2 depois)
     e o Gemini decide, em lotes:
        - ha_pancada: há mesmo uma pancada DESTE court aqui? (filtra os vizinhos/ruído)
        - tipo: forehand/backhand/volley/overhead/serve/lob

Resultado: lista limpa de pancadas reais com o tipo — recall do áudio, precisão do olho.
Os mesmos recortes servem depois para treinar o nosso próprio modelo.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from padelpro_vision.analysis.shot_detector import (
    detect_shots, detect_shots_audio, merge_signals,
)

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
FRAME_DT = 0.2      # espaçamento entre os 5 fotogramas (s)
DEDUP_S = 0.8       # candidatos a menos de isto = mesmo evento
BATCH = 10          # candidatos por pedido ao Gemini
PAUSE_S = 12.0      # espera entre pedidos (plano gratis = 5/min)

_CLASSIFY_PROMPT = (
    "Recebeste {n} candidatos a pancada de padel. Cada candidato vem como 5 imagens "
    "consecutivas (~0.2s) a volta do momento, precedidas de 'CANDIDATO k'. "
    "O court relevante e o que esta em primeiro plano/maior.\n"
    "Para CADA candidato decide:\n"
    "- ha_pancada: true se um jogador DESTE court esta a bater na bola nestes frames; "
    "false se nao se ve pancada neste court (jogadores parados, a apanhar bola, ou a "
    "pancada e de outro court ao fundo/lado).\n"
    "- tipo: forehand | backhand | volley | overhead | serve | lob | indefinido "
    "(se ha_pancada=false usa indefinido).\n"
    "Responde SO em JSON, uma entrada por candidato e por ordem:\n"
    '[{{"n":1,"ha_pancada":true,"tipo":"forehand"}}, ...]  (exatamente {n} itens)'
)


def build_candidates(video_path: str | Path, dedup_s: float = DEDUP_S) -> tuple[list[dict], dict]:
    """Junta movimento + áudio numa lista de candidatos (com de-duplicação)."""
    vis = detect_shots(video_path)
    aud = detect_shots_audio(video_path)
    merged = merge_signals(vis, aud)
    audio_only = {round(t, 3) for t in merged["audio_only"]}

    cands: list[dict] = [{"t_s": s["t_s"], "zone": s["zone"], "src": "mov"} for s in vis]
    for a in aud:
        if round(a["t_s"], 3) in audio_only:
            cands.append({"t_s": a["t_s"], "zone": "audio", "src": "audio"})
    cands.sort(key=lambda c: c["t_s"])

    # de-dup: candidatos muito próximos = mesmo evento; preferir zona de movimento
    out: list[dict] = []
    for c in cands:
        if out and (c["t_s"] - out[-1]["t_s"]) < dedup_s:
            if out[-1]["zone"] == "audio" and c["zone"] != "audio":
                out[-1] = c
            continue
        out.append(c)

    stats = {
        "movimento": len(vis),
        "audio": len(aud),
        "audio_only": len(merged["audio_only"]),
        "candidatos": len(out),
    }
    return out, stats


def _burst(cap, t: float, dt: float = FRAME_DT, max_w: int = 448) -> list[bytes]:
    import cv2
    out: list[bytes] = []
    for o in (-2 * dt, -dt, 0.0, dt, 2 * dt):
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t + o) * 1000)
        ok, fr = cap.read()
        if not ok:
            continue
        h, w = fr.shape[:2]
        if w > max_w:
            fr = cv2.resize(fr, (max_w, int(h * max_w / w)))
        ok, buf = cv2.imencode(".jpg", fr, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if ok:
            out.append(buf.tobytes())
    return out


def _classify_batch(client, types, batch: list[dict]) -> dict:
    contents: list = []
    for k, c in enumerate(batch, 1):
        contents.append(f"CANDIDATO {k}:")
        for b in c.get("_frames", []):
            contents.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=b)))
    contents.append(_CLASSIFY_PROMPT.format(n=len(batch)))
    for _ in range(4):
        try:
            r = client.models.generate_content(
                model=GEMINI_MODEL, contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=4000,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            arr = json.loads(r.text or "[]")
            return {int(x.get("n", i + 1)): x for i, x in enumerate(arr)}
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                logger.info("rate limit — espero 60s")
                time.sleep(60)
                continue
            logger.warning("classify batch falhou: %s", str(e)[:160])
            return {}
    return {}


def detect_and_classify(
    video_path: str | Path,
    api_key: str | None = None,
    candidates: list[dict] | None = None,
    batch: int = BATCH,
    pause_s: float = PAUSE_S,
    progress_cb=None,
) -> dict:
    """Pipeline completo: candidatos → Gemini confirma+classifica → pancadas limpas."""
    from google import genai
    from google.genai import types
    import cv2

    if api_key is None:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY em falta")
    client = genai.Client(api_key=api_key)

    if candidates is None:
        candidates, stats = build_candidates(video_path)
    else:
        stats = {"candidatos": len(candidates)}

    cap = cv2.VideoCapture(str(video_path))
    for c in candidates:
        c["_frames"] = _burst(cap, c["t_s"])
    cap.release()

    results: list[dict] = []
    batches = [candidates[i:i + batch] for i in range(0, len(candidates), batch)]
    for bi, b in enumerate(batches):
        if progress_cb:
            progress_cb(bi + 1, len(batches))
        res = _classify_batch(client, types, b)
        for i, c in enumerate(b, 1):
            x = res.get(i, {})
            results.append({
                "t_s": c["t_s"],
                "zone": c["zone"],
                "src": c.get("src"),
                "ha_pancada": bool(x.get("ha_pancada", True)),
                "tipo": str(x.get("tipo", "indefinido")).lower(),
            })
        if bi < len(batches) - 1 and pause_s:
            time.sleep(pause_s)

    confirmed = [r for r in results if r["ha_pancada"]]
    stats["confirmadas"] = len(confirmed)
    stats["filtradas"] = len(results) - len(confirmed)
    return {"shots": confirmed, "all": results, "stats": stats}
