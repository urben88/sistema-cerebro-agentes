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
→ **Sustituida por D13**: en la práctica el auto-serve resultó frágil (dependía del binario que encontrara en PATH y del estado del puerto).

### D6 — OpenRouter como proveedor de las manos (decisión inicial) · 2026-10-13
Decisión del usuario: unificar proveedor (DeepSeek oficial queda conectado como alternativa). v0.1.0 usa DeepSeek V4.1 Flash para los tres agentes; GPT-6 Luna se activa cambiando 1 línea en el agente que se quiera.
→ **Ajustada durante las pruebas: ver D12.** El proveedor por defecto final de v0.1.0 es DeepSeek oficial.

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

### D12 — Pivote a DeepSeek oficial como proveedor por defecto (v0.1.0) · 2026-10-13
Durante las pruebas de aceptación se detectó que la cuenta de OpenRouter está en free tier con 0 créditos: las peticiones con `max_tokens` alto (OpenCode pide hasta 256000 en algunos modelos) fallan con «requires more credits, or fewer max_tokens», y el manejo de ese error en OpenCode v2.0.27 provoca además un crash interno («Attempted to assign to readonly property» en `Agent.state`) que deja la tarea colgada en `accepted` con 0 tokens. No se encontró forma de capar el `max_tokens` por configuración (probado `body.max_tokens` y `limit.output` en OpenCode, tanto en configuración de proyecto como en variable de entorno: sin efecto).
Conclusión: los agentes usan `deepseek/deepseek-flash` (proveedor oficial, ya conectado y verificado). OpenRouter queda listo para GPT-6 Luna en cuanto la cuenta tenga crédito. Lecciones incorporadas a la skill: pasar siempre `providerID`/`modelID` explícitos (el modelo por defecto del servidor puede ser cualquiera; se detectó `meta/muse-wonder` con verificación 18+ pendiente) y documentar el requisito de crédito antes de mover agentes a OpenRouter.

### D13 — Servidor OpenCode V1 propio, gestionado por lanzador · 2026-10-13
El MCP `opencode-mcp` v3 habla la **API V1** (`POST /session`), que solo sirve `opencode-ai` (1.x). El OpenCode V2 (`@opencode/cli`) que usa la TUI expone `/api/...` y rechaza al MCP (405). Solución final: el instalador instala `opencode-ai@1.18.35` en `~/.sistema-cerebro-agentes/server` y despliega un **lanzador** que (1) asegura el servidor en `127.0.0.1:4599` con almacén de datos **aislado** (`server-data`, credenciales sincronizadas desde `~/.local/share/opencode/auth.json`) y (2) arranca `npx -y opencode-mcp` contra él. El MCP de Claude Code apunta al lanzador (scope usuario). Se eligió el puerto 4599 porque el 4096 quedó con un listener fantasma que impedía reutilizarlo. Verificado de punta a punta: `opencode_fire` → `completed` → archivo creado por el agente.

### D14 — `constructor` → `implementador` (palabra reservada de JavaScript) · 2026-10-13
Un agente llamado `constructor` hace crashear **todas** las peticiones del servidor V1 (`TypeError: Attempted to assign to readonly property` en `Agent.state`), incluso las que no lo usan: `constructor` es una propiedad heredada de todos los objetos JavaScript y rompe el mapa de agentes del servidor. Regla para el futuro: **no usar nombres de agentes que sean propiedades de Object** (`constructor`, `hasOwnProperty`, `toString`…). El agente se renombró a `implementador` y el instalador retira automáticamente el antiguo `constructor.md`.

### D15 — El modo combinado es un agente (`cerebro`) y el MCP vive dentro de él · 2026-10-13
Petición del usuario: usar Claude con normalidad y que lo combinado ocurra solo al activar un agente llamado `cerebro` ("rotándolo" cuando él quiera). Implementación: el servidor MCP se declara **inline** en el frontmatter `mcpServers` de `~/.claude/agents/cerebro.md` (los inline de `~/.claude/agents/` cargan sin diálogo de confianza), y se retira el registro global (`claude mcp remove opencode --scope user`). En el hilo normal **no existen** las herramientas `opencode_*`. Activación: `@cerebro` (una tarea), "usa el agente cerebro" (lenguaje natural) o `claude --agent cerebro` (sesión completa, con `initialPrompt`). El `CLAUDE.md` global pasa a describir los dos modos. El instalador templa la ruta del lanzador al desplegar el agente (`__COMANDO__` / `__ARGUMENTOS_JSON__`), porque la ruta es específica de cada máquina.

