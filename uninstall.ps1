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

# 3c. Subagentes de Claude
foreach ($f in @('subdirector.md', 'explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md', 'adaptador-mcps.md', 'planificador.md')) {
  $p = Join-Path $UserHome ".claude\agents\$f"
  if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Force; Write-Ok "Eliminado: $p" }
}

# 3d. Hub, hooks y MCP de triaje
$hubLauncher = Join-Path $sysDir 'hub.ps1'
if (Test-Path -LiteralPath $hubLauncher) { & powershell -NoProfile -ExecutionPolicy Bypass -File $hubLauncher -Stop 2>$null | Out-Null }
foreach ($f in @('hub.ps1', 'hub.sh', 'hub', 'hooks', 'mcp')) {
  $p = Join-Path $sysDir $f
  if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Recurse -Force; Write-Ok "Eliminado: $p" }
}

# 3e. Docker y autoarranque
$sch = Invoke-Cli 'schtasks' @('/Delete', '/TN', 'Cerebro Hub', '/F')
if ($sch.Code -eq 0) { Write-Ok 'Tarea de autoarranque eliminada' }
$arranque = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\cerebro-hub.cmd'
if (Test-Path -LiteralPath $arranque) { Backup-Item $arranque; Remove-Item -LiteralPath $arranque -Force; Write-Ok 'Autoarranque (carpeta de Inicio) retirado' }
$compose = Join-Path $sysDir 'docker\docker-compose.yml'
if (Test-Path -LiteralPath $compose) {
  Invoke-Cli 'docker' @('compose', '-f', $compose, 'down') | Out-Null
  Write-Ok 'Contenedores del hub detenidos (la memoria de hub-data se conserva)'
}
$p = Join-Path $sysDir 'docker'
if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Recurse -Force; Write-Ok "Eliminado: $p" }

# 3f. Hooks del sistema en settings.json
$settingsPath = Join-Path $UserHome '.claude\settings.json'
if (Test-Path -LiteralPath $settingsPath) {
  Backup-Item $settingsPath
  $js = 'const fs=require("fs");const p=process.argv[2];let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{};if(s.hooks){for(const ev of Object.keys(s.hooks)){const arr=s.hooks[ev];if(Array.isArray(arr)){s.hooks[ev]=arr.filter(g=>!(g&&Array.isArray(g.hooks)&&g.hooks.some(h=>String(h.command||"").includes("sistema-cerebro-agentes"))));if(!s.hooks[ev].length)delete s.hooks[ev]}}if(!Object.keys(s.hooks).length)delete s.hooks}if(s.statusLine&&typeof s.statusLine.command==="string"&&s.statusLine.command.includes("estado-linea.mjs"))delete s.statusLine;fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")'
  $tmp = Join-Path $env:TEMP 'quitar-hooks-sistema.cjs'
  [System.IO.File]::WriteAllText($tmp, $js, (New-Object System.Text.UTF8Encoding($false)))
  Invoke-Cli 'node' @($tmp, $settingsPath) | Out-Null
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  Write-Ok 'Hooks del sistema retirados de settings.json (los demas ajustes se conservan)'
}

foreach ($f in @('cerebro.cmd', 'cerebro')) {
  $p = Join-Path $UserHome ".local\bin\$f"
  if (Test-Path -LiteralPath $p) { Backup-Item $p; Remove-Item -LiteralPath $p -Force; Write-Ok "Eliminado: $p" }
}

# 4. Agentes de OpenCode
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
foreach ($name in @('implementador.md', 'revisor.md', 'testeador.md', 'constructor.md', 'cerebro-oc.md', 'debugger.md', 'explorador-ds.md', 'redactor-ds.md', 'planificador.md', 'local.md')) {
  $p = Join-Path $agentsDst $name
  if (Test-Path -LiteralPath $p) {
    Backup-Item $p
    Remove-Item -LiteralPath $p -Force
    Write-Ok "Eliminado: $p"
  }
}

Write-Host "`nDesinstalacion completada. Copias en: $BackupDir" -ForegroundColor Cyan
