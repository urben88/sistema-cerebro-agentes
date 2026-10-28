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
   9. Arranca el servidor local.

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
$VersionGentle   = '4.3.1'
$VersionPluginOc = '2.0.4'
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
Write-Step 'Cerebro Hub (memoria compartida, hooks y trabajos)'

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

# Sonido al terminar (spec 22 · S6): crea la carpeta y deja el README; NO toca los fin.* del usuario.
$sonidosDst = Join-Path $SystemDir 'sonidos'
New-Item -ItemType Directory -Force -Path $sonidosDst | Out-Null
Copy-Item -LiteralPath (Join-Path $ConfigRoot 'sonidos\README.md') -Destination (Join-Path $sonidosDst 'README.md') -Force
Write-Ok "Carpeta de sonidos: $sonidosDst (pon ahí fin.mp3, fin.wav o fin.ogg)"

$mcpDst = Join-Path $SystemDir 'mcp'
New-Item -ItemType Directory -Force -Path $mcpDst | Out-Null
Backup-Item (Join-Path $mcpDst 'triaje-mcp.mjs')
Copy-Item -LiteralPath (Join-Path $ConfigRoot 'mcp\triaje-mcp.mjs') -Destination (Join-Path $mcpDst 'triaje-mcp.mjs') -Force
Write-Ok 'MCP de trabajos instalado (mcp/triaje-mcp.mjs)'

# Mods de Claude Code (mesa de trabajo): se cargan vía CLAUDE_CODE_PLUGIN_DIRS (settings-merge).
$modsSrc = Join-Path $ConfigRoot 'mods'
$modsDst = Join-Path $SystemDir 'mods'
if (Test-Path -LiteralPath $modsSrc) {
  Backup-Item $modsDst
  if (Test-Path -LiteralPath $modsDst) { Remove-Item -LiteralPath $modsDst -Recurse -Force }
  Copy-Item -LiteralPath $modsSrc -Destination $modsDst -Recurse -Force
  Write-Ok "Mods instalados: $modsDst"
}

