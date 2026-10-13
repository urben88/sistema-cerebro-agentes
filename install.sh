#!/usr/bin/env bash
# sistema-cerebro-agentes — instalador para macOS y Linux
# Uso: bash install.sh [--check] [--force]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_ROOT="$REPO_ROOT/config"
MARKER_BEGIN='<!-- BEGIN sistema-cerebro-agentes -->'
MARKER_END='<!-- END sistema-cerebro-agentes -->'
BACKUP_ROOT="$HOME/.sistema-cerebro-agentes/backups"
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

if command -v opencode >/dev/null 2>&1; then
  ok "OpenCode $(opencode --version 2>/dev/null | head -n1)"
else
  err 'OpenCode no encontrado'
  FATAL+=('Instala OpenCode: https://opencode.ai  (npm: npm install -g @opencode/cli)')
fi

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -n1)"
else
  err 'Claude Code no encontrado'
  FATAL+=('Instala Claude Code: https://claude.com/claude-code')
fi

AUTH_JSON="$HOME/.local/share/opencode/auth.json"
if [ -f "$AUTH_JSON" ] && grep -q '"openrouter"' "$AUTH_JSON"; then
  ok 'OpenRouter conectado en OpenCode'
else
  warn 'OpenRouter no está conectado en OpenCode'
  WARNINGS+=("Conecta OpenRouter en OpenCode: ejecuta 'opencode auth login' (o /connect en la TUI) y elige OpenRouter")
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

# ---------------------------------------------------------------- 2. MCP en Claude Code
step 'MCP opencode-mcp en Claude Code'

claude mcp remove opencode --scope user >/dev/null 2>&1 || true
if claude mcp add opencode --scope user \
    --env OPENCODE_AUTO_SERVE=true \
    --env OPENCODE_TOOL_PROFILE=essential \
    --env OPENCODE_DEFAULT_PROVIDER=openrouter \
    --env OPENCODE_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash \
    -- npx -y opencode-mcp >/dev/null 2>&1; then
  ok 'MCP registrado (scope de usuario)'
else
  warn 'No se pudo registrar el MCP automáticamente'
  WARNINGS+=('Registra el MCP a mano: claude mcp add opencode --scope user --env OPENCODE_AUTO_SERVE=true --env OPENCODE_TOOL_PROFILE=essential --env OPENCODE_DEFAULT_PROVIDER=openrouter --env OPENCODE_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash -- npx -y opencode-mcp')
fi

# ---------------------------------------------------------------- 3. Rol Cerebro (Claude Code)
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

# ---------------------------------------------------------------- 4. Agentes de OpenCode
step 'Agentes de OpenCode'

AGENTS_DST="$HOME/.config/opencode/agents"
mkdir -p "$AGENTS_DST"
for f in "$CONFIG_ROOT/opencode/agents/"*.md; do
  name="$(basename "$f")"
  backup_item "$AGENTS_DST/$name"
  cp -f "$f" "$AGENTS_DST/$name"
  ok "Agente: $AGENTS_DST/$name"
done

# ---------------------------------------------------------------- Resumen
step 'Resumen'
printf 'Instalación completada. Próximos pasos:\n'
printf '  1. Reinicia Claude Code si lo tienes abierto (para que cargue el MCP).\n'
printf '  2. Verifica el sistema:\n'
printf '       bash scripts/verificar.sh --smoke\n'
printf '  3. Uso: abre Claude Code en la carpeta de un proyecto y pide lo que quieras.\n'
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\nAvisos:\n'
  for w in "${WARNINGS[@]}"; do warn "$w"; done
fi
[ -d "$BACKUP_DIR" ] && note "Backups de esta ejecución: $BACKUP_DIR"
printf '\nListo.\n'