### D16 — Rotación entre modo normal y Cerebro (comando `cerebro`) · 2026-10-13
El usuario pidió que el Cerebro fuera rotable "como los modos que se ciclan con Shift+Tab". Investigado: el ciclo de Shift+Tab es **fijo** (permisos: manual → acceptEdits → plan → [bypassPermissions] → [auto]; los docs de `permission-modes` no ofrecen modos personalizados) y no existe acción de keybinding ni comando para cambiar el agente de la sesión en caliente. Solución verificada en real: comando `cerebro` = `claude --agent cerebro --continue` — cambia de modo **conservando la conversación**; `claude --continue` vuelve al modo normal sobre la misma conversación (ambos probados). Se instala en `~/.local/bin` (`cerebro.cmd` + script bash). En un directorio sin conversación previa funciona igual (empieza una nueva).

### D17 — Gestión visual de bots en el panel web · 2026-10-13
El usuario quería una herramienta visual (sin crear nada de cero) para crear sus propios "bots" (agentes de OpenCode) y asignarles un modelo concreto o heredado. Se extendió el **panel web existente** con un editor de bots: API (`GET /api/modelos`, `POST /api/bot`, `POST /api/bot/eliminar`) + formulario en el dashboard. Al guardar, el bot se escribe en el repo (`config/opencode/agents/<nombre>.md`) y en `~/.config/opencode/agents/`, con copia de seguridad y validación de nombres (incluida la lista de nombres reservados de JavaScript que rompen el servidor V1). El Cerebro usa el bot indicado por el usuario; si el bot fija modelo, se omite `providerID`/`modelID` en `opencode_fire` para respetarlo. Alternativas consideradas: plataformas visuales externas (Dify/n8n/Flowise) — descartadas porque no conducen los agentes de OpenCode ni el flujo cerebro→implementador sin trabajo de integración adicional.

### D18 — OpenRouter retirado; DeepSeek oficial como único proveedor de pago · 2026-10-13
Decisión del usuario: nada de OpenRouter. Se retira el bloque de configuración de `opencode.jsonc` y la credencial (`opencode auth logout`, con backup del `auth.json`). Todos los agentes usan `deepseek/deepseek-flash` (V4.1 Flash oficial, ya con saldo). Los proveedores locales (Ollama, LM Studio) quedan como estaban.

### D19 — Agentes por esfuerzo (variante de razonamiento) y delegación cortada · 2026-10-13
Verificado que el frontmatter de agentes acepta `variant:` tanto en V2 (TUI) como en el servidor V1 (el del MCP). Reparto: `implementador`/`debugger` high, `revisor` max, `testeador`/`explorador-ds`/`redactor-ds` low, `cerebro-oc` max. Regla de diseño: **los subagentes no encadenan más agentes**; solo el cerebro delega (máximo: preparación + ejecución + validación). `chat-local`/`chat-deepseek` se retiran (los sustituyen `local` y el reparto nuevo).

### D20 — Lado Claude: subagentes Haiku, esfuerzos medium y reglas anti-fanout · 2026-10-13
`modelSettings` de Sonnet 5/5.5 y Haiku 5.5 a **medium** por defecto (subir con `/effort high`); Opus intacto. Subagentes nuevos: `explorador`, `redactor`, `analista`, `arquitecto` y `subdirector`. El esfuerzo por subagente no existe en Claude Code (es por modelo/sesión): la guía de reparto vive en los prompts y en el skill. Anti-fanout y `/clear` al 70 % como reglas duras.

### D21 — Cerebro Hub: la capa de organización, como aplicación · 2026-10-13
Petición del usuario: la organización (memoria, contexto, vigilante, panel) no vive en sus repositorios y es una **aplicación con backend**, no solo configuración. Implementación: `config/hub/` (Node sin dependencias) con API local, memoria externa en `hub-data/`, vigilante, briefing para hooks y panel minimalista. Se abre en el puerto 4597 (sin tocar el 4598/4599 del panel antiguo y del V1).

### D22 — Docker para la capa de aplicación (hub + Laya); puente MCP nativo · 2026-10-13
`docker-compose` con dos servicios: `hub` (127.0.0.1:4597) y `laya` (red interna). El **puente MCP y el servidor OpenCode V1 siguen en el host** porque trabajan sobre las carpetas de Windows del usuario (montarlos en contenedor exigiría traducir rutas; frágil). El hub los alcanza por `host.docker.internal`. Autoarranque en Windows: tarea programada y, si el sistema la deniega, carpeta de Inicio. Esta decisión sustituye, **solo para la capa de aplicación**, el «sin Docker» de D2.

