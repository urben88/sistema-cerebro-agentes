#Requires -Version 5.1
<#
.SYNOPSIS
  Instalador de sistema-cerebro-agentes para Windows.

.DESCRIPTION
  Despliega la arquitectura Cerebro (Claude Code) -> Hub -> Manos (OpenCode):
   1. Comprueba prerrequisitos (Node >= 22, OpenCode, Claude Code, proveedor DeepSeek, Docker opcional).
   2. Instala el servidor OpenCode V1 (opencode-ai) que usa el MCP, con datos aislados.
   3. Copia el lanzador del MCP a ~/.sistema-cerebro-agentes.
   4. Instala el panel web y el Cerebro Hub (memoria compartida, vigilante, trabajos).
   5. Instala y configura Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills) en
      Claude Code y OpenCode, antes de aplicar lo nuestro encima.
   6. Instala los hooks de contexto, los subagentes, los comandos /odd:* y los permisos
      prudentes de Claude.
   7. Instala los agentes de OpenCode (por esfuerzo) y retira los antiguos.
   8. Levanta el stack Docker (hub), retira el contenedor antiguo de Laya y registra el autoarranque.
   9. Arranca el servidor local (lo reinicia si Gentle AI se ha reinstalado).
  10. Ejecuta verificar -Smoke.

  Lleva un registro de lo instalado (~/.sistema-cerebro-agentes/instalado.json): solo
  actualiza lo que cambio en el repo y pregunta antes de pisar lo que se cambio a mano.
  Cada componente es un paso con resultado OK, sin cambios, aviso o error; un error no
  corta los demas pasos y lo que fallo a medias se restaura desde su copia de seguridad
  (~/.sistema-cerebro-agentes/backups/<fecha>/). Todo queda en
  ~/.sistema-cerebro-agentes/logs/install-<fecha>.log. Sale con codigo 1 si hubo errores.

.PARAMETER Check
  Solo comprueba prerrequisitos y que haria con cada componente; no cambia nada.

.PARAMETER Force
  No pregunta: lo cambiado a mano se conserva y se avisa en el resumen.

.PARAMETER Reinstalar
  Ignora el registro y reinstala todos los componentes.

.PARAMETER SinVerificar
  No ejecuta verificar -Smoke al terminar.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Force,
  [switch]$Reinstalar,
  [switch]$SinVerificar
)

$ErrorActionPreference = 'Stop'

