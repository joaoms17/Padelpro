# Volta a apontar o site público para o backend do Render (sem análise,
# mas sempre disponível) e mata túneis abertos.
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue
& "$PSScriptRoot\set_api_url.ps1" -Url "https://padelpro-api.onrender.com"
