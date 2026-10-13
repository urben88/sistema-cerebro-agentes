#Requires -Version 5.1
<#
.SYNOPSIS
  Desinstalador de sistema-cerebro-agentes para Windows.

.DESCRIPTION
  Quita lo que instala el sistema: MCP opencode en Claude Code, bloque gestionado
  de CLAUDE.md, skill delegar-a-opencode y agentes constructor/revisor/testeador.
  Hace copia de seguridad de todo antes de tocarlo (en ~/.sistema-cerebro-agentes/backups).
  Los agentes propios que ya tuvieras en OpenCode (chat-*) NO se tocan.
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$UserHome    = $env:USERPROFILE
$MarkerBegin = '<!-- BEGIN sistema-cerebro-agentes -->'
$MarkerEnd   = '<!-- END sistema-cerebro-agentes -->'
$BackupRoot  = Join-Path $UserHome '.sistema-cerebro-agentes\backups'
$BackupDir   = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss-uninstall')

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "  [!]    $m" -ForegroundColor Yellow }
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
  # Quirk de PowerShell 5.1: stderr de comandos externos + EAP=Stop = error fatal.
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

Write-Step 'Desinstalando sistema-cerebro-agentes'

# 1. MCP en Claude Code
$removeResult = Invoke-Cli 'claude' @('mcp', 'remove', 'opencode', '--scope', 'user')
if ($removeResult.Code -eq 0) { Write-Ok 'MCP opencode eliminado de Claude Code' }
else { Write-Warn 'El MCP opencode no estaba registrado (o no se pudo eliminar)' }

# 1b. Servidor y lanzador
$sysDir = Join-Path $UserHome '.sistema-cerebro-agentes'
$srvScript = Join-Path $sysDir 'servidor.ps1'
if (Test-Path -LiteralPath $srvScript) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $srvScript -Stop 2>$null | Out-Null
  Write-Ok 'Servidor V1 detenido'
}
foreach ($f in @('launcher.ps1', 'servidor.ps1')) {
  $p = Join-Path $sysDir $f
  if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Force; Write-Ok "Eliminado: $p" }
}

# 2. Bloque gestionado en CLAUDE.md
$claudeMd = Join-Path $UserHome '.claude\CLAUDE.md'
if ((Test-Path -LiteralPath $claudeMd) -and ([System.IO.File]::ReadAllText($claudeMd).Contains($MarkerBegin))) {
  Backup-Item $claudeMd
  $existing = [System.IO.File]::ReadAllText($claudeMd)
  $pattern  = [regex]::Escape($MarkerBegin) + '(?s).*?' + [regex]::Escape($MarkerEnd)
  $updated  = [regex]::Replace($existing, $pattern, '')
  $updated  = [regex]::Replace($updated, '(\r?\n){3,}', "`r`n`r`n").Trim() + "`r`n"
  [System.IO.File]::WriteAllText($claudeMd, $updated, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok 'Bloque gestionado quitado de CLAUDE.md'
} else {
  Write-Warn 'No habia bloque gestionado en CLAUDE.md'
}

# 3. Skill
$skillDst = Join-Path $UserHome '.claude\skills\delegar-a-opencode'
if (Test-Path -LiteralPath $skillDst) {
  Backup-Item $skillDst
  Remove-Item -LiteralPath $skillDst -Recurse -Force
  Write-Ok "Skill eliminada: $skillDst"
} else {
  Write-Warn 'La skill delegar-a-opencode no estaba instalada'
}

# 3b. Agente cerebro
$agentDst = Join-Path $UserHome '.claude\agents\cerebro.md'
if (Test-Path -LiteralPath $agentDst) {
  Backup-Item $agentDst
  Remove-Item -LiteralPath $agentDst -Force
  Write-Ok "Eliminado: $agentDst"
} else {
  Write-Warn 'El agente cerebro no estaba instalado'
}

foreach ($f in @('cerebro.cmd', 'cerebro')) {
  $p = Join-Path $UserHome ".local\bin\$f"
  if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Force; Write-Ok "Eliminado: $p" }
}

# 4. Agentes de OpenCode
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
foreach ($name in @('implementador.md', 'revisor.md', 'testeador.md', 'constructor.md')) {
  $p = Join-Path $agentsDst $name
  if (Test-Path -LiteralPath $p) {
    Backup-Item $p
    Remove-Item -LiteralPath $p -Force
    Write-Ok "Eliminado: $p"
  }
}

Write-Host "`nDesinstalacion completada. Copias en: $BackupDir" -ForegroundColor Cyan
