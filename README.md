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

# Instalar opcionais de deteção (necessário para deteção real)
pip install openmim
mim install mmcv mmdet

# Copiar e preencher variáveis de ambiente
cp .env.example .env
# editar .env com as tuas credenciais Supabase
```

---

## Pesos de modelos necessários

> Confirma a licença de cada ficheiro de pesos antes de uso em produção (ver `LICENSES.md`).

### YOLOX-m (recomendado para M1)

**Licença:** Apache 2.0

```bash
mim download mmdet --config yolox_m_8xb8-300e_coco --dest checkpoints/
```

### RTMDet-m (alternativa)

**Licença:** Apache 2.0

```bash
mim download mmdet --config rtmdet_m_8xb32-300e_coco --dest checkpoints/
```

### ByteTrack (tracking)

**Licença:** MIT

```bash
pip install git+https://github.com/ifzhang/ByteTrack.git
```

> Sem estes pesos, o pipeline corre em modo stub (sem deteções, estrutura de código completa).

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
├── detection/           # YOLOX / RTMDet wrapper
├── tracking/            # ByteTrack wrapper
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
