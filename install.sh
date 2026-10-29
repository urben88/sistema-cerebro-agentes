#!/usr/bin/env bash
# sistema-cerebro-agentes — instalador para macOS y Linux
# Uso: bash install.sh [--check] [--force] [--reinstalar] [--sin-verificar]
#   --check          solo comprueba prerrequisitos y qué haría con cada componente
#   --force          no pregunta: lo cambiado a mano se conserva y se avisa en el resumen
#   --reinstalar     ignora el registro y reinstala todos los componentes
#   --sin-verificar  no ejecuta verificar --smoke al terminar
# Lleva un registro de lo instalado (~/.sistema-cerebro-agentes/instalado.json): solo actualiza
# lo que cambió en el repo y pregunta antes de pisar lo que se cambió a mano. Un error en un
# paso no corta los demás; lo que falla a medias se restaura desde su copia. Todo queda en
# ~/.sistema-cerebro-agentes/logs/install-<fecha>.log. Sale con código 1 si hubo errores.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_ROOT="$REPO_ROOT/config"
SYSTEM_DIR="$HOME/.sistema-cerebro-agentes"
SERVER_DIR="$SYSTEM_DIR/server"
SERVER_BIN="$SERVER_DIR/node_modules/.bin/opencode"
LAUNCHER="$SYSTEM_DIR/launcher.sh"
VERSION_SERVIDOR="1.18.35"
VERSION_GENTLE="4.3.1"
VERSION_PLUGIN_OC="2.0.4"
VERSION_SISTEMA="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
MARKER_BEGIN='<!-- BEGIN sistema-cerebro-agentes -->'
MARKER_END='<!-- END sistema-cerebro-agentes -->'
FECHA="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="$SYSTEM_DIR/backups"
BACKUP_DIR="$BACKUP_ROOT/$FECHA"
REGISTRO="$SYSTEM_DIR/instalado.json"
HELPER="$REPO_ROOT/scripts/instalado.mjs"
LOG_PATH="$SYSTEM_DIR/logs/install-$FECHA.log"

CHECK=0; FORCE=0; REINSTALAR=0; SIN_VERIFICAR=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    --reinstalar) REINSTALAR=1 ;;
    --sin-verificar) SIN_VERIFICAR=1 ;;
    *) echo "Argumento desconocido: $arg (opciones: --check --force --reinstalar --sin-verificar)"; exit 2 ;;
  esac
done
INTERACTIVO=0
if [ "$FORCE" -eq 0 ] && [ -t 0 ]; then INTERACTIVO=1; fi

C_OK=""; C_WARN=""; C_ERR=""; C_STEP=""; C_NOTE=""; C_OFF=""
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_STEP=$'\033[36m'; C_NOTE=$'\033[90m'; C_OFF=$'\033[0m'
fi
step(){ printf '\n=== %s ===\n' "$1"; }
ok(){   printf '  %s[OK]%s   %s\n' "$C_OK" "$C_OFF" "$1"; }
same(){ printf '  %s[=]    %s%s\n' "$C_NOTE" "$1" "$C_OFF"; }
warn(){ printf '  %s[!]%s    %s\n' "$C_WARN" "$C_OFF" "$1"; }
err(){  printf '  %s[X]%s    %s\n' "$C_ERR" "$C_OFF" "$1"; }
note(){ printf '  %s[info] %s%s\n' "$C_NOTE" "$1" "$C_OFF"; }

FATAL=()
WARNINGS=()
PASOS_N=(); PASOS_R=(); PASOS_D=(); PASOS_A=()
add_paso(){ PASOS_N+=("$1"); PASOS_R+=("$2"); PASOS_D+=("${3:-}"); PASOS_A+=("${4:-}"); }

backup_path(){ printf '%s/%s' "$BACKUP_DIR" "$(printf '%s' "$1" | sed 's|[/:\\ ]|_|g')"; }
backup_item(){
  local path="$1" dest
  [ -e "$path" ] || return 0
  mkdir -p "$BACKUP_DIR"
  dest="$(backup_path "$path")"
  # Solo la primera copia de esta ejecución: es la que hay que restaurar si algo falla.
  [ -e "$dest" ] && return 0
  cp -R "$path" "$dest"
  note "backup: $path"
}
restore_item(){
  local path="$1" existia="$2" b
  rm -rf "$path"
  b="$(backup_path "$path")"
  if [ "$existia" = 1 ] && [ -e "$b" ]; then cp -R "$b" "$path"; fi
}

