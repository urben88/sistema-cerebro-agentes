#!/usr/bin/env bash
# Actualiza sistema-cerebro-agentes: git pull + reinstalación (macOS / Linux)
# Uso: bash scripts/actualizar.sh [--skip-pull]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "${1:-}" != "--skip-pull" ]; then
  echo '== git pull =='
  git pull --ff-only
fi

echo '== Reinstalando =='
bash install.sh --force

printf '\nActualizado a la versión %s.\n' "$(tr -d '\n' < VERSION)"
