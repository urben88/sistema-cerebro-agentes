#Requires -Version 5.1
<#
.SYNOPSIS
  Gestor del stack Docker del Cerebro Hub (hub + Laya).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File gestion.ps1 up -Build
  powershell -NoProfile -ExecutionPolicy Bypass -File gestion.ps1 status
  powershell -NoProfile -ExecutionPolicy Bypass -File gestion.ps1 logs
  powershell -NoProfile -ExecutionPolicy Bypass -File gestion.ps1 down
#>
param(
  [ValidateSet('up', 'down', 'status', 'logs', 'restart')]
  [string]$Accion = 'up',
  [switch]$Build
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$compose = Join-Path $Root 'docker-compose.yml'
if (-not (Test-Path -LiteralPath $compose)) { $compose = Join-Path (Split-Path -Parent $Root) 'docker\docker-compose.yml' }
if (-not (Test-Path -LiteralPath $compose)) { Write-Error 'No se encuentra docker-compose.yml'; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Error 'Docker no está instalado o no está en el PATH.'; exit 1 }

$cArgs = @('compose', '-f', $compose)
switch ($Accion) {
  'up' { if ($Build) { & docker @cArgs up -d --build } else { & docker @cArgs up -d } }
  'down' { & docker @cArgs down }
  'restart' { & docker @cArgs restart }
  'status' { & docker @cArgs ps }
  'logs' { & docker @cArgs logs --tail 100 }
}
exit $LASTEXITCODE
