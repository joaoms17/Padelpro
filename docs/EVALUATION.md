# Medir resultados — guia de avaliação

Sem medição, qualquer mudança de modelo é fé. Este documento descreve o
sistema de avaliação do PadelPro: o que é medido, com e sem anotações, e o
fluxo para melhorar continuamente.

## 1. Camadas de medição

| Camada | Precisa de anotação? | Onde |
|---|---|---|
| Física (velocidades impossíveis, teleports, fora do campo) | Não | `quality_report.json` por jogo + `evaluate.py` |
| Estabilidade de tracking (nº de tracks, fragmentação, % tempo com 4 jogadores) | Não | idem |
| Qualidade da calibração (erro de reprojeção, convexidade) | Não | `data/homographies/<court>.json` → `quality` |
| Segmentação de rallies (P/R/F1 temporal, IoU) | Sim — rallies | golden set |
| Deteção de batidas (P/R/F1, offset temporal médio) | Sim — hits | golden set |
| Classificação de batidas (accuracy, matriz de confusão) | Sim — hits c/ tipo | golden set + treino TCN |
| Erro de posição em metros | Sim — keyframes | golden set |

## 2. Fluxo de trabalho

```bash
# 1. Anotar clips (ver data/golden/README.md)

# 2. Correr a avaliação — gera scorecard.json + scorecard.md
python scripts/evaluate.py --golden data/golden --out outputs/eval

# 3. Mudar um modelo/config e repetir. O diff dos scorecards É o resultado.

# 4. Comparar duas configs objetivamente (trade-off qualidade/velocidade):
python scripts/ab_compare.py \
    --a video.input_skip_frames=1 \
    --b video.input_skip_frames=2 \
    --golden data/golden --out outputs/ab
```

## 3. Telemetria por jogo (sem anotações)

Cada execução do pipeline escreve `quality_report.json` no output do jogo:
deteção (% frames com 4 jogadores, confiança média), tracking (fragmentação),
física (% velocidades > 8 m/s, teleports, % fora do campo), strokes
(nº eventos, % confirmados por áudio) e performance (fator de tempo real).
Agregado ao longo de jogos, mostra tendências e regressões na frota toda.

## 4. Active learning

O pipeline também escreve `review_queue.json`: batidas com confiança < 0.6 e
janelas com menos de 4 jogadores detetados. Anotar ESTES momentos (e não
clips ao calhas) é a forma mais eficiente de crescer o dataset de treino.
O feedback 👍/👎 do utilizador no relatório pode alimentar a mesma fila.

## 5. Treino do classificador de batidas

`scripts/train_stroke_classifier.py` agora produz, além do checkpoint:
- `*.pth.meta.json` — feature mode + classes (lido automaticamente na inferência);
- `*.pth.metrics.json` — matriz de confusão e P/R/F1 por classe no conjunto
  de validação. A matriz diz onde investir dados (tipicamente bandeja↔víbora).

`--features posvel` (default) acrescenta velocidades dos keypoints às
features — a dinâmica do pulso é o que separa bandeja de víbora/smash.

## 6. Sinais de áudio

A segmentação já usava o áudio; agora os onsets (impactos da bola) também:
- cada `ShotEvent` ganha `audio_onset: true/false` (confirmado por som ±200 ms);
- eventos sem onset são penalizados na confiança (ou descartados com
  `strokes.drop_events_without_onset = true` na config);
- rajadas de eventos por frame são consolidadas num só evento por batida,
  escolhendo o frame com maior velocidade do pulso (proxy do impacto real).
