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
step 'Cerebro Hub (memoria compartida, hooks y triaje)'

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

mkdir -p "$SYSTEM_DIR/mcp"
backup_item "$SYSTEM_DIR/mcp/triaje-mcp.mjs"
cp -f "$CONFIG_ROOT/mcp/triaje-mcp.mjs" "$SYSTEM_DIR/mcp/triaje-mcp.mjs"
ok 'MCP de triaje instalado (mcp/triaje-mcp.mjs)'

# ---------------------------------------------------------------- 4. Agente cerebro (con el MCP dentro)
step 'Agente cerebro en Claude Code (con el MCP dentro)'

claude mcp remove opencode --scope user >/dev/null 2>&1 && note 'Retirado el registro global antiguo del MCP (ahora vive en el agente cerebro)' || true
AGENT_DIR="$HOME/.claude/agents"
mkdir -p "$AGENT_DIR"
ARGS_JSON='["'"$SYSTEM_DIR"'/launcher.sh"]'
TRIAJE_MCP="$SYSTEM_DIR/mcp/triaje-mcp.mjs"
for f in cerebro.md subdirector.md; do
  dst="$AGENT_DIR/$f"
  backup_item "$dst"
  node -e 'const fs=require("fs");const [src,dst,cmd,args,mcp]=process.argv.slice(1);let t=fs.readFileSync(src,"utf8");t=t.replace("__COMANDO__",cmd).replace("__ARGUMENTOS_JSON__",args).replace("__TRIAJE_MCP__",mcp);fs.writeFileSync(dst,t)' "$CONFIG_ROOT/claude/agents/$f" "$dst" "bash" "$ARGS_JSON" "$TRIAJE_MCP"
  ok "Agente instalado: $dst"
done
for f in explorador.md redactor.md analista.md arquitecto.md adaptador-mcps.md; do
  backup_item "$AGENT_DIR/$f"
  cp -f "$CONFIG_ROOT/claude/agents/$f" "$AGENT_DIR/$f"
  ok "Subagente instalado: $AGENT_DIR/$f"
done
note 'Actívalo con @cerebro, "usa el agente cerebro" o claude --agent cerebro'

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
backup_item "$BIN_DIR/cerebro"
cp -f "$CONFIG_ROOT/bin/cerebro" "$BIN_DIR/cerebro"
chmod +x "$BIN_DIR/cerebro"
ok "Comando instalado: $BIN_DIR/cerebro"
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

# ---------------------------------------------------------------- 5b. Ajustes de Claude (esfuerzos + hooks)
step 'Esfuerzos y hooks de contexto en Claude (settings.json)'
backup_item "$HOME/.claude/settings.json"
if node "$SYSTEM_DIR/hub/settings-merge.mjs" "$SYSTEM_DIR/hooks"; then
  ok 'settings.json actualizado'
else
  warn 'No se pudo actualizar settings.json'
fi

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

# ---------------------------------------------------------------- 7. Arrancar servidor
step 'Arrancando servidor local'
if [ -f "$SYSTEM_DIR/servidor.sh" ] && bash "$SYSTEM_DIR/servidor.sh" >/dev/null 2>&1; then
  ok 'Servidor V1 activo (puerto en server-port.txt)'
else
  warn 'El servidor no respondió; se arrancará en la primera llamada del MCP'
fi

# ---------------------------------------------------------------- 7b. Docker (hub + Laya)
step 'Docker (hub + Laya)'
if command -v docker >/dev/null 2>&1; then
  backup_item "$SYSTEM_DIR/docker"
  rm -rf "$SYSTEM_DIR/docker"
  cp -R "$REPO_ROOT/docker" "$SYSTEM_DIR/docker"
  sed -i.bak 's|\.\./config/hub|../hub|' "$SYSTEM_DIR/docker/docker-compose.yml" && rm -f "$SYSTEM_DIR/docker/docker-compose.yml.bak"
  ok "Stack Docker instalado: $SYSTEM_DIR/docker"
  if docker compose -f "$SYSTEM_DIR/docker/docker-compose.yml" up -d --build >/dev/null 2>&1; then
    ok 'Hub + Laya en marcha (contenedores cerebro-hub y cerebro-laya)'
  else
    warn 'No se pudo levantar el stack Docker; prueba: docker compose -f ~/.sistema-cerebro-agentes/docker/docker-compose.yml up -d --build'
  fi
  note 'Autoarranque en macOS/Linux: añade un servicio de usuario que ejecute docker compose up -d'
else
  warn 'Docker no encontrado: el hub puede ejecutarse en nativo (hub.sh); Laya no estará disponible'
fi

# ---------------------------------------------------------------- Resumen
step 'Resumen'
printf 'Instalación completada. Próximos pasos:\n'
printf '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).\n'
printf '  2. Verifica el sistema:\n'
printf '       bash scripts/verificar.sh --smoke\n'
printf '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras.\n'
printf '  4. Panel del Cerebro Hub (organización, memoria, gasto y triaje):\n'
printf '       bash ~/.sistema-cerebro-agentes/hub.sh\n'
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\nAvisos:\n'
  for w in "${WARNINGS[@]}"; do warn "$w"; done
fi
[ -d "$BACKUP_DIR" ] && note "Backups de esta ejecución: $BACKUP_DIR"
printf '\nListo.\n'
