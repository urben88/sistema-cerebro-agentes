#!/usr/bin/env bash
# Gestor del stack Docker del Cerebro Hub (hub).
# Uso: bash gestion.sh [up|down|status|logs|restart] [--build]
set -u
ACCION="${1:-up}"
BUILD=""
[ "${2:-}" = "--build" ] && BUILD="--build"

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="$ROOT/docker-compose.yml"
[ -f "$COMPOSE" ] || COMPOSE="$(dirname "$ROOT")/docker/docker-compose.yml"
[ -f "$COMPOSE" ] || { echo "No se encuentra docker-compose.yml" >&2; exit 1; }

command -v docker >/dev/null || { echo "Docker no está instalado." >&2; exit 1; }

case "$ACCION" in
  up) docker compose -f "$COMPOSE" up -d $BUILD ;;
  down) docker compose -f "$COMPOSE" down ;;
  restart) docker compose -f "$COMPOSE" restart ;;
  status) docker compose -f "$COMPOSE" ps ;;
  logs) docker compose -f "$COMPOSE" logs --tail 100 ;;
  *) echo "Acción no válida: $ACCION" >&2; exit 1 ;;
esac
