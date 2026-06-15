"""
Full-match Gemini analysis — the whole video in a single pass.

Unlike `gemini_clip.py` (which only extracts stroke type/outcome and merges
them onto CV-detected hits), this module asks Gemini to read the ENTIRE match
and return a self-contained report:

  - jogadores (player identification with visual description)
  - rallies with fases (phases) and pancadas (shots)
  - resumo (summary with durations, score, phase time breakdown)
  - pausas (breaks and side changes)
  - player_positions over time      → court heatmap (derived from zones)
  - final_score (Gemini's guess)     → user validates the model's accuracy
  - shot_counts per player and type  → who hit what, how often
  - rallies_compat (active-play segments) → useful-time stats

Everything here runs with NO torch — only google-genai + ffmpeg/cv2 — so it
works on the light Render image. The outputs double as labels for training our
own models (see padelpro_vision.training.dataset).
"""

from __future__ import annotations
import logging
import os
import time
from pathlib import Path

from padelpro_vision.analysis.gemini_clip import _parse_gemini_json
from padelpro_vision.analysis.shot_detector import detect_shots, format_shot_hints

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"

# How the report's normalised court coordinates are oriented:
#   court_x: 0.0 = left edge, 1.0 = right edge (as seen from the camera)
#   court_y: 0.0 = near baseline (closest to camera), 1.0 = far baseline
# Players 1 & 2 are the near team (Equipa A); players 3 & 4 are the far team (Equipa B).

SHOT_TYPES = ("forehand", "backhand", "volley", "overhead", "serve", "lob", "other")

FORMATIONS = ("both_net", "both_back", "split_near_net", "split_far_net", "mixed")

