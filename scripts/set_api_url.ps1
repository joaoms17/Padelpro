# Define o NEXT_PUBLIC_API_URL de producao no Vercel (via API REST) e
# redeploya o dashboard. ASCII-only de proposito.
# Uso: .\scripts\set_api_url.ps1 https://xxxx.trycloudflare.com
param([Parameter(Mandatory = $true)][string]$Url)

$PROJECT = "prj_dycE6yj1BMicEqQiWpKLDZEVZrha"
$TEAM    = "team_67ZQH1242gUbwpF3VAOnAS6T"

# --- Encontrar o token do Vercel CLI -------------------------------------
# A localizacao varia entre versoes; procura nos sitios conhecidos e, em
# ultimo recurso, varre %APPDATA% e %LOCALAPPDATA% por um auth.json do vercel.
$candidates = @(
    "$env:APPDATA\com.vercel.cli\auth.json",
    "$env:LOCALAPPDATA\com.vercel.cli\auth.json",
    "$env:APPDATA\xdg.data\com.vercel.cli\auth.json",
    "$env:USERPROFILE\.local\share\com.vercel.cli\auth.json"
)
$token = $null
foreach ($p in $candidates) {
    if (Test-Path $p) {
        $token = (Get-Content $p -Raw | ConvertFrom-Json).token
        if ($token) { break }
    }
}
if (-not $token) {
    foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA, "$env:USERPROFILE\.local\share")) {
        if (-not $base) { continue }
        $found = Get-ChildItem $base -Recurse -Filter auth.json -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "vercel" } | Select-Object -First 1
        if ($found) {
            $token = (Get-Content $found.FullName -Raw | ConvertFrom-Json).token
            if ($token) { break }
        }
    }
}
if (-not $token) {
    Write-Host "Token do Vercel nao encontrado. Corre uma vez:  npx vercel login" -ForegroundColor Red
    exit 1
}

# --- Upsert da variavel de ambiente --------------------------------------
$body = @{ key = "NEXT_PUBLIC_API_URL"; value = $Url; type = "plain"; target = @("production") } | ConvertTo-Json
try {
    Invoke-RestMethod -Method Post `
        -Uri "https://api.vercel.com/v10/projects/$PROJECT/env?upsert=true&teamId=$TEAM" `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json" -Body $body | Out-Null
} catch {
    Write-Host "Falha a actualizar a variavel no Vercel: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host "NEXT_PUBLIC_API_URL = $Url -- a redeployar..." -ForegroundColor Cyan

# --- Redeploy ------------------------------------------------------------
$dash = Join-Path (Split-Path $PSScriptRoot -Parent) "dashboard"
Push-Location $dash
try {
    npx vercel --prod --yes
    $rc = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($rc -ne 0) {
    Write-Host "O 'vercel --prod' falhou (codigo $rc)." -ForegroundColor Red
    exit 1
}
exit 0
