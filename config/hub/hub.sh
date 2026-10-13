#!/usr/bin/env bash
# Cerebro Hub — arrancar / parar / estado (macOS / Linux).
# Uso: bash hub.sh [--stop|--status|--no-open]
set -u
BASE_PORT=4597
MAX_PORTS=1
NO_OPEN=0
MODO="start"
for arg in "$@"; do
  case "$arg" in
    --stop) MODO="stop" ;;
    --status) MODO="status" ;;
    --no-open) NO_OPEN=1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_JS="$ROOT/hub.mjs"
[ -f "$SERVER_JS" ] || SERVER_JS="$ROOT/hub/hub.mjs"
[ -f "$SERVER_JS" ] || SERVER_JS="$(dirname "$ROOT")/config/hub/hub.mjs"
SYS_DIR="$HOME/.sistema-cerebro-agentes"
PORT_FILE="$SYS_DIR/hub-port.txt"
LAST_PORT=$((BASE_PORT + MAX_PORTS - 1))

check() { curl -fsS --max-time 3 "http://127.0.0.1:$1/api/salud" 2>/dev/null | grep -q 'cerebro-hub'; }

find_port() {
  if [ -f "$PORT_FILE" ]; then
    p="$(cat "$PORT_FILE" | tr -d '[:space:]')"
    if [ -n "$p" ] && check "$p"; then echo "$p"; return; fi
  fi
  for p in $(seq "$BASE_PORT" "$LAST_PORT"); do
    if check "$p"; then echo "$p"; return; fi
  done
  echo 0
}

if [ "$MODO" = "stop" ]; then
  PORT="$(find_port)"
  [ "$PORT" != "0" ] && kill "$(lsof -ti tcp:"$PORT" 2>/dev/null)" 2>/dev/null
  rm -f "$PORT_FILE"
  echo "Cerebro Hub detenido."
  exit 0
fi

PORT="$(find_port)"
if [ "$MODO" = "status" ]; then
  if [ "$PORT" != "0" ]; then echo "OK: hub activo en http://127.0.0.1:$PORT"; exit 0; fi
  echo "Hub NO activo"; exit 1
fi

if [ "$PORT" = "0" ]; then
  [ -f "$SERVER_JS" ] || { echo "No se encuentra hub.mjs. Ejecuta install.sh desde el repositorio." >&2; exit 1; }
  command -v node >/dev/null || { echo "Node.js no encontrado." >&2; exit 1; }
  for p in $(seq "$BASE_PORT" "$LAST_PORT"); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT="$p"; break; fi
    exec 3>&- 2>/dev/null
  done
  [ "$PORT" != "0" ] || { echo "No hay puerto libre entre $BASE_PORT y $LAST_PORT." >&2; exit 1; }
  mkdir -p "$SYS_DIR"
  nohup node "$SERVER_JS" "--port=$PORT" >/dev/null 2>&1 &
  for _ in $(seq 1 20); do check "$PORT" && break; sleep 1; done
  check "$PORT" || { echo "El hub no respondio (puerto $PORT)." >&2; exit 1; }
  echo "$PORT" > "$PORT_FILE"
fi

echo "Cerebro Hub activo en http://127.0.0.1:$PORT"
if [ "$NO_OPEN" != "1" ]; then
  (command -v xdg-open >/dev/null && xdg-open "http://127.0.0.1:$PORT") || (command -v open >/dev/null && open "http://127.0.0.1:$PORT") || true
fi