registro(){ node "$HELPER" "$@"; }
estado_comp(){
  # estado_comp <nombre> <pares...>
  if [ "$REINSTALAR" -eq 1 ]; then printf 'reinstalar'; return 0; fi
  local e
  if e="$(registro estado "$REGISTRO" "$@" 2>&1)"; then printf '%s' "$e"; else warn "No se pudo leer el registro ($e); se instala $1" >&2; printf 'nuevo'; fi
}
leer_decision(){
  # leer_decision <nombre> <titulo> <pares...>
  local nombre="$1" titulo="$2" r; shift 2
  [ "$INTERACTIVO" -eq 1 ] || { printf 'n'; return 0; }
  while true; do
    printf '  %s se ha cambiado a mano. [s] sobrescribir (con copia) / [n] conservar / [d] ver diferencias: ' "$titulo" >&2
    read -r r || r=n
    r="$(printf '%s' "$r" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    case "$r" in
      s|n) printf '%s' "$r"; return 0 ;;
      d) registro diferencias "$REGISTRO" "$nombre" "$@" >&2 || true ;;
      *) note 'Responde s, n o d' >&2 ;;
    esac
  done
}
COMP_INSTALADO=0
instalar_componente(){
  # instalar_componente <nombre> <titulo> <funcion> <arreglo> <pares...>
  # Deja COMP_INSTALADO=1 si se ha instalado en esta ejecución.
  local nombre="$1" titulo="$2" fn="$3" arreglo="$4" est dec i rc causa
  shift 4
  COMP_INSTALADO=0
  est="$(estado_comp "$nombre" "$@")"
  if [ "$est" = igual ]; then same "$titulo sin cambios"; add_paso "$titulo" 'sin cambios'; return 0; fi
  if [ "$est" = tocado ]; then
    dec="$(leer_decision "$nombre" "$titulo" "$@")"
    if [ "$dec" != s ]; then
      warn "$titulo se ha cambiado a mano: se conserva lo tuyo"
      add_paso "$titulo" 'aviso' 'cambiado a mano; se ha conservado' 'Repite install.sh en una terminal y elige [d] para ver diferencias o [s] para reemplazarlo; o usa install.sh --reinstalar'
      return 0
    fi
  fi
  local pares=("$@") destinos=() existia=()
  for ((i = 1; i < ${#pares[@]}; i += 2)); do
    destinos+=("${pares[$i]}")
    if [ -e "${pares[$i]}" ]; then existia+=(1); else existia+=(0); fi
    backup_item "${pares[$i]}"
  done
  local errf; errf="$(mktemp)"
  set +e
  ( set -e; "$fn" ) 2>"$errf"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ] && registro registrar "$REGISTRO" "$nombre" "$@" 2>>"$errf"; then
    case "$est" in actualizar) add_paso "$titulo" 'OK' 'actualizado' ;; tocado) add_paso "$titulo" 'OK' 'reemplazado (copia en backups)' ;; *) add_paso "$titulo" 'OK' 'instalado' ;; esac
    COMP_INSTALADO=1
  else
    causa="$(tail -n 1 "$errf")"; [ -n "$causa" ] || causa="código $rc"
    local restaurado=1
    for ((i = 0; i < ${#destinos[@]}; i++)); do restore_item "${destinos[$i]}" "${existia[$i]}" || restaurado=0; done
    if [ "$restaurado" -eq 1 ]; then err "$titulo falló: $causa (se ha restaurado lo anterior)"
    else err "$titulo falló: $causa (no se pudo restaurar todo; copia en $BACKUP_DIR)"; causa="$causa (restauración incompleta; copia en $BACKUP_DIR)"; fi
    add_paso "$titulo" 'error' "$causa" "$arreglo"
  fi
  rm -f "$errf"
}

gentle_exe(){
  # El script oficial y go install dejan el binario en sitios que pueden no estar en el PATH de esta sesión.
  local c
  if command -v gentle-ai >/dev/null 2>&1; then command -v gentle-ai; return 0; fi
  for c in "$HOME/go/bin/gentle-ai" "$HOME/.local/bin/gentle-ai" "/usr/local/bin/gentle-ai" "$(go env GOPATH 2>/dev/null)/bin/gentle-ai"; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
gentle_version(){ "$1" version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true; }

# ---------------------------------------------------------------- Componentes (spec 25 · S1)
AGENT_DIR="$HOME/.claude/agents"
AGENTES_CL=(cerebro.md subdirector.md explorador.md redactor.md analista.md arquitecto.md adaptador-mcps.md planificador.md resolutor.md ayudante.md retocador.md consultor.md)
AGENTS_DST="$HOME/.config/opencode/agents"
SKILL_DST="$HOME/.claude/skills/delegar-a-opencode"
CMD_DST="$HOME/.claude/commands/odd"
P_MCP=("$CONFIG_ROOT/mcp/servidor.sh" "$SYSTEM_DIR/servidor.sh" "$CONFIG_ROOT/mcp/launcher.sh" "$LAUNCHER" "$CONFIG_ROOT/mcp/triaje-mcp.mjs" "$SYSTEM_DIR/mcp/triaje-mcp.mjs")
P_PANEL=("$CONFIG_ROOT/web" "$SYSTEM_DIR/web" "$REPO_ROOT/scripts/panel.sh" "$SYSTEM_DIR/panel.sh")
P_HUB=("$CONFIG_ROOT/hub" "$SYSTEM_DIR/hub" "$CONFIG_ROOT/hub/hub.sh" "$SYSTEM_DIR/hub.sh")
P_HOOKS=("$CONFIG_ROOT/hooks" "$SYSTEM_DIR/hooks")
P_MODS=("$CONFIG_ROOT/mods" "$SYSTEM_DIR/mods")
P_AGENTES_CL=(); for f in "${AGENTES_CL[@]}"; do P_AGENTES_CL+=("$CONFIG_ROOT/claude/agents/$f" "$AGENT_DIR/$f"); done
P_COMANDOS=("$CONFIG_ROOT/claude/commands/odd" "$CMD_DST")
P_SKILL=("$CONFIG_ROOT/claude/skills/delegar-a-opencode" "$SKILL_DST")
P_AGENTES_OC=(); for f in "$CONFIG_ROOT/opencode/agents/"*.md; do P_AGENTES_OC+=("$f" "$AGENTS_DST/$(basename "$f")"); done
P_DOCKER=("$REPO_ROOT/docker" "$SYSTEM_DIR/docker")
COMPONENTES=(mcp panel hub hooks mods agentes-claude comandos skill agentes-opencode docker)
[ -d "$CONFIG_ROOT/mods" ] || COMPONENTES=(mcp panel hub hooks agentes-claude comandos skill agentes-opencode docker)
pares_de(){
  case "$1" in
    mcp) printf '%s\n' "${P_MCP[@]}" ;; panel) printf '%s\n' "${P_PANEL[@]}" ;; hub) printf '%s\n' "${P_HUB[@]}" ;;
    hooks) printf '%s\n' "${P_HOOKS[@]}" ;; mods) printf '%s\n' "${P_MODS[@]}" ;; agentes-claude) printf '%s\n' "${P_AGENTES_CL[@]}" ;;
    comandos) printf '%s\n' "${P_COMANDOS[@]}" ;; skill) printf '%s\n' "${P_SKILL[@]}" ;; agentes-opencode) printf '%s\n' "${P_AGENTES_OC[@]}" ;;
    docker) printf '%s\n' "${P_DOCKER[@]}" ;;
  esac
}

if [ "$CHECK" -eq 0 ]; then
  mkdir -p "$(dirname "$LOG_PATH")"
  exec > >(tee -a "$LOG_PATH") 2>&1
fi

