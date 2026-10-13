# Instalación

## Requisitos previos

| Requisito | Versión | Cómo instalarlo |
|---|---|---|
| Node.js | ≥ 22 | Windows: `winget install OpenJS.NodeJS.LTS` · macOS: `brew install node` · Linux: gestor de paquetes o [nodejs.org](https://nodejs.org) |
| OpenCode V2 | actual | [opencode.ai](https://opencode.ai) — en npm: `npm install -g @opencode/cli`. Comprueba con `opencode --version` |
| Claude Code | actual | [claude.com/claude-code](https://claude.com/claude-code) (instalador nativo o `npm install -g @anthropic-ai/claude-code`) |
| Cuenta OpenRouter con crédito | — | [openrouter.ai](https://openrouter.ai) → clave API. En OpenCode: `opencode auth login` (o `/connect` en la TUI) → OpenRouter |
| Git | actual | [git-scm.com](https://git-scm.com) |

> El sistema también admite el proveedor oficial de **DeepSeek** (sin OpenRouter): cambia los `model:` de los agentes a `deepseek/deepseek-flash`. Con el proveedor oficial no está disponible GPT-6 Luna.

## Instalación en 2 minutos

### Windows

```powershell
git clone <URL-DEL-REPO> "$env:USERPROFILE\Desktop\sistema-cerebro-agentes"
cd "$env:USERPROFILE\Desktop\sistema-cerebro-agentes"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```bash
git clone <URL-DEL-REPO> ~/sistema-cerebro-agentes
cd ~/sistema-cerebro-agentes
bash install.sh
```

### Qué hace el instalador

1. Comprueba prerrequisitos (Node ≥ 22, OpenCode, Claude Code) y avisa si falta algo.
2. Avisa si OpenRouter no está conectado (no bloquea la instalación, pero las manos no podrán trabajar hasta conectarlo).
3. Registra el MCP `opencode` en Claude Code (scope de usuario) con:
   - `OPENCODE_AUTO_SERVE=true` — arranca OpenCode solo cuando hace falta.
   - `OPENCODE_TOOL_PROFILE=essential` — 25 herramientas MCP (en vez de 87), suficiente para delegar y no inflar el contexto.
   - `OPENCODE_DEFAULT_PROVIDER=openrouter` y `OPENCODE_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash`.
4. Instala el rol Cerebro en `~/.claude/CLAUDE.md` dentro de un **bloque gestionado** (entre marcadores). Si ya tienes contenido propio, no se toca.
5. Copia la skill a `~/.claude/skills/delegar-a-opencode/`.
6. Copia los agentes a `~/.config/opencode/agents/`.
7. Hace copia de seguridad de todo lo reemplazado en `~/.sistema-cerebro-agentes/backups/<fecha>/`.

### Después de instalar

1. **Reinicia Claude Code** si lo tenías abierto (para que cargue el MCP).
2. Ejecuta la verificación:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke`
   - macOS/Linux: `bash scripts/verificar.sh --smoke`

## Actualizar

- `scripts/actualizar.ps1` / `scripts/actualizar.sh` → hace `git pull` y reinstala. Es lo que usarás en la **otra máquina**.

## Desinstalar

- `uninstall.ps1` / `uninstall.sh` → quita el MCP, la skill, los agentes y el bloque gestionado. Los backups se conservan.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Claude Code no ve las herramientas `opencode_*` | No se reinició tras registrar el MCP | Reinicia Claude Code; comprueba con `/mcp` |
| `claude mcp list` dice que opencode no conecta | Node desactualizado o npx sin red la primera vez | Comprueba Node ≥ 22; ejecuta `npx -y opencode-mcp` una vez a mano para forzar la descarga |
| Un trabajo queda en `input_required` | OpenCode pide un permiso o lanza una pregunta | El Cerebro lo resuelve con `opencode_job_input`; si no, responde tú en el chat de Claude Code |
| Las manos fallan con error de proveedor | OpenRouter sin conectar o sin crédito | `opencode auth login` → OpenRouter; revisa tu saldo en openrouter.ai |
| «No model is available» | Proveedor desconectado o modelo mal escrito | Ejecuta `opencode models` y comprueba que aparece `openrouter/deepseek/deepseek-v4.1-flash` |
| Quiero ver los trabajos recientes | — | En Claude Code pídelo (usa `opencode_job_list`), o miráis juntos `~/.local/state/opencode-mcp/tasks` |
| Conflictos raros con la TUI a la vez | Dos servidores OpenCode compartiendo almacenamiento (incidencia conocida de opencode-mcp) | Cierra uno de los dos mientras trabajas; si es habitual, pasad a servidor único persistente (ver arquitectura) |
