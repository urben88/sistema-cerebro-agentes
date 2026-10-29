#!/usr/bin/env bash
# Verificación completa de sistema-cerebro-agentes (macOS / Linux)
# Uso: bash scripts/verificar.sh [--smoke] [--ask]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SMOKE=0; ASK=0
for arg in "$@"; do
  case "$arg" in
    --smoke) SMOKE=1 ;;
    --ask) ASK=1 ;;
    *) echo "Argumento desconocido: $arg"; exit 2 ;;
  esac
done

C_OK=""; C_ERR=""; C_STEP=""; C_HINT=""; C_OFF=""
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_STEP=$'\033[36m'; C_HINT=$'\033[90m'; C_OFF=$'\033[0m'
fi
PASS=0; FAIL=0
step(){ printf '\n=== %s ===\n' "$1"; }
test_item(){
  # $1 = 0/1 ok, $2 = etiqueta, $3 = pista
  if [ "$1" -eq 0 ]; then
    printf '  %s[OK]%s   %s\n' "$C_OK" "$C_OFF" "$2"; PASS=$((PASS+1))
  else
    printf '  %s[X]%s    %s\n' "$C_ERR" "$C_OFF" "$2"; FAIL=$((FAIL+1))
    [ -n "${3:-}" ] && printf '         %s-> %s%s\n' "$C_HINT" "$3" "$C_OFF"
  fi
}

printf 'Verificación de sistema-cerebro-agentes\n'

step 'Prerrequisitos'
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$NODE_MAJOR" -ge 22 ]; then test_item 0 "Node $(node --version)"; else test_item 1 "Node $(node --version) (< 22)" 'Instala Node.js 22 o superior: https://nodejs.org'; fi
else
  test_item 1 'Node.js no encontrado' 'Instala Node.js 22 o superior: https://nodejs.org'
fi
command -v opencode >/dev/null 2>&1 && test_item 0 'OpenCode instalado' || test_item 1 'OpenCode no encontrado' 'https://opencode.ai  (npm: npm install -g @opencode/cli)'
command -v claude >/dev/null 2>&1 && test_item 0 'Claude Code instalado' || test_item 1 'Claude Code no encontrado' 'https://claude.com/claude-code'

step 'Proveedores (OpenCode)'
AUTH_JSON="$HOME/.local/share/opencode/auth.json"
if [ -f "$AUTH_JSON" ] && grep -q '"deepseek"' "$AUTH_JSON"; then
  test_item 0 'Proveedor DeepSeek (oficial) conectado'
else
  test_item 1 'DeepSeek no conectado' "Conecta DeepSeek: 'opencode auth login' (o /connect en la TUI)"
fi
if [ -f "$AUTH_JSON" ] && grep -q '"openrouter"' "$AUTH_JSON"; then
  printf '  %s[OK]%s   OpenRouter también conectado (opcional)\n' "$C_OK" "$C_OFF"; PASS=$((PASS+1))
fi

step 'Servidor OpenCode V1'
[ -x "$HOME/.sistema-cerebro-agentes/server/node_modules/.bin/opencode" ] && test_item 0 'opencode-ai (servidor V1) instalado' || test_item 1 'opencode-ai (servidor V1) no instalado' 'Ejecuta install.sh'
[ -f "$HOME/.sistema-cerebro-agentes/launcher.sh" ] && test_item 0 'Lanzador del MCP instalado' || test_item 1 'Lanzador del MCP no instalado' 'Ejecuta install.sh'
[ -f "$HOME/.sistema-cerebro-agentes/panel.sh" ] && test_item 0 'Lanzador del panel web instalado' || test_item 1 'Lanzador del panel web no instalado' 'Ejecuta install.sh'
[ -f "$HOME/.sistema-cerebro-agentes/web/servidor-web.mjs" ] && test_item 0 'Panel web instalado' || test_item 1 'Panel web no instalado' 'Ejecuta install.sh'
bash "$HOME/.sistema-cerebro-agentes/servidor.sh" >/dev/null 2>&1 || true
SRV_PORT=""
[ -f "$HOME/.sistema-cerebro-agentes/server-port.txt" ] && SRV_PORT="$(tr -d '[:space:]' < "$HOME/.sistema-cerebro-agentes/server-port.txt")"
if [ -n "$SRV_PORT" ] && curl -fsS --max-time 4 "http://127.0.0.1:$SRV_PORT/config" >/dev/null 2>&1; then
  test_item 0 "Servidor V1 responde en 127.0.0.1:$SRV_PORT"
