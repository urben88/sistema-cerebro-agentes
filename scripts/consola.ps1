#Requires -Version 5.1
<#
.SYNOPSIS
  Consola del Cerebro: arranca todo (hub + panel), lo mantiene vivo y lo apaga
  cuando se cierra la consola.

.DESCRIPTION
  Arranca el stack del hub (Docker o nativo) y el panel web, abre el navegador y
  se queda en primer plano mostrando el estado.

  Al cerrar la consola (o pulsar Ctrl+C) se apaga todo lo que esta consola encendio:
  el contenedor del hub y los servidores Node. Para que el cierre de ventana tambien
  apague (PowerShell no ejecuta el bloque finally al cerrar la consola), se lanza un
  vigilante detached que detecta que el proceso padre ha muerto y hace la misma parada.

  La configuracion NO se toca al apagar: los datos del hub viven en
  ~/.sistema-cerebro-agentes (volumen montado), el compose solo se detiene (no se
  borra con `down`), y los ajustes de esta consola se guardan en
  ~/.sistema-cerebro-agentes/consola.json.

.PARAMETER Accion
  consola (por defecto) | estado | parar | config

.PARAMETER Guardar
  Guarda los indicadores dados como ajustes por defecto para las proximas veces.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\consola.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\consola.ps1 -Accion estado
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\consola.ps1 -Accion parar
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\consola.ps1 -SinPanel -Guardar
#>
[CmdletBinding()]
param(
  [ValidateSet('consola', 'estado', 'parar', 'config')]
  [string]$Accion = 'consola',
  [switch]$SinHub,
  [switch]$SinPanel,
  [switch]$SinNavegador,
  [switch]$ConServidor,
  [switch]$Guardar,
  [switch]$ForzarParada,
  [switch]$Silencioso,
  [string]$Estado,
  [string]$Latido
)

$ErrorActionPreference = 'Continue'

$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir  = Split-Path -Parent $ScriptPath
$SystemDir  = Join-Path $env:USERPROFILE '.sistema-cerebro-agentes'

# El script vive en el repo (scripts/) o en la instalacion (~/.sistema-cerebro-agentes).
$EnInstalacion = (Split-Path -Parent $ScriptDir) -eq $SystemDir
$RepoRoot = if ($EnInstalacion) { $null } else { Split-Path -Parent $ScriptDir }

# consola-config.mjs: en el repo (scripts/) o en la instalacion.
$ConfigMjs = Join-Path $ScriptDir 'consola-config.mjs'
if (-not (Test-Path -LiteralPath $ConfigMjs)) {
  $ConfigMjs = Join-Path $SystemDir 'consola-config.mjs'
}

function Write-Line([string]$m) { if (-not $Silencioso) { Write-Host $m } }
function Write-Ok([string]$m)   { if (-not $Silencioso) { Write-Host "  [OK]   $m" -ForegroundColor Green } }
function Write-Warn([string]$m) { if (-not $Silencioso) { Write-Host "  [!]    $m" -ForegroundColor Yellow } }
function Write-Err([string]$m)  { if (-not $Silencioso) { Write-Host "  [X]    $m" -ForegroundColor Red } }
function Write-Info([string]$m) { if (-not $Silencioso) { Write-Host "  [i]    $m" -ForegroundColor DarkGray } }

# ---------------------------------------------------------------- rutas
function Get-Candidatos([string[]]$relativosRepo) {
  $c = @()
  foreach ($r in $relativosRepo) {
    if ($RepoRoot) { $c += (Join-Path $RepoRoot $r) }
  }
  return $c
}
function Get-PrimerExistente([string[]]$candidatos) {
  foreach ($c in $candidatos) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}
function Get-ComposePath {
  return (Get-PrimerExistente (@(
    (Join-Path $SystemDir 'docker\docker-compose.yml')
  ) + (Get-Candidatos @('docker\docker-compose.yml'))))
}
function Get-HubScript {
  return (Get-PrimerExistente (@(
    (Join-Path $SystemDir 'hub\hub.mjs')
  ) + (Get-Candidatos @('config\hub\hub.mjs'))))
}
function Get-PanelScript {
  return (Get-PrimerExistente (@(
    (Join-Path $SystemDir 'web\servidor-web.mjs')
  ) + (Get-Candidatos @('config\web\servidor-web.mjs'))))
}
function Get-ServidorScript {
  return (Get-PrimerExistente (@(
    (Join-Path $SystemDir 'servidor.ps1')
  ) + (Get-Candidatos @('config\mcp\servidor.ps1'))))
}

