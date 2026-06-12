# Análise em GPU (Modal) — pronto a ligar

O free tier do Modal inclui **$30/mês de créditos** (sem cartão). Um clip de
4 min custa ~$0.01-0.02 de T4, ou seja, centenas de análises grátis por mês.

## Ligar (3 comandos, uma vez)

```powershell
.venv\Scripts\pip install modal
.venv\Scripts\modal token new      # abre o browser, login com a tua conta
.venv\Scripts\modal deploy modal_app\app.py
```

O deploy imprime o URL do endpoint (algo como
`https://<user>--padelpro-analyze.modal.run`).

## O que muda com GPU

- Amostragem 10 fps (vs 4 em CPU) → cobertura de tracking muito maior
- Bola (RetinaNet) a custo marginal → atribuição fiável em todos os jogos
- Clip de 4 min: ~1-2 min em vez de ~10 (deep) no PC

## Próximo passo depois do deploy

Apontar o backend para o Modal: no `api/routers/condense.py`, em vez de correr
`analyze_clip` localmente, enviar o vídeo para o endpoint quando
`MODAL_ANALYZE_URL` estiver definido. (Pede ao Claude — é meia dúzia de linhas
e fica com fallback local automático.)
