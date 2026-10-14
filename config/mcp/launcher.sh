#!/usr/bin/env bash
# Lanzador del MCP opencode-mcp para Claude Code (sistema Cerebro → OpenCode, macOS/Linux).
# 1) asegura el servidor OpenCode V1 (puerto dinámico desde 4599, guardado en server-port.txt)
# 2) arranca opencode-mcp por stdio conectado a ese servidor
# Se instala en ~/.sistema-cerebro-agentes/launcher.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$ROOT/servidor.sh" >/dev/null 2>&1 || true

PORT=4599
if [ -f "$ROOT/server-port.txt" ]; then
  P="$(tr -d '[:space:]' < "$ROOT/server-port.txt")"
  [ -n "$P" ] && PORT="$P"
fi

export OPENCODE_BASE_URL="${OPENCODE_BASE_URL:-http://127.0.0.1:$PORT}"
export OPENCODE_TOOL_PROFILE="${OPENCODE_TOOL_PROFILE:-essential}"
export OPENCODE_DEFAULT_PROVIDER="${OPENCODE_DEFAULT_PROVIDER:-deepseek}"
export OPENCODE_DEFAULT_MODEL="${OPENCODE_DEFAULT_MODEL:-deepseek-flash}"
unset OPENCODE_AUTO_SERVE

# Version fijada (probada): una actualizacion inesperada no rompe el flujo. Para subirla a proposito: OPENCODE_MCP_VERSION.
exec npx -y "opencode-mcp@${OPENCODE_MCP_VERSION:-3.0.0}"
