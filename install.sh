#!/usr/bin/env bash
# sistema-cerebro-agentes — instalador para macOS y Linux
# Uso: bash install.sh [--check] [--force]
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
MARKER_BEGIN='<!-- BEGIN sistema-cerebro-agentes -->'
MARKER_END='<!-- END sistema-cerebro-agentes -->'
BACKUP_ROOT="$SYSTEM_DIR/backups"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --force) : ;; # reservado
    *) echo "Argumento desconocido: $arg"; exit 2 ;;
  esac
done

C_OK=""; C_WARN=""; C_ERR=""; C_STEP=""; C_NOTE=""; C_OFF=""
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_STEP=$'\033[36m'; C_NOTE=$'\033[90m'; C_OFF=$'\033[0m'
fi
step(){ printf '\n=== %s ===\n' "$1"; }
ok(){   printf '  %s[OK]%s   %s\n' "$C_OK" "$C_OFF" "$1"; }
warn(){ printf '  %s[!]%s    %s\n' "$C_WARN" "$C_OFF" "$1"; }
err(){  printf '  %s[X]%s    %s\n' "$C_ERR" "$C_OFF" "$1"; }
note(){ printf '  %s[info] %s%s\n' "$C_NOTE" "$1" "$C_OFF"; }

FATAL=()
WARNINGS=()

backup_item(){
  local path="$1"
  [ -e "$path" ] || return 0
  mkdir -p "$BACKUP_DIR"
  local name
  name="$(printf '%s' "$path" | sed 's|[/:\\ ]|_|g')"
  cp -R "$path" "$BACKUP_DIR/$name"
  note "backup: $path"
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
  ok 'OpenRouter también conectado (opcional: GPT-6 Luna cuando la cuenta tenga crédito)'
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
  printf '\nComprobación terminada (modo --check; no se ha cambiado nada).\n'
  for w in "${WARNINGS[@]:-}"; do [ -n "$w" ] && warn "$w"; done
  exit 0
fi

# ---------------------------------------------------------------- 2. Servidor OpenCode V1
step "Servidor OpenCode V1 (opencode-ai $VERSION_SERVIDOR)"

mkdir -p "$SERVER_DIR"
[ -f "$SERVER_DIR/package.json" ] || printf '{"name":"cerebro-server","private":true}\n' > "$SERVER_DIR/package.json"

NEED_INSTALL=1
if [ -x "$SERVER_BIN" ]; then
  if [ "$("$SERVER_BIN" --version 2>/dev/null | head -n1)" = "$VERSION_SERVIDOR" ]; then
    NEED_INSTALL=0
    ok "opencode-ai $VERSION_SERVIDOR ya instalado"
  fi
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  note "Instalando opencode-ai@$VERSION_SERVIDOR con npm (puede tardar un par de minutos)…"
  if npm install --prefix "$SERVER_DIR" "opencode-ai@$VERSION_SERVIDOR" --no-audit --no-fund >/dev/null 2>&1 && [ -x "$SERVER_BIN" ]; then
    ok "opencode-ai $VERSION_SERVIDOR instalado"
  else
    err 'No se pudo instalar opencode-ai'
    WARNINGS+=("Instala manualmente: npm install --prefix \"$SERVER_DIR\" opencode-ai@$VERSION_SERVIDOR")
  fi
fi

# ---------------------------------------------------------------- 3. Lanzador del MCP
step 'Lanzador del MCP'

mkdir -p "$SYSTEM_DIR"
for f in servidor.sh launcher.sh; do
  backup_item "$SYSTEM_DIR/$f"
  cp -f "$CONFIG_ROOT/mcp/$f" "$SYSTEM_DIR/$f"
  chmod +x "$SYSTEM_DIR/$f"
  ok "Instalado: $SYSTEM_DIR/$f"
done

# ---------------------------------------------------------------- 3b. Panel web
step 'Panel web en tiempo real'
backup_item "$SYSTEM_DIR/web"
rm -rf "$SYSTEM_DIR/web"
cp -R "$CONFIG_ROOT/web" "$SYSTEM_DIR/web"
ok "Panel instalado: $SYSTEM_DIR/web"
backup_item "$SYSTEM_DIR/panel.sh"
cp -f "$REPO_ROOT/scripts/panel.sh" "$SYSTEM_DIR/panel.sh"
chmod +x "$SYSTEM_DIR/panel.sh"
ok "Instalado: $SYSTEM_DIR/panel.sh"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ repoRoot: process.argv[2] }, null, 2) + "\n")' "$SYSTEM_DIR/panel-config.json" "$REPO_ROOT"
ok 'panel-config.json escrito (ruta del repositorio)'

