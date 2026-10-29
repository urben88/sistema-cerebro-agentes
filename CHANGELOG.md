# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico (MAJOR.MINOR.PATCH).

## [Sin publicar]

### Añadido (spec 25 · instalador con control y flujo de errores)

- **Registro de lo instalado** (`~/.sistema-cerebro-agentes/instalado.json`, `scripts/instalado.mjs`): huella sha256 por componente (hub, hooks, panel, mods, MCP, agentes de Claude y de OpenCode, comandos, skill, Docker) y la configuración de Gentle AI.
- **Solo lo que cambió**: lo que está igual sale como `[=] sin cambios`; si cambió en el repo se actualiza con copia. La imagen Docker del hub solo se reconstruye si cambió el hub o el stack.
- **Cambios a mano**: pregunta `[s] sobrescribir (con copia) / [n] conservar / [d] ver diferencias`. Con `-Force`/`--force` o sin consola interactiva conserva lo tuyo y lo avisa.
- **Opciones nuevas**: `-Reinstalar`/`--reinstalar` (ignora el registro) y `-SinVerificar`/`--sin-verificar`. `-Check` dice qué haría con cada componente.
- **Gentle AI** solo se ejecuta si falta o si cambian su versión o su configuración; después se reinicia el servidor OpenCode V1 para que reconecte Engram.
- **Flujo de errores**: cada paso acaba en `OK`, `sin cambios`, `aviso` o `error`; un error no corta los demás y lo que falla a medias se restaura desde su copia. Log en `~/.sistema-cerebro-agentes/logs/install-<fecha>.log`, resumen con causa y arreglo, y código de salida 1 si hubo errores. Al final ejecuta `verificar -Smoke`.
- Pruebas: `scripts/test-instalador.mjs` (dentro de `verificar`).

### Cambiado (spec 24 · bitácora en Engram)

- **Bitácora en Engram**: con Engram activo, `estado.mjs --bitacora` y la nota de trabajos cancelados al cerrar la sesión se guardan en Engram (`engram save`, tipo `manual`); si Engram falla, van al hub como antes. `BITACORA.md` deja de crecer y la compresión con Haiku ya no se dispara. ESTADO.md y CONTEXTO-REPO.md siguen en el hub.

### Corregido

- **`verificar`: Engram en OpenCode** se comprueba en el servidor V1 (`GET /mcp`). OpenCode v2 ya no lista los MCP con `opencode mcp list` y la comprobación fallaba aunque Engram estaba conectado.
- `install` ejecuta Gentle AI con `--persona neutral` (español sin voseo).

### Cambiado (spec 23 · Engram como memoria, junto al hub)

- **Briefing sin duplicados**: con Engram activo, `session-start` no inyecta la bitácora ni la nota de última sesión (Engram ya inyecta su contexto). Pide al hub `/api/briefing?engram=1`.
- **Sin resumen Haiku repetido**: con Engram activo, `session-end` no lanza `resumir-sesion.mjs`.
- **`buscar.mjs` une Engram y el hub** (`[engram:<tipo>]`, `--tipo engram`); con el hub apagado sigue mostrando Engram.
- **Comprobaciones**: `/odd:doctor` añade el punto `engram`; `install` y `verificar` comprueban `engram version`; nuevas pruebas `scripts/test-engram.mjs`.
- Sin Engram (o con `ENGRAM_DESACTIVADO=1`) todo funciona como antes. Las rutas `/api/memoria/*` y los datos de `hub-data` no cambian.

## [0.11.0] - 2026-10-28

### Añadido (specs 20 y 21 · Gentle AI en el instalador y configuración global adaptada a ODD)