_MATCH_PROMPT = """
# ANÁLISE DE VÍDEO DE PADEL — PadelPro Vision

A câmara está fixa atrás de uma das linhas de fundo, centrada no eixo longo do campo.

---
## 0. CALIBRAÇÃO (FAZ ISTO PRIMEIRO)

As imagens que precedem este texto são frames de referência do início do vídeo. Usa-as para:

1. Localizar as 4 linhas/paredes do campo no frame (em % horizontal e vertical)
2. Localizar a rede (a que % da altura do frame fica)
3. Localizar as linhas de serviço (paralelas à rede, a ~1/3 do campo de cada lado)
4. Localizar os vidros de fundo (até onde os jogadores recuam em DEFESA)

Esta calibração é a referência para todas as zonas que atribuis a seguir.

---
## 1. IDENTIFICAÇÃO DOS JOGADORES

Identifica os 4 jogadores pelos seus elementos visuais: camisola, calções, meias, ténis, raquete.

- **Equipa A:** `A1` (esquerda) e `A2` (direita) — equipa mais próxima da câmara
- **Equipa B:** `B1` (esquerda) e `B2` (direita) — equipa mais afastada

---
## 2. ZONAS DO CAMPO

Usa apenas 3 zonas:

| Zona | Localização | Fase |
|------|-------------|------|
| `REDE` | Junto à rede (1ª e 2ª malha) | ATAQUE |
| `MEIO` | Zona de transição (3ª malha até à linha de serviço) | TRANSIÇÃO |
| `FUNDO` | Vidros laterais e de fundo | DEFESA |

---
## 3. FASES DE JOGO

Cada rally tem `fases_A` (equipa A) e `fases_B` (equipa B) em listas independentes e paralelas.

| Fase | Condição |
|------|----------|
| `ATAQUE` | Equipa junto à rede (REDE) |
| `TRANSIÇÃO` | Equipa em movimento entre rede e fundo (MEIO) |
| `DEFESA` | Equipa nos vidros (FUNDO) |

**Rallies com menos de 5 segundos:** omite `fases_A` e `fases_B` (usa `[]`).

Regista apenas mudanças de fase visualmente confirmadas. Em caso de dúvida, mantém a fase anterior.

---
## 4. TIPOS DE PANCADA

| Tipo | Descrição |
|------|-----------|
| `forehand` | Pancada pelo lado dominante após a bola tocar no chão/vidro |
| `backhand` | Pancada pelo lado não-dominante após a bola tocar no chão/vidro |
| `volley` | Pancada sem a bola tocar no chão — geralmente junto à rede |
| `overhead` | Qualquer pancada acima ou ao lado da cabeça após balão adversário (smash, bandeja, víbora, kick) |
| `serve` | Serviço |
| `lob` | Balão alto (inclui saída de vidro de fundo com efeito alto) |
| `indefinido` | Tipo não identificável |

---
## 5. FIM DE RALLY

Um rally termina quando:
1. A bola sai do campo, toca duas vezes no chão, ou a mesma equipa toca nela duas vezes seguidas
2. Mais de 6 segundos sem nenhuma pancada
3. Jogadores cumprimentam-se (fim de ponto)

---
## 6. PAUSAS

Regista pausas > 45 segundos com `tipo_pausa`: `troca_de_campo`, `discussao`, `lesao`, ou `indefinido`.

---
## 7. VÍDEOS LONGOS (> 40 minutos)

Se o vídeo for mais longo que 40 minutos, analisa os primeiros 30 minutos em detalhe completo e resume o resto apenas no `resumo` (pontuação, duração total). Não omitas nenhum rally dos primeiros 30 minutos.

---
## 8. RACIOCÍNIO (ANTES DO JSON)

Escreve o bloco de raciocínio entre `<raciocinio>` e `</raciocinio>`:

<raciocinio>
CALIBRAÇÃO:
- Campo no frame: [% horizontal e % vertical]
- Rede: [% da altura do frame]
- Linhas de serviço: [% da altura do frame]
- Vidros de fundo: [% da altura do frame — é até aqui que os jogadores recuam em FUNDO]
- Mapeamento de zonas no frame: REDE=[~x% a ~y%], MEIO=[~x% a ~y%], FUNDO=[~x% a ~y%]

JOGADORES:
- A1: [descrição visual]
- A2: [descrição visual]
- B1: [descrição visual]
- B2: [descrição visual]
- Equipa A está no lado [próximo/afastado da câmara]
</raciocinio>

---
## 9. OUTPUT JSON

```json
{
  "jogadores": [
    { "id": "A1", "equipa": "A", "descricao_visual": "Camisola azul escura, calções pretos, ténis brancos" },
    { "id": "A2", "equipa": "A", "descricao_visual": "..." },
    { "id": "B1", "equipa": "B", "descricao_visual": "..." },
    { "id": "B2", "equipa": "B", "descricao_visual": "..." }
  ],
  "resumo": {
    "total_rallies": 0,
    "trocas_de_campo": 0,
    "primeiro_servidor": "A1",
    "duracao_total_jogo": "00:00:00",
    "duracao_util": "00:00:00",
    "pontuacao_final": "6-3 4-6 7-5",
    "resumo_jogo": "2-3 frases em português a resumir o jogo e o vencedor",
    "confianca": 0.8
  },
  "pausas": [
    { "id": 1, "inicio": "00:00:00", "fim": "00:00:00", "duracao_segundos": 0, "tipo_pausa": "troca_de_campo" }
  ],
  "rallies": [
    {
      "id": 1,
      "inicio": "00:00:00",
      "fim": "00:00:08",
      "servidor": "A1",
      "equipa_ganha_ponto": "A",
      "fases_A": [
        { "fase": "DEFESA", "inicio": "00:00:00", "fim": "00:00:02" },
        { "fase": "TRANSIÇÃO", "inicio": "00:00:02", "fim": "00:00:04" },
        { "fase": "ATAQUE", "inicio": "00:00:04", "fim": "00:00:08" }
      ],
      "fases_B": [
        { "fase": "ATAQUE", "inicio": "00:00:00", "fim": "00:00:05" },
        { "fase": "DEFESA", "inicio": "00:00:05", "fim": "00:00:08" }
      ],
      "pancadas": [
        { "timestamp": "00:00:00", "jogador": "A1", "tipo": "serve", "zona": "FUNDO" },
        { "timestamp": "00:00:02", "jogador": "B2", "tipo": "backhand", "zona": "FUNDO" },
        { "timestamp": "00:00:05", "jogador": "A2", "tipo": "volley", "zona": "REDE" }
      ]
    }
  ]
}
```

---
## REGRAS DE TIMESTAMP
- Ancora timestamps apenas em eventos visuais claros
- Arredonda ao segundo mais próximo
- Não inventas timestamps por estimativa

---
*Versão: 2026-06-15 v3 — PadelPro Vision*
""".strip()