# ---------------------------------------------------------------- 1. Prerrequisitos
step 'Prerrequisitos'

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$NODE_MAJOR" -lt 22 ]; then
    err "Node $(node --version) (se necesita >= 22)"
    FATAL+=("Actualiza Node.js a la versión 22 o superior: https://nodejs.org")
  else
    ok "Node $(node --version)"
  fi
else
  err 'Node.js no encontrado'
  FATAL+=('Instala Node.js 22 o superior: https://nodejs.org')
fi

command -v npx >/dev/null 2>&1 && ok 'npx disponible' || { err 'npx no encontrado'; FATAL+=('npx no encontrado (viene con Node.js >= 22)'); }

if command -v opencode >/dev/null 2>&1; then
  ok "OpenCode $(opencode --version 2>/dev/null | head -n1) (para tu TUI; el MCP usará el servidor V1 propio)"
else
  warn 'OpenCode no encontrado (no es imprescindible para el MCP, pero lo usarás como TUI)'
fi

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -n1)"
else
  err 'Claude Code no encontrado'
  FATAL+=('Instala Claude Code: https://claude.com/claude-code')
fi

AUTH_JSON="$HOME/.local/share/opencode/auth.json"
if [ -f "$AUTH_JSON" ] && grep -q '"deepseek"' "$AUTH_JSON"; then
  ok 'Proveedor DeepSeek (oficial) conectado'
else
  warn 'DeepSeek no está conectado en OpenCode'
  WARNINGS+=("Conecta DeepSeek en OpenCode: ejecuta 'opencode auth login' (o /connect en la TUI)")
fi
if [ -f "$AUTH_JSON" ] && grep -q '"openrouter"' "$AUTH_JSON"; then
  warn 'OpenRouter sigue conectado en OpenCode; este sistema ya no lo usa (puedes retirarlo con: opencode auth logout OpenRouter)'
fi

if command -v docker >/dev/null 2>&1; then ok 'Docker disponible (hub en contenedor)'; else warn 'Docker no encontrado: el hub podrá ejecutarse en nativo (hub.sh)'; fi

# Gentle AI (spec 20): aquí solo se lee; la instalación va en su paso.
if GENTLE_EXE="$(gentle_exe)"; then
  GV="$(gentle_version "$GENTLE_EXE")"
  if [ "$GV" = "$VERSION_GENTLE" ]; then ok "Gentle AI $GV"; else warn "Gentle AI ${GV:-?} (versión fijada: $VERSION_GENTLE); se usa la instalada"; WARNINGS+=("Gentle AI instalado es ${GV:-?} y el sistema está probado con $VERSION_GENTLE"); fi
else
  warn 'Gentle AI no encontrado: install lo instalará con el script oficial (última versión estable)'
fi
if [ -f "$HOME/.claude/CLAUDE.md" ] && grep -q 'gentle-ai:' "$HOME/.claude/CLAUDE.md"; then ok 'Bloques gentle-ai:* presentes en ~/.claude/CLAUDE.md'; else note 'Aún no hay bloques gentle-ai:* en ~/.claude/CLAUDE.md (los escribirá install)'; fi
if [ -d "$HOME/.claude/gentle-ai/orchestrator" ]; then ok 'Orquestador modular de Gentle AI presente'; else note 'Aún no hay orquestador modular en ~/.claude/gentle-ai/orchestrator (lo escribirá install)'; fi

if [ "${#FATAL[@]}" -gt 0 ]; then
  printf '\nFaltan prerrequisitos obligatorios:\n' >&2
  for p in "${FATAL[@]}"; do printf '  - %s\n' "$p" >&2; done
  exit 1
fi

if [ "$CHECK" -eq 1 ]; then
  step 'Qué haría install con cada componente'
  if [ -f "$REGISTRO" ]; then note "Registro: $REGISTRO"; else note 'Sin registro de instalación previa: se instalaría todo'; fi
  for n in "${COMPONENTES[@]}"; do
    PS=(); while IFS= read -r l; do PS+=("$l"); done < <(pares_de "$n")
    case "$(estado_comp "$n" "${PS[@]}")" in
      igual) same "$n: sin cambios (se salta)" ;;
      actualizar) note "$n: cambio en el repo (se actualizaría con copia)" ;;
      tocado) warn "$n: cambiado a mano (preguntaría: sobrescribir / conservar / ver diferencias)" ;;
      reinstalar) note "$n: se reinstalaría (--reinstalar)" ;;
      *) note "$n: se instalaría" ;;
    esac
  done
  printf '\nOpciones: --reinstalar (reinstala todo), --force (no pregunta; conserva lo cambiado a mano), --sin-verificar (sin verificar --smoke al final).\n'
  printf 'Comprobación terminada (modo --check; no se ha cambiado nada).\n'
  for w in "${WARNINGS[@]:-}"; do [ -n "$w" ] && warn "$w"; done
  exit 0
fi

[ "$REINSTALAR" -eq 0 ] || note '--reinstalar: se ignora el registro y se reinstala todo'
[ "$INTERACTIVO" -eq 1 ] || note 'Sin preguntas (--force o terminal no interactiva): lo cambiado a mano se conserva'

# ---------------------------------------------------------------- 2. Servidor OpenCode V1
step "Servidor OpenCode V1 (opencode-ai $VERSION_SERVIDOR)"

mkdir -p "$SERVER_DIR"
[ -f "$SERVER_DIR/package.json" ] || printf '{"name":"cerebro-server","private":true}\n' > "$SERVER_DIR/package.json"

NEED_INSTALL=1
if [ -x "$SERVER_BIN" ]; then
  if [ "$("$SERVER_BIN" --version 2>/dev/null | head -n1)" = "$VERSION_SERVIDOR" ]; then
    NEED_INSTALL=0
    same "opencode-ai $VERSION_SERVIDOR ya instalado"
    add_paso 'Servidor OpenCode V1' 'sin cambios'
  fi
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  note "Instalando opencode-ai@$VERSION_SERVIDOR con npm (puede tardar un par de minutos)…"
  if NPM_OUT="$(npm install --prefix "$SERVER_DIR" "opencode-ai@$VERSION_SERVIDOR" --no-audit --no-fund 2>&1)" && [ -x "$SERVER_BIN" ]; then
    ok "opencode-ai $VERSION_SERVIDOR instalado"
    add_paso 'Servidor OpenCode V1' 'OK' "opencode-ai $VERSION_SERVIDOR"
  else
    err 'No se pudo instalar opencode-ai'
    printf '%s\n' "${NPM_OUT:-}" | tail -n 15
    add_paso 'Servidor OpenCode V1' 'error' 'npm no pudo instalar opencode-ai (salida en el log)' "npm install --prefix \"$SERVER_DIR\" opencode-ai@$VERSION_SERVIDOR"
  fi
