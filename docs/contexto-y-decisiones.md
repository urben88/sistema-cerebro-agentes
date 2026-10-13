# Contexto y decisiones

Registro vivo: por qué el sistema es como es. Añade una entrada cada vez que cambies algo estructural.

## Entorno verificado (máquina de desarrollo, 2026-10-13)

| Componente | Versión / dato |
|---|---|
| Node.js | v24.18.0 (el MCP exige ≥ 22) |
| npm | 11.16.0 |
| OpenCode | v2.0.27 (instalado como `@opencode/cli`) |
| Claude Code | v2.1.296 (`claude.exe`, instalación nativa) |
| opencode-mcp | v3.0.0 (npm; servidor MCP por stdio) |
| git | 2.55.0 · `gh` no instalado al inicio (se instaló durante el montaje) |
| Proveedores conectados en OpenCode | DeepSeek oficial, OpenRouter, LM Studio, LLM Gateway |

Modelos verificados con `opencode models`:

| Modelo | ID |
|---|---|
| DeepSeek V4.1 Flash (oficial) | `deepseek/deepseek-flash` |
| DeepSeek V4 Pro (oficial) | `deepseek/deepseek-v4-pro` |
| DeepSeek V4.1 Flash (OpenRouter) | `openrouter/deepseek/deepseek-v4.1-flash` |
| GPT-6 Luna (OpenRouter) | `openrouter/openai/gpt-6-luna` |

## Decisiones

### D1 — El Cerebro vive en Claude Code (no Claude Desktop) · 2026-10-13
Claude Desktop no está instalado en la máquina; Claude Code sí, y es donde vive el trabajo real. El rol de Cerebro se plasma en la memoria global (`~/.claude/CLAUDE.md`) más una skill de delegación.

### D2 — Puente por `opencode-mcp` en local, sin Docker · 2026-10-13
Servidor MCP por stdio ejecutado con `npx -y opencode-mcp`. No requiere contenedores ni instalación permanente; Node 24 ya presente.

### D3 — Registro del MCP en scope de usuario · 2026-10-13
Disponible en todos los proyectos sin repetir configuración. En Windows se usa el envoltorio `cmd /c npx …` (mismo patrón que el MCP `agentation` ya existente en esta máquina).

### D4 — Perfil `essential` (25 herramientas) · 2026-10-13
Suficiente para delegación, vigilancia y resolución de entradas (`input_required`). El perfil `full` (87 herramientas) añade herramientas de bajo nivel que no se usan y consumen contexto del Cerebro.

### D5 — `OPENCODE_AUTO_SERVE=true` · 2026-10-13
El MCP arranca su propio servidor OpenCode local cuando hace falta y lo apaga al terminar. Evita depender del servicio en segundo plano de la TUI, cuyo puerto y contraseña son dinámicos (`~/.config/opencode/service.json`, puerto efímero — comprobado). Si aparecieran conflictos por uso simultáneo intenso de TUI + Claude (dos servidores compartiendo almacenamiento), la alternativa es un servidor único persistente + `OPENCODE_BASE_URL`; no es el caso hoy.

### D6 — OpenRouter como proveedor de las manos · 2026-10-13
Decisión del usuario: unificar proveedor (DeepSeek oficial queda conectado como alternativa). v0.1.0 usa DeepSeek V4.1 Flash para los tres agentes; GPT-6 Luna se activa cambiando 1 línea en el agente que se quiera.

### D7 — Agentes en `~/.config/opencode/agents/` (plural) · 2026-10-13
La documentación V2 indica `<config>/agents/`; la instalación existente tenía `agent/` (V1, sigue funcionando). Verificado empíricamente en v2.0.27 con un agente de prueba y `GET /api/agent`: **ambos directorios se descubren**. Se adopta el plural (canónico) y no se tocan los agentes existentes (`chat-deepseek`, `chat-local`).

### D8 — `CLAUDE.md` con bloque gestionado · 2026-10-13
El instalador inserta/actualiza su contenido entre `<!-- BEGIN sistema-cerebro-agentes -->` y `<!-- END … -->`. Así el usuario puede tener su propio contenido en `CLAUDE.md` sin que el instalador lo pise, y las actualizaciones son idempotentes.

### D9 — Backups automáticos y desinstalación limpia · 2026-10-13
Todo lo que el instalador reemplaza se copia antes a `~/.sistema-cerebro-agentes/backups/<fecha>/`. Los desinstaladores revierten los cambios y conservan los backups.

### D10 — Sin secretos en el repositorio · 2026-10-13
Ninguna clave API entra en el repo. Las credenciales viven en OpenCode (`~/.local/share/opencode/auth.json`, gestionadas por el usuario con `opencode auth login` / `/connect`).

### D11 — Repositorio privado como fuente de verdad · 2026-10-13
Sistema pensado para evolucionar: cambios en `config/`, versionado (`VERSION`, `CHANGELOG.md`, tags) y despliegue por `scripts/actualizar` en cada máquina (Windows, macOS y Linux soportados).

## Notas técnicas útiles

- **Herramientas clave del MCP (perfil essential):** `opencode_setup`, `opencode_context`, `opencode_status`, `opencode_ask`, `opencode_fire`, `opencode_run`, `opencode_reply`, `opencode_check`, `opencode_wait`, `opencode_job_get/list/cancel/input`, `opencode_question_*`, `opencode_permission_*`, `opencode_conversation`, `opencode_review_changes`.
- **Estados de un trabajo:** `accepted`, `running`, `input_required`, `completed`, `failed`, `cancelled`, `unknown`. Un timeout de observación **no** es un fallo.
- **`opencode_fire` acepta `agent`, `providerID`, `modelID` y `directory` por llamada**; además el agente configurado ya fija su modelo, por lo que el flujo normal solo necesita `directory`, `agent` y `prompt`.
- **Whitelist V1 en `opencode.jsonc`:** si existe un bloque `provider.openrouter.whitelist` de V1, OpenCode V2 lo ignora (el catálogo completo aparece en `opencode models`). No afecta a este sistema porque cada agente fija su modelo.
- **Claude Code debe reiniciarse** tras `claude mcp add` para cargar el MCP.
- **Permisos headless:** por defecto las herramientas están permitidas en el espacio de trabajo; lecturas sensibles o accesos fuera del proyecto pueden pedir aprobación y aparecen como `input_required`. El Cerebro los resuelve con `opencode_job_input` / `opencode_session_permission`.
- **Incidencia conocida de opencode-mcp (#18):** posible conflicto si dos servidores OpenCode comparten almacenamiento a la vez; razón de más para no fijar servidores manuales sin necesidad.