- **Gentle AI en `install`** (ps1 y sh): instala el binario (4.3.1 con `go install` en Windows; script oficial en Linux y macOS; sin Go avisa y sigue) y ejecuta `gentle-ai install --agents claude-code,opencode --preset full-gentleman --persona gentleman --claude-orchestrator-modules`. Va antes de lo nuestro y hace backup de lo que toca. Asegura `@opencode/plugin@2.0.4` en `~/.config/opencode`. `SIN_GENTLE_AI=1` lo omite.
- **`default_agent` de OpenCode**: tras Gentle AI se devuelve a `cerebro-oc` (`config/claude/agente-defecto.mjs`, reemplazo de texto acotado que conserva los comentarios del JSONC; no toca `.gentle-ai-default-agent.json`).
- **Comandos `/odd:*`** (`config/claude/commands/odd/`): `start`, `plan`, `implement`, `verify`, `review`, `status`, `handoff`. Se copian a `~/.claude/commands/odd`.
- **Permisos prudentes** (`config/claude/permisos.mjs`, fusión idempotente en `settings.json`): `ask` para `git push`, instalaciones y borrados recursivos; `deny` para credenciales de Claude y `~/.ssh` (forma `~/` y absoluta); `allow` para lectura, git de solo lectura, tests y lint. No quita nada ni toca `defaultMode`.
- Los agentes `explorador`, `planificador`, `ayudante`, `retocador`, `resolutor` y `analista` añaden su «Rol ODD» a la descripción (sin cambiar modelo ni esfuerzo).
- `install -Check` y `verificar` informan de Gentle AI (versión, bloques `gentle-ai:*`, orquestador modular, `engram` en OpenCode), de los comandos `odd/`, de los permisos y de que el bloque de `CLAUDE.md` no mencione Laya.

### Cambiado

- `CLAUDE.md` compacto sobre ODD (de 67 a unas 50 líneas): reparto barato con tabla de roles; el coste es motivo válido para delegar.
- `actualizar` espera solo al hub (`/api/salud`), no a Laya.
- `uninstall` quita `~/.claude/commands/odd` y avisa de que Gentle AI se desinstala con `gentle-ai uninstall`.

### Retirado

- **Laya** por completo (modelo, triaje, pestaña del panel, `triaje_decidir`). Los instaladores eliminan el contenedor `cerebro-laya` con su imagen y volumen si existen. El MCP `triaje` se queda con `trabajo_estado` y `parar_trabajos`.

## [0.10.0] - 2026-10-16

### Cambiado (esfuerzos más bajos)

- `resolutor` baja a **Sonnet · medium**; sube a **high** al depurar o en tareas delicadas (`reparto-claude.mjs`: si el origen es `debugger` o hay `escalar`/`riesgo`, devuelve esfuerzo high).
- `implementador` (OpenCode) baja a **DeepSeek · low**: su escalera es `low`/`high`/`max` —no existe `medium` (comprobado en el catálogo de opencode: `reasoning_options` de `deepseek/deepseek-flash`)—, así que la bajada va al escalón barato. `debugger` sigue en high y `revisor` en max. Una prueba comprueba que ningún `variant` de OpenCode se sale de `low`/`high`/`max`.
- `revisor` solo cuando hay código con lógica que revisar; en cambios mecánicos, de docs o de configuración trivial bastan los tests o el `analista` (pauta en `cerebro`, `cerebro-oc` y el skill `delegar-a-opencode`).
- `cerebro` sigue en Opus · medium; el esfuerzo lo sube el usuario a mano (p. ej. `/effort high`), el agente no lo sube solo.

### Añadido

- **`retocador`** (Sonnet · low): cambios pequeños y localizados con algo de criterio (1–2 archivos); entre `ayudante` y `resolutor`. Si el cambio crece o exige diseñar, para y lo dice.
- **`consultor`** (Opus · low, solo lectura): segunda opinión rápida con contexto aislado (≤ 10 líneas); lo difícil sigue en `arquitecto`.
- Registrados en `reparto-claude.mjs`, en `CLAUDE.md`, README, docs, instaladores y `verificar`; y **en el catálogo de Laya** (`CATALOGO_AGENTES` de `hub/lib/triaje.mjs` + `AGENTES_CLAUDE`, capa `claude`), así que el triaje local también puede elegirlos (esto revierte el «fuera de alcance» de la spec 15).
- **Palabras clave afinadas**: el `retocador` **solo** se elige si el encargo dice que el cambio es pequeño («cambio pequeño», «pequeño arreglo/ajuste», «un retoque»…); «ajusta» y «retoca» sueltos —demasiado comunes— van a la regla del trabajo que toca (implementar/depurar). Reglas de respaldo en `reglas.json`: «segunda opinión» / «valida la decisión» / «qué opción» → `consultor`, con `arquitecto` por delante de `consultor`.

## [0.9.0] - 2026-10-15

### Cambiado (spec 15 · Opus dirige y lo mejor de `configurar-claude.ps1`)

