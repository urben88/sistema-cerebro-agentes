#!/usr/bin/env bash
# sistema-cerebro-agentes — desinstalador para macOS y Linux
# Uso: bash uninstall.sh
set -euo pipefail

MARKER_BEGIN='<!-- BEGIN sistema-cerebro-agentes -->'
MARKER_END='<!-- END sistema-cerebro-agentes -->'
BACKUP_ROOT="$HOME/.sistema-cerebro-agentes/backups"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)-uninstall"

C_OK=""; C_WARN=""; C_NOTE=""; C_OFF=""
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_NOTE=$'\033[90m'; C_OFF=$'\033[0m'
fi
step(){ printf '\n=== %s ===\n' "$1"; }
ok(){   printf '  %s[OK]%s   %s\n' "$C_OK" "$C_OFF" "$1"; }
warn(){ printf '  %s[!]%s    %s\n' "$C_WARN" "$C_OFF" "$1"; }
note(){ printf '  %s[info] %s%s\n' "$C_NOTE" "$1" "$C_OFF"; }

backup_item(){
  local path="$1"
  [ -e "$path" ] || return 0
  mkdir -p "$BACKUP_DIR"
  local name
  name="$(printf '%s' "$path" | sed 's|[/:\\ ]|_|g')"
  cp -R "$path" "$BACKUP_DIR/$name"
  note "backup: $path"
}

step 'Desinstalando sistema-cerebro-agentes'

# 1. MCP en Claude Code
if claude mcp remove opencode --scope user >/dev/null 2>&1; then
  ok 'MCP opencode eliminado de Claude Code'
else
  warn 'El MCP opencode no estaba registrado (o no se pudo eliminar)'
fi

# 1b. Servidor y lanzador
SYSTEM_DIR="$HOME/.sistema-cerebro-agentes"
if [ -f "$SYSTEM_DIR/servidor.sh" ]; then
  bash "$SYSTEM_DIR/servidor.sh" --stop >/dev/null 2>&1 || true
  ok 'Servidor V1 detenido'
fi
for f in launcher.sh servidor.sh; do
  p="$SYSTEM_DIR/$f"
  if [ -e "$p" ]; then backup_item "$p"; rm -f "$p"; ok "Eliminado: $p"; fi
done

# 2. Bloque gestionado en CLAUDE.md
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -qF "$MARKER_BEGIN" "$CLAUDE_MD"; then
  backup_item "$CLAUDE_MD"
  tmp="$(mktemp)"
  awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$CLAUDE_MD" > "$tmp"
  mv "$tmp" "$CLAUDE_MD"
  ok 'Bloque gestionado quitado de CLAUDE.md'
else
  warn 'No había bloque gestionado en CLAUDE.md'
fi

# 3. Skill
SKILL_DST="$HOME/.claude/skills/delegar-a-opencode"
if [ -e "$SKILL_DST" ]; then
  backup_item "$SKILL_DST"
  rm -rf "$SKILL_DST"
  ok "Skill eliminada: $SKILL_DST"
else
  warn 'La skill delegar-a-opencode no estaba instalada'
fi

# 3b. Agente cerebro
AGENT_DST="$HOME/.claude/agents/cerebro.md"
if [ -e "$AGENT_DST" ]; then
  backup_item "$AGENT_DST"
  rm -f "$AGENT_DST"
  ok "Eliminado: $AGENT_DST"
else
  warn 'El agente cerebro no estaba instalado'
fi

BIN_CEREBRO="$HOME/.local/bin/cerebro"
if [ -e "$BIN_CEREBRO" ]; then
  backup_item "$BIN_CEREBRO"
  rm -f "$BIN_CEREBRO"
  ok "Eliminado: $BIN_CEREBRO"
fi

# 4. Agentes de OpenCode
AGENTS_DST="$HOME/.config/opencode/agents"
for name in implementador.md revisor.md testeador.md constructor.md; do
  p="$AGENTS_DST/$name"
  if [ -f "$p" ]; then
    backup_item "$p"
    rm -f "$p"
    ok "Eliminado: $p"
  fi
done

printf '\nDesinstalación completada. Copias en: %s\n' "$BACKUP_DIR"