# ---------------------------------------------------------------- estado HTTP
function Test-Url([string]$url, [string]$patron, [int]$timeout = 3) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeout
    return ($r.Content -match $patron)
  } catch { return $false }
}
function Test-Hub([int]$puerto)  { return (Test-Url "http://127.0.0.1:$puerto/api/salud" 'cerebro-hub') }
function Test-Panel([int]$puerto) { return (Test-Url "http://127.0.0.1:$puerto/api/ping" 'sistema-cerebro-agentes') }

# El hub en Docker puede responder una vez y colgarse justo despues (el healthcheck
# lo da por bueno y luego el event loop se bloquea). Por eso no basta con una
# respuesta: se exige que responda varias veces seguidas y cada vez en poco tiempo.
function Test-HubEstable([int]$puerto, [int]$muestras = 3, [int]$timeout = 4) {
  for ($i = 0; $i -lt $muestras; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not (Test-Hub $puerto)) { return $false }
    $sw.Stop()
    if ($sw.Elapsed.TotalSeconds -gt ($timeout - 1)) { return $false }
    Start-Sleep -Milliseconds 400
  }
  return $true
}

function Get-PuertoArchivo([string]$archivo, [int]$porDefecto) {
  if (Test-Path -LiteralPath $archivo) {
    $raw = (Get-Content -LiteralPath $archivo -Raw).Trim()
    $p = 0
    if ([int]::TryParse($raw, [ref]$p) -and $p -gt 0) { return $p }
  }
  return $porDefecto
}

function Stop-ProcesoEnPuerto([int]$puerto) {
  Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- ajustes
function Get-Ajustes {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err 'Node.js no encontrado (hace falta para el hub y el panel).'
    exit 2
  }
  $args = @($ConfigMjs, 'resolver', $env:USERPROFILE)
  if ($SinHub)       { $args += '--sin-hub' }
  if ($SinPanel)     { $args += '--sin-panel' }
  if ($SinNavegador) { $args += '--sin-navegador' }
  if ($ConServidor)  { $args += '--con-servidor' }
  if ($Guardar)      { $args += '--guardar' }
  $out = & node @args 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or -not $out.Trim()) {
    Write-Err 'No se pudieron leer los ajustes de la consola.'
    exit 2
  }
  return ($out.Trim() | ConvertFrom-Json)
}

function Format-Ajustes($a) {
  Write-Host ''
  Write-Host '  Ajustes de la consola' -ForegroundColor Cyan
  Write-Host "    hub         : $(if ($a.hub) { 'se levanta' } else { 'no se levanta' })"
  Write-Host "    panel       : $(if ($a.panel) { 'se levanta' } else { 'no se levanta' })"
  Write-Host "    navegador   : $(if ($a.navegador) { 'se abre' } else { 'no se abre' })"
  Write-Host "    servidor V1 : $(if ($a.servidor) { 'se levanta' } else { 'lo arranca el MCP solo' })"
  Write-Host "    puertos     : hub $($a.puertoHub) - panel $($a.puertoPanel)"
  Write-Host "    fichero     : $(Join-Path $SystemDir 'consola.json')"
}

# ---------------------------------------------------------------- arranque
function Start-Hub([int]$puerto, $ajustes) {
  $compose = Get-ComposePath
  $hubJs = Get-HubScript

  # 1) Docker: es la via normal (el hub tambien lo alcanza por host.docker.internal).
  if ($compose -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Line '  Levantando el hub (Docker)...'
    $null = & docker compose -f $compose up -d 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'docker compose fallo; se intenta el hub nativo.'
    } else {
      # El contenedor puede tardar en pasar a healthy tras un arranque en frio:
      # se espera mas de lo que parece (90 s), pero se sale en cuanto responde.
      for ($i = 0; $i -lt 90; $i++) {
        if (Test-HubEstable $puerto) { Write-Ok "Hub en marcha: http://127.0.0.1:$puerto"; return 'docker' }
        Start-Sleep -Seconds 1
      }
      Write-Warn 'El contenedor del hub no respondio de forma estable; se intenta el hub nativo.'
      # Se detiene el contenedor colgado para no dejar un proceso a medias.
      $null = & docker compose -f $compose stop 2>&1
    }
  }

  # 2) Nativo: mismo hub, pero en el host. Es la red de seguridad cuando Docker
  #    no responde (contenedor colgado, daemon parado, etc.).
  if (-not $hubJs) { Write-Err 'No se encuentra hub.mjs (ejecuta install.ps1).'; return $null }
  Write-Line '  Levantando el hub (nativo)...'
  Start-Process -FilePath 'node' -ArgumentList $hubJs, "--port=$puerto" -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-HubEstable $puerto) { Write-Ok "Hub en marcha: http://127.0.0.1:$puerto"; return 'nativo' }
    Start-Sleep -Seconds 1
  }
  Write-Err 'El hub nativo no respondio.'
  return $null
}

