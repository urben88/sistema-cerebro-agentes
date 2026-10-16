# Instalación

## Requisitos previos

| Requisito | Versión | Cómo instalarlo |
|---|---|---|
| Node.js | ≥ 22 | Windows: `winget install OpenJS.NodeJS.LTS` · macOS: `brew install node` · Linux: gestor de paquetes o [nodejs.org](https://nodejs.org) |
| OpenCode V2 | actual | [opencode.ai](https://opencode.ai) — en npm: `npm install -g @opencode/cli`. Comprueba con `opencode --version` |
| Claude Code | actual | [claude.com/claude-code](https://claude.com/claude-code) (instalador nativo o `npm install -g @anthropic-ai/claude-code`) |
| Proveedor LLM conectado | — | Por defecto **DeepSeek** (oficial): `opencode auth login` (o `/connect` en la TUI). Opcional: **OpenRouter** con crédito, para GPT-6 Luna |
| Git | actual | [git-scm.com](https://git-scm.com) |

> Si prefieres **OpenRouter** (por ejemplo para GPT-6 Luna), cambia los `model:` de los agentes a `openrouter/...`; requiere crédito en tu cuenta de OpenRouter.

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
2. Avisa si el proveedor **DeepSeek** no está conectado (no bloquea la instalación, pero las manos no podrán trabajar hasta conectarlo); informa si OpenRouter también está conectado (opcional).
3. Instala el **servidor OpenCode V1** (`opencode-ai 1.18.35`, datos aislados) y copia el **lanzador** a `~/.sistema-cerebro-agentes/`. Instala además el **agente `cerebro`** en `~/.claude/agents/cerebro.md` con el MCP `opencode` **inline dentro del agente** (retirando el registro global antiguo): así solo el agente cerebro puede delegar en OpenCode.
4. Instala el rol Cerebro en `~/.claude/CLAUDE.md` dentro de un **bloque gestionado** (entre marcadores). Si ya tienes contenido propio, no se toca.
5. Copia la skill a `~/.claude/skills/delegar-a-opencode/`.
6. Copia los agentes de OpenCode (`cerebro-oc`, `planificador`, `implementador`, `debugger`, `revisor`, `testeador`, `explorador-ds`, `redactor-ds`, `local`) a `~/.config/opencode/agents/` (y retira el antiguo `constructor.md` si existe: ese nombre es una palabra reservada de JavaScript y rompía el servidor).
7. Instala los subagentes de Claude (`planificador`, `explorador`, `redactor`, `analista`, `ayudante`, `retocador`, `resolutor`, `consultor`, `arquitecto`, `subdirector`, `adaptador-mcps`), el hub, los hooks y una **barra de estado con [claude-hud](https://github.com/jarrodwatts/claude-hud)** (plugin; modelo · esfuerzo · carpeta · git · modo y trabajo de OpenCode · duración · coste / barra de contexto y de uso / herramientas, subagentes y tareas en curso). Si ya tenías una `statusLine` propia, no se toca; sin el plugin (o con `SIN_CLAUDE_HUD=1`) queda el indicador sencillo del sistema. Para cambiar qué enseña: `/claude-hud:configure` dentro de Claude. Deja el modelo por defecto en `opus` con esfuerzo `medium`, solo si no tienes ninguno configurado.
8. Hace copia de seguridad de todo lo reemplazado en `~/.sistema-cerebro-agentes/backups/<fecha>/`.

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
| Fuera del agente cerebro no hay herramientas `opencode_*` | Es lo normal: el MCP vive solo dentro del agente `cerebro` | Actívalo con `@cerebro`, "usa el agente cerebro" o `claude --agent cerebro` |
| Claude Code no lista el agente `cerebro` | El directorio `~/.claude/agents/` no existía al arrancar | Reinicia Claude Code (después, los cambios se detectan en caliente) |
| El servidor local no responde (`UNREACHABLE`) | Servidor V1 caído | Relánzalo: `servidor.ps1` (Windows) / `bash servidor.sh` (macOS/Linux) y reintenta |
| Quiero ver o parar el servidor | — | `servidor.ps1 -Status` / `-Stop`, o `bash servidor.sh --status` / `--stop` |
| `claude mcp list` dice que opencode no conecta | Node desactualizado o npx sin red la primera vez | Comprueba Node ≥ 22; ejecuta `npx -y opencode-mcp@3.0.0` una vez a mano para forzar la descarga |
| Un trabajo queda en `input_required` | OpenCode pide un permiso o lanza una pregunta | El Cerebro lo resuelve con `opencode_job_input`; si no, responde tú en el chat de Claude Code |
| Se quedó algo trabajando en segundo plano y no quiero gastar | Al cerrar Claude normalmente se cancela solo (hook de cierre) | `cerebro-parar` para todos; `cerebro-parar --seco` para verlo antes; o «para todo» en el chat del Cerebro |
| Las manos fallan con error de proveedor | Proveedor desconectado | `opencode auth login` → DeepSeek (o el que uses) |
| «requires more credits, or fewer max_tokens» | El modelo va vía OpenRouter y la cuenta no tiene crédito | Recarga tu cuenta de OpenRouter o vuelve a `deepseek/deepseek-flash` |
| «No model is available» | Proveedor desconectado o modelo mal escrito | Ejecuta `opencode models` y comprueba que aparece `deepseek/deepseek-flash` |
| Un subagente de Claude corre en Opus sin que lo pidieras | Se lanzó sin `subagent_type` (cae en `general-purpose`) o como `fork`: heredan el modelo principal | Pide el subagente por su nombre (`explorador`, `resolutor`…); el Cerebro ya lo hace en v0.3.0. Comprueba el modelo con `/tasks` |
| No veo la barra de estado de Claude | El instalador no la registra si ya tienes una `statusLine` propia | Quita la tuya de `~/.claude/settings.json` si prefieres la del sistema; el indicador es opcional |
| La barra muestra el indicador sencillo y no claude-hud | El plugin no está instalado | `claude plugin install claude-hud@claude-hud` y vuelve a ejecutar el instalador |
| Quiero ver los trabajos recientes | — | En Claude Code pídelo (el Cerebro usa `trabajo_estado`), o miráis juntos `~/.local/state/opencode-mcp/tasks` |
| Conflictos raros con la TUI a la vez | Dos servidores OpenCode compartiendo almacenamiento (incidencia conocida de opencode-mcp) | Cierra uno de los dos mientras trabajas; si es habitual, pasad a servidor único persistente (ver arquitectura) |

## Herramientas opcionales (no las instala el sistema)

### Visor de sesiones y subagentes: claude-code-history-viewer
Aplicación de escritorio (MIT) para navegar el historial de Claude Code y de OpenCode, con analíticas de subagentes y coste. Útil cuando quieres abrir una conversación completa, cosa que `/agentes` no hace.

1. Descarga el `.exe` o el `.zip` portable (x64) desde https://github.com/jhlee0409/claude-code-history-viewer/releases
2. Ábrelo: lee `~/.claude/projects/` y `~/.local/share/opencode/` sin configurar nada.
3. Ojo: en algunas fuentes permite renombrar o borrar sesiones. Úsalo para leer.

### Versión del puente OpenCode
El lanzador fija `opencode-mcp@3.0.0` (probado con el smoke test). Para probar otra: `OPENCODE_MCP_VERSION=3.1.0` en el entorno, `verificar.ps1 -Smoke` y, si pasa, cambia el valor por defecto en `config/mcp/launcher.ps1` y `launcher.sh`.
