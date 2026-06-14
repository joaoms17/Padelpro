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

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"

# How the report's normalised court coordinates are oriented:
#   court_x: 0.0 = left edge, 1.0 = right edge (as seen from the camera)
#   court_y: 0.0 = near baseline (closest to camera), 1.0 = far baseline
# Players 1 & 2 are the near team (Equipa A); players 3 & 4 are the far team (Equipa B).

SHOT_TYPES = ("forehand", "backhand", "volley", "smash", "bandeja",
              "vibora", "serve", "lob", "other")

FORMATIONS = ("both_net", "both_back", "split_near_net", "split_far_net", "mixed")

_MATCH_PROMPT = """
# PROMPT GEMINI — ANÁLISE DE VÍDEO DE PADEL
---
## INSTRUÇÕES GERAIS
Analisa este vídeo de padel. Antes de gerar qualquer JSON, escreve um bloco de raciocínio entre `<raciocinio>` e `</raciocinio>` onde:
1. Identificas os 4 jogadores e descreves os seus elementos visuais
2. Confirmas a posição inicial (esquerda/direita) de cada equipa
3. Verificas as tuas deteções antes de as confirmar no JSON
4. Para cada rally, rastreias as mudanças de posição coletiva de cada equipa e registas o timestamp exacto de cada transição de fase — estes dados são usados para cortar o vídeo automaticamente por fase (ATAQUE / TRANSIÇÃO / DEFESA). O serviço é um momento dentro do ATAQUE, não uma fase separada
5. Cada vez que a posição coletiva de uma equipa muda claramente, fechas a fase anterior (registas o `fim`) e abres uma nova (registas o `inicio`). Só registas uma **mudança de fase** quando a mudança é visualmente confirmada — nunca por estimativa
6. No `resumo` do JSON incluis: `duracao_util` (duração total menos todas as pausas) e `tempo_por_fase` com o total acumulado por fase (ATAQUE / TRANSIÇÃO / DEFESA) para cada equipa

---
## 1. IDENTIFICAÇÃO DOS JOGADORES
No início do vídeo, identifica os 4 jogadores com base nos seguintes elementos visuais:
- Cor e padrão da **camisola**
- Cor dos **calções**
- Cor e padrão das **meias**
- Cor e modelo dos **ténis**
- Modelo e cor da **raquete**

Se dois jogadores tiverem elementos similares, usa a combinação dos restantes fatores para os distinguir.

**Posição no campo:** o Gemini deteta os jogadores automaticamente (bounding box). A referência de posição é sempre a **parte inferior do bounding box** — não a cabeça nem o tronco. Se o bounding box não for suficiente, usa os ténis/pés como backup.

Atribui as seguintes IDs:
- **Equipa A:** `A1` (lado esquerdo) e `A2` (lado direito)
- **Equipa B:** `B1` (lado esquerdo) e `B2` (lado direito)

> **Nota:** Esquerda/direita serve apenas para identificação inicial. Não é usada na análise posterior — a posição muda ao longo do jogo.

---
## 2. SISTEMA DE ZONAS DO CAMPO

Zonas do campo, da rede para o fundo:

| Zona | Localização | Fase |
|------|-------------|------|
| `ML1` | 1ª malha (junto à rede) | ATAQUE |
| `ML2` | 2ª malha | ATAQUE |
| `ML3` | 3ª malha + espaço até à linha de serviço | TRANSIÇÃO |
| `VL1` | 1º vidro lateral (da linha de serviço até ao VL2) | DEFESA |
| `VL2` | 2º vidro lateral | DEFESA |
| `VF1`–`VF5` | Vidro de fundo — da direita (`VF1`) para a esquerda (`VF5`) | DEFESA |

**Zona ML3:** engloba o painel físico da 3ª malha e todo o espaço de campo aberto até à linha de serviço. A linha de serviço é a fronteira entre ML3 (TRANSIÇÃO) e VL1 (DEFESA) — não existe sobreposição entre zonas.

**VL1:** começa na linha de serviço e estende-se até ao VL2.

**VF1–VF5:** o vidro de fundo divide-se em 5 zonas da direita para a esquerda (perspectiva da câmara). Usa para registar posições precisas no fundo do campo.

---
## 3. FASES DE JOGO

As fases são determinadas pela posição **coletiva da equipa** — nunca pelo jogador individual.

| Fase | Condição |
|------|----------|
| `ATAQUE` | Ambos os jogadores da equipa em ML1 ou ML2 — **exceto durante o serviço** (ver nota abaixo) |
| `TRANSIÇÃO` | Um ou ambos os jogadores na zona ML3 (da 3ª malha até à linha de serviço) |
| `DEFESA` | Ambos os jogadores em VL1, VL2 ou VF1–VF5 |

**Nota — Serviço dentro do ATAQUE:**
O serviço não é uma fase separada — é um momento (`momento: "servico"`) registado dentro da fase ATAQUE da equipa que serve. O parceiro já está em ML1/ML2; o servidor executa a partir de VL1/VL2/VF mas a equipa mantém a fase ATAQUE. Regista o `timestamp_servico` na fase para permitir cortes isolados no futuro.

**Nota — 2ª bola (para uso futuro):**
A primeira pancada da equipa receptora após o serviço é a "2ª bola". Regista `"segunda_bola": true` na pancada correspondente em `pancadas` — não altera a fase, serve apenas para análise futura.

**Regras obrigatórias:**
- A fase só muda quando o **bounding box ou os pés** do(s) jogador(es) mudam claramente de zona
- Em caso de dúvida, **mantém a fase anterior**
- Uma equipa **não pode** passar directamente de `DEFESA` → `ATAQUE` sem `TRANSIÇÃO`. **Exceção:** se a transição foi demasiado rápida para captar — aceitar o salto sem erro, o rally continua

Cada fase gera um clip independente com timestamps de início e fim.

---
## 4. DETECÇÃO DO SERVIÇO

O serviço é um **momento dentro da fase ATAQUE** (ver secção 3). Detecta-o para registar `timestamp_servico` e `momento: "servico"` na fase correspondente, e para marcar `"tipo": "serve"` na pancada.

Imediatamente antes do serviço e quando o serviço acontece, verificam-se estas condições:
- Servidor está **atrás da linha de serviço** (zona VL1/VL2/VF1–VF5)
- Parceiro do servidor está junto à rede (ML1/ML2)
- Adversários perto da linha de serviço ou atrás
- A bola cai da mão do servidor, bate no chão, e o servidor bate-a com a raquete
- A bola vai cruzada para o **quadrado de serviço diagonal** do adversário

**Validade do serviço:**
- ✅ Válido se: a bola bate dentro do quadrado de serviço cruzado e não toca na malha; confirmado se o receptor jogou a bola de volta **e** o próximo serviço é feito para o lado oposto (ou muda o servidor)
- 🔄 Repetição (let): a bola toca na tela da rede mas cai dentro do quadrado cruzado — o serviço repete-se
- ❌ Falta se: a bola toca na malha e não entra; ou o receptor não jogou (deixou passar, passou a bola sem força ao adversário, ou bateu para a rede); ou muda o servidor

---
## 5. FIM DE RALLY

Um rally termina quando **uma** destas condições for verdade:

1. **(Primário — deteção de bola)** A bola saiu do campo; ou está na mão de um jogador; ou tocou duas vezes no chão; ou a mesma equipa tocou nela duas vezes seguidas
2. Mais de **6 segundos** sem nenhuma pancada de nenhum jogador — se o ponto está a durar 6 segundos sem pancada, terminou. Aplica-se sempre, independentemente de a bola ser detetável ou não
3. Dois jogadores cumprimentam-se (de equipas opostas ou da mesma equipa) — indicador claro de fim de ponto
4. Um jogador toca na rede com a raquete ou o corpo durante o rally

---
## 6. PAUSAS E TROCA DE CAMPO

Uma pausa superior a **45 segundos** pode indicar três situações diferentes. Após a pausa, verifica a posição dos jogadores para determinar qual:

| Situação | Indicador |
|----------|-----------|
| **Troca de campo** | Jogadores estão no lado oposto ao que estavam antes da pausa |
| **Discussão / timeout** | Jogadores continuam no mesmo lado, reagrupados junto à rede ou no fundo |
| **Lesão / interrupção** | Jogadores dispersos, câmara pode focar num jogador específico |

**Em qualquer pausa > 45 segundos:**
- Regista com timestamps de início e fim
- Regista a duração em segundos
- Identifica a situação (`troca_de_campo`, `discussao`, `lesao`, `indefinido`)
- Se for troca de campo: atualiza as posições dos jogadores para o lado oposto
- A camisola de um jogador pode mudar durante a pausa, mas não de todos em simultâneo — atualiza só o jogador que mudou
- Cruza com os dados de posição de cada jogador no resumo individual

**No JSON das pausas**, inclui o campo `tipo_pausa` com um destes valores: `troca_de_campo`, `discussao`, `lesao`, `indefinido`.

---
## 7. TIPOS DE PANCADA

Para cada pancada, identifica o tipo com base no que vês. Usa `indefinido` se não tiveres certeza.

| Tipo | Descrição |
|------|-----------|
| `volley` | Pancada sem deixar a bola tocar no chão. Geralmente em ML1/ML2, mas pode ser feita mais atrás |
| `forehand` | Pancada após a bola tocar no chão (ou no vidro), executada pelo lado dominante |
| `backhand` | Pancada após a bola tocar no chão (ou no vidro), executada pelo lado não-dominante |
| `smash` | Após um balão do adversário: pancada com **força máxima**, executada **acima da cabeça**. Equipa tipicamente em ataque |
| `overhead` | Após um balão do adversário: pancada executada **ao lado da cabeça**, com efeito lateral, pulso alto e movimento lateral. Inclui: víbora (lateral com efeito), bandeja (controlado a recuar), kick (bola mais à esquerda da cabeça, raquete mais alta, tocado para malha ou vidro lateral) |
| `saida_vidro` | Equipa recua após balão adversário, deixa a bola bater alto no **vidro de fundo**, e executa a pancada quando a bola ressalta |
| `serve` | Serviço (ver secção 4) |
| `indefinido` | Tipo não identificável com certeza |

> **Smash vs. Overhead:** ambos ocorrem após balão adversário. O smash é força máxima acima da cabeça; o overhead tem movimento lateral e efeito.

---
## 8. RACIOCÍNIO ANTES DO JSON

Antes de gerar o JSON, escreve o bloco de raciocínio:

<raciocinio>
Jogadores identificados:
- A1: [descrição visual completa]
- A2: [descrição visual completa]
- B1: [descrição visual completa]
- B2: [descrição visual completa]
Posição inicial: Equipa A no lado [esquerdo/direito], Equipa B no lado [esquerdo/direito].
[Descreve o que vês nos primeiros segundos do vídeo antes de confirmar qualquer deteção.]
</raciocinio>

---
## 9. OUTPUT JSON

```json
{
  "jogadores": [
    { "id": "A1", "equipa": "A", "descricao_visual": "Camisola azul escura, calções pretos, meias brancas, ténis brancos Nike, raquete Head vermelha" },
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
    "tempo_por_fase": {
      "A": { "ATAQUE": "00:00:00", "TRANSIÇÃO": "00:00:00", "DEFESA": "00:00:00" },
      "B": { "ATAQUE": "00:00:00", "TRANSIÇÃO": "00:00:00", "DEFESA": "00:00:00" }
    },
    "eventos_incomuns": [],
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
      "servico_valido": true,
      "equipa_ganha_ponto": "A",
      "fases": [
        { "fase": "ATAQUE", "momento": "servico", "timestamp_servico": "00:00:00", "equipa": "A", "inicio": "00:00:00", "fim": "00:00:01", "posicao_A1": "VL2", "posicao_A2": "ML1", "posicao_B1": "VL1", "posicao_B2": "VL1" },
        { "fase": "DEFESA", "equipa": "B", "inicio": "00:00:00", "fim": "00:00:05", "posicao_A1": "VL2", "posicao_A2": "ML1", "posicao_B1": "VL1", "posicao_B2": "VL1" },
        { "fase": "TRANSIÇÃO", "equipa": "A", "inicio": "00:00:01", "fim": "00:00:03", "posicao_A1": "ML3", "posicao_A2": "ML2", "posicao_B1": "VL1", "posicao_B2": "VL2" },
        { "fase": "ATAQUE", "equipa": "A", "inicio": "00:00:03", "fim": "00:00:08", "posicao_A1": "ML1", "posicao_A2": "ML2", "posicao_B1": "VF3", "posicao_B2": "VF1" },
        { "fase": "DEFESA", "equipa": "B", "inicio": "00:00:05", "fim": "00:00:08", "posicao_A1": "ML1", "posicao_A2": "ML2", "posicao_B1": "VF3", "posicao_B2": "VF1" }
      ],
      "pancadas": [
        { "timestamp": "00:00:00", "jogador": "A1", "tipo": "serve", "zona": "VL2" },
        { "timestamp": "00:00:00", "jogador": "B2", "tipo": "backhand", "zona": "VL1", "segunda_bola": true }
      ]
    }
  ]
}
```

---
## REGRAS DE TIMESTAMP
- Ancora timestamps **apenas** em eventos visuais claros: início de serviço, primeira pancada do rally, bola fora, fim de ponto
- Arredonda ao segundo mais próximo
- **Não inventas timestamps por estimativa** — se não consegues ancorar, omite o evento

---
*Versão: 2026-06-14 v2 — PadelPro Vision*
""".strip()


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

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_file, _MATCH_PROMPT],
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
        "Gemini full-match (schema=%s): %d positions, %d shots, %d rallies (duration=%.0fs)",
        "v2" if is_v2 else "v1", n_pos, n_shots, n_rallies, dur,
    )
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
    reasoning_match = re.search(r'<raciocinio>(.*?)</raciocinio>', text, re.DOTALL | re.IGNORECASE)
    if reasoning_match:
        logger.info("Gemini reasoning (first 1000 chars): %s", reasoning_match.group(1).strip()[:1000])
        text = text[text.lower().find('</raciocinio>') + len('</raciocinio>'):]

    # Find the start of the JSON object
    json_start = text.find('{')
    if json_start == -1:
        logger.warning("No JSON object found in Gemini response")
        data: dict = {}
        _fill_defaults(data)
        _derive_compat_fields(data, is_v2=False)
        return data
    text = text[json_start:]

    data: dict = {}

    # Strategy 1: clean parse
    try:
        data = json.loads(text)
        is_v2 = "jogadores" in data
        _fill_defaults(data)
        _derive_compat_fields(data, is_v2=is_v2)
        return data
    except json.JSONDecodeError:
        logger.warning("Match JSON truncated (%d chars) — attempting recovery", len(text))

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
        is_v2 = "jogadores" in data
        logger.info("Recovery strategy 2 succeeded (%d chars)", len(repaired))
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
        logger.info("Recovery strategy 3: extracted keys %s", list(data.keys()))
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
    resumo.setdefault("eventos_incomuns", [])
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
    "ML1": 0.38, "ML2": 0.41, "ML3": 0.44,
    "VL1": 0.27, "VL2": 0.15,
    "VF1": 0.05, "VF2": 0.05, "VF3": 0.05, "VF4": 0.05, "VF5": 0.05,
}
_ZONE_Y_FAR = {
    "ML1": 0.62, "ML2": 0.59, "ML3": 0.56,
    "VL1": 0.73, "VL2": 0.85,
    "VF1": 0.95, "VF2": 0.95, "VF3": 0.95, "VF4": 0.95, "VF5": 0.95,
}
_ZONE_X_VF = {"VF1": 0.90, "VF2": 0.70, "VF3": 0.50, "VF4": 0.30, "VF5": 0.10}
_PLAYER_DEFAULT_X = {"A1": 0.25, "A2": 0.75, "B1": 0.25, "B2": 0.75}
_PLAYER_NUM = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
_PLAYER_TEAM_FAR = {"B1", "B2"}

