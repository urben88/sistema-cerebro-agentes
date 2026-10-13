#Requires -Version 5.1
<#
.SYNOPSIS
  Instalador de sistema-cerebro-agentes para Windows.

.DESCRIPTION
  Despliega la arquitectura Cerebro (Claude Code) -> Hub -> Manos (OpenCode):
   1. Comprueba prerrequisitos (Node >= 22, OpenCode, Claude Code, proveedor DeepSeek, Docker opcional).
   2. Instala el servidor OpenCode V1 (opencode-ai) que usa el MCP, con datos aislados.
   3. Copia el lanzador del MCP a ~/.sistema-cerebro-agentes.
   4. Instala el panel web y el Cerebro Hub (memoria compartida, vigilante, triaje).
   5. Instala los hooks de contexto y los subagentes de Claude (cerebro, subdirector...).
   6. Instala los agentes de OpenCode (por esfuerzo) y retira los antiguos.
   7. Levanta el stack Docker (hub + Laya) y registra el autoarranque.
   8. Arranca el servidor local.

  Es idempotente y hace copia de seguridad de todo lo que reemplaza en
  ~/.sistema-cerebro-agentes/backups/<fecha>/.

.PARAMETER Check
  Solo comprueba prerrequisitos y estado; no cambia nada.

.PARAMETER Force
  Reservado: no formula preguntas interactivas (comportamiento por defecto).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Force
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
$MarkerBegin    = '<!-- BEGIN sistema-cerebro-agentes -->'
$MarkerEnd      = '<!-- END sistema-cerebro-agentes -->'
$BackupRoot     = Join-Path $SystemDir 'backups'
$BackupDir      = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Write-Err([string]$m)  { Write-Host "  [X]    $m" -ForegroundColor Red }
function Write-Note([string]$m) { Write-Host "  [info] $m" -ForegroundColor DarkGray }

