# PadelPro Vision

Análise de jogos de padel: o utilizador filma o jogo com um telemóvel atrás do
campo, carrega o vídeo (ou cola um link/YouTube) no site, e recebe o tempo útil
+ estatísticas por jogador (zonas, heatmaps, velocidades) + a leitura da IA
(tipos de pancada, winners/erros, tática).

**Duas camadas (não confundir):**
- **Runtime** (quando alguém usa a app): o **Gemini** lê o jogo — é o motor
  atual. As correções no `/review` validam essa leitura e formam um golden set.
- **Treino** (offline, futuro): o objetivo é um modelo próprio (TCN) treinado a
  partir de pancadas rotuladas pelo Gemini → RTMPose → TCN, que correria em
  tempo real e substituiria o Gemini no runtime. Ainda **não** está construído.

## Stack (decidida — não mudar sem razão forte)

| Camada | Tecnologia | Nota |
|---|---|---|
| Deteção de jogadores | torchvision Faster R-CNN (BSD) | pesos COCO automáticos |
| Tracking | ByteTrack via `supervision` (MIT) + GreedyTracker fallback | re-ID por cor da camisola em `tracking/reid.py` |
| Pose | RTMPose-m via rtmlib/ONNX (Apache 2.0) | `pip install rtmlib onnxruntime`; stub geométrico se faltar |
| Pancadas (tipo/outcome/tática) | **Gemini** em runtime (`analysis/gemini_clip.py`) | TCN próprio (`strokes/classifier.py`) é o objetivo futuro, treinado offline |
| Calibração | homografia 4 pontos + deteção automática (`calibration/auto.py`) | qualidade validada e guardada |
| Análise espacial pesada | Modal GPU (`MODAL_ANALYZE_URL`) | pose/tracking; opcional — sem ela, "Analisar jogadores" indisponível |
| Backend | FastAPI (`api/`) | jobs em memória — reiniciar perde a lista |
| Frontend | Next.js 14 + Tailwind (`dashboard/`) | deploy Vercel automático a cada push ao `main`; marca v2 (navy+teal) |

**REGRA DE LICENÇAS: nada de AGPL (Ultralytics YOLO proibido) nem NonCommercial.**
Ver `LICENSES.md` e `docs/RESOURCES.md` (levantamento verificado de datasets/modelos externos).

## Comandos essenciais

```bash
pip install -e . && pip install fastapi httpx python-multipart pytest opencv-python-headless numpy
python -m pytest tests/ -q          # 128+ testes — TÊM de passar antes de qualquer PR
cd dashboard && npm ci && npx next build   # build do frontend — idem
uvicorn api.main:app --port 8010    # API local
python scripts/evaluate.py --golden data/golden --out outputs/eval   # avaliação vs ground truth
```

Tudo na cloud (Vercel + Render + Gemini + Modal) — ver `docs/DEPLOY.md`. Já não
há túnel Cloudflare nem API no PC. **Scripts .ps1 têm de ser ASCII puro ou
UTF-8 com BOM** — o Windows PowerShell parte acentos sem BOM.

## Filosofia: medir antes de mexer

Este projeto tem um sistema de medição completo — usa-o:
- `scripts/evaluate.py` — scorecard objetivo vs clips anotados (golden set em `data/golden/`)
- `scripts/ab_compare.py` — diff métrica a métrica entre duas configs
- `quality_report.json` por jogo + dashboard `/qualidade` — telemetria sem anotações
  (velocidades impossíveis, teleports, fragmentação de tracks = canário de regressões)

**Nunca afirmar que uma mudança de modelo/config melhorou sem scorecard antes/depois.**

## Runtime hoje vs treino (futuro)

**Hoje (runtime):** o Gemini lê cada jogo. As correções no `/review` validam essa
leitura e escrevem o golden set (`data/feedback/golden/`) usado por
`scripts/evaluate.py`. Não há retreino no site — isso era do TCN antigo e foi
removido.

**Futuro (treino do modelo próprio, offline — ainda por construir):**
```
corpus de vídeos → Gemini rotula pancadas (CSV: tempo+tipo)
→ RTMPose extrai poses nesses tempos (Modal GPU)
→ TCN treina (scripts/train_stroke_classifier.py)
→ checkpoints/stroke_tcn.pth → runtime passa a usar o TCN em vez do Gemini
```
A página `/annotate` continua a treinar os **detetores de bola e jogadores**
(`feedback/retrain.py: retrain_ball_detector / retrain_player_detector`) — esses
são modelos de visão úteis e independentes do classificador de pancadas.

## Convenções de trabalho

- **Branch próprio → PR para `main`** com testes verdes + `next build` limpo. O merge ao `main` deploya o frontend automaticamente (Vercel via Git).
- Texto do produto em **PT-PT**; código/commits em inglês.
- API: routers em `api/routers/`, registados em `api/main.py`. Se o frontend passar a depender de um endpoint novo, **bumpa `API_BUILD`** em `api/main.py` e `EXPECTED_API_BUILD` em `dashboard/src/lib/api.ts` (handshake da faixa "API desatualizada").
- Imports pesados (torch/mmpose/cv2 em routers) sempre lazy — a API tem de arrancar sem eles.
- Testes para tudo o que tenha lógica (`tests/` — segue o estilo existente, com monkeypatch dos dirs).

## Backlog priorizado (escolhe daqui)

1. **Deteção da bola** — integrar WASB (MIT, pesos de ténis prontos) na pancada; ver secção 1 do `docs/RESOURCES.md`. Maior salto de qualidade pendente.
2. **Bootstrap do TCN com PadelTracker100** — descarregar do Zenodo (manual), correr `scripts/convert_padeltracker100.py --inspect`, afinar o conversor ao formato real, treinar.
3. **Treino/análise em GPU via Modal** — já há offload começado (`extract_hit_clips.py` / commits do João); precisa do token como secret.
4. **Segmentação aprendida** — substituir thresholds fixos (0.8/0.55) por classificador sobre features áudio+movimento, treinado com os rallies do golden set.
5. **Deteção de batimento ao frame com E2E-Spot** (BSD-3, modelos de ténis prontos) — ver secção 7.4 do RESOURCES.md.
6. **Persistência real** — jobs/matches em SQLite ou Supabase (hoje é tudo em memória).

## Armadilhas conhecidas

- O Render (deploy leve) não tem torch — a análise espacial de jogadores requer `MODAL_ANALYZE_URL` (Modal GPU); sem ela responde indisponível, mas corte + Gemini funcionam. É por design.
- Import por link usa `yt-dlp` (vem no extra `backend`). O YouTube bloqueia muitas vezes downloads de IPs de datacenter (Render) — nesse caso o upload do PC é o caminho fiável.
- Jobs do condense vivem em memória (`_jobs`) e são limpos ~1h depois; os artefactos de revisão persistem em `data/output/{id}/` (inclui `gemini.json`).
