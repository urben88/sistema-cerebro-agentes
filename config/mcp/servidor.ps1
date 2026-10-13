#Requires -Version 5.1
<#
.SYNOPSIS
  Asegura el servidor OpenCode V1 (opencode-ai) que usa el sistema Cerebro → OpenCode.

.DESCRIPTION
  El MCP opencode-mcp habla la API de OpenCode V1 (opencode-ai). Este script arranca
  ese servidor si no está activo, con almacén de datos AISLADO en
  ~/.sistema-cerebro-agentes/server-data (se copia auth.json desde la instalación
  principal para que el servidor tenga los mismos proveedores conectados).

  El puerto se elige dinámicamente: se reutiliza el que esté activo (guardado en
  server-port.txt) o se toma el primer puerto libre a partir de 4599. Así se evitan
  los "listeners fantasma" que Windows deja a veces al morir un proceso.

  El servidor queda en segundo plano (proceso independiente): sobrevive a Claude Code.

.PARAMETER Status
  Comprueba si responde y sale con código 0/1.
.PARAMETER Stop
  Detiene el servidor.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File servidor.ps1
#>
param(
  [switch]$Status,
  [switch]$Stop,
  [int]$BasePort = 4599,
  [int]$MaxPorts = 22,
  [int]$TimeoutSeconds = 40
)

$ErrorActionPreference = 'Continue'
$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerExe = Join-Path $Root 'server\node_modules\opencode-ai\bin\opencode.exe'
$DataDir   = Join-Path $Root 'server-data'
$PortFile  = Join-Path $Root 'server-port.txt'
$AuthSrc   = Join-Path $env:USERPROFILE '.local\share\opencode\auth.json'
$LastPort  = $BasePort + $MaxPorts - 1

function Test-Servidor([int]$p) {
  try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$p/config" -UseBasicParsing -TimeoutSec 3; return $true } catch { return $false }
}
function Get-ActivePort {
  if (Test-Path -LiteralPath $PortFile) {
    $raw = (Get-Content -LiteralPath $PortFile -Raw).Trim()
    $p = 0
    if ([int]::TryParse($raw, [ref]$p) -and $p -gt 0 -and (Test-Servidor $p)) { return $p }
  }
  for ($p = $BasePort; $p -le $LastPort; $p++) {
    if (Test-Servidor $p) { return $p }
  }
  return 0
}
function Test-PuertoLibre([int]$p) {
  try { $t = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p); $t.Start(); $t.Stop(); return $true } catch { return $false }
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
  Write-Host 'Servidor OpenCode V1 detenido.'
  exit 0
}

$active = Get-ActivePort
if ($Status) {
  if ($active) { Write-Host "OK: servidor activo en http://127.0.0.1:$active"; exit 0 }
  Write-Host 'Servidor NO activo'
  exit 1
}
if ($active) {
  Set-Content -LiteralPath $PortFile -Value $active -Encoding Ascii
  exit 0
}

if (-not (Test-Path -LiteralPath $ServerExe)) {
  Write-Error "No se encuentra opencode-ai en $ServerExe. Ejecuta install.ps1 primero."
  exit 1
}

New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'opencode') | Out-Null
if (Test-Path -LiteralPath $AuthSrc) {
  Copy-Item -LiteralPath $AuthSrc -Destination (Join-Path $DataDir 'opencode\auth.json') -Force -ErrorAction SilentlyContinue
}

$port = 0
for ($p = $BasePort; $p -le $LastPort; $p++) {
  if (Test-PuertoLibre $p) { $port = $p; break }
}
if ($port -eq 0) {
  Write-Error "No hay puerto libre entre $BasePort y $LastPort para el servidor."
  exit 1
}

$env:XDG_DATA_HOME = $DataDir
Start-Process -FilePath $ServerExe -ArgumentList 'serve', '--hostname=127.0.0.1', "--port=$port" -WindowStyle Hidden | Out-Null
Remove-Item Env:XDG_DATA_HOME -ErrorAction SilentlyContinue

for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
  if (Test-Servidor $port) {
    Set-Content -LiteralPath $PortFile -Value $port -Encoding Ascii
    Write-Host "Servidor OpenCode V1 activo en http://127.0.0.1:$port"
    exit 0
  }
  Start-Sleep -Seconds 1
}
Write-Error "El servidor no respondio en $TimeoutSeconds s (puerto $port)."
exit 1
