#!/usr/bin/env bash
# Cerebro - vigilante de la consola (macOS / Linux)
#
# Al cerrar la ventana de la consola, el shell padre muere y su `trap` puede no
# llegar a ejecutarse: el hub y el panel se quedarian encendidos.
#
# Este vigilante se lanza detached y vigila dos senales:
#   - el proceso padre deja de existir  -> la consola se cerro de golpe
#   - el fichero de latido deja de actualizarse -> la consola esta colgada o murio
#
# Cuando cualquiera de las dos ocurre, llama a `consola.sh --parar` con el fichero
# de estado, que apaga exactamente lo que encendio esa consola. Los datos y la
# configuracion no se tocan.
set -u

PADRE=""; LATIDO=""; ESTADO=""; CONSOLA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --padre)   PADRE="$2"; shift ;;
    --latido)  LATIDO="$2"; shift ;;
    --estado)  ESTADO="$2"; shift ;;
    --consola) CONSOLA="$2"; shift ;;
  esac
  shift
done

MARGEN_LATIDO=20
INTERVALO=2
INICIO=$(date +%s)
SYSTEM_DIR="$HOME/.sistema-cerebro-agentes"

padre_vivo(){ kill -0 "$PADRE" 2>/dev/null; }

# Lee un campo de un JSON (sin dependencias).
campo(){
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(String(JSON.parse(s)[process.argv[1]]??""))}catch{console.log("")}})' "$2" 2>/dev/null
}

# Segundos desde el ultimo latido, o -1 si el fichero aun no existe.
antiguedad_latido(){
  [ -f "$LATIDO" ] || { echo -1; return; }
  local ahora mtime
  ahora=$(date +%s)
  mtime=$(stat -f %m "$LATIDO" 2>/dev/null || stat -c %Y "$LATIDO" 2>/dev/null || echo 0)
  echo $((ahora - mtime))
}

while true; do
  padre_vivo || break
  edad=$(antiguedad_latido)
  # Sin fichero de latido todavia: se espera mientras el padre siga vivo.
  if [ "$edad" -lt 0 ]; then
    [ $(( $(date +%s) - INICIO )) -gt "$MARGEN_LATIDO" ] && break
  else
    [ "$edad" -gt "$MARGEN_LATIDO" ] && break
  fi
  [ -f "$ESTADO" ] || exit 0
  sleep "$INTERVALO"
done

# La consola se cerro: a apagar lo que encendio, salvo que otra consola
# reciente se haya hecho cargo (el hub y el panel los comparten).
otras=0
for f in "$SYSTEM_DIR"/consola-estado*.json; do
  [ -f "$f" ] || continue
  [ "$f" = "$ESTADO" ] && continue
  pid=$(campo "$(cat "$f")" pid)
  [ -n "$pid" ] || continue
  kill -0 "$pid" 2>/dev/null && otras=$((otras + 1))
done

if [ "$otras" -eq 0 ] && [ -f "$ESTADO" ] && [ -n "$CONSOLA" ]; then
  bash "$CONSOLA" --parar >/dev/null 2>&1 || true
fi
# El fichero de latido se borra tambien en este camino.
rm -f "$LATIDO" 2>/dev/null || true
exit 0
