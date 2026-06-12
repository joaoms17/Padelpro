# Arranca a API completa (com torch → análise de jogadores) na porta 8010.
# O dashboard local (npm run dev) já aponta para cá via dashboard/.env.local.
$root = Split-Path $PSScriptRoot -Parent
& "$root\.venv\Scripts\python.exe" -m uvicorn api.main:app --port 8010 --app-dir $root