### D23 — Laya como motor de triaje local, con reglas de respaldo y registro · 2026-10-13
`laya[serve]` en contenedor CPU (3 checkpoints, `multilingual` para español). API real: `POST /v1/systemone` con `questions` como diccionario (`criteria` + `instructions`). Decisiones tipadas: agente, esfuerzo, escalar, riesgo. Confianza mínima 0,60: por debajo, mandan las reglas fijas (`reglas.json`). Cada decisión se registra con probabilidades (`logs/decisiones.jsonl`) para poder afinar Laya más adelante con uso real.

### D24 — Hooks de contexto y CLI `estado` · 2026-10-13
`SessionStart` (briefing inyectado; fallback a lectura local si el hub está apagado; silencioso si el proyecto no tiene memoria), `PreCompact` (checkpoint + recordatorio del ESTADO.md), `SessionEnd(clear)` (checkpoint de seguridad) y CLI `estado`. Se fusionan en `settings.json` con backup mediante `config/hub/settings-merge.mjs` (idempotente). Verificado de punta a punta: una sesión real respondió la tarea activa del proyecto solo desde el briefing.

### D25 — Nombres seguros y rutas normalizadas · 2026-10-13
La memoria del hub **normaliza las rutas** (comparación por cadena, no por resolución del sistema de archivos) para funcionar igual en Windows y dentro del contenedor Linux; los slugs se derivan de la ruta normalizada. Se mantiene la prohibición de nombres de agente que sean propiedades reservadas de JavaScript (D14).

### D26 — `default_agent` de OpenCode = `cerebro-oc` · 2026-10-13
Sin Claude, abrir OpenCode debe poner al agente «más listo» (DeepSeek · max) que delega en el resto. `plan`/`build` siguen disponibles e intactos.

### D27 — Planificador previo en las dos capas · 2026-10-13
Petición del usuario: alguien dedicado a hacer preguntas antes de generar, para no gastar tokens en suposiciones. Nuevo agente `planificador` en Claude (Haiku · medium; sirve de subagente y como agente principal) y en OpenCode (DeepSeek · high, `mode: all`): devuelve hasta 5 preguntas que cambian el trabajo + supuestos por defecto + plan + criterios de aceptación. `cerebro`/`cerebro-oc` lo lanzan antes de la spec cuando la tarea es ambigua y preguntan al usuario; no se planifican tareas triviales ni lo que el repo ya responde.

### D28 — Visibilidad de los trabajos dentro de Claude · 2026-10-13
El usuario solo veía «una llamada MCP» al delegar. Se añade: herramienta `trabajo_estado` en el MCP `triaje` (lista y detalle de jobs leyendo los `job_*.json` del MCP, sin volcar conversaciones), protocolo de hitos en `cerebro` (tarjeta → actualización ~1 min → cierre con informe + diffstat + veredicto) y una **barra de estado** (`hub/estado-linea.mjs`) con modelo, contexto y trabajo en curso; `settings-merge` la registra solo si el usuario no tiene una propia.

### D29 — Agentes por proyecto (aditivos) · 2026-10-13
Decisión del usuario: los roles del sistema son los «por defecto» de todos los proyectos; cada repo puede añadir los suyos sin tocar el sistema. Se documenta el mecanismo nativo: `<proyecto>/.claude/agents/` y `<proyecto>/.opencode/agents/`, aditivos, versionados en git, mismo nombre = ajuste local. Guía: `docs/agentes-por-proyecto.md`.

### D30 — Subagentes de Claude: tipo explícito y Haiku por defecto · 2026-10-13
Detectado en el transcript del usuario: subagentes en Sonnet porque se lanzaron como `general-purpose` (sin `subagent_type`) o `fork`; Claude Code V2.1.296 usa el modelo principal en ambos casos. Desde v0.3.0 `cerebro` y `CLAUDE.md` exigen `subagent_type` explícito y prohíben `fork`/`general-purpose`. Todo el equipo es Haiku salvo `arquitecto` (Sonnet, decisión expresa del usuario: solo arquitectura difícil).

