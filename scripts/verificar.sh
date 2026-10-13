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

step 'Agentes de OpenCode'
for name in implementador.md revisor.md testeador.md; do
  [ -f "$HOME/.config/opencode/agents/$name" ] && test_item 0 "Agente $name" || test_item 1 "Agente $name no encontrado" 'Ejecuta install.sh'
done

step 'MCP opencode en Claude Code'
MCP_LIST="$(claude mcp list 2>&1 || true)"
MCP_LINE="$(printf '%s\n' "$MCP_LIST" | grep -E '^[[:space:]]*opencode:' | head -n1 || true)"
if [ -n "$MCP_LINE" ]; then
  if printf '%s' "$MCP_LINE" | grep -qi 'connected'; then
    test_item 0 "Registrado: $(printf '%s' "$MCP_LINE" | sed 's/^[[:space:]]*//')"
  else
    test_item 1 "Registrado pero no conectado: $(printf '%s' "$MCP_LINE" | sed 's/^[[:space:]]*//')" 'Reinicia Claude Code; si sigue mal, ejecuta install.sh de nuevo'
  fi
else
  test_item 1 'MCP opencode no registrado' 'Ejecuta install.sh'
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
