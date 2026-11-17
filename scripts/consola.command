#!/usr/bin/env bash
# Cerebro - consola (macOS)
#
# Doble clic (Finder -> Abrir con Terminal, o desde Spotlight):
#   - arranca el hub y el panel web y abre el navegador
#   - se queda en primer plano mostrando el estado
#   - al cerrar esta ventana (o pulsar Ctrl+C) se apaga todo
#
# La configuracion y los datos se conservan: el contenedor del hub solo se detiene
# (no se borra) y sus datos viven en ~/.sistema-cerebro-agentes.
set -u

# Finder abre los .command con su propia terminal: se indica la ruta al repo.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SISTEMA="$HOME/.sistema-cerebro-agentes"

# Si el .command vive en ~/Applications, el repo esta en otro sitio: se busca.
if [ ! -f "$RAIZ/consola.sh" ]; then
  for candidato in \
    "$HOME/Desktop/Proyectos/sistema-cerebro-agentes/scripts" \
    "$HOME/Projects/sistema-cerebro-agentes/scripts" \
    "$HOME/sistema-cerebro-agentes/scripts"; do
    [ -f "$candidato/consola.sh" ] && RAIZ="$candidato" && break
  done
fi

if [ -f "$RAIZ/consola.sh" ]; then
  exec bash "$RAIZ/consola.sh" "$@"
fi

# Instalado: se usa la copia de ~/.sistema-cerebro-agentes.
if [ -f "$SISTEMA/consola.sh" ]; then
  exec bash "$SISTEMA/consola.sh" "$@"
fi

echo "No se encuentra la consola del Cerebro (ni en el repositorio ni en ~/.sistema-cerebro-agentes)." >&2
echo "Ejecuta install.sh para instalarla." >&2
read -r -p "Pulsa Enter para salir..." _ || true
exit 1
