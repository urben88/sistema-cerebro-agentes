# 10 · Patrones de Hermes Agent adaptados al sistema

## Objetivo
Reimplementar, en Node puro y sobre el hub actual, siete patrones de [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous Research, commit `0e427d7`). **No se copia código**: se toma el diseño y los umbrales, se escribe de cero y se cita la fuente en el comentario de cabecera de cada módulo. Cada fase se entrega sola, con pruebas y vuelta atrás por `git revert` (misma regla que la spec 09).

Hallazgo registrado y validado por el usuario: `h_mv828875mwnc`. Alcance elegido: todo el plan, de menor a mayor esfuerzo. Tras el spike (fase 0), la fase 1 primero; las fases 2 y 3 solo cuando la anterior esté verificada.

## Punto de partida (reconocimiento 2026-10-14)
| Idea | Hoy en el repo | Hueco |
|---|---|---|
| Búsqueda de sesiones | Ninguna. `/api/memoria/proyecto` solo devuelve 4000 chars | Índice y endpoint de búsqueda |
| Nudges de memoria | `aviso-contexto.mjs` (ventana) y `pre-compact.mjs` | Recordatorio de guardar memoria cada N turnos |
| Delegación asíncrona | `vivo.mjs` (4 s), `vigilante.mjs` (60 s), `cancelarTrabajos` | Reanudar tras reinicio del hub; estado `stalled` formal |
| Aprobaciones | Permisos estáticos en frontmatter de `config/opencode/agents/*.md` | Niveles, lista de patrones peligrosos y cola de aprobación en el hub |
| Skills autogenerados | Solo `delegar-a-opencode`, a mano | Propuesta, linter, guard y contador de uso |
| Cron | Solo timers de intervalo | Planificador persistente |
| Compresión | Medición (`ventana.mjs`) y checkpoint (`pre-compact.mjs`); comprime Claude Code | Resumen propio de bitácoras; no tocar el de Claude |

Base técnica: Node ≥ 22, **sin dependencias npm**. `node:sqlite` (con FTS5) está verificado en Node 24.18; en Node 22 exige ≥ 22.13 sin flag. Los datos viven en `hub-data/` (`HUB_DATA_DIR`).

## Principios de diseño (tomados de Hermes)
- **Núcleo estrecho**: la capacidad nueva va en módulos del hub (`config/hub/lib/`) o en skills, no en el hub principal. Criterio: ¿puede ser un skill? → skill; ¿lo necesita el hub entre sesiones? → módulo; ¿es otra herramienta externa? → MCP.
- **El prompt no se reescribe a mitad de sesión**: los recordatorios (nudges) entran como contexto de hook o mensaje, nunca modificando `CLAUDE.md` ni las instrucciones del agente.
- **Persistencia aditiva**: al guardar listas (permitidos, trabajos) se hace *merge contra el fichero*, no se sobrescribe con la copia en memoria.
- **Escritura atómica y merge (transversal)**: todo fichero nuevo en `hub-data/` (`estado-nudges.json`, `trabajos.json`, `aprobaciones.json`, `cron/jobs.json`, `skills.usage.json`) se escribe con `tmp`+`rename` y *read-merge-write*. En Docker Desktop el `rename` sobre un bind mount no está garantizado: se reintenta y se verifica con una relectura antes de dar la escritura por buena.
- **Telemetría fuera de los archivos del usuario**: contadores en ficheros sidecar (`*.usage.json`), nunca en frontmatter de specs o skills.

## Fase 0 · Spike de lanzamiento (esfuerzo bajo)

### R0 · Spike de lanzamiento
Un job de prueba que verifique que el hub **puede crear sesión y enviar mensaje con `agente` y `directory`** por la **API HTTP V1** del servidor OpenCode y leer el resultado. En la misma pasada se comprueba que la imagen del hub trae FTS5 (`PRAGMA compile_options`).

