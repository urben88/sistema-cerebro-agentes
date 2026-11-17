#!/usr/bin/env bash
# Cerebro - consola (macOS / Linux)
#
# Doble clic (o `bash scripts/consola.sh`):
#   - arranca el hub y el panel web y abre el navegador
#   - se queda en primer plano mostrando el estado
#   - al cerrar esta ventana (o pulsar Ctrl+C) se apaga todo
#
# La configuracion y los datos se conservan: el contenedor del hub solo se detiene
# (no se borra) y sus datos viven en ~/.sistema-cerebro-agentes.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
SYSTEM_DIR="$HOME/.sistema-cerebro-agentes"
CONFIG_MJS="$ROOT/consola-config.mjs"
[ -f "$CONFIG_MJS" ] || CONFIG_MJS="$SYSTEM_DIR/consola-config.mjs"

ACCION="consola"
STATE_FILE=""
FLAGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --estado)   ACCION="estado" ;;
    --parar)    ACCION="parar" ;;
    --config)   ACCION="config" ;;
    --sin-hub)       FLAGS+=("--sin-hub") ;;
    --sin-panel)     FLAGS+=("--sin-panel") ;;
    --sin-navegador) FLAGS+=("--sin-navegador") ;;
    --con-servidor)  FLAGS+=("--con-servidor") ;;
    --guardar)       FLAGS+=("--guardar") ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

say(){ printf '  %s\n' "$*"; }
ok(){ printf '  [OK]   %s\n' "$*"; }
warn(){ printf '  [!]    %s\n' "$*" >&2; }
err(){ printf '  [X]    %s\n' "$*" >&2; }

primer_existente(){ for c in "$@"; do [ -f "$c" ] && { printf '%s' "$c"; return 0; }; done; return 1; }

compose_path(){ primer_existente "$SYSTEM_DIR/docker/docker-compose.yml" "$REPO_ROOT/docker/docker-compose.yml"; }
hub_script(){    primer_existente "$SYSTEM_DIR/hub/hub.mjs" "$REPO_ROOT/config/hub/hub.mjs"; }
panel_script(){  primer_existente "$SYSTEM_DIR/web/servidor-web.mjs" "$REPO_ROOT/config/web/servidor-web.mjs"; }
servidor_script(){ primer_existente "$SYSTEM_DIR/servidor.sh" "$REPO_ROOT/config/mcp/servidor.sh"; }

test_hub(){    curl -fsS --max-time 3 "http://127.0.0.1:$1/api/salud" 2>/dev/null | grep -q 'cerebro-hub'; }
test_panel(){  curl -fsS --max-time 3 "http://127.0.0.1:$1/api/ping" 2>/dev/null | grep -q 'sistema-cerebro-agentes'; }

# El hub en Docker puede responder una vez y colgarse justo despues (el healthcheck
# lo da por bueno y luego el event loop se bloquea). No basta con una respuesta:
# se exige que responda varias veces seguidas y cada vez en poco tiempo.
test_hub_estable(){
  _p="$1"
  for _ in 1 2 3; do
    _s=$(date +%s%N)
    test_hub "$_p" || return 1
    _d=$(( ($(date +%s%N) - _s) / 1000000 ))
    [ "$_d" -gt 3000 ] && return 1
    sleep 0.4
  done
  return 0
}

stop_puerto(){
  p="$1"
  lsof -ti tcp:"$p" 2>/dev/null | xargs -r kill 2>/dev/null || true
}

ajustes(){ node "$CONFIG_MJS" resolver "$HOME" "${FLAGS[@]+"${FLAGS[@]}"}" 2>/dev/null; }
campo(){ printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(String(JSON.parse(s)[process.argv[1]]??""))}catch{console.log("")}})' "$2"; }

