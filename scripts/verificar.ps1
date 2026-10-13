#Requires -Version 5.1
<#
.SYNOPSIS
  Verificación completa de sistema-cerebro-agentes (Windows).

.DESCRIPTION
  Comprueba prerrequisitos, conexión de proveedores, MCP registrado en Claude Code,
  rol Cerebro, skill y agentes. Con -Smoke ejecuta además el smoke test real del MCP
  (arranque por stdio + llamada a opencode_status); con -Ask añade una inferencia real.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke
#>
[CmdletBinding()]
param(
  [switch]$Smoke,
  [switch]$Ask
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$UserHome = $env:USERPROFILE

$script:pass = 0
$script:fail = 0

function Test-Item([bool]$Ok, [string]$Label, [string]$Hint = '') {
  if ($Ok) { Write-Host "  [OK]   $Label" -ForegroundColor Green; $script:pass++ }
  else {
    Write-Host "  [X]    $Label" -ForegroundColor Red
    if ($Hint) { Write-Host "         -> $Hint" -ForegroundColor DarkGray }
    $script:fail++
  }
}
function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

Write-Host 'Verificacion de sistema-cerebro-agentes' -ForegroundColor White

Write-Step 'Prerrequisitos'
if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeVer  = (& node --version).Trim().TrimStart('v')
  $nodeMain = [int]($nodeVer.Split('.')[0])
  Test-Item ($nodeMain -ge 22) "Node v$nodeVer" 'Instala Node.js 22 o superior: https://nodejs.org'
} else { Test-Item $false 'Node.js no encontrado' 'Instala Node.js 22 o superior: https://nodejs.org' }

Test-Item ([bool](Get-Command opencode -ErrorAction SilentlyContinue)) 'OpenCode instalado' 'https://opencode.ai  (npm: npm install -g @opencode/cli)'
Test-Item ([bool](Get-Command claude -ErrorAction SilentlyContinue)) 'Claude Code instalado' 'https://claude.com/claude-code'
if (Get-Command docker -ErrorAction SilentlyContinue) { Write-Host '  [OK]   Docker disponible (hub + Laya)' -ForegroundColor Green; $script:pass++ }
else { Write-Host '  [!]    Docker no encontrado (el hub nativo sigue funcionando; Laya no estara disponible)' -ForegroundColor Yellow }

Write-Step 'Proveedores (OpenCode)'
$authPath = Join-Path $UserHome '.local\share\opencode\auth.json'
$authProviders = @()
if (Test-Path -LiteralPath $authPath) {
  try { $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json; $authProviders = @($auth.PSObject.Properties.Name) } catch { }
}
Test-Item ($authProviders -contains 'deepseek') 'Proveedor DeepSeek (oficial) conectado' "Conecta DeepSeek: 'opencode auth login' (o /connect en la TUI)"
if ($authProviders -contains 'openrouter') { Write-Host '  [!]    OpenRouter sigue conectado (el sistema no lo usa)' -ForegroundColor Yellow }

Write-Step 'Servidor OpenCode V1'
$sysDir = Join-Path $UserHome '.sistema-cerebro-agentes'
$srvExe = Join-Path $sysDir 'server\node_modules\opencode-ai\bin\opencode.exe'
Test-Item (Test-Path -LiteralPath $srvExe) 'opencode-ai (servidor V1) instalado' 'Ejecuta install.ps1'
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'launcher.ps1')) 'Lanzador del MCP instalado' 'Ejecuta install.ps1'
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'panel.ps1')) 'Lanzador del panel web instalado' 'Ejecuta install.ps1'
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'web\servidor-web.mjs')) 'Panel web instalado' 'Ejecuta install.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sysDir 'servidor.ps1') 2>$null | Out-Null
$srvPort = 0
$portFile = Join-Path $sysDir 'server-port.txt'
if (Test-Path -LiteralPath $portFile) { [void][int]::TryParse((Get-Content -LiteralPath $portFile -Raw).Trim(), [ref]$srvPort) }
$srvOk = $false
if ($srvPort -gt 0) {
  try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$srvPort/config" -UseBasicParsing -TimeoutSec 4; $srvOk = $true } catch { }
}
Test-Item $srvOk "Servidor V1 responde en 127.0.0.1:$srvPort" 'Relanza: powershell -File ~/.sistema-cerebro-agentes/servidor.ps1'

Write-Step 'Rol Cerebro (Claude Code)'
$claudeMd = Join-Path $UserHome '.claude\CLAUDE.md'
$hasBlock = (Test-Path -LiteralPath $claudeMd) -and ([System.IO.File]::ReadAllText($claudeMd).Contains('<!-- BEGIN sistema-cerebro-agentes -->'))
Test-Item $hasBlock 'Bloque gestionado en ~/.claude/CLAUDE.md' 'Ejecuta install.ps1'
$skillOk = Test-Path -LiteralPath (Join-Path $UserHome '.claude\skills\delegar-a-opencode\SKILL.md')
Test-Item $skillOk 'Skill delegar-a-opencode instalada' 'Ejecuta install.ps1'

