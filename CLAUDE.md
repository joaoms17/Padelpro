# PadelPro Vision

Análise de jogos de padel por visão computacional: o utilizador filma o jogo
com um telemóvel atrás do campo, carrega o vídeo no site, e recebe o tempo
útil + estatísticas por jogador (zonas, heatmaps, velocidades, pancadas).
O sistema melhora com feedback humano: cada correção feita no frontend vira
exemplo de treino.

## Stack (decidida — não mudar sem razão forte)

| Camada | Tecnologia | Nota |
|---|---|---|
| Deteção de jogadores | torchvision Faster R-CNN (BSD) | pesos COCO automáticos |
| Tracking | ByteTrack via `supervision` (MIT) + GreedyTracker fallback | re-ID por cor da camisola em `tracking/reid.py` |
| Pose | RTMPose-m via rtmlib/ONNX (Apache 2.0) | `pip install rtmlib onnxruntime`; stub geométrico se faltar |
| Pancadas | TCN próprio (`strokes/classifier.py`) | regras geométricas até existir `checkpoints/stroke_tcn.pth` |
| Calibração | homografia 4 pontos + deteção automática (`calibration/auto.py`) | qualidade validada e guardada |
| Backend | FastAPI (`api/`) | jobs em memória — reiniciar perde a lista |
| Frontend | Next.js 14 + Tailwind (`dashboard/`) | deploy Vercel automático a cada push ao `main` |

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

Windows (máquina do João): `.\scripts\publicar_para_teste.ps1` arranca API +
túnel Cloudflare + aponta o Vercel. **Scripts .ps1 têm de ser ASCII puro ou
UTF-8 com BOM** — o Windows PowerShell parte acentos sem BOM.

## Filosofia: medir antes de mexer

Este projeto tem um sistema de medição completo — usa-o:
- `scripts/evaluate.py` — scorecard objetivo vs clips anotados (golden set em `data/golden/`)
- `scripts/ab_compare.py` — diff métrica a métrica entre duas configs
- `quality_report.json` por jogo + dashboard `/qualidade` — telemetria sem anotações
  (velocidades impossíveis, teleports, fragmentação de tracks = canário de regressões)

**Nunca afirmar que uma mudança de modelo/config melhorou sem scorecard antes/depois.**

## Ciclo de treino (o coração do produto)

```
analisar jogo → rever pancadas (/review) ou etiquetar clips (/label)
→ correções viram amostras de treino + ground truth de avaliação
→ retreino (botão no site ou padelpro_vision/feedback/retrain.py)
→ checkpoints/stroke_tcn.pth → pipeline usa-o automaticamente
```

Mínimo 40 amostras / 2 classes para o retreino disparar. O pipeline guarda
janelas de pose por evento (`*_pose_windows.json`) — é a elas que as
correções se colam.

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

- Processo antigo da API + `git pull` = erros tipo `'ModelConfig' object has no attribute ...` (imports lazy carregam código novo com config velha em memória). Reiniciar a API resolve; o script de publicação já o faz.
- O Render (deploy leve) não tem torch — análise de jogadores e retreino respondem indisponível lá; é por design.
- `data/dataset/hits/` (clips para etiquetar) vive na máquina de quem corre a API — a árvore de pastas É o dataset.