# Map new shot types to old schema types
_SHOT_TYPE_MAP = {
    "volley": "volley",
    "forehand": "forehand",
    "backhand": "backhand",
    "smash": "smash",
    "overhead": "bandeja",   # closest old equivalent
    "saida_vidro": "lob",    # closest old equivalent
    "serve": "serve",
    "indefinido": "other",
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
        # Fallback: detect v2 by rally structure (v2 has "fases"/"pancadas"; v1 has "start_s")
        is_v2 = any("fases" in r or "pancadas" in r for r in data.get("rallies", []))

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
                })
                pk = f"player_{pnum}"
                shot_counts.setdefault(pk, {})
                shot_counts[pk][old_type] = shot_counts[pk].get(old_type, 0) + 1

        data["shots"] = shots
        data["shot_counts"] = shot_counts

        # tempo_por_fase — computed from actual fases data (don't trust Gemini's value)
        phase_totals: dict = {
            "A": {"ATAQUE": 0.0, "TRANSIÇÃO": 0.0, "DEFESA": 0.0},
            "B": {"ATAQUE": 0.0, "TRANSIÇÃO": 0.0, "DEFESA": 0.0},
        }
        for rally in data.get("rallies", []):
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
        # Only overwrite if we computed meaningful values; else keep Gemini's value
        total_computed = sum(
            v for phases in phase_totals.values() for v in phases.values()
        )
        if total_computed > 0 or not resumo.get("tempo_por_fase"):
            resumo["tempo_por_fase"] = computed_tpf

        # player_positions[] from fases (zone → coordinates)
        positions: list = []
        seen: set = set()
        for rally in data.get("rallies", []):
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
        data["rallies_compat"] = old_rallies


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
    is_v2 = bool(report.get("jogadores"))  # new schema from updated prompt

    # For v2 schema, ensure compat fields are derived if not already present
    if is_v2 and "shot_counts" not in report:
        _derive_compat_fields(report)

    report["shot_counts"] = compute_shot_counts(report.get("shots", []))
    report["formation_pct"] = compute_formation_pct(report.get("formation_samples", []))
    # Use rallies_compat for stats in v2 schema
    rallies_for_stats = report.get("rallies_compat", []) if is_v2 else report.get("rallies", [])
    report["rally_stats"] = compute_rally_stats(
        rallies_for_stats, report.get("duration_s", 0.0)
    )
    return report
