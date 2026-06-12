# PadelPro Vision

Módulo de análise de jogo de padel por visão computacional.
Processa vídeo de câmara fixa (ângulo alto) e produz, por jogador:
distância, velocidades, heatmap, distribuição de pancadas e vídeo condensado.

**Licença:** apenas dependências Apache 2.0 / MIT / BSD. Zero AGPL/NC.

---

## Requisitos

- Python 3.12+
- ffmpeg (no PATH)
- pip ou [uv](https://github.com/astral-sh/uv)
- GPU ≥ 8 GB VRAM para inferência rápida (CPU funciona, mais lento)

---

## Instalação

```bash
# Clonar e entrar no directório
git clone <repo> padelpro-vision && cd padelpro-vision

# Criar ambiente virtual
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Instalar dependências base
pip install -e .

# Instalar opcionais de deteção/tracking (necessário para deteção real)
pip install torch torchvision supervision

# Copiar e preencher variáveis de ambiente
cp .env.example .env
# editar .env com as tuas credenciais Supabase
```

---

## Stack de modelos

O projeto usa uma única stack, toda com licenças permissivas (ver `LICENSES.md`):

| Tarefa | Modelo | Instalação | Licença |
|---|---|---|---|
| Deteção de jogadores | torchvision Faster R-CNN (MobileNetV3) | `pip install torch torchvision` — pesos descarregam sozinhos | BSD-3 |
| Tracking | ByteTrack via `supervision` | `pip install supervision` | MIT |
| Pose | RTMPose-m (MMPose) | `mim install mmpose && mim download mmpose --config rtmpose-m_8xb256-420e_coco-256x192 --dest checkpoints/` | Apache 2.0 |
| Pancadas | TCN próprio | treinado via revisão/etiquetagem no frontend → `checkpoints/stroke_tcn.pth` | — |

> Sem `supervision` o tracking usa o GreedyTracker interno; sem MMPose a pose corre
> em stub (sem classificação real de pancadas). O TCN é usado automaticamente
> quando `checkpoints/stroke_tcn.pth` existe; até lá valem as regras geométricas.

---

## Calibrar um campo

Seleciona os 4 cantos do campo no primeiro frame do vídeo:

```bash
python scripts/calibrate_court.py \
    --video data/videos/jogo_sintra.mp4 \
    --court-id sintra_court1
```

Clica nos cantos na ordem: **topo-esq → topo-dir → baixo-dir → baixo-esq**, depois prime `ENTER`.
A homografia fica guardada em `data/homographies/sintra_court1.json` e reutilizada automaticamente.

---

## Correr o M1

```bash
python scripts/run_match.py \
    --video data/videos/jogo_sintra.mp4 \
    --match-id match_001 \
    --court-id sintra_court1 \
    --output data/output \
    --device cpu   # ou cuda:0
```

**Outputs em `data/output/match_001/`:**
- `match_001_positions.csv` — posições de todos os jogadores por frame
- `match_001_annotated.mp4` — vídeo com bounding boxes e IDs

---

## Testes

```bash
pip install pytest
pytest tests/ -v
```

---

## Deploy

Ver [docs/DEPLOY.md](docs/DEPLOY.md) — frontend no Vercel (auto a cada push ao
`main`) + API local com tunnel (sessões de equipa) ou no Render (sempre no ar),
com código de acesso opcional via `PADELPRO_ACCESS_CODE`.

---

## Avaliação e qualidade

O sistema de medição vive em `padelpro_vision/evaluation/` e `padelpro_vision/quality/`
— ver [docs/EVALUATION.md](docs/EVALUATION.md) para o guia completo.

```bash
# Avaliar contra clips anotados (golden set — ver data/golden/README.md)
python scripts/evaluate.py --golden data/golden --out outputs/eval

# Comparar duas configurações objetivamente
python scripts/ab_compare.py --a video.input_skip_frames=1 --b video.input_skip_frames=2
```

Cada jogo processado escreve também `quality_report.json` (telemetria de
deteção/tracking/física, sem anotações) e `review_queue.json` (momentos de
baixa confiança para anotar — active learning).

Datasets e modelos externos utilizáveis: [docs/RESOURCES.md](docs/RESOURCES.md).

---

## Roadmap

| Milestone | Estado | O que entrega |
|-----------|--------|---------------|
| M1 — Esqueleto | ✅ | deteção + tracking + CSV de posições |
| Seg — Segmentação | 🔜 | corte de tempo morto + vídeo condensado |
| M2 — Pose + Pancada | 🔜 | RTMPose + classificador de stroke |
| M3 — Analytics | 🔜 | velocidades, heatmaps, Supabase |
| Idx — Indexação | 🔜 | clips navegáveis + montagens |
| M4 — Dashboard | 🔜 | upload + cartão por jogador |
| V2 — Bola | 🔜 | velocidade de bola, winner/erro |

---

## Estrutura

```
padelpro_vision/
├── pipeline.py          # orquestrador M1
├── calibration/         # homografia + cache
├── detection/           # torchvision Faster R-CNN (BSD)
├── tracking/            # ByteTrack (supervision) + GreedyTracker
├── io/                  # vídeo I/O + Supabase client
├── constants/           # dimensões ITF do campo
├── segmentation/        # TODO: corte de tempo morto
├── pose/                # TODO: RTMPose
├── strokes/             # TODO: classificador temporal
├── analytics/           # TODO: velocidades, heatmaps
├── projection/          # TODO: projeção 2D
├── indexing/            # TODO: rallies, clips, montagens
└── viz/                 # overlays + gráficos
```