# ------------------------------------------------------------------ estado
leer_estado(){ [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo '{}'; }

# Otras consolas en marcha (su proceso sigue vivo). El hub y el panel son
# compartidos: si hay otra consola viva, no se apagan. Un PID puede reutilizarse:
# un estado con el MISMO pid que esta sesion es un fichero viejo, no otra consola.
consolas_vivas(){
  propio_pid="$1"
  n=0
  for f in "$SYSTEM_DIR"/consola-estado*.json; do
    [ -f "$f" ] || continue
    [ -n "${STATE_FILE:-}" ] && [ "$f" = "$STATE_FILE" ] && continue
    pid=$(campo "$(cat "$f")" pid)
    [ -n "$pid" ] || continue
    [ "$pid" = "$propio_pid" ] && continue
    kill -0 "$pid" 2>/dev/null && n=$((n + 1))
  done
  echo "$n"
}

parar_todo(){
  estado="$(leer_estado)"
  hub_on=$(campo "$estado" hub);  hub_on=${hub_on:-true}
  panel_on=$(campo "$estado" panel); panel_on=${panel_on:-true}
  srv_on=$(campo "$estado" servidor); srv_on=${srv_on:-false}
  p_hub=$(campo "$estado" puertoHub); p_hub=${p_hub:-4597}
  p_panel=$(campo "$estado" puertoPanel); p_panel=${p_panel:-4598}

  say ''
  say '  Apagando...'

  otras="$(consolas_vivas "$(campo "$estado" pid)")"
  if [ "$otras" -gt 0 ] && [ "${FORZAR:-0}" != "1" ]; then
    say "  Hay $otras consola(s) mas en marcha: el hub y el panel se quedan."
    rm -f "$STATE_FILE"
    return
  fi

  if [ "$srv_on" = "true" ]; then
    s="$(servidor_script)" && bash "$s" --stop >/dev/null 2>&1
    ok 'Servidor OpenCode V1 detenido.'
  fi
  if [ "$panel_on" = "true" ]; then
    stop_puerto "$p_panel"
    rm -f "$SYSTEM_DIR/web-port.txt"
    ok 'Panel web detenido.'
  fi
  if [ "$hub_on" = "true" ]; then
    c="$(compose_path)"
    # Si el hub arranco nativo, no hay que parar el contenedor de Docker.
    modo_hub=$(campo "$estado" hubModo)
    if [ -n "$c" ] && [ "$modo_hub" != "nativo" ] && command -v docker >/dev/null 2>&1; then
      # Se espera a que el contenedor este en marcha antes de pararlo: pararlo
      # mientras arranca puede dejarlo en un estado raro (colgado).
      _i=0
      while [ "$_i" -lt 30 ]; do
        _e=$(docker inspect cerebro-hub --format '{{.State.Status}}' 2>/dev/null || true)
        [ "$_e" = "running" ] && break
        sleep 1
        _i=$((_i + 1))
      done
      # `stop`, no `down`: el contenedor y los volumenes se quedan.
      docker compose -f "$c" stop >/dev/null 2>&1
      ok 'Hub detenido (el contenedor y sus datos se conservan).'
    else
      stop_puerto "$p_hub"
      ok 'Hub nativo detenido.'
    fi
    rm -f "$SYSTEM_DIR/hub-port.txt"
  fi
  rm -f "$STATE_FILE"
}

# ------------------------------------------------------------------ acciones
case "$ACCION" in
  estado)
    A="$(ajustes)"
    p_hub=$(campo "$A" puertoHub); p_panel=$(campo "$A" puertoPanel)
    printf '\n  Estado del Cerebro\n'
    if test_hub "$p_hub"; then echo "    hub   : en marcha  (http://127.0.0.1:$p_hub)"; else echo "    hub   : apagado"; fi
    if test_panel "$p_panel"; then echo "    panel : en marcha  (http://127.0.0.1:$p_panel)"; else echo "    panel : apagado"; fi
    exit 0 ;;
  config)
    A="$(ajustes)"
    printf '\n  Ajustes de la consola\n'
    printf '    hub         : %s\n' "$( [ "$(campo "$A" hub)" = "true" ] && echo 'se levanta' || echo 'no se levanta')"
    printf '    panel       : %s\n' "$( [ "$(campo "$A" panel)" = "true" ] && echo 'se levanta' || echo 'no se levanta')"
    printf '    navegador   : %s\n' "$( [ "$(campo "$A" navegador)" = "true" ] && echo 'se abre' || echo 'no se abre')"
    printf '    servidor V1 : %s\n' "$( [ "$(campo "$A" servidor)" = "true" ] && echo 'se levanta' || echo 'lo arranca el MCP solo')"
    printf '    puertos     : hub %s - panel %s\n' "$(campo "$A" puertoHub)" "$(campo "$A" puertoPanel)"
    printf '    fichero     : %s\n' "$SYSTEM_DIR/consola.json"
    exit 0 ;;
  parar)
    # Sin --estado explicito se para lo que haya en marcha.
    if [ -z "${STATE_FILE:-}" ]; then
      found=0
      for f in "$SYSTEM_DIR"/consola-estado*.json; do
        [ -f "$f" ] || continue
        found=1
        STATE_FILE="$f"
        parar_todo
      done
      [ "$found" -eq 0 ] && say '  No hay ninguna consola en marcha.'
    else
      parar_todo
    fi
    exit 0 ;;
esac

# ------------------------------------------------------------------ consola
# El nombre lleva el PID: dos consolas a la vez no se pisan el estado.
STATE_FILE="$SYSTEM_DIR/consola-estado-$$.json"
LATIDO_FILE="$SYSTEM_DIR/consola-latido-$$.txt"
mkdir -p "$SYSTEM_DIR"

A="$(ajustes)"
[ -z "$A" ] && { err 'No se pudieron leer los ajustes (falta Node.js).'; exit 1; }

if printf '%s' "${FLAGS[@]+"${FLAGS[@]}"}" | grep -q -- '--guardar'; then
  ok "Ajustes guardados en $SYSTEM_DIR/consola.json"
fi

printf '\n  C E R E B R O   -   consola\n'
printf '  ---------------------------\n'