- Si el spike **pasa**: R6 y R7.2 lanzan los jobs por la API V1 directa.
- Si el spike **falla**: R6 se convierte en «tareas vencidas» inyectadas en el briefing y lanzadas por el **cerebro**, y R7.2 usa un job lanzado por el cerebro.
- Resultado (2026-10-14): PASA — `config/hub/lib/lanzador.mjs` y `scripts/spike-lanzamiento.mjs` crean la sesión y envían el mensaje con `agente` y `directory` por la API V1 (`POST /session`, `POST /session/:id/prompt_async`), leen la respuesta (`GET /session/:id/message`) con «PONG» y confirman FTS5 en `node:sqlite`. Hallazgo: el parámetro `directory` de la query **debe ir con barras normales** (`C:/ruta`); con `\` el servidor lo corrompe.

## Fase 1 · Directo (esfuerzo bajo-medio)

### R1 · Búsqueda de sesiones y bitácoras
1. Nuevo `config/hub/lib/buscar.mjs`: índice SQLite FTS5 (`node:sqlite`) en `hub-data/indice.db` con tablas `docs(id, proyecto, tipo, fecha, titulo, texto)` y `docs_fts` (external-content). `tipo` ∈ `bitacora | estado | contexto | checkpoint | decision | hallazgo | skill | sesion`.
2. Fuentes de indexado explícitas: `hub-data/memoria/proyectos/*` (BITACORA.md, ESTADO.md, CONTEXTO-REPO.md y `checkpoints/`), `hub-data/logs/decisiones.jsonl` y `hub-data/logs/hallazgos.jsonl` (`decision`/`hallazgo`) y `config/claude/skills/*/SKILL.md` (`skill`, necesario para R5.6). Opcionalmente, un resumen de las sesiones de OpenCode. Los textos con `tipo=sesion` de subagentes/cron se degradan en el ranking.
3. Endpoint `GET /api/buscar?q=…&proyecto=…&limite=…`: consulta saneada (frases entre comillas, sin operadores FTS5 crudos, máx. 2048 chars), `snippet(…, '>>>', '<<<', '…', 40)`, orden por `rank`.
4. Reindexado incremental al arrancar el hub y tras cada escritura de memoria; reconstrucción completa con `node hub.mjs --reindexar`.
5. Si `node:sqlite` **no existe** (Node < 22.13) o **existe sin FTS5**, el hub arranca igual y `/api/buscar` responde con un fallback lineal sobre los `.md` (sin ranking), indicándolo en la respuesta. La ausencia de FTS5 se detecta con `PRAGMA compile_options`; `HUB_BUSCAR_FALLBACK=1` fuerza el fallback (para CA1). Verificado (2026-10-14, `testeador`): FTS5 funciona sin flags en `node:22-alpine` (v22.23.3) y en `node:24-alpine` (v24.21.0); la imagen del hub (`config/hub/Dockerfile:3`) **se mantiene en `node:22-alpine`** y el fallback queda como red de seguridad.
6. Herramienta para agentes: `node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta"` (CLI; en el repo, `config/hooks/buscar.mjs`) y mención en la regla de contexto del `CLAUDE.md`.

**Trampa (Hermes)**: un `delete` de un rowid que nunca se indexó corrompe el índice FTS5 external-content. Alta y baja deben operar sobre el mismo conjunto de filas; el borrado siempre pasa por la tabla `docs` con trigger.

### R2 · Nudges de memoria
1. El hook `latido.mjs` (UserPromptSubmit) mantiene un contador por sesión y proyecto en `hub-data/estado-nudges.json`. Hoy el hook registra el latido de los cuatro eventos sin devolver nada; a partir de ahora emite JSON `additionalContext` **solo** en `UserPromptSubmit` y **nada** en `Stop`, `SubagentStart` ni `SubagentStop` (esos siguen alimentando el panel).
2. Cada `nudge_intervalo` turnos (por defecto **10**, configurable en `reglas.json` con override en `hub-data/reglas.json`) sin escritura de memoria, devuelve un `additionalContext` corto: «Si en esta conversación hay decisiones, convenciones o preferencias que sobrevivan a la sesión, guárdalas en memoria (ESTADO/CONTEXTO-REPO). Si no hay nada, no hagas nada».
3. Reglas del texto: enruta cada hecho a **un solo** destino (`ESTADO.md` = tarea en curso, `CONTEXTO-REPO.md` = convenciones del proyecto) y lista qué NO guardar (progreso trivial, volcados de datos, logs de trabajo acabado, TODOs temporales).
4. Límites de tamaño por archivo de memoria, medidos como **caracteres del cuerpo sin cabecera** (`ESTADO.md` ≤ 2200, `CONTEXTO-REPO.md` ≤ 4000): si una escritura los supera, el hub la rechaza y devuelve las entradas actuales para consolidarlas. Esto cambia el contrato de `/api/memoria/estado` y `/api/memoria/contexto`: hoy devuelven `{ok:true}`; ahora pueden devolver `{ok:false, motivo:'excede', actuales:…}` con HTTP 422.
5. El contador lo posee el hook (host): el hub no lo toca. El reset a 0 lo hace el propio hook cuando detecta una escritura de memoria (marca de tiempo de `ESTADO.md`), y todas las escrituras de `estado-nudges.json` son `tmp`+`rename`.
6. El nudge se emite al llegar al turno **N** y no se repite hasta que pasen **otros N** turnos sin escritura.