Write-Step 'Agentes de OpenCode'
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
foreach ($name in @('cerebro-oc.md', 'implementador.md', 'debugger.md', 'revisor.md', 'testeador.md', 'explorador-ds.md', 'redactor-ds.md', 'local.md')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $agentsDst $name)) "Agente $name" 'Ejecuta install.ps1'
}

Write-Step 'Cerebro Hub, hooks y triaje'
$hubPort = 0
$hubPortFile = Join-Path $sysDir 'hub-port.txt'
if (Test-Path -LiteralPath $hubPortFile) { [void][int]::TryParse((Get-Content -LiteralPath $hubPortFile -Raw).Trim(), [ref]$hubPort) }
if ($hubPort -le 0) {
  # El hub puede estar en Docker (compose publica 127.0.0.1:4597) aunque no exista hub-port.txt
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4597/api/salud' -UseBasicParsing -TimeoutSec 3
    if ($r.Content -match 'cerebro-hub') { $hubPort = 4597 }
  } catch { }
}
$hubOk = $false
$layaOk = $false
if ($hubPort -gt 0) {
  try {
    $salud = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/salud" -TimeoutSec 4
    $hubOk = ($salud.app -eq 'cerebro-hub')
    $layaOk = ($salud.laya -eq $true)
  } catch { }
}
Test-Item $hubOk "Cerebro Hub responde en 127.0.0.1:$hubPort" 'Arranca: powershell -File ~/.sistema-cerebro-agentes/hub.ps1 (o docker compose up -d)'
if ($hubOk) {
  Test-Item $layaOk 'Laya disponible para el triaje' 'Levanta el stack Docker: ~/.sistema-cerebro-agentes/docker/gestion.ps1 up'
}
foreach ($f in @('session-start.mjs', 'pre-compact.mjs', 'session-end.mjs', 'estado.mjs')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $sysDir "hooks\$f")) "Hook $f instalado" 'Ejecuta install.ps1'
}
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'mcp\triaje-mcp.mjs')) 'MCP de triaje instalado' 'Ejecuta install.ps1'
$settingsPath = Join-Path $UserHome '.claude\settings.json'
$setTxt = if (Test-Path -LiteralPath $settingsPath) { [System.IO.File]::ReadAllText($settingsPath) } else { '' }
Test-Item ($setTxt -match 'session-start\.mjs') 'Hooks registrados en settings.json' 'Ejecuta install.ps1'
Test-Item ($setTxt -match 'claude-haiku-5-5') 'modelSettings de Haiku 5.5 configurado' 'Ejecuta install.ps1'
$autoTarea = $false
try { & schtasks /Query /TN 'Cerebro Hub' *> $null; $autoTarea = ($LASTEXITCODE -eq 0) } catch { $autoTarea = $false }
$autoInicio = Test-Path -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\cerebro-hub.cmd')
Test-Item ($autoTarea -or $autoInicio) 'Autoarranque del hub configurado (tarea o carpeta de Inicio)' 'Ejecuta install.ps1'

Write-Step 'Agente cerebro en Claude Code'
foreach ($f in @('cerebro.md', 'subdirector.md', 'explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $UserHome ".claude\agents\$f")) "Subagente $f instalado" 'Ejecuta install.ps1'
}
$agentDst = Join-Path $UserHome '.claude\agents\cerebro.md'
if (Test-Path -LiteralPath $agentDst) {
  $agentTxt = [System.IO.File]::ReadAllText($agentDst)
  Test-Item (-not $agentTxt.Contains('__COMANDO__')) 'Agente cerebro templado (sin placeholders)' 'Ejecuta install.ps1 de nuevo'
  Test-Item ($agentTxt.Contains('mcpServers') -and $agentTxt.Contains('launcher.ps1') -and $agentTxt.Contains('triaje-mcp.mjs')) 'MCPs inline dentro del agente (opencode + triaje)' 'Ejecuta install.ps1 de nuevo'
}
Test-Item (Test-Path -LiteralPath (Join-Path $UserHome '.local\bin\cerebro.cmd')) 'Comando cerebro instalado (~/.local/bin)' 'Ejecuta install.ps1'
$mcpList = (& claude mcp list 2>&1 | Out-String)
$globalLine = ($mcpList -split "`n" | Where-Object { $_ -match '^\s*opencode:' } | Select-Object -First 1)
Test-Item (-not $globalLine) 'MCP no registrado globalmente (solo dentro del agente)' 'Retiralo: claude mcp remove opencode --scope user'

if ($Smoke) {
  Write-Step 'Smoke test del MCP (arranque real por stdio)'
  $smokeScript = Join-Path $RepoRoot 'scripts\smoke-mcp.mjs'
  $smokeArgs = @($smokeScript)
  if ($Ask) { $smokeArgs += '--ask' }
  & node @smokeArgs
  Test-Item ($LASTEXITCODE -eq 0) 'Smoke test del MCP' 'Revisa la salida de arriba'
}

Write-Step 'Resultado'
Write-Host "  Aprobadas: $script:pass   Fallidas: $script:fail" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
