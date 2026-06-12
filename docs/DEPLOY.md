# Deploy — como pôr o PadelPro no ar

Três topologias, da mais usada à mais simples. O frontend está sempre no
Vercel (`padelpro-dashboard.vercel.app`, redeploya sozinho a cada push ao
`main`); o que muda é onde corre a API.

## 1. API local + tunnel Cloudflare (testes com a equipa — o habitual)

A análise completa precisa de torch/pose, que correm na tua máquina:

```powershell
git checkout main; git pull
.\scripts\publicar_para_teste.ps1
```

O script: arranca a API (porta 8010), **gera e imprime o código de acesso**,
abre o tunnel e aponta o Vercel para lá. Partilha com a equipa:
- o link `https://padelpro-dashboard.vercel.app`
- o código de acesso (o site pede-o uma vez e fica guardado no browser)

Mantém a janela aberta enquanto durar a sessão. No fim: `CTRL+C` e
`.\scripts\repor_api_render.ps1`.

> Os clips para etiquetar (`/label`) vivem em `data/dataset/hits/` da TUA
> máquina — etiquetar move os ficheiros aí em tempo real.

## 2. API no Render (sempre no ar, sem a tua máquina)

O `render.yaml` está pronto: Render → New + → Blueprint → repo. Auto-deploya
a cada push ao `main`.

- **Define `PADELPRO_ACCESS_CODE`** no dashboard do Render (o blueprint já
  declara a variável) se quiseres a API trancada.
- A imagem é leve **de propósito** (sem torch): corta de tempo útil,
  calibração (manual e automática), revisão e dashboard de qualidade
  funcionam; análise de jogadores e retreino respondem com mensagem clara
  de indisponível.
- Disco do Render free é efémero: calibrações e feedback não sobrevivem a
  redeploys — para sessões de etiquetagem/treino usa a topologia 1.

## 3. Tudo local (desenvolvimento)

```powershell
.\scripts\run_local_api.ps1          # API em 127.0.0.1:8010
cd dashboard; npm run dev            # frontend em localhost:3000
```

Sem `PADELPRO_ACCESS_CODE` definido, a API fica aberta — normal em dev.

## Checklist pós-deploy (30 segundos)

1. `https://padelpro-dashboard.vercel.app/ajuda` abre o tutorial novo.
2. A navegação mostra **⚡ Analisar · Jogos · Jogadores · Etiquetar · Qualidade · Calibrar**.
3. `/label` carrega (pede o código se estiver definido) e mostra a fila.
4. `<api>/health` responde `{"status": "ok"}` sem código (é o único endpoint aberto).