fi

# ---------------------------------------------------------------- 3. Lanzador del MCP
step 'Lanzador del MCP'
mkdir -p "$SYSTEM_DIR"
inst_mcp(){
  mkdir -p "$SYSTEM_DIR/mcp"
  local i
  for ((i = 0; i < ${#P_MCP[@]}; i += 2)); do
    cp -f "${P_MCP[$i]}" "${P_MCP[$((i + 1))]}"
    ok "Instalado: ${P_MCP[$((i + 1))]}"
  done
  chmod +x "$SYSTEM_DIR/servidor.sh" "$LAUNCHER"
}
instalar_componente mcp 'Lanzador del MCP' inst_mcp 'Repite install.sh; si persiste, revisa permisos de ~/.sistema-cerebro-agentes' "${P_MCP[@]}"

# ---------------------------------------------------------------- 3b. Panel web
step 'Panel web en tiempo real'
inst_panel(){
  rm -rf "$SYSTEM_DIR/web"
  cp -R "$CONFIG_ROOT/web" "$SYSTEM_DIR/web"
  ok "Panel instalado: $SYSTEM_DIR/web"
  cp -f "$REPO_ROOT/scripts/panel.sh" "$SYSTEM_DIR/panel.sh"
  chmod +x "$SYSTEM_DIR/panel.sh"
  ok "Instalado: $SYSTEM_DIR/panel.sh"
}
instalar_componente panel 'Panel web' inst_panel 'Cierra el panel (panel.sh --stop) y repite install.sh' "${P_PANEL[@]}"
PANEL_NUEVO=$COMP_INSTALADO
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ repoRoot: process.argv[2] }, null, 2) + "\n")' "$SYSTEM_DIR/panel-config.json" "$REPO_ROOT"

# Si el panel estaba abierto y ha cambiado, reiniciarlo para aplicar la versión nueva
if [ "$PANEL_NUEVO" -eq 1 ] && [ -f "$SYSTEM_DIR/web-port.txt" ] && curl -fsS --max-time 3 "http://127.0.0.1:$(tr -d '[:space:]' < "$SYSTEM_DIR/web-port.txt")/api/ping" 2>/dev/null | grep -q 'sistema-cerebro-agentes'; then
  bash "$SYSTEM_DIR/panel.sh" --stop >/dev/null 2>&1 || true
  sleep 1
  bash "$SYSTEM_DIR/panel.sh" --no-open >/dev/null 2>&1 || true
  ok 'Panel web reiniciado con la versión nueva'
fi

# ---------------------------------------------------------------- 3c. Cerebro Hub
step 'Cerebro Hub (memoria compartida, hooks y trabajos)'
inst_hub(){
  rm -rf "$SYSTEM_DIR/hub"
  cp -R "$CONFIG_ROOT/hub" "$SYSTEM_DIR/hub"
  ok "Hub instalado: $SYSTEM_DIR/hub"
  cp -f "$CONFIG_ROOT/hub/hub.sh" "$SYSTEM_DIR/hub.sh"
  chmod +x "$SYSTEM_DIR/hub.sh"
  ok "Lanzador instalado: $SYSTEM_DIR/hub.sh"
}
instalar_componente hub 'Cerebro Hub' inst_hub 'Para el hub (docker compose down o hub.sh --stop) y repite install.sh' "${P_HUB[@]}"
HUB_NUEVO=$COMP_INSTALADO

inst_hooks(){
  rm -rf "$SYSTEM_DIR/hooks"
  cp -R "$CONFIG_ROOT/hooks" "$SYSTEM_DIR/hooks"
  ok "Hooks instalados: $SYSTEM_DIR/hooks"
}
instalar_componente hooks 'Hooks de contexto' inst_hooks 'Cierra las sesiones de Claude Code abiertas y repite install.sh' "${P_HOOKS[@]}"

# Sonido al terminar (spec 22 · S6): crea la carpeta y deja el README; NO toca los fin.* del usuario.
mkdir -p "$SYSTEM_DIR/sonidos"
cp -f "$CONFIG_ROOT/sonidos/README.md" "$SYSTEM_DIR/sonidos/README.md"

if [ -d "$CONFIG_ROOT/mods" ]; then
  inst_mods(){
    rm -rf "$SYSTEM_DIR/mods"
    cp -R "$CONFIG_ROOT/mods" "$SYSTEM_DIR/mods"
    ok "Mods instalados: $SYSTEM_DIR/mods"
  }
  instalar_componente mods 'Mods de Claude Code' inst_mods 'Cierra Claude Code (usa los mods) y repite install.sh' "${P_MODS[@]}"
fi

# ---------------------------------------------------------------- 3d. Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills)
# Va ANTES de lo nuestro: así nuestros agentes, el bloque de CLAUDE.md, los permisos y el
# default_agent se aplican encima y no los pisa el componente permissions de gentle-ai.
# Spec 25 · S5: solo se ejecuta si falta, cambia la versión o cambia su configuración.
step "Gentle AI $VERSION_GENTLE (Claude Code + OpenCode)"
GENTLE_CORRIO=0
if [ -n "${SIN_GENTLE_AI:-}" ]; then
  note 'SIN_GENTLE_AI: se omite Gentle AI'
  add_paso 'Gentle AI' 'sin cambios' 'omitido (SIN_GENTLE_AI)'
