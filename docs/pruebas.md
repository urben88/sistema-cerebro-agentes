# Pruebas y verificación

## Automática

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke
```

```bash
# macOS / Linux
bash scripts/verificar.sh --smoke
```

Comprueba: Node ≥ 22, OpenCode, Claude Code, OpenRouter conectado, rol Cerebro, skill, agentes, MCP registrado y conectado, y un arranque real del MCP por stdio con llamada a `opencode_status`.

### Smoke test por niveles

```bash
# 1. MCP arranca, herramientas presentes y opencode_status responde
node scripts/smoke-mcp.mjs

# 2. Además: inferencia real (pregunta trivial al modelo)
node scripts/smoke-mcp.mjs --ask

# 3. Además: prueba de punta a punta con el constructor sobre una carpeta de prueba
node scripts/smoke-mcp.mjs --e2e "C:\ruta\a\carpeta-de-prueba"
```

El `--e2e` crea un `saludo.mjs` + `prueba.mjs`, lanza el agente `constructor`, espera el resultado y muestra el diff. Es la prueba más completa sin abrir Claude Code.

## Manual (checklist de aceptación)

| # | Paso | Resultado esperado |
|---|---|---|
| 1 | `install.ps1` (o `install.sh`) | Termina sin errores; backups creados si reemplazó algo |
| 2 | Repetir el instalador | Idempotente: termina igual, sin duplicar nada |
| 3 | `verificar -Smoke` | Todo `[OK]` |
| 4 | Abrir Claude Code en un proyecto y ejecutar `/mcp` | `opencode` aparece como connected |
| 5 | Pedir al Cerebro: «usa la herramienta opencode_status» | Devuelve el estado del servidor OpenCode |
| 6 | Pedir una feature pequeña real | Crea spec en `docs/specs/`, delega, y el resumen final coincide con lo implementado |
| 7 | `git status` en el repo del sistema | Limpio tras el commit; nada de secretos |

## Búsqueda de memoria (spec 10 · R1)

```bash
node scripts/test-buscar.mjs
HUB_BUSCAR_FALLBACK=1 node scripts/test-buscar.mjs
```

Prueba sin dependencias (directorio temporal, nunca toca `hub-data` real): indexa memoria,
bitácora, checkpoint, decisiones, hallazgos y skills con SQLite FTS5, busca con acentos y
guiones, comprueba el `snippet` (`>>>` `<<<`), reindexa dos veces sin corromper el índice,
verifica que un proyecto reindexado y las fuentes globales purgan lo que ya no existe, fuerza
el fallback con `HUB_BUSCAR_FALLBACK=1` y comprueba que consultas con operadores raros (`AND`,
`*`, comillas sueltas) no lanzan excepción. Ambas ejecuciones deben salir 0: en la segunda
todo el índice va por el recorrido lineal y las pruebas que solo aplican a FTS5 se anuncian
como `OMITE (fallback)`. `verificar.sh` / `verificar.ps1` la ejecutan como un paso más.

Buscar desde agentes (CLI contra el hub):

```bash
node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta" [--proyecto x] [--limite n]
```

## Nudges de memoria (spec 10 · R2)

```bash
node scripts/test-nudges.mjs
```

Prueba sin dependencias (directorio temporal, el hub apunta a un puerto muerto y nunca
toca `hub-data` real): con el intervalo en 10 turnos comprueba que `latido.mjs` emite un
`additionalContext` al llegar al turno 10 y no lo repite hasta pasados otros 10; que una
escritura de `ESTADO.md` (cambio de mtime) reinicia el contador; que solo
`UserPromptSubmit` devuelve JSON (`Stop`/`SubagentStart`/`SubagentStop` no emiten nada);
que un `estado-nudges.json` corrupto no rompe el hook; y, sobre la memoria directa, que
una escritura de cuerpo por encima del límite se rechaza con `{excede,limite,actuales}`
sin escribir, que dentro del límite sigue funcionando y que un checkpoint largo (y una
entrada de bitácora larga) no se rechazan. `verificar.sh` / `verificar.ps1` la ejecutan
como un paso más.

Límites por fichero (`config/hub/lib/memoria.mjs`, caracteres del cuerpo sin cabecera):
`ESTADO.md` ≤ 2200 y `CONTEXTO-REPO.md` ≤ 4000. Al superarlos, `POST /api/memoria/estado`
y `/api/memoria/contexto` responden HTTP 422 `{ok:false, motivo:'excede', limite, actuales, contenidoActual}`
(`contenidoActual` es el texto guardado hoy, para consolidar). El CLI `estado.mjs --escribir`
muestra el error y sale con 1 pidiendo mover lo cerrado a la bitácora.

## Ledger de trabajos (spec 10 · R3)

```bash
node scripts/test-ledger.mjs
```

Prueba sin dependencias (directorios temporales, nunca toca `hub-data` real ni los ficheros
de job del MCP) con reloj y umbrales cortos inyectados: comprueba las transiciones de estado
(`registrar()` traduce los estados del MCP), la reconciliación con un `leerJobs()` simulado
(job vivo → `en_curso` y re-enganchado, desaparecido o `unknown` → `desconocido` con nota de
bitácora), la inmutabilidad de lo terminal (`unknown`/activo no degradan un `completado`; un
job vivo fuera del top-N no pasa a `desconocido`), el atasco por progreso (sin progreso →
`atascado` + aviso; con progreso → no; y «dentro de una herramienta» con su propio umbral;
nunca cancela; `atascado` + progreso nuevo vuelve a `en_curso` vía `reconciliar()`), que solo
escribe bajo `dirDatos`, la tolerancia a un `trabajos.json` corrupto, la retención (7 días y
tope de 50 completados), el merge por relectura (dos escritores secuenciales) y la medición de
concurrencia/profundidad.
`verificar.sh` / `verificar.ps1` la ejecutan como un paso más.

## Aprobaciones por niveles (spec 10 · R4)

```bash
node scripts/test-aprobaciones.mjs
```

Prueba sin dependencias (directorios temporales, nunca toca `hub-data` real): comprueba que
`reglas-peligro.json` es JSON válido y todos sus regex compilan; que la clasificación evalúa
hardline → peligroso → seguro (y lo desconocido cae en peligroso «sin regla»); que `decision()`
aprueba lo seguro, pregunta lo peligroso y **rechaza el hardline siempre** (aunque esté en el
allowlist o el modo sea `abierto`); que `una_vez` no persiste y `sesion`/`siempre` sí; que el merge
por relectura respeta una entrada añadida o revocada a mano entre dos `registrar`; la cola de
pendientes (encolar/listar/resolver) con tipo e id validados (un id con `../` se rechaza); y que un
`aprobaciones.json` corrupto se tolera y se reescribe válido.
`verificar.sh` / `verificar.ps1` la ejecutan como un paso más.

**Aprobación inteligente · guardián (R8).** El mismo `test-aprobaciones.mjs` comprueba que en modo
`inteligente` un `peligroso` devuelve `accion:'guardian'` (con el contexto y el circuito) y que
`hardline`/`seguro` no cambian; que `registrarVeredicto` rechaza `hardline` con **cualquier**
veredicto (incluido `APROBAR`) sin tocar la racha; que un veredicto basura o ausente → `ESCALAR` →
`preguntar`; que `APROBAR` solo aprueba si el nivel es `peligroso` en `inteligente` con el circuito
cerrado (en `manual` no aprueba); que 3 `DENEGAR` seguidas abren el circuito y `decision()` pasa a
`preguntar` con `modoEfectivo:'manual'`; que un `APROBAR` intercalado reinicia la racha;
`reiniciarCircuito` lo cierra y vuelve a `guardian`; que el circuito persiste entre instancias y el
merge con `aprobaciones.json` no pierde ediciones a mano del allowlist; y que `guardian.jsonl`
redacta `sk-`/`ghp_`/`Bearer`/`password=`.

## Skills autogenerados (spec 10 · R5)

```bash
node scripts/test-skills.mjs
```

Prueba sin dependencias (directorios temporales, nunca toca `hub-data` real ni `~/.claude/skills`):
comprueba que el linter acepta un skill válido y rechaza nombre inválido, nombre ≠ carpeta,
descripción > 300 chars, cuerpo > 24 000 y un `README.md` prohibido; que el guard marca
`curl|sh`, `base64`+`eval` y «ignore previous instructions» como `peligroso` y `sudo` como
`precaucion`; que un skill propuesto **no** existe en `skillsDir` hasta aprobarlo y que el
peligroso se rechaza; que `aprobar` crea la carpeta (+ `references/`) y rechaza si ya existe,
mientras `rechazar` descarta el pendiente; que el contador `skills.usage.json` hace *merge*
(mover/editar a mano entre dos registros no se pierde) y acumula `veces`; que
`candidatosArchivo` propone lo sin uso en 60 días y **no borra**; que `duplicado` detecta por
palabras y vía `buscar` (y `proponer` avisa `duplicado` en vez de apilar); que
`contarUsoDeTranscript` cuenta las tres formas de mención; y que el CLI `skill-lint.mjs` sale
0/1 e imprime JSON. `verificar.sh` / `verificar.ps1` la ejecutan como un paso más.

Limitación (R5.5): el contador solo ve lo que pasa por Claude Code (hooks `Stop`/`SessionEnd`
de `skills-uso.mjs`); los usos fuera de Claude Code (OpenCode, ejecución directa) no se cuentan.

## Cron y tareas programadas (spec 10 · R6)

```bash
node scripts/test-cron.mjs
```

Prueba sin dependencias (directorios temporales, nunca toca `hub-data` real), con reloj y
**lanzador falsos** (jamás lanza jobs reales): comprueba que `parsearSchedule` traduce
«cada 30m» / «every 30m» a `interval` 30 y «laborables 9:00» a `0 9 * * 1-5`, «cada lunes a
las 9» a cron, «en 2h» / ISO a `once`, acepta un cron de 5 campos y rechaza una frase absurda
con `ejemplo` (y una fecha `once` pasada); que `siguiente()` de cron (en hora local) e interval
son correctos y que `N/step` (`5/15` → 5, 20, 35, 50) es correcto; que `tick()` ejecuta un vencido
**una sola vez** aunque se llame dos veces seguidas; que **con el lanzamiento aún en vuelo** una
segunda instancia sobre el mismo `dataDir` no duplica (claim de TTL 300 s persistido antes de
esperar); que los **tombstones** entre instancias evitan resucitar un job borrado sin perder el
alta de la otra instancia; que un claim caducado se recupera; que un `once` se completa y no se
repite tras un reinicio; que el preflight es **fail-closed** con agente inexistente (no lanza,
`fallido` + aviso) y **fail-open** con OpenCode caído (avisa y sigue); que los reintentos por
`servidor_inalcanzable` van a 5, 15 y 30 min y luego `fallido` con aviso; que el **tope de coste
real** (R6.4) aborta la sesión una sola vez al alcanzar el presupuesto, anota el evento y limpia
la vigilancia (y que al terminar la sesión anota el coste final); que un **cron imposible** se
rechaza con error claro; que un **id no seguro** no se ejecuta ni escribe salida; que el DST
*fall-back* no repite la misma hora local; que la salida se escribe en `cron/salida/<id>/`; y la
consigna R6.7 (los agentes que escriben exigen `aprobado_usuario`). `verificar.sh` / `verificar.ps1`
la ejecutan como un paso más.

## Compresión de bitácora (spec 10 · R7)

```bash
node scripts/test-compresion.mjs
```

Prueba sin dependencias (directorios temporales, nunca toca `hub-data` real), con reloj y
**lanzador falsos** (jamás lanza jobs reales): comprueba que bajo umbral no se archiva ni se
toca la bitácora; que sobre umbral se archiva lo intermedio conservando los **3 primeros** y
los **20 últimos** apuntes (`BITACORA.md` deja de tenerlos) y se crea `BITACORA-archivo/` con el
**original íntegro** (incluido el volcado largo); que la **poda** corta volcados/código > 1500
chars a `[volcado de N chars omitido]` (también en el prompt del resumidor); que el texto
**verbatim** del usuario (`Usuario:` / `> `) y las decisiones (`**Decisión**` / `DECISIÓN:`) se
conservan; que con el **resumidor caído** se usa el fallback determinista ≤ 8000 chars y los
**secretos** (un `sk-…` inyectado) quedan **redactados**; que la **episódica** omite la segunda
compresión del mismo día (`ya_comprimido_hoy`) y vuelve a permitirla al día siguiente (reloj
inyectable); y que un **slug con `../`** se rechaza. `verificar.sh` / `verificar.ps1` la ejecutan
como un paso más.

## Prueba de fuego sugerida

En una carpeta vacía:

> Crea un proyecto Node mínimo con `package.json`, un módulo `saludo.mjs` con la función `saludar(nombre)` y un test con `node:test` que se ejecute con `node --test`. Documenta el objetivo y los criterios de aceptación antes de implementar.

El Cerebro debería: escribir la spec → delegar al `constructor` → vigilar → revisar el diff → resumirte. Si todo eso ocurre sin intervención tuya, el sistema está funcionando.
