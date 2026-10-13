# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico (MAJOR.MINOR.PATCH).

## [0.2.0] - en curso

### Añadido

- **Agentes de OpenCode por esfuerzo** (variante de razonamiento del modelo): `cerebro-oc` (max, agente por defecto — el "cerebro" sin Claude), `implementador` (high), `debugger` (high), `revisor` (max), `testeador` (low), `explorador-ds` (low, solo lectura), `redactor-ds` (low, solo documentación) y `local` (Ollama/Qwen, solo bajo petición explícita).
- **Regla de delegación cortada**: los subagentes no encadenan más agentes; `cerebro-oc` es el único que delega (máximo: preparación + ejecución + validación).
- **Subagentes de Claude** (`config/claude/agents/`): `explorador` (leer/resumir), `redactor` (docs), `analista` (checklists), `arquitecto` (dirección intensa) y `subdirector` (control de bucles/gasto con el MCP dentro). Todos Haiku salvo `arquitecto` (Sonnet).
- **Reglas de contexto y sesión**: volcado de estado al 70 % para `/clear` sin pérdidas, una sola cadena por tarea, sin fanout, y reconocimiento del repositorio delegado (el repo manda sus propias reglas).
- **Cerebro Hub** (`config/hub/`): aplicación con backend propio (Node sin dependencias) que da servicio a todas las carpetas:
  - **Memoria compartida externa** a los repos (`~/.sistema-cerebro-agentes/hub-data/memoria/`): global, por proyecto (`ESTADO.md`, `BITACORA.md`, `CONTEXTO-REPO.md`, checkpoints) y temporal con caducidad.
  - **Briefing** listo para los hooks de Claude (`/api/briefing?cwd=…`) con estado, contexto, bitácora, alertas y trabajos en curso.
  - **Vigilante** de trabajos (atascos y permisos colgados; histórico silencioso al arrancar).
  - **Panel minimalista** (`/`): organización (agentes, modelo y esfuerzo en vivo), proyectos, vigilante, trabajos, gasto y ventana de Claude.
  - **Gasto**: saldo de DeepSeek + coste de sesiones + estimación local de la ventana de Claude (tokens nuevos y caché por modelo, 5 h / 7 días).
  - Lanzador `hub.ps1` / `hub.sh` (arrancar, parar, estado), en el puerto 4597.
- **Laya en Docker** (`docker/`): modelo local de decisiones (Apache 2.0, CPU) servido por `laya[serve]` en su contenedor, con los checkpoints en un volumen propio. El hub lo consulta por su red interna.
  - **Triaje** (`/api/triaje`): decide `{capa, agente, esfuerzo, escalar, riesgo}` con la confianza calibrada de Laya; si no está disponible o duda, aplica `reglas.json` (editable en la carpeta de datos). Cada decisión queda registrada en `logs/decisiones.jsonl`.
  - **MCP `triaje`** (`config/mcp/triaje-mcp.mjs`): herramienta `triaje_decidir` disponible para Claude (inline en `cerebro` y `subdirector`) y para OpenCode.
  - **Stack Docker** (`docker/docker-compose.yml`): servicios `hub` (127.0.0.1:4597) y `laya`, con `restart: unless-stopped`, healthchecks y la memoria del host montada; el puente MCP y el servidor V1 siguen en el host (el hub los alcanza por `host.docker.internal`). Gestor: `docker/gestion.ps1` / `gestion.sh` (`up/down/status/logs`).
  - Panel: tarjeta de **Triaje · Laya** con estado y últimas decisiones.
- **Hooks de contexto** (`config/hooks/`, desplegados en `~/.sistema-cerebro-agentes/hooks/` y registrados en `~/.claude/settings.json`):
  - `SessionStart` (startup/resume/clear/compact): inyecta el briefing del proyecto (estado, contexto, bitácora, alertas y trabajos) al abrir cualquier sesión; si el hub está apagado, lee la memoria del disco; si el proyecto no tiene memoria, no dice nada.
  - `PreCompact` (manual/auto): guarda un checkpoint antes de comprimir y recuerda completar el `ESTADO.md`.
  - `SessionEnd(clear)`: checkpoint de seguridad al cerrar la sesión con `/clear`.
  - CLI `estado` (`--leer`, `--escribir --archivo`, `--bitacora`, `--checkpoint`) para que los agentes actualicen la memoria en una línea.
  - Verificado de punta a punta: una sesión real de Claude respondió la tarea activa del proyecto **sin que se le dijera**, solo desde el briefing inyectado.

### Corregido

- El rango de puertos de `panel.ps1` (4598–4605) y del hub incluía el **4599 del servidor V1**: al parar el panel/hub se mataba el servidor de OpenCode. Ahora ambos usan un único puerto.