else
  GENTLE_RECIEN=0
  if ! GENTLE_EXE="$(gentle_exe)"; then
    note 'Instalando Gentle AI con el script oficial (instala la última versión estable)...'
    if curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash >/dev/null 2>&1; then :; else err 'El script oficial de Gentle AI falló'; fi
    GENTLE_EXE="$(gentle_exe)" || GENTLE_EXE=''
    if [ -n "$GENTLE_EXE" ]; then ok "gentle-ai instalado: $GENTLE_EXE"; GENTLE_RECIEN=1
    else add_paso 'Gentle AI' 'error' 'gentle-ai no está instalado y no se pudo instalar' 'curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash  y repite install.sh'; fi
  fi
  if [ -n "${GENTLE_EXE:-}" ]; then
    GV="$(gentle_version "$GENTLE_EXE")"
    [ "$GV" = "$VERSION_GENTLE" ] || warn "Gentle AI ${GV:-?} (fijada: $VERSION_GENTLE); se usa la instalada"
    CON_OPENCODE=0; command -v opencode >/dev/null 2>&1 && CON_OPENCODE=1
    if [ "$CON_OPENCODE" -eq 1 ]; then AGENTES_G='claude-code,opencode'; else AGENTES_G='claude-code'; fi
    GENTLE_ARGS=(install --agents "$AGENTES_G" --preset full-gentleman --persona neutral --claude-orchestrator-modules)
    GENTLE_CFG="version=$GV ${GENTLE_ARGS[*]}"
    GENTLE_PREV="$(registro valor "$REGISTRO" gentle-ai 2>/dev/null || true)"
    HAY_BLOQUES=0; [ -f "$HOME/.claude/CLAUDE.md" ] && grep -q 'gentle-ai:' "$HOME/.claude/CLAUDE.md" && HAY_BLOQUES=1
    MOTIVO=''
    if [ "$REINSTALAR" -eq 1 ]; then MOTIVO='--reinstalar'
    elif [ "$GENTLE_RECIEN" -eq 1 ]; then MOTIVO='recién instalado'
    elif [ -z "$GENTLE_PREV" ]; then MOTIVO='sin registro previo'
    elif [ "$GENTLE_PREV" != "$GENTLE_CFG" ]; then MOTIVO='cambio de versión o de configuración'
    elif [ "$HAY_BLOQUES" -eq 0 ]; then MOTIVO='faltan los bloques gentle-ai:* en CLAUDE.md'
    fi

    if [ -z "$MOTIVO" ]; then
      same "Gentle AI $GV sin cambios (misma versión y configuración)"
      add_paso 'Gentle AI' 'sin cambios'
    else
      note "Se ejecuta gentle-ai install: $MOTIVO"
      # Backup de lo que gentle-ai toca (no carpetas enteras: projects/ y node_modules son enormes)
      for rel in .claude/CLAUDE.md .claude/settings.json .claude/agents .claude/skills .config/opencode/opencode.jsonc .config/opencode/package.json .config/opencode/.gentle-ai-default-agent.json .config/opencode/agents .config/opencode/AGENTS.md; do
        backup_item "$HOME/$rel"
      done

      if [ "$CON_OPENCODE" -eq 1 ]; then
        # gentle-ai exige @opencode/plugin en la carpeta de configuración de OpenCode
        OC_CFG="$HOME/.config/opencode"
        PLUG_VER="$(node -e 'try{console.log(require(process.argv[1]).version)}catch{}' "$OC_CFG/node_modules/@opencode/plugin/package.json" 2>/dev/null || true)"
        if [ "$PLUG_VER" != "$VERSION_PLUGIN_OC" ]; then
          mkdir -p "$OC_CFG"
          if npm install --prefix "$OC_CFG" --save-exact "@opencode/plugin@$VERSION_PLUGIN_OC" --no-audit --no-fund >/dev/null 2>&1; then
            ok "@opencode/plugin@$VERSION_PLUGIN_OC instalado en ~/.config/opencode"
          else
            warn "No se pudo instalar @opencode/plugin@$VERSION_PLUGIN_OC"
            add_paso '@opencode/plugin' 'aviso' 'npm no pudo instalarlo' "npm install --prefix \"$OC_CFG\" --save-exact @opencode/plugin@$VERSION_PLUGIN_OC"
          fi
        fi
      else
        warn 'OpenCode no encontrado: Gentle AI se configura solo para Claude Code'
      fi

      # gentle-ai sube defaultMode a bypassPermissions; permisos.mjs (paso 5b) lo devuelve.
      MODO_PREVIO="$(node -e "try{const s=require(process.argv[1]);process.stdout.write(String((s.permissions||{}).defaultMode||'(ninguno)'))}catch{process.stdout.write('(ninguno)')}" "$HOME/.claude/settings.json" 2>/dev/null || echo '(ninguno)')"
      export MODO_PREVIO
      note "gentle-ai ${GENTLE_ARGS[*]}"
      if GR="$("$GENTLE_EXE" "${GENTLE_ARGS[@]}" 2>&1)"; then
        ok 'Gentle AI configurado (ODD, RDD, Engram, CodeGraph, Context7, skills)'
        GENTLE_CORRIO=1
        registro valor "$REGISTRO" gentle-ai "$GENTLE_CFG" || warn 'No se pudo guardar gentle-ai en el registro'
        add_paso 'Gentle AI' 'OK' "$MOTIVO"
      else
        err 'gentle-ai install no terminó bien'
        printf '%s\n' "$GR" | tail -n 15
        add_paso 'Gentle AI' 'error' 'gentle-ai install terminó con error' "Revisa su salida en $LOG_PATH y repite install.sh --reinstalar"
      fi
    fi
    # Spec 23 · S6 · Engram es la memoria del sistema (los hooks la usan junto al hub).
    if EV="$(engram version 2>&1)" && printf '%s' "$EV" | grep -qi engram; then
      ok "Engram responde ($EV): memoria de decisiones y sesiones"
    else
      warn 'Engram no responde: los hooks seguirán solo con la memoria del hub'
      add_paso 'Engram' 'aviso' 'engram version no responde' 'Repite install.sh --reinstalar (gentle-ai instala Engram) o revisa el PATH; comprueba: engram version'
    fi
  fi
fi

# ---------------------------------------------------------------- 4. Agente cerebro (con el MCP dentro)
step 'Agente cerebro en Claude Code (con el MCP dentro)'