p_hub=$(campo "$A" puertoHub); p_panel=$(campo "$A" puertoPanel)
hub_modo=""
panel_on="false"

if [ "$(campo "$A" hub)" = "true" ]; then
  say '  Levantando el hub (Docker)...'
  c="$(compose_path)"
  if [ -n "$c" ] && command -v docker >/dev/null 2>&1 && docker compose -f "$c" up -d >/dev/null 2>&1; then
    # El contenedor puede tardar en pasar a healthy tras un arranque en frio.
    for _ in $(seq 1 90); do test_hub_estable "$p_hub" && break; sleep 1; done
    if test_hub_estable "$p_hub"; then
      ok "Hub en marcha: http://127.0.0.1:$p_hub"; hub_modo="docker"
    else
      warn 'El contenedor del hub no respondio de forma estable; se intenta el hub nativo.'
      docker compose -f "$c" stop >/dev/null 2>&1
    fi
  fi
  # Nativo: mismo hub, pero en el host. Red de seguridad cuando Docker no responde.
  if [ -z "$hub_modo" ]; then
    h="$(hub_script)"
    if [ -n "$h" ]; then
      say '  Levantando el hub (nativo)...'
      ( nohup node "$h" --port="$p_hub" >/dev/null 2>&1 & ) >/dev/null 2>&1
      for _ in $(seq 1 30); do test_hub_estable "$p_hub" && break; sleep 1; done
      if test_hub_estable "$p_hub"; then ok "Hub en marcha: http://127.0.0.1:$p_hub"; hub_modo="nativo"; fi
    fi
  fi
  [ -z "$hub_modo" ] && err 'El hub no arranco.'
else
  say '  Hub omitido (ajuste).'
fi

if [ "$(campo "$A" panel)" = "true" ]; then
  say '  Levantando el panel web...'
  ps="$(panel_script)"
  if [ -n "$ps" ]; then
    ( nohup node "$ps" --port="$p_panel" >/dev/null 2>&1 & ) >/dev/null 2>&1
    for _ in $(seq 1 30); do test_panel "$p_panel" && break; sleep 1; done
    if test_panel "$p_panel"; then
      ok "Panel en marcha: http://127.0.0.1:$p_panel"
      printf '%s' "$p_panel" > "$SYSTEM_DIR/web-port.txt"
      panel_on="true"
    else
      err 'El panel web no respondio.'
    fi
  fi
else
  say '  Panel omitido (ajuste).'
fi

srv_on="false"
if [ "$(campo "$A" servidor)" = "true" ]; then
  s="$(servidor_script)"
  if [ -n "$s" ]; then
    say '  Levantando el servidor OpenCode V1...'
    bash "$s" >/dev/null 2>&1 && { ok 'Servidor OpenCode V1 en marcha.'; srv_on="true"; }
  fi
fi

cat > "$STATE_FILE" <<EOF
{
  "hub": $( [ "$(campo "$A" hub)" = "true" ] && echo true || echo false ),
  "hubModo": "${hub_modo}",
  "panel": ${panel_on},
  "servidor": ${srv_on},
  "puertoHub": ${p_hub},
  "puertoPanel": ${p_panel},
  "pid": $$,
  "inicio": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# El vigilante vigila el latido: al cerrarse la ventana, apaga todo.
# El latido se crea ANTES de lanzarlo (si no, el vigilante veria el fichero ausente
# y apagaria todo de inmediato).
touch "$LATIDO_FILE" 2>/dev/null || true
VIGILANTE="$ROOT/consola-vigilante.sh"
[ -f "$VIGILANTE" ] || VIGILANTE="$SYSTEM_DIR/consola-vigilante.sh"
if [ -f "$VIGILANTE" ]; then
  ( nohup bash "$VIGILANTE" --padre "$$" --latido "$LATIDO_FILE" --estado "$STATE_FILE" --consola "$ROOT/consola.sh" >/dev/null 2>&1 & ) >/dev/null 2>&1
fi

if [ "$(campo "$A" navegador)" = "true" ] && { [ -n "$hub_modo" ] || [ "$panel_on" = "true" ]; }; then
  url="http://127.0.0.1:$p_panel"
  [ -n "$hub_modo" ] && url="http://127.0.0.1:$p_hub"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true; fi
fi

printf '\n'
[ -n "$hub_modo" ] && printf '  Cerebro Hub  : http://127.0.0.1:%s\n' "$p_hub"
[ "$panel_on" = "true" ] && printf '  Panel web    : http://127.0.0.1:%s\n' "$p_panel"
printf '\n  Cierra esta ventana (o pulsa Ctrl+C) para apagar todo.\n'
printf '  La configuracion y los datos se conservan.\n\n'

trap 'parar_todo; rm -f "$LATIDO_FILE"; exit 0' INT TERM EXIT

while true; do
  touch "$LATIDO_FILE" 2>/dev/null || true
  sleep 2
done