else
  test_item 1 'Servidor V1 no responde' 'Relanza: bash ~/.sistema-cerebro-agentes/servidor.sh'
fi

step 'Rol Cerebro (Claude Code)'
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -qF '<!-- BEGIN sistema-cerebro-agentes -->' "$CLAUDE_MD"; then
  test_item 0 'Bloque gestionado en ~/.claude/CLAUDE.md'
else
  test_item 1 'Falta el bloque gestionado en ~/.claude/CLAUDE.md' 'Ejecuta install.sh'
fi
[ -f "$HOME/.claude/skills/delegar-a-opencode/SKILL.md" ] && test_item 0 'Skill delegar-a-opencode instalada' || test_item 1 'Skill delegar-a-opencode no instalada' 'Ejecuta install.sh'

step 'Gentle AI y ODD (spec 20 y 21)'
VERSION_GENTLE="4.3.1"
GENTLE_EXE=""
if command -v gentle-ai >/dev/null 2>&1; then GENTLE_EXE="$(command -v gentle-ai)"
else for c in "$HOME/go/bin/gentle-ai" "$HOME/.local/bin/gentle-ai" "/usr/local/bin/gentle-ai"; do [ -x "$c" ] && { GENTLE_EXE="$c"; break; }; done; fi
if [ -n "$GENTLE_EXE" ]; then
  test_item 0 'gentle-ai instalado'
  GV="$("$GENTLE_EXE" version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  if [ "$GV" = "$VERSION_GENTLE" ]; then test_item 0 "gentle-ai en la versión fijada ($VERSION_GENTLE)"; else test_item 1 "gentle-ai en la versión fijada ($VERSION_GENTLE; instalada: ${GV:-?})" "Instala la fijada: go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@v$VERSION_GENTLE"; fi
else
  test_item 1 'gentle-ai no instalado' 'Ejecuta install.sh (script oficial de Gentle AI)'