# Si el panel estaba abierto, reiniciarlo para aplicar la versión nueva
if [ -f "$SYSTEM_DIR/web-port.txt" ] && curl -fsS --max-time 3 "http://127.0.0.1:$(tr -d '[:space:]' < "$SYSTEM_DIR/web-port.txt")/api/ping" 2>/dev/null | grep -q 'sistema-cerebro-agentes'; then
  bash "$SYSTEM_DIR/panel.sh" --stop >/dev/null 2>&1 || true
  sleep 1
  bash "$SYSTEM_DIR/panel.sh" --no-open >/dev/null 2>&1 || true
  ok 'Panel web reiniciado con la versión nueva'
fi

# ---------------------------------------------------------------- 3c. Cerebro Hub
step 'Cerebro Hub (memoria compartida, hooks y trabajos)'

backup_item "$SYSTEM_DIR/hub"
rm -rf "$SYSTEM_DIR/hub"
cp -R "$CONFIG_ROOT/hub" "$SYSTEM_DIR/hub"
ok "Hub instalado: $SYSTEM_DIR/hub"

backup_item "$SYSTEM_DIR/hub.sh"
cp -f "$CONFIG_ROOT/hub/hub.sh" "$SYSTEM_DIR/hub.sh"
chmod +x "$SYSTEM_DIR/hub.sh"
ok "Lanzador instalado: $SYSTEM_DIR/hub.sh"

backup_item "$SYSTEM_DIR/hooks"
rm -rf "$SYSTEM_DIR/hooks"
cp -R "$CONFIG_ROOT/hooks" "$SYSTEM_DIR/hooks"
ok "Hooks instalados: $SYSTEM_DIR/hooks"

# Sonido al terminar (spec 22 · S6): crea la carpeta y deja el README; NO toca los fin.* del usuario.
mkdir -p "$SYSTEM_DIR/sonidos"
cp -f "$CONFIG_ROOT/sonidos/README.md" "$SYSTEM_DIR/sonidos/README.md"
ok "Carpeta de sonidos: $SYSTEM_DIR/sonidos (pon ahí fin.mp3, fin.wav o fin.ogg)"

mkdir -p "$SYSTEM_DIR/mcp"
backup_item "$SYSTEM_DIR/mcp/triaje-mcp.mjs"
cp -f "$CONFIG_ROOT/mcp/triaje-mcp.mjs" "$SYSTEM_DIR/mcp/triaje-mcp.mjs"
ok 'MCP de trabajos instalado (mcp/triaje-mcp.mjs)'

backup_item "$SYSTEM_DIR/mods"
rm -rf "$SYSTEM_DIR/mods"
cp -R "$CONFIG_ROOT/mods" "$SYSTEM_DIR/mods"
ok "Mods instalados: $SYSTEM_DIR/mods"

# ---------------------------------------------------------------- 3d. Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills)
# Va ANTES de lo nuestro: así nuestros agentes, el bloque de CLAUDE.md, los permisos y el
# default_agent se aplican encima y no los pisa el componente permissions de gentle-ai.
step "Gentle AI $VERSION_GENTLE (Claude Code + OpenCode)"
if [ -n "${SIN_GENTLE_AI:-}" ]; then
  note 'SIN_GENTLE_AI: se omite Gentle AI'
else
  if ! GENTLE_EXE="$(gentle_exe)"; then
    note 'Instalando Gentle AI con el script oficial (instala la última versión estable)...'
    if curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash >/dev/null 2>&1; then :; else warn 'El script oficial de Gentle AI falló'; fi
    GENTLE_EXE="$(gentle_exe)" || GENTLE_EXE=''
    if [ -n "$GENTLE_EXE" ]; then ok "gentle-ai instalado: $GENTLE_EXE"; else WARNINGS+=("Instala Gentle AI a mano: curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash  y repite install"); fi
  fi
  if [ -n "${GENTLE_EXE:-}" ]; then
    GV="$(gentle_version "$GENTLE_EXE")"
    [ "$GV" = "$VERSION_GENTLE" ] || warn "Gentle AI ${GV:-?} (fijada: $VERSION_GENTLE); se usa la instalada"
    CON_OPENCODE=0; command -v opencode >/dev/null 2>&1 && CON_OPENCODE=1
    if [ "$CON_OPENCODE" -eq 1 ]; then AGENTES_G='claude-code,opencode'; else AGENTES_G='claude-code'; fi

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
          WARNINGS+=("Ejecuta: npm install --prefix \"$OC_CFG\" --save-exact @opencode/plugin@$VERSION_PLUGIN_OC  y repite install")
        fi
      fi
    else
      warn 'OpenCode no encontrado: Gentle AI se configura solo para Claude Code'
    fi

    # gentle-ai sube defaultMode a bypassPermissions; permisos.mjs (paso 5b) lo devuelve.
    MODO_PREVIO="$(node -e "try{const s=require(process.argv[1]);process.stdout.write(String((s.permissions||{}).defaultMode||'(ninguno)'))}catch{process.stdout.write('(ninguno)')}" "$HOME/.claude/settings.json" 2>/dev/null || echo '(ninguno)')"
    export MODO_PREVIO
    note "gentle-ai install --agents $AGENTES_G --preset full-gentleman --persona gentleman --claude-orchestrator-modules"
    if GR="$("$GENTLE_EXE" install --agents "$AGENTES_G" --preset full-gentleman --persona gentleman --claude-orchestrator-modules 2>&1)"; then
      ok 'Gentle AI configurado (ODD, RDD, Engram, CodeGraph, Context7, skills)'
    else
      warn 'gentle-ai install no terminó bien; se sigue con lo demás'
      printf '%s\n' "$GR" | tail -n 15
      WARNINGS+=('Revisa la salida de gentle-ai install y repite install')
    fi
    # Spec 23 · S6 · Engram es la memoria del sistema (los hooks la usan junto al hub).
    if EV="$(engram version 2>&1)" && printf '%s' "$EV" | grep -qi engram; then
      ok "Engram responde ($EV): memoria de decisiones y sesiones"
    else
      warn 'Engram no responde: los hooks seguirán solo con la memoria del hub'
      WARNINGS+=('Instala Engram con gentle-ai install (o revisa el PATH) y comprueba: engram version')
    fi
  fi