def _extract_reference_frames(video_path: Path, n: int = 3) -> list[bytes]:
    """Extract n JPEG frames spaced across the first ~10 seconds for court calibration."""
    try:
        import cv2
    except ImportError:
        return []
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames: list[bytes] = []
    sample_times = [1.0, 4.0, 8.0][:n]  # seconds into the video
    for t in sample_times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if not ret:
            continue
        # Downscale to max 960px wide to keep inline payload small
        h, w = frame.shape[:2]
        if w > 960:
            scale = 960 / w
            frame = cv2.resize(frame, (960, int(h * scale)))
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            frames.append(buf.tobytes())
    cap.release()
    logger.info("Extracted %d reference frames from %s", len(frames), video_path.name)
    return frames


def analyze_full_match(video_path: str | Path, api_key: str | None = None) -> dict:
    """Upload the full video to Gemini and return a parsed match report dict.

    Raises RuntimeError on configuration/processing failure. The returned dict
    follows the prompt schema above (already JSON-parsed, truncation-salvaged).
    """
    if api_key is None:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY não configurada.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise RuntimeError("google-genai não instalado. Corre: pip install google-genai")

    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_path}")

    # The new google-genai SDK (unlike legacy google-generativeai) accepts the
    # current "AQ." API-key format.
    client = genai.Client(api_key=api_key)

    logger.info("Uploading %s to Gemini Files API…", video_path.name)
    t0 = time.time()
    try:
        video_file = client.files.upload(file=str(video_path))
    except TypeError:
        video_file = client.files.upload(path=str(video_path))

    while video_file.state and video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)

    if not video_file.state or video_file.state.name != "ACTIVE":
        state = video_file.state.name if video_file.state else "UNKNOWN"
        raise RuntimeError(f"Processamento do vídeo no Gemini falhou: {state}")
    logger.info("Gemini file ready (%.1fs)", time.time() - t0)

    cfg_kwargs: dict = dict(
        temperature=0.1,
        max_output_tokens=65536,
    )
    # Use a moderate thinking budget so Gemini reasons about player positions
    # and shot attribution before committing to JSON. thinking_budget=0 (off)
    # was the main cause of low-quality analysis. Thinking tokens are separate
    # from the output-token budget so this doesn't reduce the JSON space.
    try:
        cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=16384)
    except Exception:
        pass  # older SDK version — proceed without thinking config

    # Run optical-flow shot detection locally BEFORE sending to Gemini.
    # This is purely visual (immune to adjacent-court audio noise) and gives
    # Gemini a list of pre-detected shot timestamps to anchor its JSON output.
    logger.info("Running optical-flow shot detection…")
    detected_shots = detect_shots(video_path)
    shot_hints = format_shot_hints(detected_shots)
    if shot_hints:
        logger.info("Injecting %d optical-flow shot hints into prompt", len(detected_shots))

    # Build the final prompt: static prompt + optional shot hints
    final_prompt = _MATCH_PROMPT
    if shot_hints:
        # Insert hints before the raciocinio section so Gemini sees them early
        final_prompt = shot_hints + "\n\n" + _MATCH_PROMPT

    # Extract a few still frames from the start of the video and include them
    # as inline images BEFORE the video. This lets Gemini calibrate the court
    # boundaries (net position, service lines, glass walls) from high-quality
    # stills before processing the full compressed video stream.
    ref_frames = _extract_reference_frames(video_path)
    contents: list = []
    if ref_frames:
        contents.append(
            "As seguintes imagens são frames de referência do início do vídeo. "
            "Usa-as para calibrar o campo (rede, linhas de serviço, vidros de fundo) "
            "antes de analisar o vídeo completo:"
        )
        for fb in ref_frames:
            try:
                contents.append(types.Part(
                    inline_data=types.Blob(mime_type="image/jpeg", data=fb)
                ))
            except Exception:
                pass  # SDK version difference — skip inline frames gracefully
    contents.append(video_file)
    contents.append(final_prompt)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(**cfg_kwargs),
    )

    try:
        client.files.delete(name=video_file.name)
    except Exception:
        pass

    report = _parse_match_json(response.text or "")
    n_pos = len(report.get("player_positions", []))
    n_shots = len(report.get("shots", []))
    n_rallies = len(report.get("rallies", []))
    dur = report.get("duration_s", 0.0)
    is_v2 = bool(report.get("jogadores"))
    logger.info(
        "Gemini full-match (schema=%s): %d positions, %d shots, %d rallies "
        "(duration=%.0fs, optical_flow_hints=%d)",
        "v2" if is_v2 else "v1", n_pos, n_shots, n_rallies, dur, len(detected_shots),
    )
    # Attach optical-flow metadata so the frontend can show it
    report["_optical_flow_shots"] = len(detected_shots)
    return report