fi
if [ -f "$CLAUDE_MD" ] && grep -q '<!-- gentle-ai:' "$CLAUDE_MD"; then test_item 0 'Bloques gentle-ai:* en ~/.claude/CLAUDE.md'; else test_item 1 'Faltan los bloques gentle-ai:* en ~/.claude/CLAUDE.md' 'Ejecuta install.sh'; fi
BLOQUE_NUESTRO=""
[ -f "$CLAUDE_MD" ] && BLOQUE_NUESTRO="$(sed -n '/<!-- BEGIN sistema-cerebro-agentes -->/,/<!-- END sistema-cerebro-agentes -->/p' "$CLAUDE_MD")"
if [ -n "$BLOQUE_NUESTRO" ] && ! printf '%s' "$BLOQUE_NUESTRO" | grep -qi 'laya'; then test_item 0 'Nuestro bloque de CLAUDE.md no menciona Laya'; else test_item 1 'Nuestro bloque de CLAUDE.md falta o menciona Laya' 'Ejecuta install.sh para actualizar el bloque'; fi
[ -d "$HOME/.claude/gentle-ai/orchestrator" ] && test_item 0 'Orquestador modular de Gentle AI (~/.claude/gentle-ai/orchestrator)' || test_item 1 'Falta el orquestador modular de Gentle AI' 'Ejecuta install.sh (usa --claude-orchestrator-modules)'
ODD_OK=0
for c in start plan implement verify review status handoff; do [ -f "$HOME/.claude/commands/odd/$c.md" ] || ODD_OK=1; done
test_item "$ODD_OK" 'Comandos /odd:* instalados (~/.claude/commands/odd)' 'Ejecuta install.sh'
if grep -q 'Read(~/.claude/.credentials.json)' "$HOME/.claude/settings.json" 2>/dev/null && grep -q 'Bash(git push:\*)' "$HOME/.claude/settings.json" 2>/dev/null; then test_item 0 'Permisos prudentes en settings.json (deny credenciales, ask git push)'; else test_item 1 'Faltan los permisos prudentes en settings.json' 'Ejecuta install.sh'; fi
OC_CFG_TXT="$(cat "$HOME/.config/opencode/opencode.jsonc" "$HOME/.config/opencode/opencode.json" 2>/dev/null || true)"
# Se mira en el servidor V1 que usa el sistema (GET /mcp, solo lectura). OpenCode v2 ya no
# lista los MCP con `opencode mcp list`; queda como respaldo si el servidor no responde.
ENGRAM_OC=1
if [ -n "${SRV_PORT:-}" ] && curl -fsS -m 20 "http://127.0.0.1:$SRV_PORT/mcp" 2>/dev/null | grep -qE '"engram":\{"status":"connected"'; then ENGRAM_OC=0
elif opencode mcp list 2>&1 | grep -qE 'engram[[:space:]]+connected'; then ENGRAM_OC=0; fi
if [ "$ENGRAM_OC" -eq 0 ]; then test_item 0 'engram conectado en OpenCode (servidor V1, GET /mcp)'; else test_item 1 'engram no conectado en OpenCode' 'Reinicia el servidor V1 (servidor.sh --stop y luego servidor.sh) o ejecuta install.sh --reinstalar'; fi
DEF_AGENT="$(printf '%s' "$OC_CFG_TXT" | grep -oE '"default_agent"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"([^"]*)"$/\1/' || true)"
if [ -n "$DEF_AGENT" ]; then
  if [ "$DEF_AGENT" = "cerebro-oc" ]; then test_item 0 'default_agent de OpenCode es cerebro-oc'; else test_item 1 "default_agent de OpenCode es cerebro-oc (ahora: $DEF_AGENT)" 'Ejecuta install.sh (o node config/claude/agente-defecto.mjs)'; fi
fi

step 'Agentes de OpenCode'
for name in cerebro-oc.md implementador.md debugger.md revisor.md testeador.md explorador-ds.md redactor-ds.md planificador.md local.md; do
  [ -f "$HOME/.config/opencode/agents/$name" ] && test_item 0 "Agente $name" || test_item 1 "Agente $name no encontrado" 'Ejecuta install.sh'
done

step 'Agente cerebro en Claude Code'
AGENT_DST="$HOME/.claude/agents/cerebro.md"
if [ -f "$AGENT_DST" ]; then
  test_item 0 'Agente cerebro instalado (~/.claude/agents/cerebro.md)'
  if grep -q '__COMANDO__' "$AGENT_DST"; then
    test_item 1 'Agente sin templar (falta la ruta del lanzador)' 'Ejecuta install.sh de nuevo'
  else
    test_item 0 'Agente templado (ruta del lanzador aplicada)'
  fi
  if grep -q 'mcpServers' "$AGENT_DST" && grep -q 'launcher.sh' "$AGENT_DST"; then
    test_item 0 'El MCP va inline dentro del agente'
  else
    test_item 1 'El MCP inline no aparece en el agente' 'Ejecuta install.sh de nuevo'
  fi
else
  test_item 1 'Agente cerebro no instalado' 'Ejecuta install.sh'
fi
[ -x "$HOME/.local/bin/cerebro" ] && test_item 0 'Comando cerebro instalado (~/.local/bin)' || test_item 1 'Comando cerebro no instalado' 'Ejecuta install.sh'
for f in subdirector.md explorador.md redactor.md analista.md arquitecto.md adaptador-mcps.md planificador.md resolutor.md ayudante.md retocador.md consultor.md; do
  [ -f "$HOME/.claude/agents/$f" ] && test_item 0 "Subagente $f instalado" || test_item 1 "Subagente $f no instalado" 'Ejecuta install.sh'
done
MCP_LIST="$(claude mcp list 2>&1 || true)"
MCP_LINE="$(printf '%s\n' "$MCP_LIST" | grep -E '^[[:space:]]*opencode:' | head -n1 || true)"
if [ -n "$MCP_LINE" ]; then
  test_item 1 'El MCP sigue registrado globalmente' 'Retíralo: claude mcp remove opencode --scope user'
else
  test_item 0 'MCP no registrado globalmente (solo dentro del agente)'
fi

step 'Cerebro Hub: actividad y latidos'
HUB_PORT=""
HUB_PORT_FILE="$HOME/.sistema-cerebro-agentes/hub-port.txt"
[ -f "$HUB_PORT_FILE" ] && HUB_PORT="$(tr -d '[:space:]' < "$HUB_PORT_FILE")"
if [ -z "$HUB_PORT" ] && curl -fsS --max-time 3 "http://127.0.0.1:4597/api/salud" 2>/dev/null | grep -q 'cerebro-hub'; then
  HUB_PORT=4597
fi
HUB_OK=0
[ -n "$HUB_PORT" ] && curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/salud" 2>/dev/null | grep -q 'cerebro-hub' && HUB_OK=1 || true
if [ "$HUB_OK" -eq 1 ]; then
  if curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/actividad" 2>/dev/null | grep -q '"proyectos"'; then
    test_item 0 'GET /api/actividad devuelve proyectos'
  else
    test_item 1 'GET /api/actividad no responde' 'Revisa hub.mjs (R1 de la spec del panel)'
  fi
  if curl -fsS --max-time 4 -X POST -H 'Content-Type: application/json' -d "{\"cwd\":\"$REPO_ROOT\",\"sesion\":\"verificar\",\"evento\":\"SubagentStart\",\"agente\":\"verificar\"}" "http://127.0.0.1:$HUB_PORT/api/latido" 2>/dev/null | grep -q '"ok":true'; then
    test_item 0 'POST /api/latido acepta un latido'
  else
    test_item 1 'POST /api/latido no responde' 'Revisa hub.mjs (R3 de la spec del panel)'
  fi
  if curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/vivo" 2>/dev/null | grep -q '"ok":true'; then
    test_item 0 'GET /api/vivo responde (vista viva)'
  else
    test_item 1 'GET /api/vivo no responde' 'Revisa hub.mjs / lib/vivo.mjs (spec 05)'
  fi
  if curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/claude/estado" 2>/dev/null | grep -q '"ok":true'; then
    test_item 0 'GET /api/claude/estado responde (contexto real)'
  else
    test_item 1 'GET /api/claude/estado no responde' 'Revisa hub.mjs / estado-linea.mjs'
  fi
  if curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/logs?limite=5" 2>/dev/null | grep -q '"ok":true'; then
    test_item 0 'GET /api/logs responde (registro de errores)'
  else
    test_item 1 'GET /api/logs no responde' 'Revisa hub.mjs / lib/errores-log.mjs'
  fi
  if curl -fsS --max-time 4 "http://127.0.0.1:$HUB_PORT/api/latidos" 2>/dev/null | grep -q '"ok":true'; then
    test_item 0 'GET /api/latidos responde (subagentes en vivo)'
  else
    test_item 1 'GET /api/latidos no responde' 'Revisa hub.mjs / latido.mjs'
  fi
  [ -f "$HOME/.sistema-cerebro-agentes/hub/errores.mjs" ] && test_item 0 'CLI de errores instalada (hub/errores.mjs)' || test_item 1 'CLI de errores no instalada' 'Ejecuta install.sh'
else
  test_item 1 "Cerebro Hub responde en 127.0.0.1:${HUB_PORT:-?}" 'Arranca: bash ~/.sistema-cerebro-agentes/hub.sh'
fi
HOOK_LATIDO="$HOME/.sistema-cerebro-agentes/hooks/latido.mjs"
if [ -f "$HOOK_LATIDO" ]; then
  HOOK_INICIO=$SECONDS
  if printf '%s' '{"hook_event_name":"SubagentStart","cwd":"."}' | HUB_URL="http://127.0.0.1:1" node "$HOOK_LATIDO" >/dev/null 2>&1; then HOOK_CODE=0; else HOOK_CODE=$?; fi
  if [ "$HOOK_CODE" -eq 0 ] && [ $((SECONDS - HOOK_INICIO)) -lt 3 ]; then
    test_item 0 'Hook latido no bloquea con el hub caído'
  else
    test_item 1 'Hook latido bloquea o falla' 'Revisa config/hooks/latido.mjs'
  fi
else
  test_item 1 'Hook latido no instalado' 'Ejecuta install.sh'
fi
for f in session-start.mjs pre-compact.mjs session-end.mjs cerrar-trabajos.mjs estado.mjs latido.mjs sonido-fin.mjs doctor.mjs aviso-contexto.mjs errores-repetidos.mjs ultima-sesion.mjs resumir-sesion.mjs hallazgos.mjs buscar.mjs; do
  [ -f "$HOME/.sistema-cerebro-agentes/hooks/$f" ] && test_item 0 "Hook $f instalado" || test_item 1 "Hook $f no instalado" 'Ejecuta install.sh'
done
TRIAJE="$HOME/.sistema-cerebro-agentes/mcp/triaje-mcp.mjs"
if [ -f "$TRIAJE" ]; then
  test_item 0 'MCP de trabajos instalado'
  if grep -q 'trabajo_estado' "$TRIAJE"; then
    test_item 0 'MCP de trabajos con trabajo_estado (visibilidad)'
  else
    test_item 1 'MCP de trabajos sin trabajo_estado' 'Ejecuta install.sh'
  fi
else
  test_item 1 'MCP de trabajos no instalado' 'Ejecuta install.sh'
fi
[ -f "$HOME/.sistema-cerebro-agentes/mods/mesa-de-trabajo/hooks/register.js" ] && test_item 0 'Mod «mesa de trabajo» instalado' || test_item 1 'Mod «mesa de trabajo» no instalado' 'Ejecuta install.sh'
ESTADO_LINEA="$HOME/.sistema-cerebro-agentes/hub/estado-linea.mjs"
if [ -f "$ESTADO_LINEA" ]; then
  test_item 0 'Barra de estado instalada (hub/estado-linea.mjs)'
  SALIDA_ES="$(printf '%s' "{\"workspace\":{\"current_dir\":\"$REPO_ROOT\"},\"model\":{\"display_name\":\"Test\"},\"context_window\":{\"used_percentage\":42}}" | node "$ESTADO_LINEA" 2>/dev/null || true)"
  if printf '%s' "$SALIDA_ES" | grep -q 'Test'; then
    test_item 0 'La barra de estado responde'
  else
    test_item 1 'La barra de estado no responde' 'Revisa config/hub/estado-linea.mjs'
  fi
else
  test_item 1 'Barra de estado no instalada' 'Ejecuta install.sh'
fi
if grep -qE 'estado-linea.mjs|hud.(mjs|cmd)' "$HOME/.claude/settings.json" 2>/dev/null; then
  test_item 0 'Barra de estado registrada en settings.json'
else
  test_item 1 'Barra de estado no registrada' 'Ejecuta install.sh (o quita tu statusLine propia)'
fi
PARAR_TODO="$HOME/.sistema-cerebro-agentes/hub/parar-todo.mjs"
if [ -f "$PARAR_TODO" ]; then
  test_item 0 'Parada de emergencia instalada (hub/parar-todo.mjs)'
  SALIDA_PARAR="$(node "$PARAR_TODO" --seco 2>/dev/null || true)"
  if printf '%s' "$SALIDA_PARAR" | grep -qE 'Trabajos|No hab'; then
    test_item 0 'La parada de emergencia responde (modo seco)'
  else
    test_item 1 'La parada de emergencia no responde' 'Revisa config/hub/parar-todo.mjs'
  fi
else
  test_item 1 'Parada de emergencia no instalada' 'Ejecuta install.sh'
fi
[ -x "$HOME/.local/bin/cerebro-parar" ] && test_item 0 'Comando cerebro-parar instalado' || test_item 1 'Comando cerebro-parar no instalado' 'Ejecuta install.sh'
if grep -q 'cerrar-trabajos.mjs' "$HOME/.claude/settings.json" 2>/dev/null; then
  test_item 0 'Apagado de trabajos registrado al cerrar sesion'
else
  test_item 1 'Apagado de trabajos no registrado' 'Ejecuta install.sh'
fi
if grep -q 'mesa-de-trabajo' "$HOME/.claude/settings.json" 2>/dev/null; then
  test_item 0 'Mod cargado en settings (CLAUDE_CODE_PLUGIN_DIRS)'
else
  test_item 1 'Mod no cargado en settings' 'Ejecuta install.sh'
fi

step 'Búsqueda de memoria (R1 · spec 10)'
if node "$REPO_ROOT/scripts/test-buscar.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de búsqueda (FTS5, o fallback si no hay FTS5)'
else
  test_item 1 'Pruebas de búsqueda (FTS5, o fallback si no hay FTS5)' 'Ejecuta: node scripts/test-buscar.mjs'
fi

step 'Nudges de memoria (R2 · spec 10)'
for n in sonido doctor; do
  if node "$REPO_ROOT/scripts/test-$n.mjs" >/dev/null 2>&1; then test_item 0 "Pruebas de $n (spec 22)"; else test_item 1 "Pruebas de $n (spec 22)" "Ejecuta: node scripts/test-$n.mjs"; fi
done

step 'Engram junto al hub (spec 23)'
if engram version 2>&1 | grep -qi engram; then test_item 0 'Engram responde en Claude Code (engram version)'; else test_item 1 'Engram no responde en Claude Code' 'Ejecuta install.sh (gentle-ai install) y revisa el PATH'; fi
if node "$REPO_ROOT/scripts/test-engram.mjs" >/dev/null 2>&1; then test_item 0 'Pruebas de Engram junto al hub'; else test_item 1 'Pruebas de Engram junto al hub' 'Ejecuta: node scripts/test-engram.mjs'; fi

step 'Instalador con control (spec 25)'
if node "$REPO_ROOT/scripts/test-instalador.mjs" >/dev/null 2>&1; then test_item 0 'Pruebas del instalador (registro, cambios a mano, --check)'; else test_item 1 'Pruebas del instalador' 'Ejecuta: node scripts/test-instalador.mjs'; fi

if node "$REPO_ROOT/scripts/test-nudges.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de nudges y límites de memoria'
else
  test_item 1 'Pruebas de nudges y límites de memoria' 'Ejecuta: node scripts/test-nudges.mjs'
fi

step 'Ledger de trabajos (R3 · spec 10)'
if node "$REPO_ROOT/scripts/test-ledger.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas del ledger de trabajos (reconciliación, atasco, retención)'
else
  test_item 1 'Pruebas del ledger de trabajos (reconciliación, atasco, retención)' 'Ejecuta: node scripts/test-ledger.mjs'
fi

step 'Aprobaciones por niveles (R4 · spec 10)'
if node "$REPO_ROOT/scripts/test-aprobaciones.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de aprobaciones (niveles, allowlist con merge, pendientes)'
else
  test_item 1 'Pruebas de aprobaciones (niveles, allowlist con merge, pendientes)' 'Ejecuta: node scripts/test-aprobaciones.mjs'
fi

step 'Skills autogenerados (R5 · spec 10)'
if node "$REPO_ROOT/scripts/test-skills.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de skills (linter, guard, propuesta→aprobación, uso)'
else
  test_item 1 'Pruebas de skills (linter, guard, propuesta→aprobación, uso)' 'Ejecuta: node scripts/test-skills.mjs'
fi

step 'Cron y tareas programadas (R6 · spec 10)'
if node "$REPO_ROOT/scripts/test-cron.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de cron (parser, siguiente, claim, preflight, reintentos)'
else
  test_item 1 'Pruebas de cron (parser, siguiente, claim, preflight, reintentos)' 'Ejecuta: node scripts/test-cron.mjs'
fi

step 'Resumen propio de contexto (R7 · spec 10)'
if node "$REPO_ROOT/scripts/test-compresion.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de compresión (troceo, poda, verbatim, fallback, episódica)'
else
  test_item 1 'Pruebas de compresión (troceo, poda, verbatim, fallback, episódica)' 'Ejecuta: node scripts/test-compresion.mjs'
fi

step 'Métricas de uso (spec 11)'
if node "$REPO_ROOT/scripts/test-metricas.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de métricas (JSONL, saneo, rotación, poda, job idempotente)'
else
  test_item 1 'Pruebas de métricas (JSONL, saneo, rotación, poda, job idempotente)' 'Ejecuta: node scripts/test-metricas.mjs'
fi

step 'Agente local-codigo y su respaldo (spec 12)'
if node "$REPO_ROOT/scripts/test-salud-agentes.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de salud de agentes (degradación, reintento, código acotado)'
else
  test_item 1 'Pruebas de salud de agentes (degradación, reintento, código acotado)' 'Ejecuta: node scripts/test-salud-agentes.mjs'
fi

step 'Guía de uso de MCPs (spec 13)'
if node "$REPO_ROOT/scripts/test-mcps-guia.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de la guía de MCPs (copia sin pisar, --forzar-guia, MCPS.md idéntico, resumen)'
else
  test_item 1 'Pruebas de la guía de MCPs (copia sin pisar, --forzar-guia, MCPS.md idéntico, resumen)' 'Ejecuta: node scripts/test-mcps-guia.mjs'
fi

step 'Comunicación entre agentes y reparto (spec 14)'
if node "$REPO_ROOT/scripts/test-a2a.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de A2A-lite (directorio, consulta, buzón, triaje, reparto)'
else
  test_item 1 'Pruebas de A2A-lite (directorio, consulta, buzón, triaje, reparto)' 'Ejecuta: node scripts/test-a2a.mjs'
fi

step 'Barra de estado: modo normal vs cerebro'
if node "$REPO_ROOT/scripts/test-modo.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas del modo normal/cerebro en la barra de estado'
else
  test_item 1 'Pruebas del modo normal/cerebro en la barra de estado' 'Ejecuta: node scripts/test-modo.mjs'
fi

step 'Opus dirige y configurar-claude (spec 15)'
if node "$REPO_ROOT/scripts/test-opus-reparto.mjs" >/dev/null 2>&1; then
  test_item 0 'Pruebas de la spec 15 (reparto Opus/Sonnet/Haiku, aviso en consola, nota de última sesión)'
else
  test_item 1 'Pruebas de la spec 15 (reparto Opus/Sonnet/Haiku, aviso en consola, nota de última sesión)' 'Ejecuta: node scripts/test-opus-reparto.mjs'
fi

if [ "$SMOKE" -eq 1 ]; then
  step 'Smoke test del MCP (arranque real por stdio)'
  if [ "$ASK" -eq 1 ]; then
    if node "$REPO_ROOT/scripts/smoke-mcp.mjs" --ask; then test_item 0 'Smoke test del MCP'; else test_item 1 'Smoke test del MCP' 'Revisa la salida de arriba'; fi
  else
    if node "$REPO_ROOT/scripts/smoke-mcp.mjs"; then test_item 0 'Smoke test del MCP'; else test_item 1 'Smoke test del MCP' 'Revisa la salida de arriba'; fi
  fi
fi

step 'Resultado'
printf '  Aprobadas: %s   Fallidas: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
