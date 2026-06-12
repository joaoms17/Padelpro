# Publica o backend (analise de jogadores) na internet via Cloudflare e
# aponta o site Vercel para o tunel. Verifica cada passo e PARA com o erro
# real se algo falhar (em vez de seguir com uma API morta -> "Failed to fetch").
#
# ASCII-only de proposito: o Windows PowerShell parte ficheiros .ps1 com
# acentos quando nao tem BOM.
#
# Mantem esta janela aberta enquanto durar o teste (o tunel vive aqui).
# Terminar: CTRL+C e depois .\scripts\repor_api_render.ps1

$root   = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root ".venv\Scripts\python.exe"
$EXPECTED_BUILD = 2

function Fail($msg) {
    Write-Host ""
    Write-Host "FALHOU: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $python)) { Fail "Nao encontrei $python (falta criar o .venv?)." }

# --- 1. Parar API antiga na porta 8010 -----------------------------------
$olds = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $olds) {
    Write-Host "A parar API antiga (PID $procId)..." -ForegroundColor Cyan
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
        Fail "Sem permissao para matar o PID $procId. Abre um PowerShell COMO ADMINISTRADOR e corre:  Stop-Process -Id $procId -Force"
    }
}
Start-Sleep -Seconds 1

# --- 2. Arrancar API nova ------------------------------------------------
$env:API_MAX_UPLOAD_MB = "95"
if (-not $env:PADELPRO_ACCESS_CODE) {
    $env:PADELPRO_ACCESS_CODE = -join ((48..57) + (97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
}
$code   = $env:PADELPRO_ACCESS_CODE
$apilog = Join-Path $env:TEMP "padelpro_api.log"
$apierr = Join-Path $env:TEMP "padelpro_api.err.log"
Remove-Item $apilog, $apierr -ErrorAction SilentlyContinue

Write-Host "A arrancar API (porta 8010)..." -ForegroundColor Cyan
$api = Start-Process -PassThru -WindowStyle Minimized -FilePath $python `
    -ArgumentList "-m", "uvicorn", "api.main:app", "--port", "8010" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $apilog -RedirectStandardError $apierr

$h = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if ($api.HasExited) { break }
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:8010/health" -TimeoutSec 2
        if ($h.api_build) { break } else { $h = $null }
    } catch { $h = $null }
}
if (-not $h) {
    Write-Host "--- ultimas linhas do arranque da API ---" -ForegroundColor Yellow
    if (Test-Path $apierr) { Get-Content $apierr -Tail 25 }
    if (Test-Path $apilog) { Get-Content $apilog -Tail 25 }
    Fail "A API nao arrancou (ver acima). Costuma ser uma dependencia em falta no .venv."
}
if ([int]$h.api_build -lt $EXPECTED_BUILD) {
    Fail "API com codigo antigo (api_build=$($h.api_build), esperado >= $EXPECTED_BUILD). Fizeste 'git pull'?"
}
Write-Host "API OK (api_build=$($h.api_build))." -ForegroundColor Green

# --- 3. Tunel Cloudflare -------------------------------------------------
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    $cf = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared*" `
        -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cf) { Fail "cloudflared nao encontrado. Instala:  winget install Cloudflare.cloudflared" }

$tlog = Join-Path $env:TEMP "padelpro_tunnel.log"
Remove-Item $tlog -ErrorAction SilentlyContinue
Write-Host "A abrir tunel Cloudflare..." -ForegroundColor Cyan
$tunnel = Start-Process -PassThru -WindowStyle Minimized $cf `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:8010", "--logfile", $tlog

$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $tlog) {
        $m = Select-String -Path $tlog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
}
if (-not $url) { Fail "Nao consegui o URL do tunel (ver $tlog)." }
Write-Host "Tunel: $url" -ForegroundColor Green

# --- 4. Confirmar que o tunel chega mesmo a API --------------------------
$pubOk = $false
for ($i = 0; $i -lt 12 -and -not $pubOk; $i++) {
    try {
        $h2 = Invoke-RestMethod "$url/health" -TimeoutSec 5
        if ($h2.api_build) { $pubOk = $true }
    } catch {}
    if (-not $pubOk) { Start-Sleep -Seconds 2 }
}
if (-not $pubOk) { Fail "O tunel abriu mas /health nao responde atraves dele." }
Write-Host "Tunel chega a API OK." -ForegroundColor Green

# --- 5. Apontar o Vercel para o tunel + redeploy -------------------------
& "$PSScriptRoot\set_api_url.ps1" -Url $url
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "API e tunel estao OK, mas o Vercel nao foi actualizado (ver acima)." -ForegroundColor Yellow
    Write-Host "Se diz 'Token nao encontrado', corre UMA vez:  npx vercel login" -ForegroundColor Yellow
    Write-Host "O tunel desta sessao:  $url" -ForegroundColor Yellow
    Write-Host "(podes mete-lo a mao em Vercel > Settings > Environment Variables > NEXT_PUBLIC_API_URL e Redeploy)" -ForegroundColor Yellow
    Fail "Vercel por actualizar."
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host " PRONTO. Partilha com a equipa:" -ForegroundColor Green
Write-Host "   Site:   https://padelpro-dashboard.vercel.app" -ForegroundColor Green
Write-Host "   Codigo: $code" -ForegroundColor Green
Write-Host " O redeploy do Vercel demora ~1-2 min a ficar Ready." -ForegroundColor Green
Write-Host " Mantem esta janela aberta. Terminar: CTRL+C" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green

Wait-Process -Id $tunnel.Id
