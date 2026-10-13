#Requires -Version 5.1
<#
.SYNOPSIS
  Lanzador del MCP opencode-mcp para Claude Code (sistema Cerebro → OpenCode).

.DESCRIPTION
  1. Asegura el servidor OpenCode V1 (servidor.ps1; puerto dinámico desde 4599,
     guardado en server-port.txt).
  2. Arranca opencode-mcp por stdio, conectado a ese servidor.

  Este es el comando que Claude Code ejecuta para el MCP "opencode".
  Se instala en ~/.sistema-cerebro-agentes/launcher.ps1.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'servidor.ps1') | Out-Null

$port = 4599
$portFile = Join-Path $Root 'server-port.txt'
if (Test-Path -LiteralPath $portFile) {
  $raw = (Get-Content -LiteralPath $portFile -Raw).Trim()
  $parsed = 0
  if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0) { $port = $parsed }
}

if (-not $env:OPENCODE_BASE_URL)         { $env:OPENCODE_BASE_URL = "http://127.0.0.1:$port" }
if (-not $env:OPENCODE_TOOL_PROFILE)     { $env:OPENCODE_TOOL_PROFILE = 'essential' }
if (-not $env:OPENCODE_DEFAULT_PROVIDER) { $env:OPENCODE_DEFAULT_PROVIDER = 'deepseek' }
if (-not $env:OPENCODE_DEFAULT_MODEL)    { $env:OPENCODE_DEFAULT_MODEL = 'deepseek-flash' }
Remove-Item Env:OPENCODE_AUTO_SERVE -ErrorAction SilentlyContinue

& npx -y opencode-mcp
exit $LASTEXITCODE