fi

# ---------------------------------------------------------------- 4. Agente cerebro (con el MCP dentro)
step 'Agente cerebro en Claude Code (con el MCP dentro)'

claude mcp remove opencode --scope user >/dev/null 2>&1 && note 'Retirado el registro global antiguo del MCP (ahora vive en el agente cerebro)' || true
AGENT_DIR="$HOME/.claude/agents"
mkdir -p "$AGENT_DIR"
ARGS_JSON='["'"$SYSTEM_DIR"'/launcher.sh"]'
TRIAJE_MCP="$SYSTEM_DIR/mcp/triaje-mcp.mjs"
# MCP de trabajos (trabajo_estado, parar_trabajos): global, para que `claude` a secas vea los trabajos; OpenCode solo dentro del agente cerebro.
claude mcp remove triaje --scope user >/dev/null 2>&1 || true
if claude mcp add --scope user triaje -- node "$TRIAJE_MCP" >/dev/null 2>&1; then ok "MCP de trabajos (triaje) registrado a nivel de usuario (modo normal)"; else note "No se pudo registrar el MCP triaje global; claude mcp add --scope user triaje -- node <ruta>"; fi
for f in cerebro.md subdirector.md; do
  dst="$AGENT_DIR/$f"
  backup_item "$dst"
  node -e 'const fs=require("fs");const [src,dst,cmd,args,mcp]=process.argv.slice(1);let t=fs.readFileSync(src,"utf8");t=t.replace("__COMANDO__",cmd).replace("__ARGUMENTOS_JSON__",args).replace("__TRIAJE_MCP__",mcp);fs.writeFileSync(dst,t)' "$CONFIG_ROOT/claude/agents/$f" "$dst" "bash" "$ARGS_JSON" "$TRIAJE_MCP"
  ok "Agente instalado: $dst"
done
for f in explorador.md redactor.md analista.md arquitecto.md adaptador-mcps.md planificador.md resolutor.md ayudante.md retocador.md consultor.md; do
  backup_item "$AGENT_DIR/$f"
  cp -f "$CONFIG_ROOT/claude/agents/$f" "$AGENT_DIR/$f"
  ok "Subagente instalado: $AGENT_DIR/$f"
done
note 'Actívalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
for f in cerebro cerebro-parar; do
  backup_item "$BIN_DIR/$f"
  cp -f "$CONFIG_ROOT/bin/$f" "$BIN_DIR/$f"
  chmod +x "$BIN_DIR/$f"
done
ok "Comandos instalados: $BIN_DIR/cerebro, $BIN_DIR/cerebro-parar"
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
  backup_item "$target"
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
    mv "$tmp" "$target"
    ok "Bloque actualizado: $target"
  else
    {
      printf '\n%s\n' "$MARKER_BEGIN"
      cat "$blockfile"
      printf '%s\n' "$MARKER_END"
    } >> "$target"
    ok "Bloque añadido: $target"
  fi
}

set_managed_block "$HOME/.claude/CLAUDE.md" "$CONFIG_ROOT/claude/CLAUDE.md"

SKILL_SRC="$CONFIG_ROOT/claude/skills/delegar-a-opencode"
SKILL_DST="$HOME/.claude/skills/delegar-a-opencode"
backup_item "$SKILL_DST"
mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -R "$SKILL_SRC" "$SKILL_DST"
ok "Skill instalada: $SKILL_DST"

