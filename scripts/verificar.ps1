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
if (Get-Command docker -ErrorAction SilentlyContinue) { Write-Host '  [OK]   Docker disponible (hub en contenedor)' -ForegroundColor Green; $script:pass++ }
else { Write-Host '  [!]    Docker no encontrado (el hub nativo sigue funcionando)' -ForegroundColor Yellow }

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

Write-Step 'Gentle AI y ODD (spec 20 y 21)'
$versionGentle = '4.3.1'
$gentleExe = $null
$gc = Get-Command gentle-ai -ErrorAction SilentlyContinue
if ($gc) { $gentleExe = $gc.Source }
elseif (Test-Path -LiteralPath (Join-Path $UserHome 'go\bin\gentle-ai.exe')) { $gentleExe = Join-Path $UserHome 'go\bin\gentle-ai.exe' }
Test-Item ([bool]$gentleExe) 'gentle-ai instalado' "Ejecuta install.ps1 (necesita Go: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$versionGentle)"
if ($gentleExe) {
  $gvOut = (& $gentleExe version 2>&1 | Out-String)
  $gv = if ($gvOut -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { '' }
  Test-Item ($gv -eq $versionGentle) "gentle-ai en la version fijada ($versionGentle; instalada: $gv)" "Instala la fijada: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$versionGentle"
}
$cmTxt = if (Test-Path -LiteralPath $claudeMd) { [System.IO.File]::ReadAllText($claudeMd) } else { '' }
Test-Item ($cmTxt -match '<!-- gentle-ai:') 'Bloques gentle-ai:* en ~/.claude/CLAUDE.md' 'Ejecuta install.ps1'
$bloqueNuestro = [regex]::Match($cmTxt, '(?s)<!-- BEGIN sistema-cerebro-agentes -->.*?<!-- END sistema-cerebro-agentes -->').Value
Test-Item (($bloqueNuestro.Length -gt 0) -and ($bloqueNuestro -notmatch '(?i)laya')) 'Nuestro bloque de CLAUDE.md no menciona Laya' 'Ejecuta install.ps1 para actualizar el bloque'
Test-Item (Test-Path -LiteralPath (Join-Path $UserHome '.claude\gentle-ai\orchestrator')) 'Orquestador modular de Gentle AI (~/.claude/gentle-ai/orchestrator)' 'Ejecuta install.ps1 (usa --claude-orchestrator-modules)'
$oddOk = $true
foreach ($c in @('start', 'plan', 'implement', 'verify', 'review', 'status', 'handoff')) {
  if (-not (Test-Path -LiteralPath (Join-Path $UserHome ".claude\commands\odd\$c.md"))) { $oddOk = $false }
}
Test-Item $oddOk 'Comandos /odd:* instalados (~/.claude/commands/odd)' 'Ejecuta install.ps1'
$setPerm = Join-Path $UserHome '.claude\settings.json'
$setPermTxt = if (Test-Path -LiteralPath $setPerm) { [System.IO.File]::ReadAllText($setPerm) } else { '' }
Test-Item (($setPermTxt -match 'Read\(~/\.claude/\.credentials\.json\)') -and ($setPermTxt -match 'Bash\(git push:\*\)')) 'Permisos prudentes en settings.json (deny credenciales, ask git push)' 'Ejecuta install.ps1'
$ocCfgTxt = ''
foreach ($n in @('opencode.jsonc', 'opencode.json')) {
  $pc = Join-Path $UserHome ".config\opencode\$n"
  if (Test-Path -LiteralPath $pc) { $ocCfgTxt += [System.IO.File]::ReadAllText($pc) }
}
# Se mira donde lo lee OpenCode (opencode mcp list, solo lectura), no solo el texto del archivo.
$ocMcp = if (Get-Command opencode -ErrorAction SilentlyContinue) { (& opencode mcp list 2>&1 | Out-String) } else { '' }
Test-Item ($ocMcp -match 'engram\s+connected') 'engram conectado en OpenCode (opencode mcp list)' 'Ejecuta install.ps1 (gentle-ai install --agents claude-code,opencode) y revisa: opencode mcp list'
if ($ocCfgTxt -match '"default_agent"\s*:\s*"([^"]*)"') {
  Test-Item ($Matches[1] -eq 'cerebro-oc') "default_agent de OpenCode es cerebro-oc (ahora: $($Matches[1]))" 'Ejecuta install.ps1 (o node config/claude/agente-defecto.mjs)'
}

Write-Step 'Agentes de OpenCode'
$agentsDst = Join-Path $UserHome '.config\opencode\agents'
foreach ($name in @('cerebro-oc.md', 'implementador.md', 'debugger.md', 'revisor.md', 'testeador.md', 'explorador-ds.md', 'redactor-ds.md', 'planificador.md', 'local.md')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $agentsDst $name)) "Agente $name" 'Ejecuta install.ps1'
}

