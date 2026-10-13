#Requires -Version 5.1
<#
.SYNOPSIS
  Cerebro Hub — arrancar / parar / estado (Windows).

.DESCRIPTION
  Arranca el backend del hub (config/hub/hub.mjs, Node >= 22, sin dependencias)
  en 127.0.0.1 con puerto dinámico desde 4597 (guardado en
  ~/.sistema-cerebro-agentes/hub-port.txt) y abre el panel.

  El hub guarda su memoria compartida y sus datos en
  ~/.sistema-cerebro-agentes/hub-data (fuera de los repositorios).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File hub.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File hub.ps1 -Stop
  powershell -NoProfile -ExecutionPolicy Bypass -File hub.ps1 -Status
#>
param(
  [switch]$Stop,
  [switch]$Status,
  [switch]$NoOpen,
  [int]$BasePort = 4597,
  [int]$MaxPorts = 1
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Localizar hub.mjs: en el repo (config/hub, junto al script), instalado (~/.sistema-cerebro-agentes/hub/hub.mjs)
# o relativo al repositorio.
$serverJs = Join-Path $Root 'hub.mjs'
if (-not (Test-Path -LiteralPath $serverJs)) { $serverJs = Join-Path $Root 'hub\hub.mjs' }
if (-not (Test-Path -LiteralPath $serverJs)) { $serverJs = Join-Path (Split-Path -Parent $Root) 'config\hub\hub.mjs' }
$SystemDir = Join-Path $env:USERPROFILE '.sistema-cerebro-agentes'
$PortFile  = Join-Path $SystemDir 'hub-port.txt'
$LastPort  = $BasePort + $MaxPorts - 1

function Test-Hub([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/salud" -UseBasicParsing -TimeoutSec 3
    return ($r.Content -match 'cerebro-hub')
  } catch { return $false }
}
function Get-HubPort {
  if (Test-Path -LiteralPath $PortFile) {
    $raw = (Get-Content -LiteralPath $PortFile -Raw).Trim()
    $p = 0
    if ([int]::TryParse($raw, [ref]$p) -and $p -gt 0 -and (Test-Hub $p)) { return $p }
  }
  for ($p = $BasePort; $p -le $LastPort; $p++) { if (Test-Hub $p) { return $p } }
  return 0
}

if ($Stop) {
  $ports = @()
  if (Test-Path -LiteralPath $PortFile) {
    $raw = (Get-Content -LiteralPath $PortFile -Raw).Trim()
    $p = 0
    if ([int]::TryParse($raw, [ref]$p) -and $p -gt 0) { $ports += $p }
  }
  $ports += ($BasePort..$LastPort)
  foreach ($p in ($ports | Sort-Object -Unique)) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $PortFile -ErrorAction SilentlyContinue
  Write-Host 'Cerebro Hub detenido.'
  exit 0
}

$activo = Get-HubPort
if ($Status) {
  if ($activo) { Write-Host "OK: hub activo en http://127.0.0.1:$activo"; exit 0 }
  Write-Host 'Hub NO activo'
  exit 1
}

if (-not $activo) {
  if (-not (Test-Path -LiteralPath $serverJs)) {
    Write-Error "No se encuentra hub.mjs. Ejecuta install.ps1 desde el repositorio."
    exit 1
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js no encontrado.'
    exit 1
  }
  $puerto = 0
  for ($p = $BasePort; $p -le $LastPort; $p++) {
    try { $t = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p); $t.Start(); $t.Stop(); $puerto = $p; break } catch { }
  }
  if ($puerto -eq 0) { Write-Error "No hay puerto libre entre $BasePort y $LastPort."; exit 1 }

  New-Item -ItemType Directory -Force -Path $SystemDir | Out-Null
  Start-Process -FilePath 'node' -ArgumentList $serverJs, "--port=$puerto" -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-Hub $puerto) { break }
    Start-Sleep -Seconds 1
  }
  if (-not (Test-Hub $puerto)) { Write-Error "El hub no respondio (puerto $puerto)."; exit 1 }
  Set-Content -LiteralPath $PortFile -Value $puerto -Encoding Ascii
  $activo = $puerto
}

Write-Host "Cerebro Hub activo en http://127.0.0.1:$activo"
if (-not $NoOpen) { Start-Process "http://127.0.0.1:$activo" | Out-Null }
