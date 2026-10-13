#!/usr/bin/env bash
# Panel web en tiempo real de sistema-cerebro-agentes (macOS/Linux).
# Arranca config/web/servidor-web.mjs en 127.0.0.1 con puerto dinámico desde 4598
# (guardado en ~/.sistema-cerebro-agentes/web-port.txt) y abre el navegador.
# El panel es de SOLO LECTURA.
# Uso: bash panel.sh [--stop | --status | --no-open]
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT/web"
[ -f "$WEB_DIR/servidor-web.mjs" ] || WEB_DIR="$(cd "$ROOT/.." && pwd)/config/web"
SERVER_JS="$WEB_DIR/servidor-web.mjs"
SYSTEM_DIR="$HOME/.sistema-cerebro-agentes"
PORT_FILE="$SYSTEM_DIR/web-port.txt"
BASE_PORT=4598
MAX_PORTS=8

test_panel() { curl -fsS --max-time 3 "http://127.0.0.1:$1/api/ping" 2>/dev/null | grep -q 'sistema-cerebro-agentes'; }

active_port() {
  if [ -f "$PORT_FILE" ]; then
    p="$(tr -d '[:space:]' < "$PORT_FILE")"
    if [ -n "$p" ] && test_panel "$p"; then echo "$p"; return 0; fi
  fi
  for i in $(seq 0 $((MAX_PORTS - 1))); do
    p=$((BASE_PORT + i))
    if test_panel "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

case "${1:-}" in
  --stop)
    for i in $(seq 0 $((MAX_PORTS - 1))); do
      pkill -f "servidor-web.mjs --port=$((BASE_PORT + i))" 2>/dev/null || true
    done
    rm -f "$PORT_FILE"
    echo 'Panel web detenido.'
    exit 0
    ;;
  --status)
    if p="$(active_port)"; then echo "OK: panel activo en http://127.0.0.1:$p"; exit 0; fi
    echo 'Panel NO activo'; exit 1
    ;;
esac

if p="$(active_port)"; then
  echo "$p" > "$PORT_FILE"
  ACTIVE="$p"
else
  if [ ! -f "$SERVER_JS" ]; then
    echo "No se encuentra servidor-web.mjs. Ejecuta install.sh desde el repositorio." >&2
    exit 1
  fi
  PORT=""
  for i in $(seq 0 $((MAX_PORTS - 1))); do
    p=$((BASE_PORT + i))
    if ! (exec 7<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT="$p"; break; fi
  done
  [ -n "$PORT" ] || { echo "No hay puerto libre entre $BASE_PORT y $((BASE_PORT + MAX_PORTS - 1))." >&2; exit 1; }
  mkdir -p "$SYSTEM_DIR"
  ( nohup node "$SERVER_JS" --port="$PORT" >/dev/null 2>&1 & ) >/dev/null 2>&1
  for _ in $(seq 1 20); do
    if test_panel "$PORT"; then break; fi
    sleep 1
  done
  if ! test_panel "$PORT"; then echo "El panel no respondió (puerto $PORT)." >&2; exit 1; fi
  echo "$PORT" > "$PORT_FILE"
  ACTIVE="$PORT"
fi

echo "Panel web activo en http://127.0.0.1:$ACTIVE"
if [ "${1:-}" != "--no-open" ]; then
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$ACTIVE" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$ACTIVE" >/dev/null 2>&1 || true
  fi
fi