function Backup-Item([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
  $name = ($Path -replace '[\\/:*?"<>|]', '_')
  $dest = Join-Path $BackupDir $name
  Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force
  Write-Note "backup: $Path"
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
  Backup-Item $TargetPath
  $existing = [System.IO.File]::ReadAllText($TargetPath)
  if ($existing.Contains($MarkerBegin)) {
    $pattern     = [regex]::Escape($MarkerBegin) + '(?s).*?' + [regex]::Escape($MarkerEnd)
    $placeholder = '<<<sistema-cerebro-agentes-block>>>'
    $updated     = [regex]::Replace($existing, $pattern, $placeholder).Replace($placeholder, $managed)
    [System.IO.File]::WriteAllText($TargetPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Bloque actualizado: $TargetPath"
  } else {
    [System.IO.File]::AppendAllText($TargetPath, "`n" + $managed + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Bloque anadido: $TargetPath"
  }
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
  Write-Ok 'Docker disponible (hub + Laya en contenedores)'
} else {
  Write-Warn 'Docker no encontrado: el hub podra ejecutarse en nativo (hub.ps1), pero Laya no estara disponible'
}

if ($fatal.Count -gt 0) {
  Write-Host "`nFaltan prerrequisitos obligatorios:" -ForegroundColor Red
  foreach ($p in $fatal) { Write-Host "  - $p" -ForegroundColor Red }
  exit 1
}

if ($Check) {
  Write-Host "`nComprobacion terminada (modo -Check; no se ha cambiado nada)." -ForegroundColor Cyan
  foreach ($w in $warnings) { Write-Warn $w }
  exit 0
}

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
    Write-Ok "opencode-ai $VersionServidor ya instalado"
  }
}

if ($needInstall) {
  Write-Host "  Instalando opencode-ai@$VersionServidor con npm (puede tardar un par de minutos)..." -ForegroundColor DarkGray
  $npmRes = Invoke-Cli 'npm' @('install', '--prefix', $ServerDir, "opencode-ai@$VersionServidor", '--no-audit', '--no-fund')
  if (Test-Path -LiteralPath $ServerExe) {
    Write-Ok "opencode-ai $VersionServidor instalado"
  } else {
    Write-Err 'No se pudo instalar opencode-ai'
    Write-Host $npmRes.Output -ForegroundColor DarkGray
    $warnings.Add("Instala manualmente: npm install --prefix `"$ServerDir`" opencode-ai@$VersionServidor")
  }
}

# ---------------------------------------------------------------- 3. Lanzador del MCP
Write-Step 'Lanzador del MCP'

New-Item -ItemType Directory -Force -Path $SystemDir | Out-Null
foreach ($f in @('servidor.ps1', 'launcher.ps1')) {
  $src = Join-Path $ConfigRoot "mcp\$f"
  $dst = Join-Path $SystemDir $f
  Backup-Item $dst
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Ok "Instalado: $dst"
}

# ---------------------------------------------------------------- 3b. Panel web
Write-Step 'Panel web en tiempo real'
$webSrc = Join-Path $ConfigRoot 'web'
$webDst = Join-Path $SystemDir 'web'
Backup-Item $webDst
if (Test-Path -LiteralPath $webDst) { Remove-Item -LiteralPath $webDst -Recurse -Force }
Copy-Item -LiteralPath $webSrc -Destination $webDst -Recurse -Force
Write-Ok "Panel instalado: $webDst"
$panelSrc = Join-Path $RepoRoot 'scripts\panel.ps1'
$panelDst = Join-Path $SystemDir 'panel.ps1'
Backup-Item $panelDst
Copy-Item -LiteralPath $panelSrc -Destination $panelDst -Force
Write-Ok "Instalado: $panelDst"
$panelCfg = (@{ repoRoot = $RepoRoot } | ConvertTo-Json)
[System.IO.File]::WriteAllText((Join-Path $SystemDir 'panel-config.json'), $panelCfg + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Ok 'panel-config.json escrito (ruta del repositorio)'

# Si el panel estaba abierto, reiniciarlo para aplicar la version nueva
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

# ---------------------------------------------------------------- 3c. Cerebro Hub
Write-Step 'Cerebro Hub (memoria compartida, hooks y triaje)'

$hubSrc = Join-Path $ConfigRoot 'hub'
$hubDst = Join-Path $SystemDir 'hub'
Backup-Item $hubDst
if (Test-Path -LiteralPath $hubDst) { Remove-Item -LiteralPath $hubDst -Recurse -Force }
Copy-Item -LiteralPath $hubSrc -Destination $hubDst -Recurse -Force
Write-Ok "Hub instalado: $hubDst"

$hubLauncher = Join-Path $SystemDir 'hub.ps1'
Backup-Item $hubLauncher
Copy-Item -LiteralPath (Join-Path $hubSrc 'hub.ps1') -Destination $hubLauncher -Force
Write-Ok "Lanzador instalado: $hubLauncher"

$hooksDst = Join-Path $SystemDir 'hooks'
Backup-Item $hooksDst
if (Test-Path -LiteralPath $hooksDst) { Remove-Item -LiteralPath $hooksDst -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $ConfigRoot 'hooks') -Destination $hooksDst -Recurse -Force
Write-Ok "Hooks instalados: $hooksDst"

$mcpDst = Join-Path $SystemDir 'mcp'
New-Item -ItemType Directory -Force -Path $mcpDst | Out-Null
Backup-Item (Join-Path $mcpDst 'triaje-mcp.mjs')
Copy-Item -LiteralPath (Join-Path $ConfigRoot 'mcp\triaje-mcp.mjs') -Destination (Join-Path $mcpDst 'triaje-mcp.mjs') -Force
Write-Ok 'MCP de triaje instalado (mcp/triaje-mcp.mjs)'

# ---------------------------------------------------------------- 4. Agente cerebro (con el MCP dentro)
Write-Step 'Agente cerebro en Claude Code (con el MCP dentro)'

# Migracion: el MCP ya no se registra globalmente; vive DENTRO del agente cerebro.
$rm = Invoke-Cli 'claude' @('mcp', 'remove', 'opencode', '--scope', 'user')
if ($rm.Code -eq 0) { Write-Note 'Retirado el registro global antiguo del MCP (ahora vive en el agente cerebro)' }

$agentSrcDir = Join-Path $ConfigRoot 'claude\agents'
$agentDir = Join-Path $UserHome '.claude\agents'
New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
$argsJson = '["/c","powershell","-NoProfile","-ExecutionPolicy","Bypass","-File","' + ($LauncherPath.Replace('\', '\\')) + '"]'
$triajeMcp = Join-Path $SystemDir 'mcp\triaje-mcp.mjs'
foreach ($f in @('cerebro.md', 'subdirector.md')) {
  $dst = Join-Path $agentDir $f
  Backup-Item $dst
  $tpl = [System.IO.File]::ReadAllText((Join-Path $agentSrcDir $f)).Replace('__COMANDO__', 'cmd').Replace('__ARGUMENTOS_JSON__', $argsJson).Replace('__TRIAJE_MCP__', $triajeMcp)
  [System.IO.File]::WriteAllText($dst, $tpl, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "Agente instalado: $dst"
}
foreach ($f in @('explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md', 'adaptador-mcps.md', 'planificador.md')) {
  $dst = Join-Path $agentDir $f
  Backup-Item $dst
  Copy-Item -LiteralPath (Join-Path $agentSrcDir $f) -Destination $dst -Force
  Write-Ok "Subagente instalado: $dst"
}
Write-Note 'Activalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

$binDir = Join-Path $UserHome '.local\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
foreach ($f in @('cerebro.cmd', 'cerebro')) {
  $binSrc = Join-Path $ConfigRoot "bin\$f"
  $binDst = Join-Path $binDir $f
  Backup-Item $binDst
  Copy-Item -LiteralPath $binSrc -Destination $binDst -Force
  Write-Ok "Comando instalado: $binDst"
}
Write-Note 'Rotacion: escribe "cerebro" para continuar la conversacion en modo Cerebro; "claude --continue" para volver al modo normal'

# ---------------------------------------------------------------- 5. Rol Cerebro (Claude Code)
Write-Step 'Rol Cerebro en Claude Code'

Set-ManagedBlock (Join-Path $UserHome '.claude\CLAUDE.md') (Join-Path $ConfigRoot 'claude\CLAUDE.md')

$skillSrc = Join-Path $ConfigRoot 'claude\skills\delegar-a-opencode'
$skillDst = Join-Path $UserHome '.claude\skills\delegar-a-opencode'
Backup-Item $skillDst
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillDst) | Out-Null
if (Test-Path -LiteralPath $skillDst) { Remove-Item -LiteralPath $skillDst -Recurse -Force }
Copy-Item -LiteralPath $skillSrc -Destination $skillDst -Recurse -Force
Write-Ok "Skill instalada: $skillDst"

# ---------------------------------------------------------------- 5b. Ajustes de Claude (esfuerzos + hooks)
Write-Step 'Esfuerzos y hooks de contexto en Claude (settings.json)'
$settingsPath = Join-Path $UserHome '.claude\settings.json'
Backup-Item $settingsPath
$mergeRes = Invoke-Cli 'node' @((Join-Path $SystemDir 'hub\settings-merge.mjs'), $hooksDst)
if ($mergeRes.Code -eq 0) { Write-Ok ($mergeRes.Output.Trim()) }
else { Write-Warn 'No se pudo actualizar settings.json'; Write-Host $mergeRes.Output -ForegroundColor DarkGray }

# ---------------------------------------------------------------- 6. Agentes de OpenCode
Write-Step 'Agentes de OpenCode'

$agentsSrc = Join-Path $ConfigRoot 'opencode\agents'
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
New-Item -ItemType Directory -Force -Path $agentsDst | Out-Null
foreach ($f in Get-ChildItem -LiteralPath $agentsSrc -Filter '*.md') {
  $dst = Join-Path $agentsDst $f.Name
  Backup-Item $dst
  Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
  Write-Ok "Agente: $dst"
}
$legacy = Join-Path $agentsDst 'constructor.md'
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

# ---------------------------------------------------------------- 7. Arrancar servidor
Write-Step 'Arrancando servidor local'
if (Test-Path -LiteralPath (Join-Path $SystemDir 'servidor.ps1')) {
  $srvRes = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $SystemDir 'servidor.ps1'))
  if ($srvRes.Code -eq 0) { Write-Ok 'Servidor V1 activo (puerto en server-port.txt)' }
  else { Write-Warn 'El servidor no respondio; se arrancara en la primera llamada del MCP'; Write-Host $srvRes.Output -ForegroundColor DarkGray }
}

# ---------------------------------------------------------------- 7b. Docker (hub + Laya) y autoarranque
Write-Step 'Docker (hub + Laya) y autoarranque'
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $dockerDst = Join-Path $SystemDir 'docker'
  Backup-Item $dockerDst
  if (Test-Path -LiteralPath $dockerDst) { Remove-Item -LiteralPath $dockerDst -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'docker') -Destination $dockerDst -Recurse -Force
  # El compose instalado construye desde la copia instalada del hub
  $composePath = Join-Path $dockerDst 'docker-compose.yml'
  $composeTxt = [System.IO.File]::ReadAllText($composePath).Replace('../config/hub', '../hub')
  # La carpeta de trabajos del MCP vive fuera del hub (LOCALAPPDATA): se monta para
  # que el panel y el vigilante vean los trabajos tambien cuando el hub va en Docker.
  $tareasMcpDocker = (Join-Path $env:LOCALAPPDATA 'opencode-mcp\tasks').Replace('\', '/')
  $composeTxt = $composeTxt.Replace('# __TAREAS_MCP_ENV__', '- OPENCODE_MCP_TASKS=/opencode-mcp/tasks')
  $composeTxt = $composeTxt.Replace('# __TAREAS_MCP_VOL__', '- ' + $tareasMcpDocker + ':/opencode-mcp/tasks:ro')
  [System.IO.File]::WriteAllText($composePath, $composeTxt, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "Stack Docker instalado: $dockerDst"

  # Reconstruye siempre (las capas sin cambios salen de cache): asi una actualizacion
  # del hub llega de verdad al contenedor; antes solo se construia si faltaba la imagen.
  Write-Note 'Construyendo imagenes de Docker si hay cambios (la primera vez, Laya descarga torch; puede tardar)...'
  $b = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'build')
  if ($b.Code -eq 0) { Write-Ok 'Imagenes listas' }
  else { Write-Warn 'No se pudieron construir las imagenes'; Write-Host $b.Output -ForegroundColor DarkGray }
  $up = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'up', '-d')
  if ($up.Code -eq 0) { Write-Ok 'Hub + Laya en marcha (cerebro-hub, cerebro-laya)' }
  else { Write-Warn 'No se pudo levantar el stack Docker'; Write-Host $up.Output -ForegroundColor DarkGray }

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
  Write-Warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.ps1); Laya no estara disponible'
}

# ---------------------------------------------------------------- Resumen
Write-Step 'Resumen'
Write-Host 'Instalacion completada. Proximos pasos:' -ForegroundColor Cyan
Write-Host '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).'
Write-Host '  2. Verifica el sistema:'
Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke'
Write-Host '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras.'
Write-Host '  4. Panel del Cerebro Hub (organización, memoria, gasto y triaje):'
Write-Host '       powershell -NoProfile -ExecutionPolicy Bypass -File ~\.sistema-cerebro-agentes\hub.ps1'
Write-Host '     (El panel antiguo de actividad sigue disponible con panel.ps1.)'
if ($warnings.Count -gt 0) {
  Write-Host "`nAvisos:" -ForegroundColor Yellow
  foreach ($w in $warnings) { Write-Warn $w }
}
if (Test-Path -LiteralPath $BackupDir) { Write-Note "Backups de esta ejecucion: $BackupDir" }
Write-Host "`nListo."