claude mcp remove opencode --scope user >/dev/null 2>&1 && note 'Retirado el registro global antiguo del MCP (ahora vive en el agente cerebro)' || true
ARGS_JSON='["'"$SYSTEM_DIR"'/launcher.sh"]'
TRIAJE_MCP="$SYSTEM_DIR/mcp/triaje-mcp.mjs"
# MCP de trabajos (trabajo_estado, parar_trabajos): global, para que `claude` a secas vea los trabajos; OpenCode solo dentro del agente cerebro.
claude mcp remove triaje --scope user >/dev/null 2>&1 || true
if claude mcp add --scope user triaje -- node "$TRIAJE_MCP" >/dev/null 2>&1; then ok "MCP de trabajos (triaje) registrado a nivel de usuario (modo normal)"; add_paso 'MCP triaje' 'OK'
else warn 'No se pudo registrar el MCP triaje global'; add_paso 'MCP triaje' 'aviso' 'claude mcp add falló' "claude mcp add --scope user triaje -- node \"$TRIAJE_MCP\""; fi
inst_agentes_cl(){
  mkdir -p "$AGENT_DIR"
  local f
  for f in "${AGENTES_CL[@]}"; do
    if [ "$f" = cerebro.md ] || [ "$f" = subdirector.md ]; then
      node -e 'const fs=require("fs");const [src,dst,cmd,args,mcp]=process.argv.slice(1);let t=fs.readFileSync(src,"utf8");t=t.replace("__COMANDO__",cmd).replace("__ARGUMENTOS_JSON__",args).replace("__TRIAJE_MCP__",mcp);fs.writeFileSync(dst,t)' "$CONFIG_ROOT/claude/agents/$f" "$AGENT_DIR/$f" "bash" "$ARGS_JSON" "$TRIAJE_MCP"
    else
      cp -f "$CONFIG_ROOT/claude/agents/$f" "$AGENT_DIR/$f"
    fi
    ok "Agente instalado: $AGENT_DIR/$f"
  done
}
instalar_componente agentes-claude 'Agentes de Claude Code' inst_agentes_cl 'Repite install.sh; si persiste, revisa permisos de ~/.claude/agents' "${P_AGENTES_CL[@]}"
note 'Actívalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
for f in cerebro cerebro-parar; do
  if [ -f "$BIN_DIR/$f" ] && cmp -s "$CONFIG_ROOT/bin/$f" "$BIN_DIR/$f"; then continue; fi
  backup_item "$BIN_DIR/$f"
  cp -f "$CONFIG_ROOT/bin/$f" "$BIN_DIR/$f"
  chmod +x "$BIN_DIR/$f"
  ok "Comando instalado: $BIN_DIR/$f"
done
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) note "Añade $BIN_DIR al PATH para usar 'cerebro' desde cualquier terminal" ;;
esac

# ---------------------------------------------------------------- 5. Rol Cerebro (Claude Code)
step 'Rol Cerebro en Claude Code'

set_managed_block(){
  local target="$1" blockfile="$2" tmp
  if [ ! -f "$target" ]; then
    mkdir -p "$(dirname "$target")"
    {
      printf '%s\n' "$MARKER_BEGIN"
      cat "$blockfile"
      printf '%s\n' "$MARKER_END"
    } > "$target"
    ok "Creado $target"
    return
  fi
  if grep -qF "$MARKER_BEGIN" "$target"; then
    tmp="$(mktemp)"
    awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" -v blockfile="$blockfile" '
      $0 == begin {
        print
        while ((getline line < blockfile) > 0) print line
        skip = 1
        next
      }
      $0 == end { skip = 0; print; next }
      !skip { print }
    ' "$target" > "$tmp"
    if cmp -s "$tmp" "$target"; then rm -f "$tmp"; same "Bloque sin cambios: $target"; return; fi
    backup_item "$target"
    mv "$tmp" "$target"
    ok "Bloque actualizado: $target"
  else
    backup_item "$target"
    {
      printf '\n%s\n' "$MARKER_BEGIN"
      cat "$blockfile"
      printf '%s\n' "$MARKER_END"
    } >> "$target"
    ok "Bloque añadido: $target"
  fi
}

if set_managed_block "$HOME/.claude/CLAUDE.md" "$CONFIG_ROOT/claude/CLAUDE.md"; then add_paso 'Bloque de CLAUDE.md' 'OK'
else err 'No se pudo escribir el bloque de CLAUDE.md'; add_paso 'Bloque de CLAUDE.md' 'error' 'no se pudo escribir ~/.claude/CLAUDE.md' 'Revisa permisos de ~/.claude/CLAUDE.md y repite install.sh'; fi

inst_skill(){
  mkdir -p "$(dirname "$SKILL_DST")"
  rm -rf "$SKILL_DST"
  cp -R "$CONFIG_ROOT/claude/skills/delegar-a-opencode" "$SKILL_DST"
  ok "Skill instalada: $SKILL_DST"
}
instalar_componente skill 'Skill delegar-a-opencode' inst_skill 'Repite install.sh' "${P_SKILL[@]}"

# Comandos /odd:* (spec 21 · S4): solo se reemplaza la carpeta odd; los comandos del usuario no se tocan.
inst_comandos(){
  mkdir -p "$(dirname "$CMD_DST")"
  rm -rf "$CMD_DST"
  cp -R "$CONFIG_ROOT/claude/commands/odd" "$CMD_DST"
  ok "Comandos /odd:* instalados: $CMD_DST"
}
instalar_componente comandos 'Comandos /odd:*' inst_comandos 'Repite install.sh' "${P_COMANDOS[@]}"

# ---------------------------------------------------------------- 5b. Ajustes de Claude (esfuerzos + hooks)
step 'Esfuerzos y hooks de contexto en Claude (settings.json)'
backup_item "$HOME/.claude/settings.json"
# Barra de estado (spec 15): plugin claude-hud; si no se puede instalar, queda el indicador propio.
if [ -n "${SIN_CLAUDE_HUD:-}" ]; then
  note 'SIN_CLAUDE_HUD: se mantiene el indicador propio'
