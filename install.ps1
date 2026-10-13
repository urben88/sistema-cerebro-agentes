#Requires -Version 5.1
<#
.SYNOPSIS
  Instalador de sistema-cerebro-agentes para Windows.

.DESCRIPTION
  Despliega la arquitectura Cerebro (Claude Code) -> Manos (OpenCode):
   1. Comprueba prerrequisitos (Node >= 22, OpenCode, Claude Code, OpenRouter).
   2. Registra el MCP opencode-mcp en Claude Code (scope de usuario).
   3. Instala el rol Cerebro (CLAUDE.md, bloque gestionado) y la skill delegar-a-opencode.
   4. Instala los agentes constructor/revisor/testeador en OpenCode.

  Es idempotente (se puede ejecutar las veces que haga falta) y hace copia de
  seguridad de todo lo que reemplaza en ~/.sistema-cerebro-agentes/backups/<fecha>/.

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

$RepoRoot    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigRoot  = Join-Path $RepoRoot 'config'
$UserHome    = $env:USERPROFILE
$MarkerBegin = '<!-- BEGIN sistema-cerebro-agentes -->'
$MarkerEnd   = '<!-- END sistema-cerebro-agentes -->'
$BackupRoot  = Join-Path $UserHome '.sistema-cerebro-agentes\backups'
$BackupDir   = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')

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

if (Get-Command opencode -ErrorAction SilentlyContinue) {
  $ocVer = (& opencode --version 2>$null | Select-Object -First 1)
  Write-Ok "OpenCode $ocVer"
} else {
  Write-Err 'OpenCode no encontrado'
  $fatal.Add('Instala OpenCode: https://opencode.ai  (npm: npm install -g @opencode/cli)')
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
  $ccVer = (& claude --version 2>$null | Select-Object -First 1)
  Write-Ok "Claude Code $ccVer"
} else {
  Write-Err 'Claude Code no encontrado'
  $fatal.Add('Instala Claude Code: https://claude.com/claude-code')
}

$authPath      = Join-Path $UserHome '.local\share\opencode\auth.json'
$hasOpenRouter = $false
if (Test-Path -LiteralPath $authPath) {
  try {
    $auth          = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
    $hasOpenRouter = @($auth.PSObject.Properties.Name) -contains 'openrouter'
  } catch { }
}
if ($hasOpenRouter) {
  Write-Ok 'OpenRouter conectado en OpenCode'
} else {
  Write-Warn 'OpenRouter no esta conectado en OpenCode'
  $warnings.Add("Conecta OpenRouter en OpenCode: ejecuta 'opencode auth login' (o /connect en la TUI) y elige OpenRouter")
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

# ---------------------------------------------------------------- 2. MCP en Claude Code
Write-Step 'MCP opencode-mcp en Claude Code'

& claude mcp remove opencode --scope user 2>$null | Out-Null
$mcpArgs = @(
  'mcp', 'add', 'opencode', '--scope', 'user',
  '--env', 'OPENCODE_AUTO_SERVE=true',
  '--env', 'OPENCODE_TOOL_PROFILE=essential',
  '--env', 'OPENCODE_DEFAULT_PROVIDER=openrouter',
  '--env', 'OPENCODE_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash',
  '--', 'cmd', '/c', 'npx', '-y', 'opencode-mcp'
)
$mcpOut = (& claude @mcpArgs 2>&1 | Out-String)
if ($LASTEXITCODE -eq 0) {
  Write-Ok 'MCP registrado (scope de usuario)'
} else {
  Write-Warn 'No se pudo registrar el MCP automaticamente:'
  Write-Host $mcpOut -ForegroundColor DarkGray
  $warnings.Add('Registra el MCP a mano: claude mcp add opencode --scope user --env OPENCODE_AUTO_SERVE=true --env OPENCODE_TOOL_PROFILE=essential --env OPENCODE_DEFAULT_PROVIDER=openrouter --env OPENCODE_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash -- cmd /c npx -y opencode-mcp')
}

# ---------------------------------------------------------------- 3. Rol Cerebro (Claude Code)
Write-Step 'Rol Cerebro en Claude Code'

Set-ManagedBlock (Join-Path $UserHome '.claude\CLAUDE.md') (Join-Path $ConfigRoot 'claude\CLAUDE.md')

$skillSrc = Join-Path $ConfigRoot 'claude\skills\delegar-a-opencode'
$skillDst = Join-Path $UserHome '.claude\skills\delegar-a-opencode'
Backup-Item $skillDst
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillDst) | Out-Null
Copy-Item -LiteralPath $skillSrc -Destination $skillDst -Recurse -Force
Write-Ok "Skill instalada: $skillDst"

# ---------------------------------------------------------------- 4. Agentes de OpenCode
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

# ---------------------------------------------------------------- Resumen
Write-Step 'Resumen'
Write-Host 'Instalacion completada. Proximos pasos:' -ForegroundColor Cyan
Write-Host '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).'
Write-Host '  2. Verifica el sistema:'
Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke'
Write-Host '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras.'
if ($warnings.Count -gt 0) {
  Write-Host "`nAvisos:" -ForegroundColor Yellow
  foreach ($w in $warnings) { Write-Warn $w }
}
if (Test-Path -LiteralPath $BackupDir) { Write-Note "Backups de esta ejecucion: $BackupDir" }
Write-Host "`nListo."
