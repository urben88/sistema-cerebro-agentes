# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico (MAJOR.MINOR.PATCH).

## [0.2.0] - en curso

### Añadido

- **Agentes de OpenCode por esfuerzo** (variante de razonamiento del modelo): `cerebro-oc` (max, agente por defecto — el "cerebro" sin Claude), `implementador` (high), `debugger` (high), `revisor` (max), `testeador` (low), `explorador-ds` (low, solo lectura), `redactor-ds` (low, solo documentación) y `local` (Ollama/Qwen, solo bajo petición explícita).
- **Regla de delegación cortada**: los subagentes no encadenan más agentes; `cerebro-oc` es el único que delega (máximo: preparación + ejecución + validación).

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