else
  claude plugin marketplace add jarrodwatts/claude-hud >/dev/null 2>&1 || true
  if claude plugin install claude-hud@claude-hud >/dev/null 2>&1; then ok 'Plugin claude-hud instalado (barra de estado)'; else note 'No se pudo instalar claude-hud; se usa el indicador propio'; fi
fi
if MERGE_OUT="$(node "$SYSTEM_DIR/hub/settings-merge.mjs" "$SYSTEM_DIR/hooks" 2>&1)"; then
  ok "$MERGE_OUT"; add_paso 'settings.json (hooks y esfuerzos)' 'OK'
else
  err 'No se pudo actualizar settings.json'; printf '%s\n' "$MERGE_OUT"
  add_paso 'settings.json (hooks y esfuerzos)' 'error' "$(printf '%s' "$MERGE_OUT" | head -n1)" "Revisa que ~/.claude/settings.json sea JSON válido (copia en $BACKUP_DIR) y repite install.sh"
fi
# Permisos prudentes (spec 21 · S5): se unen a los que ya hay, sin quitar nada.
if PERM_OUT="$(node "$CONFIG_ROOT/claude/permisos.mjs" "$HOME/.claude/settings.json" 2>&1)"; then ok "$PERM_OUT"; add_paso 'Permisos de Claude' 'OK'
else err 'No se pudieron fusionar los permisos'; printf '%s\n' "$PERM_OUT"; add_paso 'Permisos de Claude' 'error' "$(printf '%s' "$PERM_OUT" | head -n1)" 'Revisa que ~/.claude/settings.json sea JSON válido y repite install.sh'; fi

