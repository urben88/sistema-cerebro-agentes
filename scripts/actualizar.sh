#!/usr/bin/env bash
# Actualiza sistema-cerebro-agentes: git pull + reinstalación (macOS / Linux)
# Uso: bash scripts/actualizar.sh [--skip-pull] [--sin-verificar]
# Al final ejecuta verificar.sh --smoke (si falla, avisa pero no aborta).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_PULL=0; SIN_VERIFICAR=0
for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --sin-verificar) SIN_VERIFICAR=1 ;;
    *) echo "Argumento desconocido: $arg"; exit 2 ;;
  esac
done

if [ "$SKIP_PULL" -eq 0 ]; then
  echo '== git pull =='
  git pull --ff-only
fi

echo '== Reinstalando =='
bash install.sh --force

printf '\nActualizado a la versión %s.\n' "$(tr -d '\n' < VERSION)"

if [ "$SIN_VERIFICAR" -eq 0 ]; then
  echo; echo '== Verificando (smoke) =='
  # Hub y Laya se reinician al desplegar: esperar hasta 90 s a que estén listos para no dar un falso fallo.
  for _ in $(seq 1 45); do curl -fs -m 2 http://127.0.0.1:4597/api/salud 2>/dev/null | grep -q '"laya":true' && break; sleep 2; done
  if bash scripts/verificar.sh --smoke; then
    echo 'Verificación correcta.'
  else
    echo 'AVISO: la verificación ha fallado (la actualización ya está instalada). Revisa los [X] de arriba.'
  fi
fi