**Trampa (Hermes)**: tocar el prompt de sistema a mitad de conversación rompe la caché. El nudge viaja solo como `additionalContext` del hook.

### R3 · Delegación asíncrona robusta
1. Ledger durable `hub-data/trabajos.json` (escritura atómica `rename`) con `{jobId, agente, directorio, estado, creado, actualizado, deadline}`.
2. Estados formales: `pendiente → en_curso → completado | fallido | cancelado | atascado | desconocido`. Los estados reales del job incluyen `unknown`, que el ledger registra como `desconocido`.
3. Al arrancar, el hub reconcilia el ledger con `leerJobs()` (`config/hub/lib/opencode.mjs`), no con `opencode_job_list`: lo que sigue vivo se re-engancha a `vivo.mjs`; lo que desapareció pasa a `desconocido` y se anota en la bitácora.
4. Detección de atasco por **progreso**, no por reloj: se mide con `updatedAt` del job y los eventos con `ts` de `lib/vivo.mjs`. El umbral es el `minutosAtasco` ya existente (por defecto **12** min, hoy en `CONFIG_DEFECTO` de `config/hub/hub.mjs`) y un segundo valor configurable con ese mismo defecto para el caso «dentro de una herramienta»; tras un margen de gracia configurable → `atascado` y aviso al cerebro (el `subdirector` decide, nunca se cancela solo). La detección **solo escribe en el ledger**, nunca en el fichero del job del MCP.
5. Concurrencia y profundidad: el hub **mide y avisa** (concurrencia observada, profundidad detectada), no impone nada; la imposición (por defecto 3 en segundo plano y profundidad 1) es consigna del cerebro.
6. Retención del ledger: 7 días; los completados se conservan 50.

**Trampa (Hermes)**: el trabajo en segundo plano es process-local; sin ledger, un reinicio pierde jobs y resultados.

### R4 · Aprobaciones por niveles
1. Nuevo `config/hub/lib/aprobaciones.mjs` y `reglas-peligro.json` con listas regex: `hardline` (bloqueo siempre: `rm -rf /`, formateo de disco, fork bomb, escritura en dispositivos), `peligroso` (escritura en `~/.ssh`, `.env`, perfiles de shell, `git push --force`, `git reset --hard`, borrados recursivos, `curl … | sh`) y `seguro`. Los patrones `hardline` se añaden además como `deny` en el frontmatter de `config/opencode/agents/*.md` (defensa en profundidad).
2. El hub **clasifica**, no aprueba: expone `POST /api/aprobaciones/clasificar`, que recibe el comando/petición y devuelve `hardline | peligroso | seguro` más un `motivo`. El hub no es cliente MCP y no aprueba nada.
3. El allowlist es **propio** del hub, en `hub-data/aprobaciones.json` (no la configuración de OpenCode); se escribe con `tmp`+`rename` y **merge contra el fichero en disco** (lo revocado a mano no se resucita). Modos en `hub-data/config.json` → `aprobaciones.modo`: `manual` (por defecto, pregunta lo peligroso), `inteligente` (reservado para fase 3; hoy equivale a `manual`), `abierto` (solo bloquea hardline, y solo por decisión explícita del usuario).
4. El cerebro **resuelve**: al ver un job en `input_required`, consulta la clasificación y responde con `opencode_job_input` / `opencode_session_permission`. `hardline` → rechaza siempre; `peligroso` → decide (usuario); `seguro` → aprueba. Respuesta `una_vez | sesion | siempre`; solo `sesion`/`siempre` persisten, `siempre` en el allowlist con merge contra el fichero en disco.
5. Cola de escrituras diferidas `hub-data/pendientes/{memoria,skills}/<id>.json` con `{id, resumen, origen, creado, payload}` para revisar fuera de banda (la usa R5 de la fase 2).
6. Panel (`config/hub/panel`): lista de pendientes y de reglas activas.

