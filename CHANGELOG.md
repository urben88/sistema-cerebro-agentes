# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico (MAJOR.MINOR.PATCH).

## [0.3.0] - 2026-10-13

### Añadido

- **Planificador previo** (`config/claude/agents/planificador.md` y `config/opencode/agents/planificador.md`): agente barato (Haiku · medium / DeepSeek · high) que convierte una petición ambigua en hasta 5 preguntas que cambian el trabajo + supuestos por defecto + plan + criterios de aceptación. `cerebro`/`cerebro-oc` lo lanzan antes de la spec y preguntan al usuario; también se puede abrir como agente principal (entrevista que termina en spec).
- **Visibilidad de los trabajos dentro de Claude**:
  - herramienta **`trabajo_estado`** en el MCP `triaje` (lista de trabajos y detalle de un `jobId`: estado, duración, coste, tokens, modelo, último paso, herramientas y pregunta pendiente), leyendo los `job_*.json` del MCP sin volcar conversaciones;
  - protocolo de **hitos en el chat** para `cerebro` (tarjeta de lanzamiento, actualización ~1 min, cierre con informe + diffstat + veredicto);
  - **barra de estado** (`config/hub/estado-linea.mjs`): modelo, contexto y trabajo de OpenCode en curso (o cierre reciente) por proyecto. `settings-merge` la registra solo si no hay una `statusLine` propia; el desinstalador la retira.
- **Agentes por proyecto**: documentados en `docs/agentes-por-proyecto.md` — nativos en `<proyecto>/.claude/agents/` y `<proyecto>/.opencode/agents/`, aditivos a los roles por defecto (globales, siempre presentes) y versionados en git.
- **Regla de subagentes baratos**: `cerebro` y `CLAUDE.md` exigen `subagent_type` explícito y prohíben `fork`/`general-purpose` (corren en Sonnet); se anuncia el modelo al lanzar. Solo `arquitecto` usa Sonnet a propósito.
- **Apagado al cerrar la sesión**: hook `cerrar-trabajos.mjs` en `SessionEnd` (cualquier motivo: `prompt_input_exit`, `logout`, `clear`, `other`) que cancela los trabajos de OpenCode del proyecto abortando sus sesiones en el servidor V1 y lo anota en la bitácora — nada sigue consumiendo tokens en segundo plano.
- **Botón de pánico**: comando `cerebro-parar` (todos / un proyecto / `--seco`), herramienta MCP `parar_trabajos` (pídeselo al Cerebro en el chat) y `POST /api/trabajos/cancelar` (para el panel).
- **Vista viva en «La oficina»** (spec 05, sobre el detalle de la spec 04): al pinchar en un agente de OpenCode se ve su **razonamiento en directo** («Pensando ahora»), la **actividad** (herramientas, textos, parches y pasos, desplegables), los **siguientes pasos** de su lista y su **esfuerzo** (modelo · variant). El hub lo **recopila solo** (`lib/vivo.mjs`, snapshots en `hub-data/trabajos-vivo/`) y lo difunde por SSE; si el servidor V1 cae, enseña la última copia con aviso.
- **Vista viva también para Claude**: al abrir un agente de Claude (cerebro, exploradores…) se ve su actividad en tiempo real —herramientas, archivos, textos, subtareas lanzadas y resultados— leída de su transcript; su pensamiento interno no es legible y el panel lo explica.
- **Control desde la web**: botones ⛔ de emergencia en «La oficina» — parar **todo**, parar una **sala** o parar **un trabajo** desde su detalle (usa `/api/trabajos/cancelar`, que ahora acepta `jobId`).
- **Consumo real por proyecto**: chips en cada sala con el **contexto**, las **ventanas 5 h/7 d** y el **coste** de la sesión de Claude (los empuja la barra de estado, en tiempo real: `POST /api/claude/estado`) y el **gasto DeepSeek** acumulado de los trabajos de esa sala.
- **Registro central de errores** (spec 06): cada fallo —hub, trabajos, colector, hooks, MCP y panel— queda con **mensaje, stack y contexto** en `hub-data/logs/errores.jsonl`; pestaña «Errores» en el panel con resumen y botón **«Copiar informe para la IA»**, y CLI `hub/errores.mjs --exportar`. Incluye reintento de transcripts de Claude **buscándolos por id de sesión** si la ruta aún no existe.
- **Mod «mesa de trabajo»** (spec 07, se carga en cada sesión con `CLAUDE_CODE_PLUGIN_DIRS`): **banda sobre el prompt** con los trabajos de OpenCode y los subagentes en vivo (con su modelo: **Haiku visible**) más el contexto de la sesión; comandos **`/trabajos`**, **`/errores`** y **`/parar-todo`** dentro de Claude; y guardián `agent.spawn` que **fija el modelo de cada subagente** según su definición y lo registra en el log del hub. Validado con `claude plugin validate` y probado en real.
- **Haiku visible en directo**: los subagentes de Claude aparecen en la barra de estado —hasta 3, con **modelo · esfuerzo · tiempo** (`👥 explorador (haiku·bajo) 2m · planificador (haiku·medio) 1m`) y la **tarea** si el terminal es ancho—, filtrados por proyecto; y en el hub (`GET /api/latidos`). El modelo y el esfuerzo de un subagente se leen de su **definición** (`model:` y `effort:` del fichero del agente), no del transcript.
- `sesionMensajes`/`sesionTodo` en el cliente del servidor V1; `GET /api/vivo` y bloque `vivo` en `/api/trabajos/:jobId`.
- **Modelo real, errores legibles y detalle por agente** (spec 04, trabajo conjunto con la sesión paralela): modelo/variant reales en jobs y latidos de Claude, `clasificarError` (`lib/errores.mjs`) con causa y acción sugerida, y panel lateral con modelo, duración, coste, tokens, herramientas y archivos.
- Spec `docs/specs/02-planificador-y-visibilidad.md`.