# ---------------------------------------------------------------- 6. Agentes de OpenCode
step 'Agentes de OpenCode'
inst_agentes_oc(){
  mkdir -p "$AGENTS_DST"
  local i
  for ((i = 0; i < ${#P_AGENTES_OC[@]}; i += 2)); do
    cp -f "${P_AGENTES_OC[$i]}" "${P_AGENTES_OC[$((i + 1))]}"
    ok "Agente: ${P_AGENTES_OC[$((i + 1))]}"
  done
}
instalar_componente agentes-opencode 'Agentes de OpenCode' inst_agentes_oc 'Repite install.sh; si persiste, revisa permisos de ~/.config/opencode/agents' "${P_AGENTES_OC[@]}"
if [ -f "$AGENTS_DST/constructor.md" ]; then
  backup_item "$AGENTS_DST/constructor.md"
  rm -f "$AGENTS_DST/constructor.md"
  warn 'Retirado constructor.md (renombrado a implementador.md: era una palabra reservada de JavaScript que rompía el servidor V1)'
fi
for viejo in chat-deepseek.md chat-local.md; do
  p="$HOME/.config/opencode/agent/$viejo"
  if [ -f "$p" ]; then
    backup_item "$p"
    rm -f "$p"
    warn "Retirado agente antiguo: $viejo (sustituido por local.md)"
  fi
done

# gentle-ai deja gentle-orchestrator como default_agent; aquí se devuelve cerebro-oc (spec 20 · L8).
if DEF_OUT="$(node "$CONFIG_ROOT/claude/agente-defecto.mjs" "$HOME/.config/opencode/opencode.jsonc" 2>&1)"; then ok "$DEF_OUT"; add_paso 'default_agent de OpenCode' 'OK'
else warn "$DEF_OUT"; add_paso 'default_agent de OpenCode' 'aviso' "$(printf '%s' "$DEF_OUT" | head -n1)" 'node config/claude/agente-defecto.mjs ~/.config/opencode/opencode.jsonc'; fi

# ---------------------------------------------------------------- 7. Arrancar servidor
step 'Arrancando servidor local'
if [ -f "$SYSTEM_DIR/servidor.sh" ]; then
  # Spec 25 · S5: gentle-ai reemplaza engram y deja sin Engram al servidor V1 que ya estaba
  # en marcha; se reinicia para que vuelva a conectar sus MCP.
  if [ "$GENTLE_CORRIO" -eq 1 ]; then
    bash "$SYSTEM_DIR/servidor.sh" --stop >/dev/null 2>&1 || true
    note 'Servidor V1 detenido para reconectar Engram tras gentle-ai install'
  fi
  if bash "$SYSTEM_DIR/servidor.sh" >/dev/null 2>&1; then
    if [ "$GENTLE_CORRIO" -eq 1 ]; then ok 'Servidor V1 reiniciado (puerto en server-port.txt)'; add_paso 'Servidor V1 en marcha' 'OK' 'reiniciado tras gentle-ai'
    else ok 'Servidor V1 activo (puerto en server-port.txt)'; add_paso 'Servidor V1 en marcha' 'OK'; fi
  else
    warn 'El servidor no respondió; se arrancará en la primera llamada del MCP'
    add_paso 'Servidor V1 en marcha' 'aviso' 'no respondió al arrancar' "bash \"$SYSTEM_DIR/servidor.sh\""
  fi
fi

# ---------------------------------------------------------------- 7b. Docker (hub)
step 'Docker (hub)'
if command -v docker >/dev/null 2>&1; then
  # Laya ya no existe: se retira el contenedor, la imagen y el volumen de las máquinas que lo tenían.
  # Primero el contenedor y luego el volumen; sin fallar si no existen o el daemon está parado.
  # Cada uno por separado: tras un compose down o un uninstall puede quedar solo la imagen o el volumen (~850 MB).
  QUITADOS=""
  docker rm -f cerebro-laya >/dev/null 2>&1 && QUITADOS="$QUITADOS contenedor" || true
  docker image rm cerebro-hub-laya:latest >/dev/null 2>&1 && QUITADOS="$QUITADOS imagen" || true
  docker volume rm cerebro-hub_laya-modelos >/dev/null 2>&1 && QUITADOS="$QUITADOS volumen" || true
  [ -z "$QUITADOS" ] || ok "Retirado lo que quedaba de Laya:$QUITADOS"
  COMPOSE="$SYSTEM_DIR/docker/docker-compose.yml"
  inst_docker(){
    rm -rf "$SYSTEM_DIR/docker"
    cp -R "$REPO_ROOT/docker" "$SYSTEM_DIR/docker"
    # La carpeta de trabajos del MCP vive fuera del hub: se monta para que el panel
    # y el vigilante vean los trabajos también cuando el hub va en Docker.
    local tareas="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-mcp/tasks"
    sed -i.bak -e 's|\.\./config/hub|../hub|' -e 's|# __TAREAS_MCP_ENV__|- OPENCODE_MCP_TASKS=/opencode-mcp/tasks|' -e "s|# __TAREAS_MCP_VOL__|- $tareas:/opencode-mcp/tasks:ro|" "$COMPOSE"
    rm -f "$COMPOSE.bak"
    ok "Stack Docker instalado: $SYSTEM_DIR/docker"
  }
  instalar_componente docker 'Stack Docker' inst_docker 'Arranca Docker y repite install.sh' "${P_DOCKER[@]}"
  DOCKER_NUEVO=$COMP_INSTALADO
  if [ -f "$COMPOSE" ]; then
    # Solo se reconstruye si cambió el hub o el stack, o si falta la imagen (spec 25 · S2).
    BUILD=''
    if [ "$HUB_NUEVO" -eq 1 ] || [ "$DOCKER_NUEVO" -eq 1 ] || [ "$REINSTALAR" -eq 1 ] || ! docker image inspect cerebro-hub:latest >/dev/null 2>&1; then BUILD='--build'; fi
    [ -n "$BUILD" ] && note 'Construyendo la imagen del hub (la primera vez puede tardar)...' || same 'Imagen del hub sin cambios'
    if UP_OUT="$(docker compose -f "$COMPOSE" up -d $BUILD 2>&1)"; then
      ok 'Hub en marcha (contenedor cerebro-hub)'; add_paso 'Hub en Docker' 'OK' "${BUILD:+imagen reconstruida}"
    else
      err 'No se pudo levantar el stack Docker'; printf '%s\n' "$UP_OUT" | tail -n 15
      add_paso 'Hub en Docker' 'error' 'docker compose up falló (salida en el log)' "Arranca Docker y ejecuta: docker compose -f \"$COMPOSE\" up -d --build"
    fi
  fi
  note 'Autoarranque en macOS/Linux: añade un servicio de usuario que ejecute docker compose up -d'
else
  warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.sh)'
  add_paso 'Hub en Docker' 'aviso' 'Docker no está instalado' 'Instala Docker o arranca el hub en nativo: hub.sh'
fi

registro cerrar "$REGISTRO" "$VERSION_SISTEMA" || warn 'No se pudo cerrar el registro'

# ---------------------------------------------------------------- 8. Comprobación final (spec 25 · S7)
if [ "$SIN_VERIFICAR" -eq 1 ]; then
  note '--sin-verificar: se omite verificar --smoke'
else
  step 'Verificando (verificar --smoke)'
  if command -v docker >/dev/null 2>&1; then
    # El hub se reinicia al desplegar: esperar hasta 90 s para no dar un falso fallo.
    for _ in $(seq 1 45); do curl -fsS -m 2 http://127.0.0.1:4597/api/salud 2>/dev/null | grep -q cerebro-hub && break; sleep 2; done
  fi
  if bash "$REPO_ROOT/scripts/verificar.sh" --smoke; then add_paso 'Verificación (verificar --smoke)' 'OK'
  else add_paso 'Verificación (verificar --smoke)' 'error' 'hay comprobaciones con [X]' 'Revisa los [X] de la verificación de arriba: cada uno dice cómo arreglarlo'; fi
fi

# ---------------------------------------------------------------- Resumen (spec 25 · S6)
step 'Resumen'
ERRORES=0
for ((i = 0; i < ${#PASOS_N[@]}; i++)); do
  txt="${PASOS_N[$i]}"; [ -z "${PASOS_D[$i]}" ] || txt="$txt: ${PASOS_D[$i]}"
  case "${PASOS_R[$i]}" in
    OK) ok "$txt" ;; 'sin cambios') same "$txt" ;; aviso) warn "$txt" ;; *) err "$txt"; ERRORES=$((ERRORES + 1)) ;;
  esac
done
if [ "$ERRORES" -gt 0 ]; then
  printf '\n%sErrores (%s):%s\n' "$C_ERR" "$ERRORES" "$C_OFF"
  for ((i = 0; i < ${#PASOS_N[@]}; i++)); do
    [ "${PASOS_R[$i]}" = error ] || continue
    printf '  - %s: %s\n' "${PASOS_N[$i]}" "${PASOS_D[$i]}"
    [ -z "${PASOS_A[$i]}" ] || printf '    Cómo arreglarlo: %s\n' "${PASOS_A[$i]}"
  done
fi
HAY_AVISOS=0
for ((i = 0; i < ${#PASOS_N[@]}; i++)); do [ "${PASOS_R[$i]}" = aviso ] && [ -n "${PASOS_A[$i]}" ] && HAY_AVISOS=1; done
if [ "$HAY_AVISOS" -eq 1 ] || [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\nAvisos:\n'
  for ((i = 0; i < ${#PASOS_N[@]}; i++)); do [ "${PASOS_R[$i]}" = aviso ] && [ -n "${PASOS_A[$i]}" ] && warn "${PASOS_N[$i]}: ${PASOS_A[$i]}"; done
  for w in "${WARNINGS[@]:-}"; do [ -n "$w" ] && warn "$w"; done
fi
printf '\nPróximos pasos:\n'
printf '  1. Reinicia Claude Code si lo tienes abierto (para que cargue lo nuevo).\n'
printf '  2. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras (comandos /odd:start, /odd:plan...).\n'
printf '  3. Panel del Cerebro Hub (organización, memoria y gasto):\n'
printf '       bash ~/.sistema-cerebro-agentes/hub.sh\n'
[ -d "$BACKUP_DIR" ] && note "Backups de esta ejecución: $BACKUP_DIR"
note "Registro: $REGISTRO"
note "Log: $LOG_PATH"
if [ "$ERRORES" -gt 0 ]; then printf '\nTerminado con %s error(es).\n' "$ERRORES"; exit 1; fi
printf '\nListo.\n'