$RepoRoot       = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigRoot     = Join-Path $RepoRoot 'config'
$UserHome       = $env:USERPROFILE
$SystemDir      = Join-Path $UserHome '.sistema-cerebro-agentes'
$ServerDir      = Join-Path $SystemDir 'server'
$ServerExe      = Join-Path $ServerDir 'node_modules\opencode-ai\bin\opencode.exe'
$LauncherPath   = Join-Path $SystemDir 'launcher.ps1'
$VersionServidor = '1.18.35'
$VersionGentle   = '4.3.1'
$VersionPluginOc = '2.0.4'
$VersionSistema = ([System.IO.File]::ReadAllText((Join-Path $RepoRoot 'VERSION'))).Trim()
$MarkerBegin    = '<!-- BEGIN sistema-cerebro-agentes -->'
$MarkerEnd      = '<!-- END sistema-cerebro-agentes -->'
$Fecha          = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot     = Join-Path $SystemDir 'backups'
$BackupDir      = Join-Path $BackupRoot $Fecha
$Registro       = Join-Path $SystemDir 'instalado.json'
$Helper         = Join-Path $RepoRoot 'scripts\instalado.mjs'
$LogPath        = Join-Path (Join-Path $SystemDir 'logs') "install-$Fecha.log"
$Interactivo    = (-not $Force) -and [Environment]::UserInteractive -and (-not [Console]::IsInputRedirected)

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Same([string]$m) { Write-Host "  [=]    $m" -ForegroundColor DarkGray }
function Write-Warn([string]$m) { Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Write-Err([string]$m)  { Write-Host "  [X]    $m" -ForegroundColor Red }
function Write-Note([string]$m) { Write-Host "  [info] $m" -ForegroundColor DarkGray }

$Pasos = New-Object System.Collections.Generic.List[object]
function Add-Paso([string]$Paso, [string]$Resultado, [string]$Detalle = '', [string]$Arreglo = '') {
  $Pasos.Add([pscustomobject]@{ Paso = $Paso; Resultado = $Resultado; Detalle = $Detalle; Arreglo = $Arreglo })
}

function Get-BackupPath([string]$Path) { return (Join-Path $BackupDir ($Path -replace '[\\/:*?"<>|]', '_')) }

function Backup-Item([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
  $dest = Get-BackupPath $Path
  # Solo la primera copia de esta ejecucion: es la que hay que restaurar si algo falla.
  if (Test-Path -LiteralPath $dest) { return }
  Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force
  Write-Note "backup: $Path"
}

function Restore-Item([string]$Path, [bool]$Existia) {
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
  $b = Get-BackupPath $Path
  if ($Existia -and (Test-Path -LiteralPath $b)) { Copy-Item -LiteralPath $b -Destination $Path -Recurse -Force }
}

function Invoke-Cli([string]$File, [string[]]$Arguments) {
  # Envoltorio para comandos externos: nunca lanza por stderr (quirk de PowerShell 5.1
  # con $ErrorActionPreference='Stop'); devuelve salida combinada y codigo de salida.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& $File @Arguments 2>&1 | Out-String)
    $code   = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  return [pscustomobject]@{ Output = $output; Code = $code }
}

function Invoke-Registro([string[]]$Arguments) {
  $r = Invoke-Cli 'node' (@($Helper) + $Arguments)
  if ($r.Code -ne 0) { throw "instalado.mjs $($Arguments[0]): $($r.Output.Trim())" }
  return $r.Output.Trim()
}

function Get-Estado([string]$Nombre, [string[]]$Pares) {
  if ($Reinstalar) { return 'reinstalar' }
  try { return (Invoke-Registro (@('estado', $Registro, $Nombre) + $Pares)) }
  catch { Write-Warn "No se pudo leer el registro ($($_.Exception.Message)); se instala $Nombre"; return 'nuevo' }
}

function Read-Decision([string]$Nombre, [string]$Titulo, [string[]]$Pares) {
  if (-not $Interactivo) { return 'n' }
  while ($true) {
    $r = ([string](Read-Host "  $Titulo se ha cambiado a mano. [s] sobrescribir (con copia) / [n] conservar / [d] ver diferencias")).Trim().ToLower()
    if ($r -eq 's' -or $r -eq 'n') { return $r }
    if ($r -eq 'd') { Write-Host (Invoke-Cli 'node' (@($Helper, 'diferencias', $Registro, $Nombre) + $Pares)).Output }
    else { Write-Note 'Responde s, n o d' }
  }
}

function Install-Componente([string]$Nombre, [string]$Titulo, [string[]]$Pares, [scriptblock]$Instalar, [string]$Arreglo) {
  # Devuelve $true si se ha instalado en esta ejecucion.
  $estado = Get-Estado $Nombre $Pares
  if ($estado -eq 'igual') { Write-Same "$Titulo sin cambios"; Add-Paso $Titulo 'sin cambios'; return $false }
  if ($estado -eq 'tocado' -and (Read-Decision $Nombre $Titulo $Pares) -ne 's') {
    Write-Warn "$Titulo se ha cambiado a mano: se conserva lo tuyo"
    Add-Paso $Titulo 'aviso' 'cambiado a mano; se ha conservado' 'Repite install.ps1 en una consola y elige [d] para ver diferencias o [s] para reemplazarlo; o usa install.ps1 -Reinstalar'
    return $false
  }
  $destinos = @(for ($i = 1; $i -lt $Pares.Count; $i += 2) { $Pares[$i] })
  $existia = @{}
  try {
    foreach ($d in $destinos) { $existia[$d] = (Test-Path -LiteralPath $d); Backup-Item $d }
    & $Instalar | Out-Null
    Invoke-Registro (@('registrar', $Registro, $Nombre) + $Pares) | Out-Null
    Add-Paso $Titulo 'OK' $(if ($estado -eq 'actualizar') { 'actualizado' } elseif ($estado -eq 'tocado') { 'reemplazado (copia en backups)' } else { 'instalado' })
    return $true
  } catch {
    $causa = $_.Exception.Message
    $restaurado = $true
    foreach ($d in $destinos) { if ($existia.ContainsKey($d)) { try { Restore-Item $d $existia[$d] } catch { $restaurado = $false } } }
    if ($restaurado) { Write-Err "$Titulo fallo: $causa (se ha restaurado lo anterior)" }
    else { Write-Err "$Titulo fallo: $causa (no se pudo restaurar todo; copia en $BackupDir)"; $causa += " (restauracion incompleta; copia en $BackupDir)" }
    Add-Paso $Titulo 'error' $causa $Arreglo
    return $false
  }
}

function Set-ManagedBlock([string]$TargetPath, [string]$BlockPath) {
  $block   = [System.IO.File]::ReadAllText($BlockPath).Trim()
  $managed = $MarkerBegin + "`n" + $block + "`n" + $MarkerEnd
  $dir = Split-Path -Parent $TargetPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (-not (Test-Path -LiteralPath $TargetPath)) {
    [System.IO.File]::WriteAllText($TargetPath, $managed + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Creado $TargetPath"
    return
  }
  $existing = [System.IO.File]::ReadAllText($TargetPath)
  if ($existing.Contains($MarkerBegin)) {
    $pattern     = [regex]::Escape($MarkerBegin) + '(?s).*?' + [regex]::Escape($MarkerEnd)
    $placeholder = '<<<sistema-cerebro-agentes-block>>>'
    $updated     = [regex]::Replace($existing, $pattern, $placeholder).Replace($placeholder, $managed)
    if ($updated -eq $existing) { Write-Same "Bloque sin cambios: $TargetPath"; return }
    Backup-Item $TargetPath
    [System.IO.File]::WriteAllText($TargetPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Bloque actualizado: $TargetPath"
  } else {
    Backup-Item $TargetPath
    [System.IO.File]::AppendAllText($TargetPath, "`n" + $managed + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Bloque anadido: $TargetPath"
  }
}

function Get-GentleAiExe {
  # go install deja el binario en GOPATH\bin, que puede no estar en el PATH de esta sesion.
  $cmd = Get-Command gentle-ai -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cands = @((Join-Path $UserHome 'go\bin\gentle-ai.exe'))
  if (Get-Command go -ErrorAction SilentlyContinue) {
    $gp = (Invoke-Cli 'go' @('env', 'GOPATH')).Output.Trim()
    if ($gp) { $cands = @((Join-Path $gp 'bin\gentle-ai.exe')) + $cands }
  }
  foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { return $c } }
  return $null
}

function Get-GentleAiVersion([string]$Exe) {
  $v = Invoke-Cli $Exe @('version')
  if ($v.Output -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
  return ''
}

function Exit-Install([int]$Code) {
  if (-not $Check) { try { Stop-Transcript | Out-Null } catch { } }
  exit $Code
}

# ---------------------------------------------------------------- Componentes (spec 25 · S1)
# Cada uno: nombre en el registro, titulo y pares origen/destino que se comparan por huella.
$AgentDir   = Join-Path $UserHome '.claude\agents'
$AgentesCl  = @('cerebro.md', 'subdirector.md', 'explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md', 'adaptador-mcps.md', 'planificador.md', 'resolutor.md', 'ayudante.md', 'retocador.md', 'consultor.md')
$AgentsOcSrc = Join-Path $ConfigRoot 'opencode\agents'
$AgentsOcDst = Join-Path $UserHome '.config\opencode\agents'
$hubDst     = Join-Path $SystemDir 'hub'
$hooksDst   = Join-Path $SystemDir 'hooks'
$dockerDst  = Join-Path $SystemDir 'docker'
$modsSrc    = Join-Path $ConfigRoot 'mods'
$Comp = [ordered]@{
  'mcp'              = @((Join-Path $ConfigRoot 'mcp\servidor.ps1'), (Join-Path $SystemDir 'servidor.ps1'), (Join-Path $ConfigRoot 'mcp\launcher.ps1'), $LauncherPath, (Join-Path $ConfigRoot 'mcp\triaje-mcp.mjs'), (Join-Path $SystemDir 'mcp\triaje-mcp.mjs'))
  'panel'            = @((Join-Path $ConfigRoot 'web'), (Join-Path $SystemDir 'web'), (Join-Path $RepoRoot 'scripts\panel.ps1'), (Join-Path $SystemDir 'panel.ps1'))
  'hub'              = @((Join-Path $ConfigRoot 'hub'), $hubDst, (Join-Path $ConfigRoot 'hub\hub.ps1'), (Join-Path $SystemDir 'hub.ps1'))
  'hooks'            = @((Join-Path $ConfigRoot 'hooks'), $hooksDst)
  'mods'             = @($modsSrc, (Join-Path $SystemDir 'mods'))
  'agentes-claude'   = @($AgentesCl | ForEach-Object { (Join-Path $ConfigRoot "claude\agents\$_"); (Join-Path $AgentDir $_) })
  'comandos'         = @((Join-Path $ConfigRoot 'claude\commands\odd'), (Join-Path $UserHome '.claude\commands\odd'))
  'skill'            = @((Join-Path $ConfigRoot 'claude\skills\delegar-a-opencode'), (Join-Path $UserHome '.claude\skills\delegar-a-opencode'))
  'agentes-opencode' = @(Get-ChildItem -LiteralPath $AgentsOcSrc -Filter '*.md' | Sort-Object Name | ForEach-Object { $_.FullName; (Join-Path $AgentsOcDst $_.Name) })
  'docker'           = @((Join-Path $RepoRoot 'docker'), $dockerDst)
}
if (-not (Test-Path -LiteralPath $modsSrc)) { $Comp.Remove('mods') }

if (-not $Check) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
  try { Start-Transcript -LiteralPath $LogPath -Append | Out-Null } catch { Write-Host "  [!]    No se pudo abrir el log $LogPath" -ForegroundColor Yellow }
}

$fatal    = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------- 1. Prerrequisitos
Write-Step 'Prerrequisitos'

if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeVer  = (& node --version).Trim().TrimStart('v')
  $nodeMain = [int]($nodeVer.Split('.')[0])
  if ($nodeMain -lt 22) {
    Write-Err "Node v$nodeVer (se necesita >= 22)"
    $fatal.Add('Actualiza Node.js a la version 22 o superior: https://nodejs.org')
  } else { Write-Ok "Node v$nodeVer" }
} else {
  Write-Err 'Node.js no encontrado'
  $fatal.Add('Instala Node.js 22 o superior: https://nodejs.org')
}

if (Get-Command npx -ErrorAction SilentlyContinue) { Write-Ok 'npx disponible' }
else { Write-Err 'npx no encontrado'; $fatal.Add('npx no encontrado (viene con Node.js >= 22)') }

if (Get-Command opencode -ErrorAction SilentlyContinue) {
  $ocRes = Invoke-Cli 'opencode' @('--version')
  Write-Ok "OpenCode $($ocRes.Output.Trim()) (para tu TUI; el MCP usara el servidor V1 propio)"
} else {
  Write-Warn 'OpenCode no encontrado (no es imprescindible para el MCP, pero lo usaras como TUI)'
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
  $ccRes = Invoke-Cli 'claude' @('--version')
  Write-Ok "Claude Code $($ccRes.Output.Trim())"
} else {
  Write-Err 'Claude Code no encontrado'
  $fatal.Add('Instala Claude Code: https://claude.com/claude-code')
}

$authPath      = Join-Path $UserHome '.local\share\opencode\auth.json'
$authProviders = @()
if (Test-Path -LiteralPath $authPath) {
  try {
    $auth          = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
    $authProviders = @($auth.PSObject.Properties.Name)
  } catch { }
}
if ($authProviders -contains 'deepseek') {
  Write-Ok 'Proveedor DeepSeek (oficial) conectado'
} else {
  Write-Warn 'DeepSeek no esta conectado en OpenCode'
  $warnings.Add("Conecta DeepSeek en OpenCode: ejecuta 'opencode auth login' (o /connect en la TUI) y elige DeepSeek")
}
if ($authProviders -contains 'openrouter') {
  Write-Warn 'OpenRouter sigue conectado en OpenCode; este sistema ya no lo usa (puedes retirarlo con: opencode auth logout OpenRouter)'
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Ok 'Docker disponible (hub en contenedor)'
} else {
  Write-Warn 'Docker no encontrado: el hub podra ejecutarse en nativo (hub.ps1)'
}

# Gentle AI (spec 20): aqui solo se lee; la instalacion va en su paso.
$gentleExe = Get-GentleAiExe
if ($gentleExe) {
  $gv = Get-GentleAiVersion $gentleExe
  if ($gv -eq $VersionGentle) { Write-Ok "Gentle AI $gv" }
  else { Write-Warn "Gentle AI $gv (version fijada: $VersionGentle); se usa la instalada"; $warnings.Add("Gentle AI instalado es $gv y el sistema esta probado con $VersionGentle") }
} elseif (Get-Command go -ErrorAction SilentlyContinue) {
  Write-Warn "Gentle AI no encontrado: install lo instalara con go install (@v$VersionGentle)"
} else {
  Write-Warn 'Gentle AI no encontrado y falta Go: install seguira sin Gentle AI'
  $warnings.Add("Instala Go (https://go.dev/dl) y ejecuta: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VersionGentle")
}
$claudeMdPrev = Join-Path $UserHome '.claude\CLAUDE.md'
if ((Test-Path -LiteralPath $claudeMdPrev) -and ([System.IO.File]::ReadAllText($claudeMdPrev) -match 'gentle-ai:')) { Write-Ok 'Bloques gentle-ai:* presentes en ~/.claude/CLAUDE.md' }
else { Write-Note 'Aun no hay bloques gentle-ai:* en ~/.claude/CLAUDE.md (los escribira install)' }
if (Test-Path -LiteralPath (Join-Path $UserHome '.claude\gentle-ai\orchestrator')) { Write-Ok 'Orquestador modular de Gentle AI presente' }
else { Write-Note 'Aun no hay orquestador modular en ~/.claude/gentle-ai/orchestrator (lo escribira install)' }

if ($fatal.Count -gt 0) {
  Write-Host "`nFaltan prerrequisitos obligatorios:" -ForegroundColor Red
  foreach ($p in $fatal) { Write-Host "  - $p" -ForegroundColor Red }
  Exit-Install 1
}

if ($Check) {
  Write-Step 'Que haria install con cada componente'
  if (Test-Path -LiteralPath $Registro) { Write-Note "Registro: $Registro" } else { Write-Note 'Sin registro de instalacion previa: se instalaria todo' }
  foreach ($n in $Comp.Keys) {
    switch (Get-Estado $n $Comp[$n]) {
      'igual'      { Write-Same "${n}: sin cambios (se salta)" }
      'actualizar' { Write-Note "${n}: cambio en el repo (se actualizaria con copia)" }
      'tocado'     { Write-Warn "${n}: cambiado a mano (preguntaria: sobrescribir / conservar / ver diferencias)" }
      'reinstalar' { Write-Note "${n}: se reinstalaria (-Reinstalar)" }
      default      { Write-Note "${n}: se instalaria" }
    }
  }
  Write-Host "`nOpciones: -Reinstalar (reinstala todo), -Force (no pregunta; conserva lo cambiado a mano), -SinVerificar (sin verificar -Smoke al final)." -ForegroundColor Cyan
  Write-Host "Comprobacion terminada (modo -Check; no se ha cambiado nada)." -ForegroundColor Cyan
  foreach ($w in $warnings) { Write-Warn $w }
  exit 0
}

if ($Reinstalar) { Write-Note '-Reinstalar: se ignora el registro y se reinstala todo' }
if (-not $Interactivo) { Write-Note 'Sin preguntas (-Force o consola no interactiva): lo cambiado a mano se conserva' }

# ---------------------------------------------------------------- 2. Servidor OpenCode V1
Write-Step "Servidor OpenCode V1 (opencode-ai $VersionServidor)"

New-Item -ItemType Directory -Force -Path $ServerDir | Out-Null
$pkgJson = Join-Path $ServerDir 'package.json'
if (-not (Test-Path -LiteralPath $pkgJson)) {
  [System.IO.File]::WriteAllText($pkgJson, '{"name":"cerebro-server","private":true}', (New-Object System.Text.UTF8Encoding($false)))
}

$needInstall = $true
if (Test-Path -LiteralPath $ServerExe) {
  $verRes = Invoke-Cli $ServerExe @('--version')
  if ($verRes.Output.Trim() -eq $VersionServidor) {
    $needInstall = $false
    Write-Same "opencode-ai $VersionServidor ya instalado"
    Add-Paso 'Servidor OpenCode V1' 'sin cambios'
  }
}

if ($needInstall) {
  Write-Host "  Instalando opencode-ai@$VersionServidor con npm (puede tardar un par de minutos)..." -ForegroundColor DarkGray
  $npmRes = Invoke-Cli 'npm' @('install', '--prefix', $ServerDir, "opencode-ai@$VersionServidor", '--no-audit', '--no-fund')
  if (Test-Path -LiteralPath $ServerExe) {
    Write-Ok "opencode-ai $VersionServidor instalado"
    Add-Paso 'Servidor OpenCode V1' 'OK' "opencode-ai $VersionServidor"
  } else {
    Write-Err 'No se pudo instalar opencode-ai'
    Write-Host $npmRes.Output -ForegroundColor DarkGray
    Add-Paso 'Servidor OpenCode V1' 'error' 'npm no pudo instalar opencode-ai (salida completa en el log)' "npm install --prefix `"$ServerDir`" opencode-ai@$VersionServidor"
  }
}

# ---------------------------------------------------------------- 3. Lanzador del MCP
Write-Step 'Lanzador del MCP'
New-Item -ItemType Directory -Force -Path $SystemDir | Out-Null
$null = Install-Componente 'mcp' 'Lanzador del MCP' $Comp['mcp'] {
  New-Item -ItemType Directory -Force -Path (Join-Path $SystemDir 'mcp') | Out-Null
  for ($i = 0; $i -lt $Comp['mcp'].Count; $i += 2) {
    Copy-Item -LiteralPath $Comp['mcp'][$i] -Destination $Comp['mcp'][$i + 1] -Force
    Write-Ok "Instalado: $($Comp['mcp'][$i + 1])"
  }
} 'Repite install.ps1; si persiste, revisa permisos de ~/.sistema-cerebro-agentes'

# ---------------------------------------------------------------- 3b. Panel web
Write-Step 'Panel web en tiempo real'
$webDst = Join-Path $SystemDir 'web'
$panelNuevo = Install-Componente 'panel' 'Panel web' $Comp['panel'] {
  if (Test-Path -LiteralPath $webDst) { Remove-Item -LiteralPath $webDst -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $ConfigRoot 'web') -Destination $webDst -Recurse -Force
  Write-Ok "Panel instalado: $webDst"
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'scripts\panel.ps1') -Destination (Join-Path $SystemDir 'panel.ps1') -Force
  Write-Ok "Instalado: $(Join-Path $SystemDir 'panel.ps1')"
} 'Cierra el panel (panel.ps1 -Stop) y repite install.ps1'
$panelCfg = (@{ repoRoot = $RepoRoot } | ConvertTo-Json)
[System.IO.File]::WriteAllText((Join-Path $SystemDir 'panel-config.json'), $panelCfg + "`n", (New-Object System.Text.UTF8Encoding($false)))

# Si el panel estaba abierto y ha cambiado, reiniciarlo para aplicar la version nueva
if ($panelNuevo) {
  $webPort = 0
  $webPortFile = Join-Path $SystemDir 'web-port.txt'
  if (Test-Path -LiteralPath $webPortFile) { [void][int]::TryParse((Get-Content -LiteralPath $webPortFile -Raw).Trim(), [ref]$webPort) }
  $panelActivo = $false
  if ($webPort -gt 0) {
    try {
      $pingPanel = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/api/ping" -UseBasicParsing -TimeoutSec 3
      $panelActivo = ($pingPanel.Content -match 'sistema-cerebro-agentes')
    } catch { }
  }
  if ($panelActivo) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SystemDir 'panel.ps1') -Stop | Out-Null
    Start-Sleep -Seconds 1
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SystemDir 'panel.ps1') -NoOpen | Out-Null
    Write-Ok 'Panel web reiniciado con la version nueva'
  }
}

# ---------------------------------------------------------------- 3c. Cerebro Hub
Write-Step 'Cerebro Hub (memoria compartida, hooks y trabajos)'

$hubNuevo = Install-Componente 'hub' 'Cerebro Hub' $Comp['hub'] {
  if (Test-Path -LiteralPath $hubDst) { Remove-Item -LiteralPath $hubDst -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $ConfigRoot 'hub') -Destination $hubDst -Recurse -Force
  Write-Ok "Hub instalado: $hubDst"
  Copy-Item -LiteralPath (Join-Path $ConfigRoot 'hub\hub.ps1') -Destination (Join-Path $SystemDir 'hub.ps1') -Force
  Write-Ok "Lanzador instalado: $(Join-Path $SystemDir 'hub.ps1')"
} 'Para el hub (docker compose down o hub.ps1 -Stop) y repite install.ps1'

$null = Install-Componente 'hooks' 'Hooks de contexto' $Comp['hooks'] {
  if (Test-Path -LiteralPath $hooksDst) { Remove-Item -LiteralPath $hooksDst -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $ConfigRoot 'hooks') -Destination $hooksDst -Recurse -Force
  Write-Ok "Hooks instalados: $hooksDst"
} 'Cierra las sesiones de Claude Code abiertas y repite install.ps1'

# Sonido al terminar (spec 22 · S6): crea la carpeta y deja el README; NO toca los fin.* del usuario.
$sonidosDst = Join-Path $SystemDir 'sonidos'
New-Item -ItemType Directory -Force -Path $sonidosDst | Out-Null
Copy-Item -LiteralPath (Join-Path $ConfigRoot 'sonidos\README.md') -Destination (Join-Path $sonidosDst 'README.md') -Force

# Mods de Claude Code (mesa de trabajo): se cargan via CLAUDE_CODE_PLUGIN_DIRS (settings-merge).
if ($Comp.Contains('mods')) {
  $modsDst = Join-Path $SystemDir 'mods'
  $null = Install-Componente 'mods' 'Mods de Claude Code' $Comp['mods'] {
    if (Test-Path -LiteralPath $modsDst) { Remove-Item -LiteralPath $modsDst -Recurse -Force }
    Copy-Item -LiteralPath $modsSrc -Destination $modsDst -Recurse -Force
    Write-Ok "Mods instalados: $modsDst"
  } 'Cierra Claude Code (usa los mods) y repite install.ps1'
}

# ---------------------------------------------------------------- 3d. Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills)
# Va ANTES de lo nuestro: asi nuestros agentes, el bloque de CLAUDE.md, los permisos y el
# default_agent se aplican encima y no los pisa el componente permissions de gentle-ai.
# Spec 25 · S5: solo se ejecuta si falta, cambia la version o cambia su configuracion.
Write-Step "Gentle AI $VersionGentle (Claude Code + OpenCode)"
$gentleCorrio = $false
if ($env:SIN_GENTLE_AI) {
  Write-Note 'SIN_GENTLE_AI: se omite Gentle AI'
  Add-Paso 'Gentle AI' 'sin cambios' 'omitido (SIN_GENTLE_AI)'
} else {
  $gentleExe = Get-GentleAiExe
  $gentleRecien = $false
  if (-not $gentleExe) {
    if (Get-Command go -ErrorAction SilentlyContinue) {
      Write-Note "Instalando gentle-ai@v$VersionGentle con go install (puede tardar)..."
      $gi = Invoke-Cli 'go' @('install', "github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VersionGentle")
      $gentleExe = Get-GentleAiExe
      if ($gentleExe) { Write-Ok "gentle-ai instalado: $gentleExe"; $gentleRecien = $true }
      else { Write-Err 'No se pudo instalar gentle-ai'; Write-Host $gi.Output -ForegroundColor DarkGray }
    } else {
      Write-Err 'Falta Go: no se puede instalar gentle-ai'
    }
    if (-not $gentleExe) { Add-Paso 'Gentle AI' 'error' 'gentle-ai no esta instalado y no se pudo instalar' "Instala Go (https://go.dev/dl), ejecuta: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VersionGentle y repite install.ps1" }
  }
  if ($gentleExe) {
    $gv = Get-GentleAiVersion $gentleExe
    if ($gv -ne $VersionGentle) { Write-Warn "Gentle AI $gv (fijada: $VersionGentle); se usa la instalada" }
    $conOpenCode = [bool](Get-Command opencode -ErrorAction SilentlyContinue)
    $agentesG = if ($conOpenCode) { 'claude-code,opencode' } else { 'claude-code' }
    $gentleArgs = @('install', '--agents', $agentesG, '--preset', 'full-gentleman', '--persona', 'neutral', '--claude-orchestrator-modules')
    $gentleCfg = "version=$gv " + ($gentleArgs -join ' ')
    $gentlePrev = try { Invoke-Registro @('valor', $Registro, 'gentle-ai') } catch { '' }
    $hayBloques = (Test-Path -LiteralPath $claudeMdPrev) -and ([System.IO.File]::ReadAllText($claudeMdPrev) -match 'gentle-ai:')
    $motivo = if ($Reinstalar) { '-Reinstalar' }
      elseif ($gentleRecien) { 'recien instalado' }
      elseif (-not $gentlePrev) { 'sin registro previo' }
      elseif ($gentlePrev -ne $gentleCfg) { 'cambio de version o de configuracion' }
      elseif (-not $hayBloques) { 'faltan los bloques gentle-ai:* en CLAUDE.md' }
      else { '' }

    if (-not $motivo) {
      Write-Same "Gentle AI $gv sin cambios (misma version y configuracion)"
      Add-Paso 'Gentle AI' 'sin cambios'
    } else {
      Write-Note "Se ejecuta gentle-ai install: $motivo"
      # Backup de lo que gentle-ai toca (no carpetas enteras: projects/ y node_modules son enormes)
      foreach ($rel in @('.claude\CLAUDE.md', '.claude\settings.json', '.claude\agents', '.claude\skills', '.config\opencode\opencode.jsonc', '.config\opencode\package.json', '.config\opencode\.gentle-ai-default-agent.json', '.config\opencode\agents', '.config\opencode\AGENTS.md')) {
        Backup-Item (Join-Path $UserHome $rel)
      }

      if ($conOpenCode) {
        # gentle-ai exige @opencode/plugin en la carpeta de configuracion de OpenCode
        $ocCfg = Join-Path $UserHome '.config\opencode'
        $plugPkg = Join-Path $ocCfg 'node_modules\@opencode\plugin\package.json'
        $plugOk = $false
        if (Test-Path -LiteralPath $plugPkg) { try { $plugOk = ((Get-Content -LiteralPath $plugPkg -Raw | ConvertFrom-Json).version -eq $VersionPluginOc) } catch { } }
        if (-not $plugOk) {
          New-Item -ItemType Directory -Force -Path $ocCfg | Out-Null
          $np = Invoke-Cli 'npm' @('install', '--prefix', $ocCfg, '--save-exact', "@opencode/plugin@$VersionPluginOc", '--no-audit', '--no-fund')
          if ($np.Code -eq 0) { Write-Ok "@opencode/plugin@$VersionPluginOc instalado en ~/.config/opencode" }
          else { Write-Warn "No se pudo instalar @opencode/plugin@$VersionPluginOc"; Add-Paso '@opencode/plugin' 'aviso' 'npm no pudo instalarlo' "npm install --prefix `"$ocCfg`" --save-exact @opencode/plugin@$VersionPluginOc" }
        }
      } else {
        Write-Warn 'OpenCode no encontrado: Gentle AI se configura solo para Claude Code'
      }

      # gentle-ai sube defaultMode a bypassPermissions; permisos.mjs (paso 5b) lo devuelve.
      $settingsAntes = Join-Path $UserHome '.claude\settings.json'
      $modoPrevio = '(ninguno)'
      try { $m = (Get-Content -Raw -LiteralPath $settingsAntes | ConvertFrom-Json).permissions.defaultMode; if ($m) { $modoPrevio = [string]$m } } catch { }
      $env:MODO_PREVIO = $modoPrevio
      Write-Note "gentle-ai $($gentleArgs -join ' ')"
      $gr = Invoke-Cli $gentleExe $gentleArgs
      if ($gr.Code -eq 0) {
        Write-Ok 'Gentle AI configurado (ODD, RDD, Engram, CodeGraph, Context7, skills)'
        $gentleCorrio = $true
        try { Invoke-Registro @('valor', $Registro, 'gentle-ai', $gentleCfg) | Out-Null } catch { Write-Warn $_.Exception.Message }
        Add-Paso 'Gentle AI' 'OK' $motivo
      } else {
        Write-Err "gentle-ai install termino con codigo $($gr.Code)"
        Write-Host $gr.Output -ForegroundColor DarkGray
        Add-Paso 'Gentle AI' 'error' "gentle-ai install termino con codigo $($gr.Code)" "Revisa su salida en $LogPath y repite install.ps1 -Reinstalar"
      }
    }
    # Spec 23 · S6 · Engram es la memoria del sistema (los hooks la usan junto al hub).
    $ev = try { (& engram version 2>&1 | Out-String).Trim() } catch { '' }
    if ($ev -match 'engram') { Write-Ok "Engram responde ($ev): memoria de decisiones y sesiones" }
    else {
      Write-Warn 'Engram no responde: los hooks seguiran solo con la memoria del hub'
      Add-Paso 'Engram' 'aviso' 'engram version no responde' 'Repite install.ps1 -Reinstalar (gentle-ai instala Engram) o revisa el PATH; comprueba: engram version'
    }
  }
}

# ---------------------------------------------------------------- 4. Agente cerebro (con el MCP dentro)
Write-Step 'Agente cerebro en Claude Code (con el MCP dentro)'

# Migracion: el MCP ya no se registra globalmente; vive DENTRO del agente cerebro.
$rm = Invoke-Cli 'claude' @('mcp', 'remove', 'opencode', '--scope', 'user')
if ($rm.Code -eq 0) { Write-Note 'Retirado el registro global antiguo del MCP (ahora vive en el agente cerebro)' }

# MCP de trabajos (trabajo_estado, parar_trabajos): global, para que `claude` a secas vea los trabajos.
# El MCP de OpenCode NO: sigue solo dentro del agente cerebro.
$triajeGlobal = Join-Path $SystemDir 'mcp\triaje-mcp.mjs'
Invoke-Cli 'claude' @('mcp', 'remove', 'triaje', '--scope', 'user') | Out-Null
$addT = Invoke-Cli 'claude' @('mcp', 'add', '--scope', 'user', 'triaje', '--', 'node', $triajeGlobal)
if ($addT.Code -eq 0) { Write-Ok 'MCP de trabajos (triaje) registrado a nivel de usuario (modo normal)'; Add-Paso 'MCP triaje' 'OK' }
else { Write-Warn 'No se pudo registrar el MCP triaje global'; Add-Paso 'MCP triaje' 'aviso' 'claude mcp add fallo' "claude mcp add --scope user triaje -- node `"$triajeGlobal`"" }

$argsJson = '["/c","powershell","-NoProfile","-ExecutionPolicy","Bypass","-File","' + ($LauncherPath.Replace('\', '\\')) + '"]'
$null = Install-Componente 'agentes-claude' 'Agentes de Claude Code' $Comp['agentes-claude'] {
  New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
  foreach ($f in $AgentesCl) {
    $src = Join-Path $ConfigRoot "claude\agents\$f"
    $dst = Join-Path $AgentDir $f
    if ($f -eq 'cerebro.md' -or $f -eq 'subdirector.md') {
      $tpl = [System.IO.File]::ReadAllText($src).Replace('__COMANDO__', 'cmd').Replace('__ARGUMENTOS_JSON__', $argsJson).Replace('__TRIAJE_MCP__', $triajeGlobal)
      [System.IO.File]::WriteAllText($dst, $tpl, (New-Object System.Text.UTF8Encoding($false)))
    } else {
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
    Write-Ok "Agente instalado: $dst"
  }
} 'Repite install.ps1; si persiste, revisa permisos de ~/.claude/agents'
Write-Note 'Activalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

$binDir = Join-Path $UserHome '.local\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
foreach ($f in @('cerebro.cmd', 'cerebro', 'cerebro-parar.cmd', 'cerebro-parar')) {
  $binSrc = Join-Path $ConfigRoot "bin\$f"
  $binDst = Join-Path $binDir $f
  if ((Test-Path -LiteralPath $binDst) -and ((Get-FileHash -LiteralPath $binSrc).Hash -eq (Get-FileHash -LiteralPath $binDst).Hash)) { continue }
  Backup-Item $binDst
  Copy-Item -LiteralPath $binSrc -Destination $binDst -Force
  Write-Ok "Comando instalado: $binDst"
}
Write-Note 'Rotacion: escribe "cerebro" para continuar la conversacion en modo Cerebro; "claude --continue" para volver al modo normal'

# ---------------------------------------------------------------- 5. Rol Cerebro (Claude Code)
Write-Step 'Rol Cerebro en Claude Code'

try { Set-ManagedBlock (Join-Path $UserHome '.claude\CLAUDE.md') (Join-Path $ConfigRoot 'claude\CLAUDE.md'); Add-Paso 'Bloque de CLAUDE.md' 'OK' }
catch { Write-Err "CLAUDE.md: $($_.Exception.Message)"; Add-Paso 'Bloque de CLAUDE.md' 'error' $_.Exception.Message 'Cierra los editores que tengan abierto ~/.claude/CLAUDE.md y repite install.ps1' }

$skillDst = $Comp['skill'][1]
$null = Install-Componente 'skill' 'Skill delegar-a-opencode' $Comp['skill'] {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillDst) | Out-Null
  if (Test-Path -LiteralPath $skillDst) { Remove-Item -LiteralPath $skillDst -Recurse -Force }
  Copy-Item -LiteralPath $Comp['skill'][0] -Destination $skillDst -Recurse -Force
  Write-Ok "Skill instalada: $skillDst"
} 'Repite install.ps1'

# Comandos /odd:* (spec 21 · S4): solo se reemplaza la carpeta odd; los comandos del usuario no se tocan.
$cmdDst = $Comp['comandos'][1]
$null = Install-Componente 'comandos' 'Comandos /odd:*' $Comp['comandos'] {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cmdDst) | Out-Null
  if (Test-Path -LiteralPath $cmdDst) { Remove-Item -LiteralPath $cmdDst -Recurse -Force }
  Copy-Item -LiteralPath $Comp['comandos'][0] -Destination $cmdDst -Recurse -Force
  Write-Ok "Comandos /odd:* instalados: $cmdDst"
} 'Repite install.ps1'

# ---------------------------------------------------------------- 5b. Ajustes de Claude (esfuerzos + hooks)
Write-Step 'Esfuerzos y hooks de contexto en Claude (settings.json)'
$settingsPath = Join-Path $UserHome '.claude\settings.json'
Backup-Item $settingsPath
# Barra de estado (spec 15): plugin claude-hud; si no se puede instalar, queda el indicador propio.
if ($env:SIN_CLAUDE_HUD) { Write-Note 'SIN_CLAUDE_HUD: se mantiene el indicador propio' }
else {
  Invoke-Cli 'claude' @('plugin', 'marketplace', 'add', 'jarrodwatts/claude-hud') | Out-Null
  $hud = Invoke-Cli 'claude' @('plugin', 'install', 'claude-hud@claude-hud')
  if ($hud.Code -eq 0) { Write-Ok 'Plugin claude-hud instalado (barra de estado)' } else { Write-Note 'No se pudo instalar claude-hud; se usa el indicador propio' }
}
$mergeRes = Invoke-Cli 'node' @((Join-Path $hubDst 'settings-merge.mjs'), $hooksDst)
if ($mergeRes.Code -eq 0) { Write-Ok ($mergeRes.Output.Trim()); Add-Paso 'settings.json (hooks y esfuerzos)' 'OK' }
else { Write-Err 'No se pudo actualizar settings.json'; Write-Host $mergeRes.Output -ForegroundColor DarkGray; Add-Paso 'settings.json (hooks y esfuerzos)' 'error' (($mergeRes.Output.Trim() -split "`n")[0]) "Revisa que ~/.claude/settings.json sea JSON valido (copia en $BackupDir) y repite install.ps1" }
# Permisos prudentes (spec 21 · S5): se unen a los que ya hay, sin quitar nada.
$permRes = Invoke-Cli 'node' @((Join-Path $ConfigRoot 'claude\permisos.mjs'), $settingsPath)
if ($permRes.Code -eq 0) { Write-Ok ($permRes.Output.Trim()); Add-Paso 'Permisos de Claude' 'OK' }
else { Write-Err 'No se pudieron fusionar los permisos'; Write-Host $permRes.Output -ForegroundColor DarkGray; Add-Paso 'Permisos de Claude' 'error' (($permRes.Output.Trim() -split "`n")[0]) "Revisa que ~/.claude/settings.json sea JSON valido y repite install.ps1" }

# ---------------------------------------------------------------- 6. Agentes de OpenCode
Write-Step 'Agentes de OpenCode'

$null = Install-Componente 'agentes-opencode' 'Agentes de OpenCode' $Comp['agentes-opencode'] {
  New-Item -ItemType Directory -Force -Path $AgentsOcDst | Out-Null
  for ($i = 0; $i -lt $Comp['agentes-opencode'].Count; $i += 2) {
    Copy-Item -LiteralPath $Comp['agentes-opencode'][$i] -Destination $Comp['agentes-opencode'][$i + 1] -Force
    Write-Ok "Agente: $($Comp['agentes-opencode'][$i + 1])"
  }
} 'Repite install.ps1; si persiste, revisa permisos de ~/.config/opencode/agents'
$legacy = Join-Path $AgentsOcDst 'constructor.md'
if (Test-Path -LiteralPath $legacy) {
  Backup-Item $legacy
  Remove-Item -LiteralPath $legacy -Force
  Write-Warn 'Retirado constructor.md (renombrado a implementador.md: era una palabra reservada de JavaScript que rompia el servidor V1)'
}
foreach ($viejo in @('chat-deepseek.md', 'chat-local.md')) {
  $p = Join-Path $UserHome ".config\opencode\agent\$viejo"
  if (Test-Path -LiteralPath $p) {
    Backup-Item $p
    Remove-Item -LiteralPath $p -Force
    Write-Warn "Retirado agente antiguo: $viejo (sustituido por local.md / deepseek-oc)"
  }
}

# gentle-ai deja gentle-orchestrator como default_agent; aqui se devuelve cerebro-oc (spec 20 · L8).
$defRes = Invoke-Cli 'node' @((Join-Path $ConfigRoot 'claude\agente-defecto.mjs'), (Join-Path $UserHome '.config\opencode\opencode.jsonc'))
if ($defRes.Code -eq 0) { Write-Ok ($defRes.Output.Trim()); Add-Paso 'default_agent de OpenCode' 'OK' }
else { Write-Warn ($defRes.Output.Trim()); Add-Paso 'default_agent de OpenCode' 'aviso' (($defRes.Output.Trim() -split "`n")[0]) 'node config\claude\agente-defecto.mjs ~\.config\opencode\opencode.jsonc' }

# ---------------------------------------------------------------- 7. Arrancar servidor
Write-Step 'Arrancando servidor local'
$servidorPs = Join-Path $SystemDir 'servidor.ps1'
if (Test-Path -LiteralPath $servidorPs) {
  # Spec 25 · S5: gentle-ai reemplaza engram.exe y deja sin Engram al servidor V1 que ya estaba
  # en marcha; se reinicia para que vuelva a conectar sus MCP.
  if ($gentleCorrio) {
    Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $servidorPs, '-Stop') | Out-Null
    Write-Note 'Servidor V1 detenido para reconectar Engram tras gentle-ai install'
  }
  $srvRes = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $servidorPs)
  if ($srvRes.Code -eq 0) {
    Write-Ok $(if ($gentleCorrio) { 'Servidor V1 reiniciado (puerto en server-port.txt)' } else { 'Servidor V1 activo (puerto en server-port.txt)' })
    Add-Paso 'Servidor V1 en marcha' 'OK' $(if ($gentleCorrio) { 'reiniciado tras gentle-ai' } else { '' })
  } else {
    Write-Warn 'El servidor no respondio; se arrancara en la primera llamada del MCP'
    Write-Host $srvRes.Output -ForegroundColor DarkGray
    Add-Paso 'Servidor V1 en marcha' 'aviso' 'no respondio al arrancar' "powershell -File `"$servidorPs`""
  }
}

# ---------------------------------------------------------------- 7b. Docker (hub) y autoarranque
Write-Step 'Docker (hub) y autoarranque'
if (Get-Command docker -ErrorAction SilentlyContinue) {
  # Laya ya no existe: se retira el contenedor, la imagen y el volumen de las maquinas que lo tenian.
  # Primero el contenedor y luego el volumen; sin fallar si no existen o el daemon esta parado.
  # Cada uno por separado: tras un compose down o un uninstall puede quedar solo la imagen o el volumen (~850 MB).
  $quitados = @()
  foreach ($obj in @(@('contenedor', @('rm', '-f', 'cerebro-laya')), @('imagen', @('image', 'rm', 'cerebro-hub-laya:latest')), @('volumen', @('volume', 'rm', 'cerebro-hub_laya-modelos')))) {
    $r = Invoke-Cli 'docker' $obj[1]
    if ($r.Code -eq 0) { $quitados += $obj[0] }
  }
  if ($quitados.Count -gt 0) { Write-Ok ('Retirado lo que quedaba de Laya: ' + ($quitados -join ', ')) }
  $composePath = Join-Path $dockerDst 'docker-compose.yml'
  $dockerNuevo = Install-Componente 'docker' 'Stack Docker' $Comp['docker'] {
    if (Test-Path -LiteralPath $dockerDst) { Remove-Item -LiteralPath $dockerDst -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docker') -Destination $dockerDst -Recurse -Force
    # El compose instalado construye desde la copia instalada del hub
    $composeTxt = [System.IO.File]::ReadAllText($composePath).Replace('../config/hub', '../hub')
    # La carpeta de trabajos del MCP vive fuera del hub (LOCALAPPDATA): se monta para
    # que el panel y el vigilante vean los trabajos tambien cuando el hub va en Docker.
    $tareasMcpDocker = (Join-Path $env:LOCALAPPDATA 'opencode-mcp\tasks').Replace('\', '/')
    $composeTxt = $composeTxt.Replace('# __TAREAS_MCP_ENV__', '- OPENCODE_MCP_TASKS=/opencode-mcp/tasks')
    $composeTxt = $composeTxt.Replace('# __TAREAS_MCP_VOL__', '- ' + $tareasMcpDocker + ':/opencode-mcp/tasks:ro')
    [System.IO.File]::WriteAllText($composePath, $composeTxt, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Stack Docker instalado: $dockerDst"
  } 'Arranca Docker Desktop y repite install.ps1'

  if (Test-Path -LiteralPath $composePath) {
    # Solo se reconstruye si cambio el hub o el stack, o si falta la imagen (spec 25 · S2).
    $sinImagen = ((Invoke-Cli 'docker' @('image', 'inspect', 'cerebro-hub:latest')).Code -ne 0)
    if ($hubNuevo -or $dockerNuevo -or $sinImagen -or $Reinstalar) {
      Write-Note 'Construyendo imagenes de Docker (la primera vez puede tardar)...'
      $b = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'build')
      if ($b.Code -eq 0) { Write-Ok 'Imagenes listas'; Add-Paso 'Imagen Docker del hub' 'OK' }
      else { Write-Err 'No se pudieron construir las imagenes'; Write-Host $b.Output -ForegroundColor DarkGray; Add-Paso 'Imagen Docker del hub' 'error' 'docker compose build fallo (salida en el log)' "Arranca Docker Desktop y ejecuta: docker compose -f `"$composePath`" build" }
    } else {
      Write-Same 'Imagen del hub sin cambios'
      Add-Paso 'Imagen Docker del hub' 'sin cambios'
    }
    $up = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'up', '-d')
    if ($up.Code -eq 0) { Write-Ok 'Hub en marcha (cerebro-hub)'; Add-Paso 'Hub en Docker' 'OK' }
    else { Write-Err 'No se pudo levantar el stack Docker'; Write-Host $up.Output -ForegroundColor DarkGray; Add-Paso 'Hub en Docker' 'error' 'docker compose up fallo (salida en el log)' "Arranca Docker Desktop y ejecuta: docker compose -f `"$composePath`" up -d" }
  }

  $taskName = 'Cerebro Hub'
  $taskCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dockerDst 'gestion.ps1') + '" up'
  $sch = Invoke-Cli 'schtasks' @('/Create', '/TN', $taskName, '/TR', $taskCmd, '/SC', 'ONLOGON', '/F')
  if ($sch.Code -eq 0) {
    Write-Ok "Autoarranque registrado (tarea programada «$taskName»)"
  } else {
    # Sin permisos para tareas programadas: carpeta de Inicio del usuario
    $inicio = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    New-Item -ItemType Directory -Force -Path $inicio | Out-Null
    $arranque = Join-Path $inicio 'cerebro-hub.cmd'
    Backup-Item $arranque
    $contenido = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$dockerDst\gestion.ps1`" up`r`n"
    [System.IO.File]::WriteAllText($arranque, $contenido, (New-Object System.Text.ASCIIEncoding))
    Write-Ok 'Autoarranque registrado (Inicio de Windows: cerebro-hub.cmd)'
  }
} else {
  Write-Warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.ps1)'
  Add-Paso 'Hub en Docker' 'aviso' 'Docker no esta instalado' 'Instala Docker Desktop o arranca el hub en nativo: hub.ps1'
}

try { Invoke-Registro @('cerrar', $Registro, $VersionSistema) | Out-Null } catch { Write-Warn "No se pudo cerrar el registro: $($_.Exception.Message)" }

# ---------------------------------------------------------------- 8. Comprobacion final (spec 25 · S7)
if ($SinVerificar) {
  Write-Note '-SinVerificar: se omite verificar -Smoke'
} else {
  Write-Step 'Verificando (verificar -Smoke)'
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    # El hub se reinicia al desplegar: esperar hasta 90 s para no dar un falso fallo.
    for ($i = 0; $i -lt 45; $i++) {
      try { $s = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:4597/api/salud'; if ($s.app -eq 'cerebro-hub') { break } } catch { }
      Start-Sleep -Seconds 2
    }
  }
  $ver = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoRoot 'scripts\verificar.ps1'), '-Smoke')
  Write-Host $ver.Output
  if ($ver.Code -eq 0) { Add-Paso 'Verificacion (verificar -Smoke)' 'OK' }
  else { Add-Paso 'Verificacion (verificar -Smoke)' 'error' 'hay comprobaciones con [X]' 'Revisa los [X] de la verificacion de arriba: cada uno dice como arreglarlo' }
}

# ---------------------------------------------------------------- Resumen (spec 25 · S6)
Write-Step 'Resumen'
foreach ($p in $Pasos) {
  $txt = $p.Paso + $(if ($p.Detalle) { ": $($p.Detalle)" } else { '' })
  switch ($p.Resultado) {
    'OK'          { Write-Ok $txt }
    'sin cambios' { Write-Same $txt }
    'aviso'       { Write-Warn $txt }
    default       { Write-Err $txt }
  }
}
$errores = @($Pasos | Where-Object { $_.Resultado -eq 'error' })
$avisos  = @($Pasos | Where-Object { $_.Resultado -eq 'aviso' -and $_.Arreglo })
if ($errores.Count -gt 0) {
  Write-Host "`nErrores ($($errores.Count)):" -ForegroundColor Red
  foreach ($e in $errores) {
    Write-Host "  - $($e.Paso): $($e.Detalle)" -ForegroundColor Red
    if ($e.Arreglo) { Write-Host "    Como arreglarlo: $($e.Arreglo)" }
  }
}
if ($avisos.Count -gt 0 -or $warnings.Count -gt 0) {
  Write-Host "`nAvisos:" -ForegroundColor Yellow
  foreach ($a in $avisos) { Write-Warn "$($a.Paso): $($a.Arreglo)" }
  foreach ($w in $warnings) { Write-Warn $w }
}
Write-Host "`nProximos pasos:" -ForegroundColor Cyan
Write-Host '  1. Reinicia Claude Code si lo tienes abierto (para que cargue lo nuevo).'
Write-Host '  2. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras (comandos /odd:start, /odd:plan...).'
Write-Host '  3. Panel del Cerebro Hub (organizacion, memoria y gasto):'
Write-Host '       powershell -NoProfile -ExecutionPolicy Bypass -File ~\.sistema-cerebro-agentes\hub.ps1'
if (Test-Path -LiteralPath $BackupDir) { Write-Note "Backups de esta ejecucion: $BackupDir" }
Write-Note "Registro: $Registro"
Write-Note "Log: $LogPath"
if ($errores.Count -gt 0) { Write-Host "`nTerminado con $($errores.Count) error(es)." -ForegroundColor Red; Exit-Install 1 }
Write-Host "`nListo."
Exit-Install 0