function Start-Panel([int]$puerto) {
  $panelJs = Get-PanelScript
  if (-not $panelJs) { Write-Err 'No se encuentra servidor-web.mjs (ejecuta install.ps1).'; return $false }
  Write-Line '  Levantando el panel web...'
  Start-Process -FilePath 'node' -ArgumentList $panelJs, "--port=$puerto" -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-Panel $puerto) {
      Write-Ok "Panel en marcha: http://127.0.0.1:$puerto"
      Set-Content -LiteralPath (Join-Path $SystemDir 'web-port.txt') -Value $puerto -Encoding Ascii
      return $true
    }
    Start-Sleep -Seconds 1
  }
  Write-Err 'El panel web no respondio.'
  return $false
}

function Start-Servidor() {
  $servidor = Get-ServidorScript
  if (-not $servidor) { Write-Warn 'No se encuentra servidor.ps1 (el MCP lo arranca solo).'; return $false }
  Write-Line '  Levantando el servidor OpenCode V1...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $servidor | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Ok 'Servidor OpenCode V1 en marcha.'; return $true }
  Write-Warn 'El servidor OpenCode V1 no arranco (el MCP lo reintentara).'
  return $false
}

# ---------------------------------------------------------------- parada
function Get-ConsolasVivas([string]$propioEstado) {
  # Otras consolas en marcha (su proceso sigue vivo). El hub y el panel son
  # compartidos: si hay otra consola viva, no se apagan.
  $vivas = @()
  Get-ChildItem -LiteralPath $SystemDir -Filter 'consola-estado*.json' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($propioEstado -and ($_.FullName -eq $propioEstado)) { return }
    try {
      $e = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      if ($e -and $e.pid -and (Get-Process -Id ([int]$e.pid) -ErrorAction SilentlyContinue)) { $vivas += $_.FullName }
    } catch { }
  }
  return $vivas
}

# Un PID puede reutilizarse: si el estado de "otra consola" tiene el MISMO pid que
# esta sesion, no es otra consola (es un fichero viejo). Se descarta.
function Get-ConsolasVivasDistintas([string]$propioEstado, [int]$propioPid) {
  return @(Get-ConsolasVivas $propioEstado | Where-Object {
    try {
      $e = Get-Content -LiteralPath $_ -Raw | ConvertFrom-Json
      -not ($e -and $e.pid -and ([int]$e.pid -eq $propioPid))
    } catch { $true }
  })
}