def _parse_match_json(text: str) -> dict:
    """Parse the full-match report JSON with robust truncation recovery.

    Handles the new v2 schema which starts with a <raciocinio>...</raciocinio>
    reasoning block before the JSON object.

    When Gemini truncates mid-array, standard json.loads fails.  We try
    a series of progressively more aggressive recovery strategies:
      1. json.loads as-is (ideal path)
      2. Close open brackets/braces and retry
      3. Extract whatever top-level keys parsed before the truncation point
    """
    import json, re

    # Extract and log reasoning block
    reasoning_text = ""
    reasoning_match = re.search(r'<raciocinio>(.*?)</raciocinio>', text, re.DOTALL | re.IGNORECASE)
    if reasoning_match:
        reasoning_text = reasoning_match.group(1).strip()
        logger.info("Gemini reasoning (first 1000 chars): %s", reasoning_text[:1000])
        text = text[text.lower().find('</raciocinio>') + len('</raciocinio>'):]

    # Strip markdown code fences that Gemini adds around JSON (```json ... ```)
    text = re.sub(r'```(?:json)?\s*\n?', '', text)

    # Find the start of the JSON object
    json_start = text.find('{')
    # Always save a preview of what comes after the reasoning block for debugging
    _json_preview = text[:800].strip() if text.strip() else "(empty)"
    logger.info("Gemini post-reasoning text (first 800 chars): %s", _json_preview)
    if json_start == -1:
        logger.warning("No JSON object found in Gemini response")
        data: dict = {}
        data["_gemini_reasoning"] = reasoning_text
        data["_gemini_json_preview"] = _json_preview
        _fill_defaults(data)
        _derive_compat_fields(data, is_v2=False)
        return data
    text = text[json_start:]

    data: dict = {}

    # Strategy 1: clean parse
    try:
        data = json.loads(text)
        data["_gemini_reasoning"] = reasoning_text
        data["_gemini_json_preview"] = _json_preview
        data["_gemini_n_rallies"] = len(data.get("rallies", []))
        is_v2 = "jogadores" in data
        logger.info("Strategy 1 OK — is_v2=%s rallies=%d", is_v2, data["_gemini_n_rallies"])
        _fill_defaults(data)
        _derive_compat_fields(data, is_v2=is_v2)
        return data
    except json.JSONDecodeError as e:
        logger.warning("Match JSON truncated (%d chars) error=%s — attempting recovery", len(text), e)

    # Strategy 2: close unclosed brackets then retry
    repaired = text.rstrip()
    last_obj = repaired.rfind("},")
    if last_obj > len(repaired) // 2:
        repaired = repaired[: last_obj + 1]
    opens   = repaired.count("[") - repaired.count("]")
    opens_b = repaired.count("{") - repaired.count("}")
    repaired += "]" * max(0, opens) + "}" * max(0, opens_b)
    try:
        data = json.loads(repaired)
        data["_gemini_reasoning"] = reasoning_text
        data["_gemini_json_preview"] = _json_preview
        data["_gemini_n_rallies"] = len(data.get("rallies", []))
        is_v2 = "jogadores" in data
        logger.info("Recovery strategy 2 OK — is_v2=%s rallies=%d", is_v2, data["_gemini_n_rallies"])
        _fill_defaults(data)
        _derive_compat_fields(data, is_v2=is_v2)
        return data
    except json.JSONDecodeError:
        pass

    # Strategy 3: extract top-level scalar fields + whatever arrays parsed
    for key_match in re.finditer(r'"(\w+)"\s*:\s*', text):
        key = key_match.group(1)
        rest = text[key_match.end():]
        scalar = re.match(r'(-?\d+(?:\.\d+)?|"[^"]*"|true|false|null)', rest)
        if scalar:
            try:
                data[key] = json.loads(scalar.group(1))
            except Exception:
                pass
        elif rest.startswith("["):
            objs: list = []
            for m in re.finditer(r'\{[^{}]*\}', rest):
                try:
                    objs.append(json.loads(m.group(0)))
                except Exception:
                    pass
            if objs:
                data[key] = objs

    is_v2 = "jogadores" in data
    if data:
        logger.info("Recovery strategy 3: extracted keys %s is_v2=%s rallies=%d",
                    list(data.keys()), is_v2, len(data.get("rallies", [])))
    data["_gemini_reasoning"] = reasoning_text
    data["_gemini_json_preview"] = _json_preview
    data["_gemini_n_rallies"] = len(data.get("rallies", []))
    _fill_defaults(data)
    _derive_compat_fields(data, is_v2=is_v2)
    return data


