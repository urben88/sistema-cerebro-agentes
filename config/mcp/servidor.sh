#!/usr/bin/env bash
# Asegura el servidor OpenCode V1 (opencode-ai) del sistema Cerebro → OpenCode (macOS/Linux).
# Datos aislados en ~/.sistema-cerebro-agentes/server-data (auth.json sincronizado).
# Puerto dinámico: reutiliza el activo (server-port.txt) o toma el primero libre desde 4599.
# Uso: bash servidor.sh [--status | --stop]
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_PORT=4599
MAX_PORTS=22
EXE="$ROOT/server/node_modules/.bin/opencode"
DATA_DIR="$ROOT/server-data"
PORT_FILE="$ROOT/server-port.txt"
AUTH_SRC="$HOME/.local/share/opencode/auth.json"

test_port() { curl -fsS --max-time 3 "http://127.0.0.1:$1/config" >/dev/null 2>&1; }

active_port() {
  if [ -f "$PORT_FILE" ]; then
    p="$(tr -d '[:space:]' < "$PORT_FILE")"
    if [ -n "$p" ] && test_port "$p"; then echo "$p"; return 0; fi
  fi
  for i in $(seq 0 $((MAX_PORTS - 1))); do
    p=$((BASE_PORT + i))
    if test_port "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

free_port() {
  for i in $(seq 0 $((MAX_PORTS - 1))); do
    p=$((BASE_PORT + i))
    if ! (exec 7<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  return 1
}

case "${1:-}" in
  --stop)
    if [ -f "$PORT_FILE" ]; then
      p="$(tr -d '[:space:]' < "$PORT_FILE")"
      [ -n "$p" ] && pkill -f -- "--port=$p" 2>/dev/null || true
    fi
    for i in $(seq 0 $((MAX_PORTS - 1))); do
      pkill -f -- "--port=$((BASE_PORT + i))" 2>/dev/null || true
    done
    rm -f "$PORT_FILE"
    echo 'Servidor OpenCode V1 detenido.'
    exit 0
    ;;
  --status)
    if p="$(active_port)"; then echo "OK: servidor activo en http://127.0.0.1:$p"; exit 0; fi
    echo 'Servidor NO activo'; exit 1
    ;;
esac

if p="$(active_port)"; then
  echo "$p" > "$PORT_FILE"
  exit 0
fi

if [ ! -x "$EXE" ]; then
  echo "No se encuentra opencode-ai en $EXE. Ejecuta install.sh primero." >&2
  exit 1
fi

PORT="$(free_port)" || { echo 'No hay puerto libre entre 4599 y 4620.' >&2; exit 1; }

mkdir -p "$DATA_DIR/opencode"
[ -f "$AUTH_SRC" ] && cp -f "$AUTH_SRC" "$DATA_DIR/opencode/auth.json" 2>/dev/null

( XDG_DATA_HOME="$DATA_DIR" nohup "$EXE" serve --hostname=127.0.0.1 --port="$PORT" >/dev/null 2>&1 & ) >/dev/null 2>&1

for _ in $(seq 1 40); do
  if test_port "$PORT"; then
    echo "$PORT" > "$PORT_FILE"
    echo "Servidor OpenCode V1 activo en http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done

echo "El servidor no respondió en 40 s (puerto $PORT)." >&2
exit 1