# ---------------------------------------------------------------- 3d. Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills)
# Va ANTES de lo nuestro: asi nuestros agentes, el bloque de CLAUDE.md, los permisos y el
# default_agent se aplican encima y no los pisa el componente permissions de gentle-ai.
Write-Step "Gentle AI $VersionGentle (Claude Code + OpenCode)"
if ($env:SIN_GENTLE_AI) {
  Write-Note 'SIN_GENTLE_AI: se omite Gentle AI'
} else {
  $gentleExe = Get-GentleAiExe
  if (-not $gentleExe) {
    if (Get-Command go -ErrorAction SilentlyContinue) {
      Write-Note "Instalando gentle-ai@v$VersionGentle con go install (puede tardar)..."
      $gi = Invoke-Cli 'go' @('install', "github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VersionGentle")
      $gentleExe = Get-GentleAiExe
      if ($gentleExe) { Write-Ok "gentle-ai instalado: $gentleExe" }
      else { Write-Warn 'No se pudo instalar gentle-ai'; Write-Host $gi.Output -ForegroundColor DarkGray }
    } else {
      Write-Warn 'Falta Go: no se puede instalar gentle-ai'
    }
    if (-not $gentleExe) { $warnings.Add("Instala Gentle AI a mano: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VersionGentle (necesita Go) y repite install") }
  }
  if ($gentleExe) {
    $gv = Get-GentleAiVersion $gentleExe
    if ($gv -ne $VersionGentle) { Write-Warn "Gentle AI $gv (fijada: $VersionGentle); se usa la instalada" }
    $conOpenCode = [bool](Get-Command opencode -ErrorAction SilentlyContinue)
    $agentesG = if ($conOpenCode) { 'claude-code,opencode' } else { 'claude-code' }

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
        else { Write-Warn "No se pudo instalar @opencode/plugin@$VersionPluginOc"; $warnings.Add("Ejecuta: npm install --prefix `"$ocCfg`" --save-exact @opencode/plugin@$VersionPluginOc y repite install") }
      }
    } else {
      Write-Warn 'OpenCode no encontrado: Gentle AI se configura solo para Claude Code'
    }

    # gentle-ai sube defaultMode a bypassPermissions; permisos.mjs (paso 5b) lo devuelve.
    $settingsAntes = Join-Path $UserHome '.claude\settings.json'
    $modoPrevio = '(ninguno)'
    try { $m = (Get-Content -Raw -LiteralPath $settingsAntes | ConvertFrom-Json).permissions.defaultMode; if ($m) { $modoPrevio = [string]$m } } catch { }
    $env:MODO_PREVIO = $modoPrevio
    Write-Note "gentle-ai install --agents $agentesG --preset full-gentleman --persona gentleman --claude-orchestrator-modules"
    $gr =Invoke-Cli $gentleExe @('install', '--agents', $agentesG, '--preset', 'full-gentleman', '--persona', 'gentleman', '--claude-orchestrator-modules')
    if ($gr.Code -eq 0) { Write-Ok 'Gentle AI configurado (ODD, RDD, Engram, CodeGraph, Context7, skills)' }
    else {
      Write-Warn 'gentle-ai install no termino bien; se sigue con lo demas'
      Write-Host $gr.Output -ForegroundColor DarkGray
      $warnings.Add('Revisa la salida de gentle-ai install y repite install')
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
if ($addT.Code -eq 0) { Write-Ok 'MCP de trabajos (triaje) registrado a nivel de usuario (modo normal)' } else { Write-Note 'No se pudo registrar el MCP triaje global; hazlo a mano: claude mcp add --scope user triaje -- node <ruta>' }

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
foreach ($f in @('explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md', 'adaptador-mcps.md', 'planificador.md', 'resolutor.md', 'ayudante.md', 'retocador.md', 'consultor.md')) {
  $dst = Join-Path $agentDir $f
  Backup-Item $dst
  Copy-Item -LiteralPath (Join-Path $agentSrcDir $f) -Destination $dst -Force
  Write-Ok "Subagente instalado: $dst"
}
Write-Note 'Activalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

$binDir = Join-Path $UserHome '.local\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
foreach ($f in @('cerebro.cmd', 'cerebro', 'cerebro-parar.cmd', 'cerebro-parar')) {
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

# Comandos /odd:* (spec 21 · S4): solo se reemplaza la carpeta odd; los comandos del usuario no se tocan.
$cmdSrc = Join-Path $ConfigRoot 'claude\commands\odd'
$cmdDst = Join-Path $UserHome '.claude\commands\odd'
Backup-Item $cmdDst
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cmdDst) | Out-Null
if (Test-Path -LiteralPath $cmdDst) { Remove-Item -LiteralPath $cmdDst -Recurse -Force }
Copy-Item -LiteralPath $cmdSrc -Destination $cmdDst -Recurse -Force
Write-Ok "Comandos /odd:* instalados: $cmdDst"

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
$mergeRes = Invoke-Cli 'node' @((Join-Path $SystemDir 'hub\settings-merge.mjs'), $hooksDst)
if ($mergeRes.Code -eq 0) { Write-Ok ($mergeRes.Output.Trim()) }
else { Write-Warn 'No se pudo actualizar settings.json'; Write-Host $mergeRes.Output -ForegroundColor DarkGray }
# Permisos prudentes (spec 21 · S5): se unen a los que ya hay, sin quitar nada.
$permRes = Invoke-Cli 'node' @((Join-Path $ConfigRoot 'claude\permisos.mjs'), $settingsPath)
if ($permRes.Code -eq 0) { Write-Ok ($permRes.Output.Trim()) }
else { Write-Warn 'No se pudieron fusionar los permisos'; Write-Host $permRes.Output -ForegroundColor DarkGray }

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

# gentle-ai deja gentle-orchestrator como default_agent; aqui se devuelve cerebro-oc (spec 20 · L8).
$defRes = Invoke-Cli 'node' @((Join-Path $ConfigRoot 'claude\agente-defecto.mjs'), (Join-Path $UserHome '.config\opencode\opencode.jsonc'))
if ($defRes.Code -eq 0) { Write-Ok ($defRes.Output.Trim()) } else { Write-Warn ($defRes.Output.Trim()) }

# ---------------------------------------------------------------- 7. Arrancar servidor
Write-Step 'Arrancando servidor local'
if (Test-Path -LiteralPath (Join-Path $SystemDir 'servidor.ps1')) {
  $srvRes = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $SystemDir 'servidor.ps1'))
  if ($srvRes.Code -eq 0) { Write-Ok 'Servidor V1 activo (puerto en server-port.txt)' }
  else { Write-Warn 'El servidor no respondio; se arrancara en la primera llamada del MCP'; Write-Host $srvRes.Output -ForegroundColor DarkGray }
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
  Write-Note 'Construyendo imagenes de Docker si hay cambios (la primera vez puede tardar)...'
  $b = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'build')
  if ($b.Code -eq 0) { Write-Ok 'Imagenes listas' }
  else { Write-Warn 'No se pudieron construir las imagenes'; Write-Host $b.Output -ForegroundColor DarkGray }
  $up = Invoke-Cli 'docker' @('compose', '-f', $composePath, 'up', '-d')
  if ($up.Code -eq 0) { Write-Ok 'Hub en marcha (cerebro-hub)' }
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
  Write-Warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.ps1)'
}

# ---------------------------------------------------------------- Resumen
Write-Step 'Resumen'
Write-Host 'Instalacion completada. Proximos pasos:' -ForegroundColor Cyan
Write-Host '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).'
Write-Host '  2. Verifica el sistema:'
Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke'
Write-Host '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras (comandos /odd:start, /odd:plan...).'
Write-Host '  4. Panel del Cerebro Hub (organización, memoria y gasto):'
Write-Host '       powershell -NoProfile -ExecutionPolicy Bypass -File ~\.sistema-cerebro-agentes\hub.ps1'
Write-Host '     (El panel antiguo de actividad sigue disponible con panel.ps1.)'
if ($warnings.Count -gt 0) {
  Write-Host "`nAvisos:" -ForegroundColor Yellow
  foreach ($w in $warnings) { Write-Warn $w }
}
if (Test-Path -LiteralPath $BackupDir) { Write-Note "Backups de esta ejecucion: $BackupDir" }
Write-Host "`nListo."