def _fill_defaults(data: dict) -> None:
    # v2 schema fields
    data.setdefault("jogadores", [])
    resumo = data.setdefault("resumo", {})
    resumo.setdefault("total_rallies", 0)
    resumo.setdefault("trocas_de_campo", 0)
    resumo.setdefault("primeiro_servidor", None)
    resumo.setdefault("duracao_total_jogo", "00:00:00")
    resumo.setdefault("duracao_util", "00:00:00")
    resumo.setdefault("pontuacao_final", "")
    resumo.setdefault("resumo_jogo", "")
    resumo.setdefault("tempo_por_fase", {
        "A": {"ATAQUE": "00:00:00", "TRANSIÇÃO": "00:00:00", "DEFESA": "00:00:00"},
        "B": {"ATAQUE": "00:00:00", "TRANSIÇÃO": "00:00:00", "DEFESA": "00:00:00"},
    })
    resumo.setdefault("eventos_incomuns", [])  # kept for backward compat (v2 reports)
    resumo.setdefault("confianca", 0.0)
    data.setdefault("pausas", [])
    data.setdefault("rallies", [])

    # v1 schema backward-compatibility defaults (harmless if v2 schema)
    data.setdefault("duration_s", 0.0)
    data.setdefault("players", [])
    for key in ("player_positions", "shots", "formation_samples",
                "score_timeline", "key_frames"):
        data.setdefault(key, [])
    data.setdefault("final_score", {"team1_sets": 0, "team2_sets": 0, "detail": ""})
    data.setdefault("match_summary", "")
    data.setdefault("confidence", 0.0)


# ── Zone → court coordinate mapping ─────────────────────────────────────────
_ZONE_Y_NEAR = {
    # v3 system (3 zones)
    "REDE": 0.40, "MEIO": 0.44, "FUNDO": 0.05,
    # v2 legacy (10 zones)
    "ML1": 0.38, "ML2": 0.41, "ML3": 0.44,
    "VL1": 0.27, "VL2": 0.15,
    "VF1": 0.05, "VF2": 0.05, "VF3": 0.05, "VF4": 0.05, "VF5": 0.05,
}
_ZONE_Y_FAR = {
    # v3 system (3 zones)
    "REDE": 0.60, "MEIO": 0.56, "FUNDO": 0.95,
    # v2 legacy (10 zones)
    "ML1": 0.62, "ML2": 0.59, "ML3": 0.56,
    "VL1": 0.73, "VL2": 0.85,
    "VF1": 0.95, "VF2": 0.95, "VF3": 0.95, "VF4": 0.95, "VF5": 0.95,
}
_ZONE_X_VF = {"VF1": 0.90, "VF2": 0.70, "VF3": 0.50, "VF4": 0.30, "VF5": 0.10}
_PLAYER_DEFAULT_X = {"A1": 0.25, "A2": 0.75, "B1": 0.25, "B2": 0.75}
_PLAYER_NUM = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
_PLAYER_TEAM_FAR = {"B1", "B2"}

