# Define o NEXT_PUBLIC_API_URL de produção no Vercel (via API REST, porque o
# prompt interativo do CLI é pouco fiável) e redeploya o dashboard.
# Uso: .\scripts\set_api_url.ps1 https://xxxx.trycloudflare.com
param([Parameter(Mandatory = $true)][string]$Url)

$PROJECT = "prj_dycE6yj1BMicEqQiWpKLDZEVZrha"
$TEAM = "team_67ZQH1242gUbwpF3VAOnAS6T"

# token do login do Vercel CLI
$authPaths = @(
    "$env:APPDATA\xdg.data\com.vercel.cli\auth.json",
    "$env:LOCALAPPDATA\com.vercel.cli\auth.json",
    "$env:APPDATA\com.vercel.cli\auth.json"
)
$token = $null
foreach ($p in $authPaths) {
    if (Test-Path $p) {
        $token = (Get-Content $p -Raw | ConvertFrom-Json).token
        if ($token) { break }
    }
}
if (-not $token) {
    Write-Host "Token do Vercel não encontrado — corre 'npx vercel login' primeiro." -ForegroundColor Red
    exit 1
}

$body = @{ key = "NEXT_PUBLIC_API_URL"; value = $Url; type = "encrypted"; target = @("production") } | ConvertTo-Json
Invoke-RestMethod -Method Post `
    -Uri "https://api.vercel.com/v10/projects/$PROJECT/env?upsert=true&teamId=$TEAM" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" -Body $body | Out-Null
Write-Host "NEXT_PUBLIC_API_URL = $Url — a redeployar..." -ForegroundColor Cyan

$dash = Join-Path (Split-Path $PSScriptRoot -Parent) "dashboard"
Push-Location $dash
try {
    npx vercel --prod --yes
} finally {
    Pop-Location
}