**Trampa (Hermes)**: persistir el allowlist escribiendo el set en memoria borra entradas añadidas en disco desde el arranque.

## Fase 2 · Capas que descansan sobre la fase 1 (esfuerzo medio)

### R5 · Skills autogenerados y mejora con el uso
1. Skills en carpetas `config/claude/skills/<nombre>/SKILL.md` (frontmatter `name` + `description`) con `references/` opcional.
2. El cerebro **propone** un skill al cerrar una tarea compleja (≥ 5 pasos o un error resuelto tras 2 intentos): se escribe como pendiente en `hub-data/pendientes/skills/` (R4.5) y **el usuario lo aprueba** antes de existir.
3. Linter `config/hooks/skill-lint.mjs`: nombre `^[a-z0-9][a-z0-9_-]*$`, coincide con la carpeta, descripción ≤ 300 chars, cuerpo ≤ 24 000 chars, ficheros prohibidos (`README.md`, `CHANGELOG.md`, `.env`, `install.sh`).
4. Guard estático de seguridad sobre el contenido: `curl|sh`, `base64`+`eval`, lectura de `~/.ssh`/tokens, «ignore previous instructions»; veredicto `seguro | precaucion | peligroso`; `peligroso` bloquea.
5. Contador de uso en `hub-data/skills.usage.json` (`uso`, `visto`, `parcheado`, `ultimo_uso`): se alimenta parseando los transcripts en los hooks `Stop`/`SessionEnd` (menciones de la skill). Limitación: no cuenta usos fuera de Claude Code (OpenCode, ejecución directa). Depende de R1 con el `tipo=skill`. Un skill sin uso en 60 días se propone para archivar (nunca se borra solo).
6. Regla «una lección = una regla»: antes de añadir, se busca el duplicado con R1 y se corrige la frase en su sitio, sin apilar `ACTUALIZACIÓN:`.

### R6 · Cron y tareas programadas
1. `config/hub/lib/cron.mjs` + `hub-data/cron/jobs.json`: `{id, nombre, schedule, destino, prompt, siguiente, estado}`; `schedule` tipado: `{kind:'cron',expr}`, `{kind:'interval',minutos}`, `{kind:'once',ejecutar_en}`.
2. Parser de frases en español/inglés a `schedule`: «cada lunes a las 9», «laborables 9:00», «cada 30m», «en 2h», fecha ISO, cron de 5 campos. Lo no entendido se rechaza con ejemplo válido.
3. Preflight antes de disparar: destino/agente existe (**fail-closed**), OpenCode vivo y proveedor configurado (**fail-open**, avisa).
4. Ejecución (**depende de R0**): el hub crea la sesión y envía el mensaje directamente por la **API HTTP V1** del servidor OpenCode (`agente` y `directory` del job) con el **tope de coste** de `reglas.json`; salida en `hub-data/cron/salida/<id>/<fecha>.md`. Si el spike R0 falló, R6 se limita a «tareas vencidas» inyectadas en el briefing y lanzadas por el cerebro.
5. Reintentos tras fallo de OpenCode inalcanzable: 5, 15 y 30 min; luego `fallido` y aviso en la barra.
6. Claim con TTL de 300 s y recuperación al arrancar para que un reinicio no duplique ni pierda ejecuciones.
7. La regla «nunca escribir código sin spec» es una **consigna del cerebro**, no un mecanismo del hub: el hub no puede impedir que un job escriba; el cerebro es quien limita los jobs a agentes de lectura/revisión/pruebas salvo que el job lo declare y el usuario lo apruebe al crearlo.

## Fase 3 · Lo grande (esfuerzo medio-alto)

