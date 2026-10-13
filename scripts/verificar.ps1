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

Write-Step 'Proveedores (OpenCode)'
$authPath = Join-Path $UserHome '.local\share\opencode\auth.json'
$authProviders = @()
if (Test-Path -LiteralPath $authPath) {
  try { $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json; $authProviders = @($auth.PSObject.Properties.Name) } catch { }
}
Test-Item ($authProviders -contains 'deepseek') 'Proveedor DeepSeek (oficial) conectado' "Conecta DeepSeek: 'opencode auth login' (o /connect en la TUI)"
if ($authProviders -contains 'openrouter') {
  Write-Host '  [OK]   OpenRouter tambien conectado (opcional)' -ForegroundColor Green
  $script:pass++
}

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
foreach ($name in @('implementador.md', 'revisor.md', 'testeador.md')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $agentsDst $name)) "Agente $name" 'Ejecuta install.ps1'
}

Write-Step 'Agente cerebro en Claude Code'
$agentDst = Join-Path $UserHome '.claude\agents\cerebro.md'
$agentOk = Test-Path -LiteralPath $agentDst
Test-Item $agentOk 'Agente cerebro instalado (~/.claude/agents/cerebro.md)' 'Ejecuta install.ps1'
if ($agentOk) {
  $agentTxt = [System.IO.File]::ReadAllText($agentDst)
  Test-Item (-not $agentTxt.Contains('__COMANDO__')) 'Agente templado (ruta del lanzador aplicada)' 'Ejecuta install.ps1 de nuevo'
  Test-Item ($agentTxt.Contains('mcpServers') -and $agentTxt.Contains('launcher.ps1')) 'El MCP va inline dentro del agente' 'Ejecuta install.ps1 de nuevo'
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