### D31 — Despliegue consistente: hooks y hub al día · 2026-10-13
Incidencia real: `latido.mjs` estaba registrado en `settings.json` pero no desplegado (`MODULE_NOT_FOUND` en cada Stop) y la imagen Docker del hub no se reconstruía al actualizar (el panel «La oficina» no llegaba al contenedor). `settings-merge.mjs` ahora solo registra hooks/statusLine que existen y limpia registros huérfanos; `install.ps1` reconstruye siempre las imágenes (capa cacheada si no hay cambios), como ya hacía `install.sh`.

### D32 — Apagado al cerrar la sesión y botón de pánico · 2026-10-13
Petición del usuario: nada debe seguir consumiendo tokens cuando cierra el chat que lanzó los subagentes. `SessionEnd` (todos los motivos: `prompt_input_exit`, `logout`, `clear`, `other`) ejecuta `cerrar-trabajos.mjs`, que cancela los trabajos activos del proyecto abortando sus sesiones en el servidor V1 (`POST /session/{id}/abort`) y los marca como `cancelled`; budget de 8 s (el hook tarda ~0,5 s) y registro en la bitácora. Complementos: comando `cerebro-parar` (todos / un proyecto / `--seco`), herramienta MCP `parar_trabajos` (desde el chat) y `POST /api/trabajos/cancelar` (para el panel). Si el cierre es brusco y el hook no corre, el comando lo cubre. Nota: el hook no usa `process.exit()` (aserción de libuv en Windows al cerrar con fetches pendientes).

### D33 — Opus 5.5 dirige en los dos modos · 2026-10-15
Decisión del usuario: Opus 5.5 · medium pasa a ser la inteligencia de la sesión principal y del agente `cerebro` (antes Sonnet), y `arquitecto` pasa a Opus · high. Regla de coste: el agente más barato que pueda hacer la tarea (Haiku por defecto → Sonnet si hace falta criterio, vía el nuevo `resolutor` → Opus solo para analizar y decidir lo global). Ideas tomadas de `configurar-claude.ps1` (equipo Opus → `coder` Sonnet → `explorer`/`helper` Haiku): `resolutor` (Sonnet · high), `ayudante` (Haiku · low, solo en EJECUTAR), modos PLAN/EJECUTAR (sin indicación, PLAN), aviso de contexto por tokens reales en consola y nota de última sesión escrita por Haiku. Detalle en `docs/specs/15-opus-dirige-y-configurar-claude.md`.

## Notas técnicas útiles

- **Herramientas clave del MCP (perfil essential):** `opencode_setup`, `opencode_context`, `opencode_status`, `opencode_ask`, `opencode_fire`, `opencode_run`, `opencode_reply`, `opencode_check`, `opencode_wait`, `opencode_job_get/list/cancel/input`, `opencode_question_*`, `opencode_permission_*`, `opencode_conversation`, `opencode_review_changes`.
- **Estados de un trabajo:** `accepted`, `running`, `input_required`, `completed`, `failed`, `cancelled`, `unknown`. Un timeout de observación **no** es un fallo.
- **`opencode_fire` acepta `agent`, `providerID`, `modelID` y `directory` por llamada**. Pasa siempre `providerID` + `modelID` explícitos: en V2 el modelo es de la sesión y puede quedar en otro distinto al del archivo del agente (p. ej. el último usado en la TUI).
- **Whitelist V1 en `opencode.jsonc`:** si existe un bloque `provider.openrouter.whitelist` de V1, OpenCode V2 lo ignora (el catálogo completo aparece en `opencode models`). No afecta a este sistema porque las llamadas fijan proveedor y modelo explícitos.
- **Claude Code debe reiniciarse** tras `claude mcp add` para cargar el MCP.
- **Permisos headless:** por defecto las herramientas están permitidas en el espacio de trabajo; lecturas sensibles o accesos fuera del proyecto pueden pedir aprobación y aparecen como `input_required`. El Cerebro los resuelve con `opencode_job_input` / `opencode_session_permission`.
- **Nunca llames a un agente con una propiedad reservada de JavaScript** (`constructor`, `hasOwnProperty`, `toString`…): el servidor V1 crashea en todas las peticiones (`Agent.state`, «Attempted to assign to readonly property»). Ocurrió con `constructor`; renombrado a `implementador`.
- **Incidencia conocida de opencode-mcp (#18):** posible conflicto si dos servidores OpenCode comparten almacenamiento a la vez; razón de más para no fijar servidores manuales sin necesidad.
