# Publica o backend COMPLETO (análise de jogadores) para a internet, para
# alguém testar pelo site https://padelpro-dashboard.vercel.app:
#   1. arranca a API do .venv na porta 8010 (se ainda não estiver up)
#   2. abre um túnel Cloudflare gratuito para essa porta
#   3. aponta o site do Vercel para o túnel e redeploya
#
# Mantém esta janela aberta enquanto durar o teste (o túnel vive aqui).
# Quando acabares: CTRL+C e corre .\scripts\repor_api_render.ps1
#
# Nota: o túnel gratuito limita uploads a ~100 MB → API anuncia máx. 95 MB.

$root = Split-Path $PSScriptRoot -Parent

# --- 1. API local ---------------------------------------------------------
$up = $false
try { Invoke-RestMethod "http://127.0.0.1:8010/health" -TimeoutSec 3 | Out-Null; $up = $true } catch {}
if (-not $up) {
    Write-Host "A arrancar API (porta 8010, com análise)..." -ForegroundColor Cyan
    $env:API_MAX_UPLOAD_MB = "95"
    if (-not $env:PADELPRO_ACCESS_CODE) {
        $env:PADELPRO_ACCESS_CODE = -join ((48..57) + (97..122) | Get-Random -Count 8 | ForEach-Object {[char]$_})
    }
    Write-Host "Codigo de acesso (partilha com a equipa): $($env:PADELPRO_ACCESS_CODE)" -ForegroundColor Yellow
    Start-Process -WindowStyle Minimized -FilePath "$root\.venv\Scripts\python.exe" `
        -ArgumentList "-m", "uvicorn", "api.main:app", "--port", "8010" -WorkingDirectory $root
    $tries = 0
    while ($tries -lt 30) {
        Start-Sleep -Seconds 2
        try { Invoke-RestMethod "http://127.0.0.1:8010/health" -TimeoutSec 2 | Out-Null; break } catch { $tries++ }
    }
} else {
    Write-Host "API 8010 já está a correr." -ForegroundColor Green
}

# --- 2. Túnel -------------------------------------------------------------
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    $cf = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared*" `
        -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cf) {
    Write-Host "cloudflared não encontrado — instala com: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
}
$log = Join-Path $env:TEMP "padelpro_tunnel.log"
Remove-Item $log -ErrorAction SilentlyContinue
Write-Host "A abrir túnel Cloudflare..." -ForegroundColor Cyan
$tunnel = Start-Process -PassThru -WindowStyle Minimized $cf `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:8010", "--logfile", $log

$url = $null
$tries = 0
while (-not $url -and $tries -lt 30) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
    $tries++
}
if (-not $url) {
    Write-Host "Não consegui obter o URL do túnel (vê $log)." -ForegroundColor Red
    exit 1
}
Write-Host "Túnel: $url" -ForegroundColor Green

# --- 3. Vercel ------------------------------------------------------------
& "$PSScriptRoot\set_api_url.ps1" -Url $url

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Yellow
Write-Host " Pronto! Manda ao teu amigo: https://padelpro-dashboard.vercel.app" -ForegroundColor Yellow
Write-Host " (clips até ~95 MB; análise: marcar a checkbox e calibrar o campo dele em /calibrate)" -ForegroundColor Yellow
Write-Host " Mantém este PC ligado. Para terminar: CTRL+C + repor_api_render.ps1" -ForegroundColor Yellow
Write-Host "=============================================================" -ForegroundColor Yellow

Wait-Process -Id $tunnel.Id