- **O1 · Opus 5.5 dirige en los dos modos.** Reparto Opus → Sonnet → Haiku → OpenCode: la sesión principal y `cerebro` en **Opus 5.5 · medium**, `arquitecto` en **Opus 5.5 · high**. `settings-merge.mjs` deja `model: "opus"` y `effortLevel: medium` para `claude-opus-5-5` solo si faltan (lo elegido por el usuario se respeta).
- **Agentes nuevos:** `resolutor` (Sonnet · high; decide el cómo de un área acotada; en el cerebro, solo si OpenCode falla dos veces) y `ayudante` (Haiku · low; cambios ya decididos con instrucciones exactas, solo en EJECUTAR). Todos los subagentes con `disallowedTools: Agent` (la delegación se corta en ellos), `maxTurns` y `color`.
- **O2 · Triaje del modo normal** (`config/hub/lib/reparto-claude.mjs`, usado por el MCP `triaje` 0.4.0): implementar/depurar → `resolutor` (Sonnet), mecánico → `ayudante` (Haiku), revisión delicada → `arquitecto` (Opus), lo global → «hazlo tú» (Opus). El mod fija el modelo de los agentes nuevos.
- **O3 · Modos PLAN / EJECUTAR** en `CLAUDE.md` y `cerebro`: sin indicación, PLAN salvo lo trivial; en el cerebro, PLAN = spec propuesta sin delegar código.
- **O4 · Aviso de contexto en consola** (`aviso-contexto.mjs`): cuenta **tokens reales** (uso de la última respuesta) en vez de MB; avisa a los 100k y cada +50k (`CONTEXTO_AVISO`, `CONTEXTO_PASO`), una vez por nivel y sesión, al usuario (`systemMessage`) y al modelo (`additionalContext`).
- **Límite de turnos amplio:** `maxTurns: 200` en todos los subagentes de Claude (antes 20–60), para que no se corten a mitad de tarea y pierdan el contexto; se mantiene como freno anti-bucle.
- **Advisor de Opus para los subagentes:** `settings-merge.mjs` deja `advisorModel: "opus"` si falta ([advisor tool](https://code.claude.com/docs/en/advisor)); `resolutor`, `ayudante`, `analista` y `planificador` (Sonnet/Haiku) consultan a Opus solo en puntos de decisión (enfoque no obvio, error repetido, cierre de riesgo). La sesión principal en Opus no lo usa (exige advisor ≥ principal). Se desactiva con `/advisor off`.
- **Tramo de DeepSeek en la barra** (`hub/lib/tarifa-deepseek.mjs`): `🔥 DS punta` / `🌙 DS valle ½` con la cuenta atrás al cambio, en los dos modos. Horario oficial: punta L–V 01–04 y 06–10 UTC; el resto, valle a mitad de precio (los festivos chinos no se detectan).
- **Informes de subagente con tope** (≤ 10–15 líneas; `arquitecto`/`planificador` ≤ 30): lo largo va a un archivo y se da la ruta, para no llenar el contexto de Opus.
- **Revisión de entregas** en `CLAUDE.md`: criterio de terminado en cada encargo; si el informe dice «hecho» sin verificar, se reanuda al mismo subagente.
- **Caché de DeepSeek medida:** 99 % de acierto en 14 días (OpenCode); no hace falta spec.
- **O6 · Carga mental y estilo** en `CLAUDE.md`: nota «🧠 Merece que lo mires tú» solo cuando aporte, el porqué de las decisiones, puntos de control y estilo por defecto.

### Añadido

- **O5 · Nota de última sesión**: al cerrar o hacer `/clear`, `session-end.mjs` lanza en segundo plano `resumir-sesion.mjs`, que resume la sesión con Haiku en ≤ 5 líneas en `hub-data/memoria/ultima-sesion/<proyecto>.md`; `session-start.mjs` la inyecta (espera si el resumen sigue en curso). La sesión interna del resumidor lleva `ULTIMA_SESION_RESUMIENDO=1` y todos los hooks la ignoran. `SessionEnd` se registra ahora para cualquier motivo (el checkpoint sigue solo en `/clear`).
- **O8 · Barra de estado con [claude-hud](https://github.com/jarrodwatts/claude-hud)** (la más recomendada por la comunidad; sustituye al indicador «normal/cerebro»): el instalador añade el plugin (`claude plugin install claude-hud@claude-hud`) y `settings-merge.mjs` apunta la barra a `hub/hud.mjs` (vía `hud.cmd` con Git Bash), que lanza la versión más nueva de claude-hud y le añade la línea del sistema con `--extra-cmd` (`estado-linea.mjs --widget`: modo y trabajo de OpenCode, con el JSON de Claude en `CEREBRO_BARRA_DATOS`). Config inicial en `~/.claude/plugins/claude-hud/config.json` (herramientas, subagentes, tareas, coste, duración, esfuerzo) solo si no existe. Sin plugin o con `SIN_CLAUDE_HUD=1`, queda el indicador propio; el desinstalador la retira.
- **Freno a bucles de error** (`errores-repetidos.mjs`, hooks `PostToolUseFailure` + `PostToolUse` de Bash): si el mismo comando falla 2 veces seguidas avisa al modelo (cambiar de enfoque o consultar al advisor) y a la 3.ª también al usuario; un éxito reinicia el contador. Además, `actualizar` ejecuta `verificar -Smoke` al terminar (`-SinVerificar` / `--sin-verificar` lo salta; si falla, avisa sin abortar).
- **O7 · Pruebas:** `scripts/test-opus-reparto.mjs` (reparto, aviso, nota, agentes y barra) enganchado en `verificar.sh/.ps1`.

### Corregido

- Hub en Docker: `lib/skills.mjs` importaba `hooks/skill-lint.mjs`, que no está en la imagen; ahora lo carga del volumen `/sistema/hooks` si no lo encuentra al lado (el contenedor entraba en bucle de reinicios al reconstruirse).
- `verificar.ps1`: la ruta de `test-modo.mjs` llevaba un tabulador en lugar de `\` y la prueba de la barra no se ejecutaba.

## [0.8.0] - 2026-10-14

### Añadido (spec 14 · comunicación entre agentes y reparto)

- **C1 · Directorio de agentes** (`config/hub/lib/a2a.mjs` + `GET /api/a2a/agentes`): Agent Card ligera por agente — `{name, description, version, skills[{id,name,description}], modelo, esfuerzo, capa, solo_lectura, coste_estimado, salud}`, a partir del frontmatter de `config/opencode/agents/*.md` y `config/claude/agents/*.md`, `reglas.json` y `salud-agentes`. Sin dependencias nuevas.
- **C2 · Consulta síncrona mediada** (`POST /api/a2a/consultar`): valida (`para` de lectura, `pregunta` ≤ 2000, `directory` absoluto y existente), antepone la instrucción fija («responde en ≤ 10 líneas…»), lanza el job con `lanzador.mjs`, espera hasta 120 s vigilando el tope de coste de `presupuestos` (aborta la sesión al superarlo) y devuelve `{ok, jobId, respuesta (≤ 1200, con «…»), coste, ms}`. Rechaza con 409 si `de` ya está dentro de una consulta (profundidad 1) o si hay más de 3 en curso. Deja job en el ledger y evento `a2a` en métricas.
- **C3 · Buzón asíncrono por tarea** (`POST/GET /api/a2a/mensajes`, `POST /api/a2a/mensajes/responder`): estados `pendiente|respondido|expirado`, TTL 30 min, máx. 20 pendientes por destinatario (429) y persistencia atómica read-merge-write en `hub-data/a2a.json`. Una respuesta no genera otro mensaje de tipo `pregunta`.
- **C4 · Triaje en el camino**: la consulta mediada y el lanzamiento de jobs del hub registran la decisión de triaje (`decisiones.jsonl`) si no hay una reciente para el mismo encargo; `cerebro` y `cerebro-oc` pasan a decir «antes de delegar, `triaje_decidir`; para lecturas largas, `a2a/consultar` en vez de leer tú».
- **C5 · Reparto medido** (`GET /api/reparto?dias=7`): agrega ledger + métricas (spec 11) + `decisiones.jsonl` en `{trabajos, completados, fallidos, cancelados, coste, mediaMs}` por agente y por capa, `%` de jobs con decisión de triaje previa y `consultasA2A {total, coste, mediaRespuestaChars}`. Tarjeta «Reparto» en el panel y evento de métricas `a2a` (consulta|mensaje; sin texto).
- **C6 · Limpiar el ruido del ledger**: las entradas se creaban sin `agente` cuando el fichero del job aún no exponía `agent`/`session.agent` (o lo traía como `"Object"`); `reconciliar()` ahora **completa** `agente`/`directorio` con el registro del job aunque la entrada sea terminal (el estado sigue inmutable).
- **C7 · Guías, docs y pruebas**: sección A2A en los agentes de OpenCode de lectura y en `implementador`/`debugger` (cuándo usar `consultar` por curl y sus límites), `docs/arquitectura.md` (diagrama del mediador), `docs/pruebas.md` y `scripts/test-a2a.mjs` (lanzador simulado, todo en `os.tmpdir()`) enganchado en `verificar.sh/.ps1`.

## [0.7.0] - 2026-10-14

### Añadido (spec 13 · guía de uso de MCPs)

- **N1 · Plantilla de guía** (`config/hub/plantillas/mcps-guia.md`, ≤ 4000 caracteres): en español, con la tabla «Si necesitas X → usa Y» (docs de librería → `context7`; web/JS → `playwright` o `claude-in-chrome`; búsqueda → `web-search`; repo/PR/issue → `github`; servidor → `ssh`; OpenCode → `opencode`/`triaje`), una ficha por MCP (`Úsalo cuando`, `No lo uses para`, ejemplo y herramientas reales) y 3 reglas finales.
- **N2 · Copia sin pisar** (`config/hub/mcps.mjs`): copia la plantilla a `hub-data/memoria/global/MCPS-GUIA.md` **solo si no existe** (lo editado por el usuario se conserva); `--forzar-guia` la regenera. `MCPS.md` y `mcps.json` se generan exactamente igual. El instalador deja la plantilla en `~/.sistema-cerebro-agentes/hub/plantillas/`.
- **N3 · Contexto para Claude**: `session-start.mjs` añade al briefing un resumen ≤ 1200 caracteres de la guía (tabla + reglas, vía `config/hooks/mcps-guia.mjs`); `CLAUDE.md`, `cerebro`, `explorador` y `analista` apuntan a `MCPS-GUIA.md`.
- **N4 · Contexto para OpenCode**: una línea en `explorador-ds`, `implementador`, `debugger`, `redactor-ds`, `revisor` y `cerebro-oc` para leer `MCPS-GUIA.md` antes de buscar datos externos (`local-codigo` no).
- **N5 · Pruebas y docs**: `scripts/test-mcps-guia.mjs` (enganchado en `verificar.sh/.ps1`) comprueba que la copia no pisa la guía editada, que `--forzar-guia` la regenera, que `MCPS.md` es idéntico con y sin guía y que el resumen respeta el tope; `docs/arquitectura.md` y `docs/pruebas.md` actualizados.

## [0.6.0] - 2026-10-14

### Añadido (spec 12 · agente local `local-codigo` y respaldo automático)

- **L1 · Catálogo y reglas**: `local-codigo` entra en `CATALOGO_AGENTES` y en `presupuestos` (coste 0); en `reglas.json` la regla de `implementador` elige `local-codigo` cuando el encargo es **acotado** (archivo/función/test/spec/criterio y sin arquitectura/migración/refactor global/varios módulos/todo el), y depuración, revisión y arquitectura (`prioridad`) no cambian.
- **L2/L3 · Salud por agente** (`lib/salud-agentes.mjs`): `crearSaludAgentes({ledger, reglas})` calcula sobre los últimos N trabajos terminales (excluye `cancelado`) la tasa de fallo (`fallido`+`atascado`) y los fallos seguidos; `resolver` degrada al sustituto configurado en `reglas.json` → `respaldo`, permite **una prueba** (`prueba:true`) tras el enfriamiento y se limpia solo con un acierto. Todo se deriva del ledger (sin fichero propio): sobrevive a reinicios.
- **L4 · Triaje**: `triaje.decidir` (Laya o reglas) aplica `resolver()` a la decisión final, lo explica en `motivo` («local-codigo degradado a implementador: 3 de 5 fallaron») y lo registra en `decisiones.jsonl` con `degradado`.
- **L5 · API y panel**: `GET /api/agentes/salud` devuelve `{agentes:[{agente, muestras, tasaFallo, fallosSeguidos, degradado, proximaPrueba}]}` y la pestaña «Triaje·Laya» muestra una línea por agente con respaldo («local-codigo · 4/6 OK · activo» o «degradado hasta HH:MM»).
- **L6 · Guía a los cerebros**: `cerebro` y `cerebro-oc` usan `local-codigo` para código acotado y bien especificado antes que `implementador` (spec con archivos, cambio exacto y comando de comprobación; verificación siempre con tests/`revisor`) y aceptan la degradación sin discutir.
- **L7 · Docs y pruebas**: `docs/arquitectura.md` y `docs/pruebas.md` actualizados, y `scripts/test-salud-agentes.mjs` enganchado en `verificar.sh/.ps1`.

## [0.5.0] - 2026-10-14

### Añadido (spec 11 · métricas de uso)

- **M1 · Módulo `lib/metricas.mjs`**: `crearMetricas({dirLogs})` escribe `hub-data/logs/metricas.jsonl` (una línea JSON por evento `{ts, tipo, …}`), con rotación a `metricas.1.jsonl` al pasar de 8 MB, poda por retención y **saneo** (se descartan `prompt`, `texto`, `respuesta`, `contenido` —y por defensa `comando`, `command`, `consulta`— y cualquier campo string > 200 chars). Nunca lanza: un fallo de escritura va al registro central como `aviso`.
- **M2 · Eventos de trabajo**: al pasar a `completado | fallido | cancelado | atascado`, un evento `job` con `jobId`, `agente`, `modelo`, `directorio`, `estado`, `duracionMs`, `coste` y `pasos`; **idempotente por `jobId`** incluso tras reiniciar el hub.
- **M3 · Contexto y memoria**: `briefing` (chars por sesión y proyecto), `nudge` (disparado/descartado), `compresion` (chars antes/después y modo `resumen|fallback`) y `busqueda` (nº de consultas, resultados y ms, sin la consulta), más los límites 422 (fichero y chars).
- **M4 · Decisiones**: `aprobacion` (nivel, decisión, alcance, modo efectivo), `guardian` (veredicto y ms), `skill` (propuesto/aprobado/rechazado/usado) y `cron` (ejecución: id, agente, estado). Nunca el comando ni la consulta.
- **M5 · API**: `GET /api/metricas?tipo=&desde=&limite=` (máx. 1000), `GET /api/metricas/exportar` (descarga el JSONL completo, rotado + actual) y `GET /api/metricas/resumen` (conteos, rango, bytes y `porTipo`).
- **M6 · Configuración**: `metricas_activas` (defecto `true`) y `metricas_retencion_dias` (90) en `hub-data/config.json`; al arrancar el hub se poda lo más viejo que la retención.
- **M7 · Panel**: tarjeta «Métricas» en «Datos» con interruptor activar/desactivar, tamaño, nº de eventos y botón «Exportar .jsonl» (sin gráficas).
- **M8 · Documentación y pruebas**: `docs/arquitectura.md` y `docs/pruebas.md` (formato de cada evento y qué NO se guarda) y `scripts/test-metricas.mjs` enganchado en `verificar.sh/.ps1`.

## [0.4.0] - 2026-10-14

### Añadido (spec 10 · patrones de Hermes Agent, reimplementados)

- **R0 · Lanzamiento por API V1** (`lib/lanzador.mjs`): el hub crea sesión y envía mensajes a OpenCode con agente y `directory`, sin depender del MCP.
- **R1 · Búsqueda FTS5** de memoria, bitácoras, decisiones, hallazgos y skills (`GET /api/buscar`, `--reindexar`, fallback lineal con `HUB_BUSCAR_FALLBACK=1`).
- **R2 · Nudges de memoria** en `latido.mjs` y límites de tamaño con HTTP 422 en ESTADO / CONTEXTO-REPO.
- **R3 · Ledger durable de trabajos** (`hub-data/trabajos.json`): estados formales, reconciliación al arrancar, atasco por falta de progreso (nunca cancela solo).
- **R4 · Aprobaciones por niveles** (`hardline` / `peligroso` / `seguro`): el hub clasifica (`POST /api/aprobaciones/clasificar`) y el cerebro resuelve; allowlist propio con merge contra disco, cola de pendientes, `deny` hardline en los 9 agentes de OpenCode y panel.
- **R5 · Skills autogenerados**: propuesta → pendiente → aprobación del usuario; linter y guard de seguridad (`config/hooks/skill-lint.mjs`), contador de uso (hook `skills-uso.mjs`), candidatos a archivar sin borrar nunca.
- **R6 · Cron** (`lib/cron.mjs`): schedule tipado, parser es/en, preflight, claim con TTL, reintentos 5/15/30, tope de coste real (aborta la sesión) y panel «Programadas».
- **R7 · Compresión de bitácoras** (`lib/compresion.mjs`): archivo íntegro verificado en `BITACORA-archivo/`, resumen por `redactor-ds` con fallback determinista, protección frente a apuntes concurrentes.
- **R8 · Aprobación inteligente**: el cerebro invoca al guardián (plantilla `guardian-prompt.md`) y reporta el veredicto; hardline jamás aprobable; 3 denegaciones seguidas abren el circuito y vuelve a `manual`.

### Corregido tras revisión

- `seguro` ya no autoaprueba `find -delete`, redirecciones, `tee` ni `sort -o`; rutas de `references/` con `..` rechazadas; bajas del cron persistidas entre instancias; la compresión no pierde apuntes añadidos durante el resumen.

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