### R7 · Resumen propio de contexto
1. No sustituye la compactación de Claude Code. Cubre las **notas del hub** (bitácoras largas): cuando `BITACORA.md` supera **60 000 caracteres** (configurable en `reglas.json`) se archiva lo antiguo en `BITACORA-archivo/` (carpeta nueva), troceando por las cabeceras `## YYYY-MM-DD HH:MM — título`, y se deja un resumen.
2. Primero poda determinista (cortar volcados largos a placeholder) y después un resumen por `redactor-ds` (OpenCode, DeepSeek; si R0 falló, con un job lanzado por el cerebro) con las secciones: `Objetivo`, `Restricciones y preferencias`, `Hecho`, `Estado activo`, `Bloqueos`, `Decisiones clave`, `Archivos relevantes`.
3. Se conserva **verbatim** lo escrito por el usuario y las decisiones marcadas; protegidos los 3 primeros y los 20 últimos apuntes.
4. Si el resumidor falla, fallback determinista: anclas locales (peticiones del usuario, acciones, archivos, errores), máx. 8000 chars, con secretos redactados.
5. Episódica: máximo una compresión por proyecto y por día.

### R8 · Aprobación inteligente (completa R4)
Un agente guardián barato (`analista` o `revisor`) evalúa los comandos `peligroso` con veredicto `APROBAR | DENEGAR | ESCALAR`. **Depende de R4**: el guardián **se invoca desde el cerebro**, no desde el hub (el hub solo clasifica). Circuit-breaker: 3 denegaciones seguidas → pasa a `manual`. Siempre `ESCALAR` ante cualquier duda; el guardián nunca puede aprobar `hardline`.

## Fuera de alcance
- Gateway de mensajería (Telegram, Discord…), backends Docker/SSH/Modal para ejecución, app de escritorio.
- Sustituir la compactación de Claude Code o el hub existente.
- Copiar código de Hermes (solo diseño y constantes).
- Skills «de comunidad» o hub de skills externo.

## Criterios de aceptación
- CA0 (R0): el spike crea una sesión y envía un mensaje con `agente` y `directory` por la API V1, y lee el resultado; en la imagen del hub, `PRAGMA compile_options` confirma FTS5 (o se activa el fallback con `HUB_BUSCAR_FALLBACK=1`).
- CA1 (R1): `GET /api/buscar?q=…` devuelve resultados con snippet y proyecto; tras `--reindexar` los resultados coinciden; con `node:sqlite` desactivado —o sin FTS5— responde con el fallback lineal.
- CA2 (R2): simulando 10 turnos sin escribir memoria, `latido.mjs` devuelve el nudge al llegar al turno N y no lo repite hasta que pasen otros N turnos sin escritura; tras una escritura el contador vuelve a 0; una escritura que excede el límite (cuerpo sin cabecera) se rechaza con las entradas actuales y HTTP 422.
- CA3 (R3): con un job en curso, reiniciar el hub y comprobar que el job aparece de nuevo; un job sin progreso durante el umbral configurable (probado con un reloj/valor corto) pasa a `atascado` y no se cancela solo.
- CA4 (R4): un comando `hardline` se rechaza siempre; uno `peligroso` queda pendiente hasta que el cerebro decida; «siempre» persiste y un allowlist (`hub-data/aprobaciones.json`) editado a mano no se pierde tras un guardado.
- CA5 (R5): un skill propuesto no existe hasta aprobarlo; el linter rechaza nombre inválido y fichero prohibido; el guard marca `curl|sh` como `peligroso`.
- CA6 (R6): «cada 30m» y «laborables 9:00» producen el `schedule` esperado; matar el hub a mitad y relanzarlo no duplica la ejecución.
- CA7 (R7): una bitácora de prueba que supera el límite se archiva y queda un resumen con las secciones; el texto del usuario sigue verbatim.
- CA8 (R8): el guardián deniega `rm -rf` fuera del proyecto y escala ante duda; tres denegaciones cambian a `manual`.
- CA9 (todas): `scripts/verificar.sh` y `scripts/verificar.ps1` siguen sin fallos y cada fase añade sus comprobaciones a `scripts/verificar.*`/`smoke-mcp.mjs`; `docs/pruebas.md` y `docs/arquitectura.md` actualizados.