# Comandos /odd:* (spec 21 · S4): solo se reemplaza la carpeta odd; los comandos del usuario no se tocan.
CMD_DST="$HOME/.claude/commands/odd"
backup_item "$CMD_DST"
mkdir -p "$(dirname "$CMD_DST")"
rm -rf "$CMD_DST"
cp -R "$CONFIG_ROOT/claude/commands/odd" "$CMD_DST"
ok "Comandos /odd:* instalados: $CMD_DST"

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
if node "$SYSTEM_DIR/hub/settings-merge.mjs" "$SYSTEM_DIR/hooks"; then
  ok 'settings.json actualizado'
else
  warn 'No se pudo actualizar settings.json'
fi
# Permisos prudentes (spec 21 · S5): se unen a los que ya hay, sin quitar nada.
if PERM_OUT="$(node "$CONFIG_ROOT/claude/permisos.mjs" "$HOME/.claude/settings.json" 2>&1)"; then ok "$PERM_OUT"; else warn 'No se pudieron fusionar los permisos'; printf '%s\n' "$PERM_OUT"; fi

# ---------------------------------------------------------------- 6. Agentes de OpenCode
step 'Agentes de OpenCode'

AGENTS_DST="$HOME/.config/opencode/agents"
mkdir -p "$AGENTS_DST"
for f in "$CONFIG_ROOT/opencode/agents/"*.md; do
  name="$(basename "$f")"
  backup_item "$AGENTS_DST/$name"
  cp -f "$f" "$AGENTS_DST/$name"
  ok "Agente: $AGENTS_DST/$name"
done
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
if DEF_OUT="$(node "$CONFIG_ROOT/claude/agente-defecto.mjs" "$HOME/.config/opencode/opencode.jsonc" 2>&1)"; then ok "$DEF_OUT"; else warn "$DEF_OUT"; fi

# ---------------------------------------------------------------- 7. Arrancar servidor
step 'Arrancando servidor local'
if [ -f "$SYSTEM_DIR/servidor.sh" ] && bash "$SYSTEM_DIR/servidor.sh" >/dev/null 2>&1; then
  ok 'Servidor V1 activo (puerto en server-port.txt)'
else
  warn 'El servidor no respondió; se arrancará en la primera llamada del MCP'
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
  backup_item "$SYSTEM_DIR/docker"
  rm -rf "$SYSTEM_DIR/docker"
  cp -R "$REPO_ROOT/docker" "$SYSTEM_DIR/docker"
  # La carpeta de trabajos del MCP vive fuera del hub: se monta para que el panel
  # y el vigilante vean los trabajos tambien cuando el hub va en Docker.
  TAREAS_MCP="${XDG_STATE_HOME:-$HOME/.local/state}/opencode-mcp/tasks"
  sed -i.bak -e 's|\.\./config/hub|../hub|' -e 's|# __TAREAS_MCP_ENV__|- OPENCODE_MCP_TASKS=/opencode-mcp/tasks|' -e "s|# __TAREAS_MCP_VOL__|- $TAREAS_MCP:/opencode-mcp/tasks:ro|" "$SYSTEM_DIR/docker/docker-compose.yml" && rm -f "$SYSTEM_DIR/docker/docker-compose.yml.bak"
  ok "Stack Docker instalado: $SYSTEM_DIR/docker"
  if docker compose -f "$SYSTEM_DIR/docker/docker-compose.yml" up -d --build >/dev/null 2>&1; then
    ok 'Hub en marcha (contenedor cerebro-hub)'
  else
    warn 'No se pudo levantar el stack Docker; prueba: docker compose -f ~/.sistema-cerebro-agentes/docker/docker-compose.yml up -d --build'
  fi
  note 'Autoarranque en macOS/Linux: añade un servicio de usuario que ejecute docker compose up -d'
else
  warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.sh)'
fi

# ---------------------------------------------------------------- Resumen
step 'Resumen'
printf 'Instalación completada. Próximos pasos:\n'
printf '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).\n'
printf '  2. Verifica el sistema:\n'
printf '       bash scripts/verificar.sh --smoke\n'
printf '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras (comandos /odd:start, /odd:plan...).\n'
printf '  4. Panel del Cerebro Hub (organización, memoria y gasto):\n'
printf '       bash ~/.sistema-cerebro-agentes/hub.sh\n'
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\nAvisos:\n'
  for w in "${WARNINGS[@]}"; do warn "$w"; done
fi
[ -d "$BACKUP_DIR" ] && note "Backups de esta ejecución: $BACKUP_DIR"
printf '\nListo.\n'
