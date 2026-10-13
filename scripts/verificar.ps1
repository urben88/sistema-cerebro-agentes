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
$hasOpenRouter = $false
if (Test-Path -LiteralPath $authPath) {
  try {
    $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
    $hasOpenRouter = @($auth.PSObject.Properties.Name) -contains 'openrouter'
  } catch { }
}
Test-Item $hasOpenRouter 'OpenRouter conectado' "Conecta OpenRouter: 'opencode auth login' (o /connect en la TUI)"

Write-Step 'Rol Cerebro (Claude Code)'
$claudeMd = Join-Path $UserHome '.claude\CLAUDE.md'
$hasBlock = (Test-Path -LiteralPath $claudeMd) -and ([System.IO.File]::ReadAllText($claudeMd).Contains('<!-- BEGIN sistema-cerebro-agentes -->'))
Test-Item $hasBlock 'Bloque gestionado en ~/.claude/CLAUDE.md' 'Ejecuta install.ps1'
$skillOk = Test-Path -LiteralPath (Join-Path $UserHome '.claude\skills\delegar-a-opencode\SKILL.md')
Test-Item $skillOk 'Skill delegar-a-opencode instalada' 'Ejecuta install.ps1'

Write-Step 'Agentes de OpenCode'
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
foreach ($name in @('constructor.md', 'revisor.md', 'testeador.md')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $agentsDst $name)) "Agente $name" 'Ejecuta install.ps1'
}

Write-Step 'MCP opencode en Claude Code'
$mcpList = (& claude mcp list 2>&1 | Out-String)
$line = ($mcpList -split "`n" | Where-Object { $_ -match '^\s*opencode:' } | Select-Object -First 1)
if ($line) {
  $trimmed = $line.Trim()
  Test-Item ($trimmed -match 'Connected') "Registrado: $trimmed" 'Reinicia Claude Code; si sigue mal, ejecuta install.ps1 de nuevo'
} else {
  Test-Item $false 'MCP opencode no registrado' 'Ejecuta install.ps1'
}

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