### Corregido

- **Hooks fantasma**: `settings-merge.mjs` ya no registra hooks (`latido.mjs`, `aviso-contexto.mjs`…) que no estén desplegados; limpia registros huérfanos y avisa de los que falten. Evita el `MODULE_NOT_FOUND` en cada Stop/UserPromptSubmit.
- **Actualizaciones del hub en Docker**: `install.ps1` reconstruye siempre las imágenes (las capas sin cambios salen de caché), así los cambios del hub llegan al contenedor; antes solo construía si faltaba la imagen.
- **Trabajos del MCP visibles en Docker**: el hub monta la carpeta de tareas de `opencode-mcp` (vía `OPENCODE_MCP_TASKS`), así el panel y el vigilante ven los trabajos también en contenedor.
- Datos sucios de trabajos antiguos (`agent: "Object"`) normalizados en la vista de trabajos.
- El hook de cierre no usa `process.exit()`: en Windows, salir con sockets de `fetch` cerrándose reventaba con una aserción de libuv.

### Cambiado

- `subdirector` usa `trabajo_estado` para vigilar todos los trabajos con una sola llamada barata.
- Instaladores, desinstaladores y verificadores cubren los agentes nuevos (`planificador`, `adaptador-mcps` en las listas), la barra de estado y la herramienta `trabajo_estado`.

## [0.2.0] - 2026-10-13

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
  - `SessionStart` (startup/resume/clear/compact): inyecta el briefing del proyecto (estado, contexto, bitácora, alertas, trabajos y hallazgos pendientes) al abrir cualquier sesión; si el hub está apagado, lee la memoria del disco; si el proyecto no tiene memoria, no dice nada.
  - `PreCompact` (manual/auto): guarda un checkpoint antes de comprimir y recuerda completar el `ESTADO.md`.
  - `SessionEnd(clear)`: checkpoint de seguridad al cerrar la sesión con `/clear`.
  - CLI `estado` (`--leer`, `--escribir --archivo`, `--bitacora`, `--checkpoint`) para que los agentes actualicen la memoria en una línea.
  - Verificado de punta a punta: una sesión real de Claude respondió la tarea activa del proyecto **sin que se le dijera**, solo desde el briefing inyectado.
- **Filosofía «buscar antes de crear»** con registro de hallazgos compartido (API `/api/hallazgos`, CLI `hallazgos` y tarjeta en el panel): los exploradores buscan primero soluciones ya hechas (MCPs), apuntan candidatos con enlace y el Cerebro **pregunta al usuario** (validar / descartar / integrar) antes de construir nada; si nada encaja, se crea de cero. El briefing trae los pendientes de validar.
- **Descubrimiento genérico de MCPs** (`hub/mcps.mjs`, `/api/mcps` y tarjeta en el panel): inventario automático de los MCPs de OpenCode y Claude con sus capacidades y prioridad de uso. El agente `adaptador-mcps` se ejecuta solo cuando se pide (p. ej. al instalar o quitar MCPs), verifica que los agentes puedan usarlos y propone mejoras **sin tocar nada**.

### Corregido

- El rango de puertos de `panel.ps1` (4598–4605) y del hub incluía el **4599 del servidor V1**: al parar el panel/hub se mataba el servidor de OpenCode. Ahora ambos usan un único puerto.

### Cambiado

- El trío del sistema pasa a **DeepSeek oficial V4.1 Flash con esfuerzos**: `implementador` high, `revisor` max, `testeador` low (verificado en real por CLI y por el puente MCP).
- `opencode.jsonc`: `default_agent` = `cerebro-oc` (al abrir OpenCode sin Claude, atiende el agente más capaz y delega él).
- El agente `cerebro` y el skill `delegar-a-opencode` se reescriben con la matriz de reparto completa, los topes de coste por job y el protocolo actualizado: **sin `providerID`/`modelID`** en `opencode_fire` (el modelo y el esfuerzo van fijados en el agente).
- **Esfuerzo por agente también en Claude** (campo `effort` del frontmatter, verificado contra el propio Claude Code): `cerebro` medium, `arquitecto` **high**, `explorador`/`redactor` **low**, `analista`/`subdirector` medium — la misma lógica que las variantes de DeepSeek.
- `~/.claude/settings.json`: esfuerzos por defecto de Claude a **medium** (Sonnet 5/5.5 y Haiku 5.5); Opus se deja intacto. Subir a `high` cuando la tarea lo merezca (`/effort high`).
- **Instaladores** (`install.ps1` / `install.sh`): ahora despliegan también el hub, los hooks, el MCP de triaje y los subagentes; fusionan `settings.json` (esfuerzos + hooks, con backup) mediante `config/hub/settings-merge.mjs`; copian el stack Docker (con el compose ajustado a la ruta instalada), levantan los contenedores y registran el **autoarranque** en Windows (tarea programada y, si el sistema la deniega, carpeta de Inicio). El desinstalador retira todo lo nuevo (conservando memoria y backups) y `verificar` comprueba hub, Laya, hooks, subagentes y settings.

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