Write-Step 'Cerebro Hub, hooks y trabajos'
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
if ($hubPort -gt 0) {
  try {
    $salud = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/salud" -TimeoutSec 4
    $hubOk = ($salud.app -eq 'cerebro-hub')
  } catch { }
}
Test-Item $hubOk "Cerebro Hub responde en 127.0.0.1:$hubPort" 'Arranca: powershell -File ~/.sistema-cerebro-agentes/hub.ps1 (o docker compose up -d)'
if ($hubOk) {
  $actOk = $false
  try {
    $act = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/actividad" -TimeoutSec 4
    $actOk = ($null -ne $act.proyectos)
  } catch { $actOk = $false }
  Test-Item $actOk 'GET /api/actividad devuelve proyectos' 'Revisa hub.mjs (R1 de la spec del panel)'
  $latOk = $false
  try {
    $cuerpo = @{ cwd = $RepoRoot; sesion = 'verificar'; evento = 'SubagentStart'; agente = 'verificar' } | ConvertTo-Json
    $lat = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/latido" -Method Post -ContentType 'application/json' -Body $cuerpo -TimeoutSec 4
    $latOk = ($lat.ok -eq $true)
  } catch { $latOk = $false }
  Test-Item $latOk 'POST /api/latido acepta un latido' 'Revisa hub.mjs (R3 de la spec del panel)'
  $vivoOk = $false
  try {
    $vv = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/vivo" -TimeoutSec 4
    $vivoOk = ($vv.ok -eq $true)
  } catch { $vivoOk = $false }
  Test-Item $vivoOk 'GET /api/vivo responde (vista viva)' 'Revisa hub.mjs / lib/vivo.mjs (spec 05)'
  $claudeOk = $false
  try {
    $ce = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/claude/estado" -TimeoutSec 4
    $claudeOk = ($ce.ok -eq $true)
  } catch { $claudeOk = $false }
  Test-Item $claudeOk 'GET /api/claude/estado responde (contexto real)' 'Revisa hub.mjs / estado-linea.mjs'
  $logsOk = $false
  try {
    $lg = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/logs?limite=5" -TimeoutSec 4
    $logsOk = ($lg.ok -eq $true -and $null -ne $lg.errores)
  } catch { $logsOk = $false }
  Test-Item $logsOk 'GET /api/logs responde (registro de errores)' 'Revisa hub.mjs / lib/errores-log.mjs'
  $latidosOk = $false
  try {
    $lt = Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/latidos" -TimeoutSec 4
    $latidosOk = ($lt.ok -eq $true)
  } catch { $latidosOk = $false }
  Test-Item $latidosOk 'GET /api/latidos responde (subagentes en vivo)' 'Revisa hub.mjs / latido.mjs'
  Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'hub\errores.mjs')) 'CLI de errores instalada (hub/errores.mjs)' 'Ejecuta install.ps1'
}
foreach ($f in @('session-start.mjs', 'pre-compact.mjs', 'session-end.mjs', 'cerrar-trabajos.mjs', 'estado.mjs', 'latido.mjs', 'sonido-fin.mjs', 'doctor.mjs', 'aviso-contexto.mjs', 'errores-repetidos.mjs', 'ultima-sesion.mjs', 'resumir-sesion.mjs', 'hallazgos.mjs', 'buscar.mjs')) {
  Test-Item (Test-Path -LiteralPath (Join-Path $sysDir "hooks\$f")) "Hook $f instalado" 'Ejecuta install.ps1'
}
$hookLatido = Join-Path $sysDir 'hooks\latido.mjs'
if (Test-Path -LiteralPath $hookLatido) {
  $prevHubUrl = $env:HUB_URL
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $env:HUB_URL = 'http://127.0.0.1:1'
    '{"hook_event_name":"SubagentStart","cwd":"."}' | & node $hookLatido 2>$null | Out-Null
    $hookCode = $LASTEXITCODE
  } catch { $hookCode = 1 }
  $sw.Stop()
  if ($null -eq $prevHubUrl) { Remove-Item Env:\HUB_URL -ErrorAction SilentlyContinue } else { $env:HUB_URL = $prevHubUrl }
  $seg = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  Test-Item (($hookCode -eq 0) -and ($sw.Elapsed.TotalSeconds -lt 2)) "Hook latido no bloquea con el hub caído ($seg s)" 'Revisa config/hooks/latido.mjs'
}
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'mcp\triaje-mcp.mjs')) 'MCP de trabajos instalado' 'Ejecuta install.ps1'
Test-Item (Test-Path -LiteralPath (Join-Path $sysDir 'mods\mesa-de-trabajo\hooks\register.js')) 'Mod «mesa de trabajo» instalado' 'Ejecuta install.ps1'
$triajeTxt = ''
$triajePath = Join-Path $sysDir 'mcp\triaje-mcp.mjs'
if (Test-Path -LiteralPath $triajePath) { $triajeTxt = [System.IO.File]::ReadAllText($triajePath) }
Test-Item ($triajeTxt.Contains('trabajo_estado')) 'MCP de trabajos con trabajo_estado (visibilidad)' 'Ejecuta install.ps1'
$estadoLinea = Join-Path $sysDir 'hub\estado-linea.mjs'
Test-Item (Test-Path -LiteralPath $estadoLinea) 'Barra de estado instalada (hub/estado-linea.mjs)' 'Ejecuta install.ps1'
if (Test-Path -LiteralPath $estadoLinea) {
  $entrada = '{"workspace":{"current_dir":"' + ($RepoRoot.Replace('\', '\\')) + '"},"model":{"display_name":"Test"},"context_window":{"used_percentage":42}}'
  $salidaEstado = ''
  try { $salidaEstado = ($entrada | & node $estadoLinea 2>$null | Out-String) } catch { $salidaEstado = '' }
  Test-Item ($salidaEstado.Contains('Test')) 'La barra de estado responde' 'Revisa config/hub/estado-linea.mjs'
}
$pararTodo = Join-Path $sysDir 'hub\parar-todo.mjs'
Test-Item (Test-Path -LiteralPath $pararTodo) 'Parada de emergencia instalada (hub/parar-todo.mjs)' 'Ejecuta install.ps1'
if (Test-Path -LiteralPath $pararTodo) {
  $salidaParar = ''
  try { $salidaParar = (& node $pararTodo --seco 2>$null | Out-String) } catch { $salidaParar = '' }
  Test-Item (($LASTEXITCODE -eq 0) -and ($salidaParar -match 'Trabajos|No hab')) 'La parada de emergencia responde (modo seco)' 'Revisa config/hub/parar-todo.mjs'
}
Test-Item (Test-Path -LiteralPath (Join-Path $UserHome '.local\bin\cerebro-parar.cmd')) 'Comando cerebro-parar instalado (~/.local/bin)' 'Ejecuta install.ps1'
$settingsPath = Join-Path $UserHome '.claude\settings.json'
$setTxt = if (Test-Path -LiteralPath $settingsPath) { [System.IO.File]::ReadAllText($settingsPath) } else { '' }
Test-Item ($setTxt -match 'session-start\.mjs') 'Hooks registrados en settings.json' 'Ejecuta install.ps1'
Test-Item ($setTxt -match 'claude-haiku-5-5') 'modelSettings de Haiku 5.5 configurado' 'Ejecuta install.ps1'
Test-Item ($setTxt -match 'estado-linea\.mjs|hud\.(mjs|cmd)') 'Barra de estado registrada en settings.json' 'Ejecuta install.ps1 (o quita tu statusLine propia)'
Test-Item ($setTxt -match 'cerrar-trabajos\.mjs') 'Apagado de trabajos registrado al cerrar sesion' 'Ejecuta install.ps1'
Test-Item ($setTxt -match 'mesa-de-trabajo') 'Mod cargado en settings (CLAUDE_CODE_PLUGIN_DIRS)' 'Ejecuta install.ps1'
$autoTarea = $false
try { & schtasks /Query /TN 'Cerebro Hub' *> $null; $autoTarea = ($LASTEXITCODE -eq 0) } catch { $autoTarea = $false }
$autoInicio = Test-Path -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\cerebro-hub.cmd')
Test-Item ($autoTarea -or $autoInicio) 'Autoarranque del hub configurado (tarea o carpeta de Inicio)' 'Ejecuta install.ps1'

Write-Step 'Agente cerebro en Claude Code'
foreach ($f in @('cerebro.md', 'subdirector.md', 'explorador.md', 'redactor.md', 'analista.md', 'arquitecto.md', 'adaptador-mcps.md', 'planificador.md', 'resolutor.md', 'ayudante.md', 'retocador.md', 'consultor.md')) {
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

Write-Step 'Búsqueda de memoria (R1 · spec 10)'
$buscarPruebas = Join-Path $RepoRoot 'scripts\test-buscar.mjs'
& node $buscarPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de búsqueda (FTS5, o fallback si no hay FTS5)' 'Ejecuta: node scripts\test-buscar.mjs'

Write-Step 'Nudges de memoria (R2 · spec 10)'
$nudgesPruebas = Join-Path $RepoRoot 'scripts\test-nudges.mjs'
& node $nudgesPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de nudges y límites de memoria' 'Ejecuta: node scripts\test-nudges.mjs'

Write-Step 'Sonido y doctor (spec 22)'
$s22 = Join-Path $RepoRoot 'scripts\test-sonido.mjs'
& node $s22 | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas del sonido al terminar' 'Ejecuta: node scripts\test-sonido.mjs'
$s22d = Join-Path $RepoRoot 'scripts\test-doctor.mjs'
& node $s22d | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de /odd:doctor' 'Ejecuta: node scripts\test-doctor.mjs'

Write-Step 'Engram junto al hub (spec 23)'
$ev = try { (& engram version 2>&1 | Out-String) } catch { '' }
Test-Item ($ev -match 'engram') 'Engram responde en Claude Code (engram version)' 'Ejecuta install.ps1 (gentle-ai install) y revisa el PATH'
$s23 = Join-Path $RepoRoot 'scripts\test-engram.mjs'
& node $s23 | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de Engram junto al hub' 'Ejecuta: node scripts\test-engram.mjs'

Write-Step 'Ledger de trabajos (R3 · spec 10)'
$ledgerPruebas = Join-Path $RepoRoot 'scripts\test-ledger.mjs'
& node $ledgerPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas del ledger de trabajos (reconciliación, atasco, retención)' 'Ejecuta: node scripts\test-ledger.mjs'

Write-Step 'Aprobaciones por niveles (R4 · spec 10)'
$aprobPruebas = Join-Path $RepoRoot 'scripts\test-aprobaciones.mjs'
& node $aprobPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de aprobaciones (niveles, allowlist con merge, pendientes)' 'Ejecuta: node scripts\test-aprobaciones.mjs'

Write-Step 'Skills autogenerados (R5 · spec 10)'
$skillsPruebas = Join-Path $RepoRoot 'scripts\test-skills.mjs'
& node $skillsPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de skills (linter, guard, propuesta→aprobación, uso)' 'Ejecuta: node scripts\test-skills.mjs'

Write-Step 'Cron y tareas programadas (R6 · spec 10)'
$cronPruebas = Join-Path $RepoRoot 'scripts\test-cron.mjs'
& node $cronPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de cron (parser, siguiente, claim, preflight, reintentos)' 'Ejecuta: node scripts\test-cron.mjs'

Write-Step 'Resumen propio de contexto (R7 · spec 10)'
$compresionPruebas = Join-Path $RepoRoot 'scripts\test-compresion.mjs'
& node $compresionPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de compresión (troceo, poda, verbatim, fallback, episódica)' 'Ejecuta: node scripts\test-compresion.mjs'

Write-Step 'Métricas de uso (spec 11)'
$metricasPruebas = Join-Path $RepoRoot 'scripts\test-metricas.mjs'
& node $metricasPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de métricas (JSONL, saneo, rotación, poda, job idempotente)' 'Ejecuta: node scripts\test-metricas.mjs'

Write-Step 'Agente local-codigo y su respaldo (spec 12)'
$saludPruebas = Join-Path $RepoRoot 'scripts\test-salud-agentes.mjs'
& node $saludPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de salud de agentes (degradación, reintento, código acotado)' 'Ejecuta: node scripts\test-salud-agentes.mjs'

Write-Step 'Guía de uso de MCPs (spec 13)'
$guiaPruebas = Join-Path $RepoRoot 'scripts\test-mcps-guia.mjs'
& node $guiaPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de la guía de MCPs (copia sin pisar, --forzar-guia, MCPS.md idéntico, resumen)' 'Ejecuta: node scripts\test-mcps-guia.mjs'

Write-Step 'Comunicación entre agentes y reparto (spec 14)'
$a2aPruebas = Join-Path $RepoRoot 'scripts\test-a2a.mjs'
& node $a2aPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de A2A-lite (directorio, consulta, buzón, triaje, reparto)' 'Ejecuta: node scripts\test-a2a.mjs'

Write-Step 'Barra de estado: modo normal vs cerebro'
$modoPruebas = Join-Path $RepoRoot 'scripts\test-modo.mjs'
& node $modoPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas del modo normal/cerebro en la barra de estado' 'Ejecuta: node scripts\test-modo.mjs'

Write-Step 'Opus dirige y configurar-claude (spec 15)'
$opusPruebas = Join-Path $RepoRoot 'scripts\test-opus-reparto.mjs'
& node $opusPruebas | Out-Null
Test-Item ($LASTEXITCODE -eq 0) 'Pruebas de la spec 15 (reparto Opus/Sonnet/Haiku, aviso en consola, nota de última sesión)' 'Ejecuta: node scripts\test-opus-reparto.mjs'

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
