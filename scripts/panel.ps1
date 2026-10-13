#Requires -Version 5.1
<#
.SYNOPSIS
  Panel web en tiempo real de sistema-cerebro-agentes (iniciar / parar / estado).

.DESCRIPTION
  Arranca el servidor del panel (config/web/servidor-web.mjs, Node >= 22, sin
  dependencias) en 127.0.0.1 con puerto dinámico desde 4598 (guardado en
  ~/.sistema-cerebro-agentes/web-port.txt) y abre el navegador.
  El panel es de SOLO LECTURA: muestra actividad, agentes y configuración.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File panel.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File panel.ps1 -Stop
  powershell -NoProfile -ExecutionPolicy Bypass -File panel.ps1 -NoOpen
#>
param(
  [switch]$Stop,
  [switch]$Status,
  [switch]$NoOpen,
  [int]$BasePort = 4598,
  [int]$MaxPorts = 1
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Localizar el servidor web: instalado (~/.sistema-cerebro-agentes/web) o en el repo (config/web)
$webDir = Join-Path $Root 'web'
if (-not (Test-Path -LiteralPath (Join-Path $webDir 'servidor-web.mjs'))) {
  $webDir = Join-Path (Split-Path -Parent $Root) 'config\web'
}
$serverJs  = Join-Path $webDir 'servidor-web.mjs'
$SystemDir = Join-Path $env:USERPROFILE '.sistema-cerebro-agentes'
$PortFile  = Join-Path $SystemDir 'web-port.txt'
$LastPort  = $BasePort + $MaxPorts - 1

function Test-Web([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/ping" -UseBasicParsing -TimeoutSec 3
    return ($r.Content -match 'sistema-cerebro-agentes')
  } catch { return $false }
}
function Get-PanelPort {
  if (Test-Path -LiteralPath $PortFile) {
    $raw = (Get-Content -LiteralPath $PortFile -Raw).Trim()
    $p = 0
    if ([int]::TryParse($raw, [ref]$p) -and $p -gt 0 -and (Test-Web $p)) { return $p }
  }
  for ($p = $BasePort; $p -le $LastPort; $p++) { if (Test-Web $p) { return $p } }
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
  Write-Host 'Panel web detenido.'
  exit 0
}

$activo = Get-PanelPort
if ($Status) {
  if ($activo) { Write-Host "OK: panel activo en http://127.0.0.1:$activo"; exit 0 }
  Write-Host 'Panel NO activo'
  exit 1
}

if (-not $activo) {
  if (-not (Test-Path -LiteralPath $serverJs)) {
    Write-Error "No se encuentra servidor-web.mjs. Ejecuta install.ps1 desde el repositorio."
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
    if (Test-Web $puerto) { break }
    Start-Sleep -Seconds 1
  }
  if (-not (Test-Web $puerto)) { Write-Error "El panel no respondio (puerto $puerto)."; exit 1 }
  Set-Content -LiteralPath $PortFile -Value $puerto -Encoding Ascii
  $activo = $puerto
}

Write-Host "Panel web activo en http://127.0.0.1:$activo"
if (-not $NoOpen) { Start-Process "http://127.0.0.1:$activo" | Out-Null }