## Reparto de ejecución (cadena única por fase)
| Paso | Agente | Qué |
|---|---|---|
| Fase 0 · Spike (R0 + FTS5) | `implementador` (DeepSeek · high) | Antes de la fase 1: crear sesión y enviar mensaje por la API V1 con `agente` y `directory`; comprobar FTS5 en la imagen (`PRAGMA compile_options`) |
| Preparación | `explorador-ds` | Releer los módulos del hub que toca la fase y listar los puntos de inserción exactos |
| Ejecución | `implementador` (DeepSeek · high) | Un requisito por job, con esta spec como contrato |
| Validación | `testeador` + `revisor` (DeepSeek) | Pruebas de los CA de la fase y revisión del diff contra la spec |
| Documentación | `redactor-ds` | `docs/`, `CHANGELOG.md` |
| Control | Cerebro | Revisión final, commit por requisito |

## Registro de decisiones
- 2026-10-14 · `node:sqlite` con FTS5 en lugar de índice propio: verificado funcionando en Node 24.18; mínimo 22.13 con fallback lineal.
- 2026-10-14 · Hermes es fuente de ideas, no de código (MIT, pero la reimplementación evita arrastrar Python y dependencias).
- 2026-10-14 · Aprobaciones (R4): el hub **clasifica** (`POST /api/aprobaciones/clasificar`) y el cerebro **resuelve** con `opencode_job_input`/`opencode_session_permission`; el hub no es cliente MCP ni aprueba nada. Los patrones `hardline` van también como `deny` en el frontmatter de `config/opencode/agents/*.md`, el allowlist propio vive en `hub-data/aprobaciones.json`, y R8 invoca el guardián desde el cerebro, no desde el hub. El panel que se amplía es `config/hub/panel`.
- 2026-10-14 · Lanzamiento de jobs (R6/R7.2): por la **API HTTP V1** directa del servidor OpenCode (crear sesión + enviar mensaje con `agente` y `directory`), precedido del spike **R0**; si R0 falla, R6 pasa a «tareas vencidas» inyectadas en el briefing (lanzadas por el cerebro) y R7.2 usa un job lanzado por el cerebro.
- 2026-10-14 · Hub: se mantiene `node:22-alpine` (FTS5 verificado sin flags en 22.23.3 y 24.21.0); el fallback lineal cubre «sin `node:sqlite`» y «sin FTS5» (`HUB_BUSCAR_FALLBACK=1` lo fuerza para CA1).

## Registro de revisión (2026-10-14)
- R4 reescrito: el hub **clasifica** y el cerebro **resuelve**; veredicto vía `POST /api/aprobaciones/clasificar` (`hardline|peligroso|seguro` + motivo), allowlist propio en `hub-data/aprobaciones.json` con tmp+rename y merge, `hardline` también como `deny` en `config/opencode/agents/*.md`, y panel en `config/hub/panel`. R8 pasa a invocarse desde el cerebro.
- R6/R7.2 replanteados con nuevo **R0 · Spike de lanzamiento** (crear sesión + enviar mensaje con agente y directory por la API V1); si el spike falla, R6 se convierte en «tareas vencidas» en el briefing y R7.2 en un job lanzado por el cerebro. Ambos pasan a depender de R0.
- R1 corregido: imagen a `node:24-alpine` si la prueba lo confirma, fallback lineal ampliado a «sin `node:sqlite`» y «sin FTS5» (detectado con `PRAGMA compile_options`), `HUB_BUSCAR_FALLBACK=1`, fuentes de indexado explícitas y tipo `skill`; ruta de hooks instalados `~/.sistema-cerebro-agentes/hooks/`.
- R2 y R3 ajustados a la realidad: `CONTEXTO-REPO.md`, límites en caracteres de cuerpo sin cabecera y nuevo contrato `{ok:false, motivo:'excede'}` (HTTP 422); hook que emite `additionalContext` solo en `UserPromptSubmit`; contador propiedad del hook con reset por escritura; reconciliación por `leerJobs()` y umbral `minutosAtasco`, atasco que solo escribe en el ledger; R3.5 pasa a medición y aviso. R5 y R7 corregidos (contador por transcripts `Stop`/`SessionEnd`; archivo al superar 60 000 caracteres troceando por cabeceras).
- Forma: nueva subsección transversal de escritura atómica (tmp+rename y read-merge-write, con reintento en bind mounts de Docker Desktop), CA9 cita `scripts/verificar.sh` y `scripts/verificar.ps1`, se añade CA0 y el reparto de ejecución incluye la fase 0 (R0 + FTS5) antes de la fase 1.
