# Deploy — como pôr o PadelPro no ar

Tudo na cloud, sempre no ar. Nenhuma peça depende do teu PC estar ligado.

| Peça | O que faz | Onde |
|---|---|---|
| Frontend | o site | Vercel |
| API | corte de tempo útil, revisão, qualidade, calibração, import por link | Render (Docker) |
| IA semântica | tipos de pancada, tática, winners/erros | Gemini API |
| GPU (opcional) | análise espacial pesada (pose/tracking) | Modal |

## Frontend (Vercel)

- Ligar o projeto Vercel ao Git **uma vez**: dashboard Vercel → *Connect Git* →
  repo `joaoms17/Padelpro` → **Root Directory = `dashboard`** → branch `main`.
  A partir daí cada push ao `main` deploya sozinho.
- Define `NEXT_PUBLIC_API_URL` no projeto Vercel a apontar para a API do Render
  (ex.: `https://padelpro-api.onrender.com`). É permanente — já não há túnel.

## API (Render)

`render.yaml` está pronto: Render → *New +* → *Blueprint* → repo. Auto-deploy a
cada push ao `main`. Variáveis no dashboard do Render:

- `GEMINI_API_KEY` — leitura de pancadas/tática (necessária para a análise IA).
- `MODAL_ANALYZE_URL` — endpoint Modal GPU para a análise espacial de jogadores
  (opcional; sem ela, "Analisar jogadores" fica indisponível, mas o corte +
  Gemini continuam a funcionar).
- `PADELPRO_ACCESS_CODE` — opcional; tranca a API com um código partilhado.

A imagem é leve de propósito (sem torch): corte de tempo útil, calibração,
revisão, dashboard de qualidade, Gemini e import por link (yt-dlp) funcionam. A
análise espacial pesada é offloaded para o Modal. Disco do Render free é
efémero — calibrações e feedback não sobrevivem a redeploys.

## Local (desenvolvimento)

```powershell
.\scripts\run_local_api.ps1          # API em 127.0.0.1:8010
cd dashboard; npm run dev            # frontend em localhost:3000
```

Sem `PADELPRO_ACCESS_CODE` definido, a API fica aberta — normal em dev.

## Checklist pós-deploy (30 segundos)

1. `<api>/health` responde `{"status": "ok"}` (único endpoint aberto sem código).
2. O site abre e o formulário **⚡ Analisar jogo** mostra as opções (Gemini, link/YouTube).
3. Carrega um clip curto do PC → recebes o vídeo cortado + relatório com a leitura da IA.