# Map v3/v2 shot types to compat types used by shot_counts + frontend
_SHOT_TYPE_MAP = {
    "forehand":    "forehand",
    "backhand":    "backhand",
    "volley":      "volley",
    "overhead":    "overhead",
    "smash":       "overhead",   # v2 legacy → overhead
    "bandeja":     "overhead",   # v2 legacy → overhead
    "vibora":      "overhead",   # v2 legacy → overhead
    "serve":       "serve",
    "lob":         "lob",
    "saida_vidro": "lob",        # v2 legacy → lob
    "indefinido":  "other",
    "other":       "other",
}


def _hhmmss_to_s(t: str) -> float:
    """Convert HH:MM:SS string to float seconds."""
    try:
        parts = t.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except Exception:
        pass
    return 0.0


def _zone_to_xy(zone: str, pid: str) -> tuple[float, float]:
    """Convert a zone name + player ID to normalised (court_x, court_y)."""
    is_far = pid in _PLAYER_TEAM_FAR
    zy = _ZONE_Y_FAR if is_far else _ZONE_Y_NEAR
    y = zy.get(zone, 0.75 if is_far else 0.25)
    x = _ZONE_X_VF.get(zone, _PLAYER_DEFAULT_X.get(pid, 0.5))
    return x, y


def _derive_compat_fields(data: dict, is_v2: bool | None = None) -> None:
    """Derive backward-compatible fields from the new Gemini v2 schema.

    is_v2 must be computed BEFORE _fill_defaults() runs (which always adds
    "jogadores": [] to every schema, making key-presence checks unreliable).
    Falls back to rally-structure detection if not provided.
    """

    resumo = data.get("resumo", {})
    if is_v2 is None:
        # Fallback: detect v2 by rally structure
        is_v2 = any(
            "fases" in r or "pancadas" in r or "fases_A" in r
            for r in data.get("rallies", [])
        )

    # duration_s — prefer existing value (v1 schema has it directly),
    # derive from resumo only for v2 schema
    if is_v2 or not data.get("duration_s"):
        derived_dur = _hhmmss_to_s(resumo.get("duracao_total_jogo", "00:00:00"))
        if derived_dur > 0 or is_v2:
            data["duration_s"] = derived_dur

    # match_summary and final_score (old field names, derived from new schema)
    # For v1 schema, match_summary is already set directly; only derive for v2
    if is_v2 or not data.get("match_summary"):
        data["match_summary"] = resumo.get("resumo_jogo", "")

    pf = resumo.get("pontuacao_final", "")
    # Parse e.g. "6-3 4-6 7-5" → team1_sets / team2_sets
    t1_sets, t2_sets = 0, 0
    for game in pf.split():
        parts = game.split("-")
        if len(parts) == 2:
            try:
                if int(parts[0]) > int(parts[1]):
                    t1_sets += 1
                else:
                    t2_sets += 1
            except ValueError:
                pass
    if is_v2 or not data.get("final_score", {}).get("detail"):
        data["final_score"] = {"team1_sets": t1_sets, "team2_sets": t2_sets, "detail": pf}

    # confidence: prefer existing value from v1 schema; use confianca for v2
    if is_v2 or not data.get("confidence"):
        data["confidence"] = resumo.get("confianca", 0.0)

    # players[] (old format: player=1..4, shirt_color, team, side)
    id_to_team = {"A1": "near", "A2": "near", "B1": "far", "B2": "far"}
    id_to_side = {"A1": "left", "A2": "right", "B1": "left", "B2": "right"}
    if is_v2:
        players = []
        for j in data.get("jogadores", []):
            pid = j.get("id", "")
            desc = j.get("descricao_visual", "")
            # Extract shirt colour: first element of comma-separated description
            shirt = desc.split(",")[0].strip() if desc else ""
            # Remove leading "Camisola " prefix if present
            shirt = shirt.replace("Camisola ", "").replace("camisola ", "").strip()
            players.append({
                "player": _PLAYER_NUM.get(pid, 0),
                "shirt_color": shirt,
                "team": id_to_team.get(pid, "near"),
                "side": id_to_side.get(pid, "left"),
            })
        data["players"] = players

    # shots[] flat array (old format) + shot_counts (v2 schema only)
    if is_v2:
        shots: list = []
        shot_counts: dict = {}
        for rally in data.get("rallies", []):
            for p in rally.get("pancadas", []):
                pid = p.get("jogador", "")
                pnum = _PLAYER_NUM.get(pid, 0)
                t_s = _hhmmss_to_s(p.get("timestamp", "00:00:00"))
                new_type = p.get("tipo", "indefinido")
                old_type = _SHOT_TYPE_MAP.get(new_type, "other")
                shots.append({
                    "t_s": t_s,
                    "player": pnum,
                    "type": old_type,
                    "outcome": "continuation",  # new schema has no per-shot outcome
                    "zone": p.get("zona", ""),
                })
                pk = f"player_{pnum}"
                shot_counts.setdefault(pk, {})
                shot_counts[pk][old_type] = shot_counts[pk].get(old_type, 0) + 1

        data["shots"] = shots
        data["shot_counts"] = shot_counts

        # tempo_por_fase — computed from fases_A/fases_B (v3) or fases with equipa (v2 legacy)
        phase_totals: dict = {
            "A": {"ATAQUE": 0.0, "TRANSIÇÃO": 0.0, "DEFESA": 0.0},
            "B": {"ATAQUE": 0.0, "TRANSIÇÃO": 0.0, "DEFESA": 0.0},
        }
        for rally in data.get("rallies", []):
            # v3 format: separate fases_A / fases_B lists
            for team_key, team in (("fases_A", "A"), ("fases_B", "B")):
                for fase in rally.get(team_key, []):
                    phase = fase.get("fase")
                    if phase not in phase_totals[team]:
                        continue
                    dur = _hhmmss_to_s(fase.get("fim", "00:00:00")) - _hhmmss_to_s(fase.get("inicio", "00:00:00"))
                    if dur > 0:
                        phase_totals[team][phase] += dur
            # v2 legacy format: single fases list with equipa field
            for fase in rally.get("fases", []):
                team = fase.get("equipa")
                phase = fase.get("fase")
                if team not in phase_totals or phase not in phase_totals[team]:
                    continue
                dur = _hhmmss_to_s(fase.get("fim", "00:00:00")) - _hhmmss_to_s(fase.get("inicio", "00:00:00"))
                if dur > 0:
                    phase_totals[team][phase] += dur

        def _s_to_hhmmss(s: float) -> str:
            s = max(0, int(s))
            return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"

        computed_tpf = {
            team: {ph: _s_to_hhmmss(v) for ph, v in phases.items()}
            for team, phases in phase_totals.items()
        }
        # Always use computed values — don't trust Gemini's resumo which is often wrong.
        resumo["tempo_por_fase"] = computed_tpf

        # player_positions[] — v3: from pancadas zones; v2 legacy: from fases posicao_*
        positions: list = []
        seen: set = set()

        for rally in data.get("rallies", []):
            # v3: derive positions from each shot's zona
            for p in rally.get("pancadas", []):
                pid = p.get("jogador", "")
                zone = p.get("zona", "")
                if not pid or not zone:
                    continue
                t_s = _hhmmss_to_s(p.get("timestamp", "00:00:00"))
                key = (round(t_s), pid)
                if key in seen:
                    continue
                seen.add(key)
                x, y = _zone_to_xy(zone, pid)
                pnum = _PLAYER_NUM.get(pid, 0)
                if pnum:
                    positions.append({"t_s": t_s, "player": pnum, "court_x": x, "court_y": y})
            # v2 legacy: derive positions from fases posicao_* fields
            for fase in rally.get("fases", []):
                t_s = _hhmmss_to_s(fase.get("inicio", "00:00:00"))
                for pid in ("A1", "A2", "B1", "B2"):
                    zone = fase.get(f"posicao_{pid}")
                    if not zone:
                        continue
                    key = (round(t_s), pid)
                    if key in seen:
                        continue
                    seen.add(key)
                    x, y = _zone_to_xy(zone, pid)
                    positions.append({
                        "t_s": t_s,
                        "player": _PLAYER_NUM[pid],
                        "court_x": x,
                        "court_y": y,
                    })
        data["player_positions"] = positions

        # rallies_compat[] in old format (start_s/end_s/num_shots/winner_team)
        old_rallies = []
        for rally in data.get("rallies", []):
            winner = rally.get("equipa_ganha_ponto")
            old_rallies.append({
                "start_s": _hhmmss_to_s(rally.get("inicio", "00:00:00")),
                "end_s": _hhmmss_to_s(rally.get("fim", "00:00:00")),
                "num_shots": len(rally.get("pancadas", [])),
                "winner_team": 1 if winner == "A" else (2 if winner == "B" else None),
            })
        data["rallies_v2"] = data["rallies"]   # keep original v2 for reference
        data["rallies"] = old_rallies           # replace with compat format for all consumers