function Stop-Todo([string]$estadoFile, [switch]$Forzar) {
  $estado = @{}
  if ($estadoFile -and (Test-Path -LiteralPath $estadoFile)) {
    try { $estado = Get-Content -LiteralPath $estadoFile -Raw | ConvertFrom-Json } catch { $estado = @{} }
  }
  $hubOn = $true
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'hub')) { $hubOn = [bool]$estado.hub }
  $panelOn = $true
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'panel')) { $panelOn = [bool]$estado.panel }
  $servidorOn = $false
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'servidor')) { $servidorOn = [bool]$estado.servidor }
  $puertoHub = 4597
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'puertoHub')) { $puertoHub = [int]$estado.puertoHub }
  $puertoPanel = 4598
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'puertoPanel')) { $puertoPanel = [int]$estado.puertoPanel }

  Write-Line ''
  Write-Line '  Apagando...'

  # Si hay otra consola en marcha, el hub y el panel son suyos: no se tocan.
  $propioPid = 0
  if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'pid')) { $propioPid = [int]$estado.pid }
  $otras = Get-ConsolasVivasDistintas $estadoFile $propioPid
  if ($otras.Count -gt 0 -and -not $Forzar) {
    Write-Info "Hay $($otras.Count) consola(s) mas en marcha: el hub y el panel se quedan."
    if ($estadoFile) { Remove-Item -LiteralPath $estadoFile -ErrorAction SilentlyContinue }
    return
  }

  if ($servidorOn) {
    $servidor = Get-ServidorScript
    if ($servidor) { & powershell -NoProfile -ExecutionPolicy Bypass -File $servidor -Stop | Out-Null }
    Write-Ok 'Servidor OpenCode V1 detenido.'
  }
  if ($panelOn -or $Forzar) {
    Stop-ProcesoEnPuerto $puertoPanel
    Remove-Item -LiteralPath (Join-Path $SystemDir 'web-port.txt') -ErrorAction SilentlyContinue
    Write-Ok 'Panel web detenido.'
  }
  if ($hubOn -or $Forzar) {
    $compose = Get-ComposePath
    $modo = ''
    if ($estado -is [pscustomobject] -and ($estado.PSObject.Properties.Name -contains 'hubModo')) { $modo = [string]$estado.hubModo }
    # Si el hub arranco nativo, no hay que parar el contenedor de Docker.
    $dockerHub = ($modo -ne 'nativo')
    if ($compose -and $dockerHub -and (Get-Command docker -ErrorAction SilentlyContinue)) {
      # `stop`, no `down`: el contenedor y los volumenes se quedan (la configuracion y los datos sobreviven).
      # Se espera a que el contenedor este en marcha antes de pararlo: pararlo mientras
      # arranca puede dejarlo en un estado raro (colgado) y la siguiente consola lo
      # encontraria sin responder.
      $espera = 0
      while ($espera -lt 30) {
        $estadoCont = (& docker inspect cerebro-hub --format '{{.State.Status}}' 2>$null | Out-String).Trim()
        if ($estadoCont -eq 'running') { break }
        Start-Sleep -Seconds 1
        $espera++
      }
      $null = & docker compose -f $compose stop 2>&1
      Write-Ok 'Hub detenido (el contenedor y sus datos se conservan).'
    } else {
      Stop-ProcesoEnPuerto $puertoHub
      Write-Ok 'Hub nativo detenido.'
    }
    Remove-Item -LiteralPath (Join-Path $SystemDir 'hub-port.txt') -ErrorAction SilentlyContinue
  }
  if ($estadoFile) { Remove-Item -LiteralPath $estadoFile -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- acciones
switch ($Accion) {
  'estado' {
    $a = Get-Ajustes
    Write-Host ''
    Write-Host '  Estado del Cerebro' -ForegroundColor Cyan
    $hub = Test-Hub $a.puertoHub
    $panel = Test-Panel $a.puertoPanel
    Write-Host "    hub   : $(if ($hub) { 'en marcha' } else { 'apagado' })  (http://127.0.0.1:$($a.puertoHub))"
    Write-Host "    panel : $(if ($panel) { 'en marcha' } else { 'apagado' })  (http://127.0.0.1:$($a.puertoPanel))"
    $comp = Get-ComposePath
    if ($comp -and (Get-Command docker -ErrorAction SilentlyContinue)) {
      $null = & docker compose -f $comp ps 2>&1 | Out-String | Write-Host
    }
    exit 0
  }
  'config' {
    $a = Get-Ajustes
    Format-Ajustes $a
    Write-Host ''
    Write-Host '  Para cambiarlos y guardarlos:' -ForegroundColor Cyan
    Write-Host '    powershell -File .\scripts\consola.ps1 -SinPanel -Guardar'
    Write-Host '    powershell -File .\scripts\consola.ps1 -ConServidor -Guardar'
    exit 0
  }
  'parar' {
    # Sin -Estado explicito se para lo que haya en marcha (todas las consolas vivas).
    if (-not $Estado) {
      $estados = @(Get-ChildItem -LiteralPath $SystemDir -Filter 'consola-estado*.json' -ErrorAction SilentlyContinue)
      if ($estados.Count -eq 0) { Write-Line '  No hay ninguna consola en marcha.'; exit 0 }
      foreach ($e in $estados) { Stop-Todo $e.FullName -Forzar:$ForzarParada }
      exit 0
    }
    Stop-Todo $Estado -Forzar:$ForzarParada
    exit 0
  }
}

# ---------------------------------------------------------------- consola
$a = Get-Ajustes
if ($Guardar) { Write-Ok "Ajustes guardados en $(Join-Path $SystemDir 'consola.json')" }

Write-Host ''
Write-Host '  C E R E B R O   -   consola' -ForegroundColor Cyan
Write-Host '  ---------------------------' -ForegroundColor DarkGray

$puertoHub = [int]$a.puertoHub
$puertoPanel = [int]$a.puertoPanel
$hubModo = $null
$panelOn = $false

if ($a.hub) {
  $hubModo = Start-Hub $puertoHub $a
  if (-not $hubModo) {
    Write-Err 'El hub no arranco. Se continua con el resto.'
  }
} else {
  Write-Info 'Hub omitido (ajuste).'
}

if ($a.panel) {
  $panelOn = Start-Panel $puertoPanel
} else {
  Write-Info 'Panel omitido (ajuste).'
}

$servidorOn = $false
if ($a.servidor) { $servidorOn = Start-Servidor }

# Estado en marcha: lo usa el vigilante para saber que apagar.
# El nombre lleva el PID: dos consolas a la vez no se pisan el estado.
$estadoFile = Join-Path $SystemDir "consola-estado-$PID.json"
$latidoFile = Join-Path $SystemDir "consola-latido-$PID.txt"
New-Item -ItemType Directory -Force -Path $SystemDir | Out-Null
$estadoObj = [ordered]@{
  hub        = [bool]$a.hub
  hubModo    = $hubModo
  panel      = [bool]$panelOn
  servidor   = [bool]$servidorOn
  puertoHub  = $puertoHub
  puertoPanel = $puertoPanel
  pid        = $PID
  inicio     = (Get-Date).ToString('o')
}
[System.IO.File]::WriteAllText($estadoFile, ($estadoObj | ConvertTo-Json) + "`n", (New-Object System.Text.UTF8Encoding($false)))

# Latido: se CREA el fichero (SetLastWriteTime no crea ficheros) y se va tocando.
function Write-Latido {
  try {
    if (-not (Test-Path -LiteralPath $latidoFile)) {
      [System.IO.File]::WriteAllText($latidoFile, (Get-Date).ToString('o'))
    } else {
      [System.IO.File]::SetLastWriteTime($latidoFile, (Get-Date))
    }
  } catch { }
}
Write-Latido

# El vigilante detecta el cierre de la consola (PowerShell no ejecuta el finally al cerrar la ventana).
# El latido se escribe ANTES de lanzarlo: si no, el vigilante veria el fichero ausente
# ("sin latido") y apagaria todo de inmediato.
$vigilante = Join-Path $ScriptDir 'consola-vigilante.ps1'
if (-not (Test-Path -LiteralPath $vigilante)) { $vigilante = Join-Path $SystemDir 'consola-vigilante.ps1' }
if (Test-Path -LiteralPath $vigilante) {
  Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $vigilante,
    '-Padre', $PID, '-Latido', $latidoFile, '-Estado', $estadoFile, '-Consola', $ScriptPath
  ) | Out-Null
}

if ($a.navegador) {
  $url = if ($hubModo) { "http://127.0.0.1:$puertoHub" } else { "http://127.0.0.1:$puertoPanel" }
  if ($hubModo -or $panelOn) { Start-Process $url | Out-Null }
}

Write-Host ''
if ($hubModo) { Write-Host "  Cerebro Hub  : http://127.0.0.1:$puertoHub" -ForegroundColor White }
if ($panelOn)  { Write-Host "  Panel web    : http://127.0.0.1:$puertoPanel" -ForegroundColor White }
Write-Host ''
Write-Host '  Cierra esta ventana (o pulsa Ctrl+C) para apagar todo.' -ForegroundColor Yellow
Write-Host '  La configuracion y los datos se conservan.' -ForegroundColor DarkGray
Write-Host ''

try {
  while ($true) {
    Write-Latido
    Start-Sleep -Seconds 2
  }
} finally {
  Stop-Todo $estadoFile
  Remove-Item -LiteralPath $latidoFile -ErrorAction SilentlyContinue
}