### Cambiado

- El agente `cerebro` y el skill `delegar-a-opencode` se reescriben con la matriz de reparto completa, los topes de coste por job y el protocolo actualizado: **sin `providerID`/`modelID`** en `opencode_fire` (el modelo y el esfuerzo van fijados en el agente).
- `~/.claude/settings.json`: esfuerzos por defecto de Claude a **medium** (Sonnet 5/5.5 y Haiku 5.5); Opus se deja intacto. Subir a `high` cuando la tarea lo merezca (`/effort high`).

### Cambiado

- El trío del sistema pasa a **DeepSeek oficial V4.1 Flash con esfuerzos**: `implementador` high, `revisor` max, `testeador` low (verificado en real por CLI y por el puente MCP).
- `opencode.jsonc`: `default_agent` = `cerebro-oc` (al abrir OpenCode sin Claude, atiende el agente más capaz y delega él).

### Eliminado

- **Proveedor OpenRouter**: retirado el bloque de configuración y la credencial (`opencode auth logout`), con copia de seguridad. El sistema trabaja solo con DeepSeek oficial (los proveedores locales no se tocan).
- Agentes antiguos `chat-deepseek` y `chat-local` (sustituidos por `local`, con backup).

## [0.1.0] - 2026-10-13

### Añadido

- **Instaladores** para Windows (`install.ps1`) y macOS/Linux (`install.sh`), idempotentes y con copia de seguridad automática.
- **Desinstaladores** (`uninstall.ps1` / `uninstall.sh`).
- **Rol Cerebro** (`config/claude/CLAUDE.md`) para Claude Code: piensa y documenta; el código se delega a OpenCode.
- **Skill `delegar-a-opencode`** con el protocolo completo de delegación y plantilla de specs.
- **Agentes de OpenCode** en `~/.config/opencode/agents/`: `constructor`, `revisor` y `testeador`, con modelo DeepSeek V4.1 Flash (proveedor oficial; el cambio a OpenRouter/GPT-6 Luna queda documentado).
- **Registro automático del MCP `opencode-mcp`** en Claude Code (scope de usuario, perfil `essential`, auto-arranque del servidor local).
- **Scripts**: `verificar` (comprobación completa), `actualizar` (pull + reinstalar) y `smoke-mcp.mjs` (prueba real del MCP por stdio, sin depender de Claude).
- **Documentación**: arquitectura, instalación, uso diario, pruebas y registro de decisiones.
- **Panel web en tiempo real** (`config/web` + `scripts/panel.*`): dashboard local de solo lectura con pipeline visual del sistema, estado del servidor V1, sesiones y trabajos MCP en vivo, características de los agentes y visor de ficheros de configuración.
- **Agente `cerebro`**: el MCP `opencode` pasa a vivir **inline dentro del agente** de Claude Code (`~/.claude/agents/cerebro.md`) y se retira el registro global. Activable con `@cerebro`, "usa el agente cerebro" o `claude --agent cerebro`; el hilo normal de Claude queda sin herramientas `opencode_*`.
- **Comando `cerebro`** (`~/.local/bin`): rota al modo Cerebro conservando la conversación (`claude --agent cerebro --continue`); volver al modo normal con `claude --continue`. Nota: Claude Code no permite modos personalizados en el ciclo de Shift+Tab (ese ciclo es solo de permisos).
- **Editor de bots en el panel web**: crear/editar/eliminar agentes de OpenCode visualmente (nombre, descripción, modo, modelo del catálogo completo o heredado, prompt). Se guardan en el repositorio y en OpenCode al momento, con validación de nombres seguros y copias de seguridad. Al desplegar con `scripts/actualizar`, el panel se **reinicia solo** si estaba abierto.

### Corregido

- El MCP `opencode-mcp` v3 habla la API **V1** de OpenCode: el instalador añade ahora un servidor `opencode-ai 1.18.35` propio con lanzador (datos aislados, puerto 4599) en lugar de depender del auto-arranque del MCP.
- Renombrado el agente `constructor` → **`implementador`**: `constructor` es una palabra reservada de JavaScript y hacía crashear el servidor V1 en **todas** las peticiones.
- `install.ps1`: los mensajes de stderr de comandos externos ya no abortan la instalación (quirk de PowerShell 5.1).

### Notas

- Durante las pruebas de aceptación el proveedor por defecto pasó de OpenRouter a **DeepSeek oficial**: la cuenta de OpenRouter está sin crédito (free tier) y las peticiones fallan con «requires more credits». Ver `docs/contexto-y-decisiones.md` (D12).