# ── Derived metrics ──────────────────────────────────────────────────────────

def compute_shot_counts(shots: list[dict]) -> dict:
    """Build {player_N: {shot_type: count}} from the raw shots list."""
    counts = {
        f"player_{p}": {t: 0 for t in SHOT_TYPES}
        for p in (1, 2, 3, 4)
    }
    for s in shots:
        p = s.get("player")
        t = s.get("type", "other")
        if p not in (1, 2, 3, 4):
            continue
        if t not in SHOT_TYPES:
            t = "other"
        counts[f"player_{p}"][t] += 1
    return counts


def compute_formation_pct(samples: list[dict]) -> dict:
    """Percentage of sampled time spent in each formation."""
    counts = {f: 0 for f in FORMATIONS}
    for s in samples:
        t = s.get("type", "mixed")
        counts[t if t in counts else "mixed"] += 1
    total = sum(counts.values())
    if total == 0:
        return {f: 0.0 for f in FORMATIONS}
    return {f: round(100.0 * c / total, 1) for f, c in counts.items()}


def compute_rally_stats(rallies: list[dict], duration_s: float) -> dict:
    """Aggregate rally stats: count, average length, total/percentage play time."""
    durations = []
    for r in rallies:
        # Support both old format (start_s/end_s) and new compat format
        start = r.get("start_s", 0.0)
        end = r.get("end_s", 0.0)
        d = end - start
        if d > 0:
            durations.append(d)
    total_play = sum(durations)
    return {
        "total_rallies": len(rallies),
        "avg_duration_s": round(total_play / len(durations), 1) if durations else 0.0,
        "total_play_time_s": round(total_play, 1),
        "play_time_pct": round(100.0 * total_play / duration_s, 1) if duration_s else 0.0,
    }


def enrich_report(report: dict) -> dict:
    """Add derived fields the frontend consumes."""
    is_v2 = bool(report.get("rallies_v2")) or any(
        "fases" in r or "pancadas" in r for r in report.get("rallies", [])
    )

    # For v2 schema, ensure compat fields are derived if not already present
    if is_v2 and "shot_counts" not in report:
        _derive_compat_fields(report)

    report["shot_counts"] = compute_shot_counts(report.get("shots", []))
    report["formation_pct"] = compute_formation_pct(report.get("formation_samples", []))
    # rallies is always in compat format (start_s/end_s) after _derive_compat_fields
    rallies_for_stats = report.get("rallies", [])
    report["rally_stats"] = compute_rally_stats(
        rallies_for_stats, report.get("duration_s", 0.0)
    )
    return report
