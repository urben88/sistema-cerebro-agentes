# Arquitectura

## Visión general (v0.2.0)

Dos puertas de entrada, un hub común y una capa de ejecución barata:

```
 Tú
  │
  ├──── PUERTA 1 · con Claude (suscripción que se estira) ──────────────────────────┐
  │     Claude Code → agente `cerebro` (Sonnet · medium; `arquitecto` para lo duro) │
  │       · subagentes Haiku: planificador · explorador · redactor · analista ·     │
│         subdirector (y arquitecto Sonnet para lo duro)                         │
  │       · MCP `opencode` → código en DeepSeek   · MCP `triaje` → ¿quién y cuánto? │
  │       · hooks → briefing, checkpoints, /clear sin pérdidas                      │
  │                                                                                 │
  └──── PUERTA 2 · sin Claude (cuota agotada) ──────────────────────────────────────┤
        OpenCode TUI → `cerebro-oc` (DeepSeek · max): specs y delegación en el resto │
                                                                                    ▼
┌─────────────────────────── CEREBRO HUB (app local, Docker) ────────────────────────┐
│  hub (Node sin deps, 127.0.0.1:4597)          laya (modelo local de decisiones)     │
│   · memoria compartida FUERA de los repos      · decide agente/esfuerzo/escalar     │
│   · briefing de sesión · vigilante             · confianza calibrada; si duda,      │
│   · organización · gasto · ventana Claude        mandan las reglas (conf < 0,60)    │
└───────────────┬─────────────────────────────────────────────────────────────────────┘
                │ (nativo, en el host: trabaja sobre tus carpetas)
                ▼
        opencode-mcp → servidor OpenCode V1 → agentes DeepSeek por esfuerzo:
        planificador · implementador · debugger · revisor · testeador ·
        explorador-ds · redactor-ds · local
```

## Responsabilidades

| Capa | Hace | No hace |
|---|---|---|
| Cerebro (Claude Code) | Decidir, especificar, revisar, conversar | Escribir código de producción salvo petición explícita |
| Hub | Memoria, contexto, vigilancia, triaje, panel | Tocar tus repositorios |
| Manos (OpenCode) | Implementar, depurar, probar, revisar por céntimos | Decidir el diseño o cambiar el alcance |

**Principio de capas**: la herramienta (reparto, esfuerzos, topes, contexto) es genérica; **el repositorio manda** sus indicaciones (CLAUDE.md/AGENTS.md, specs, convenciones). El reconocimiento las lee una vez y las resume fuera del repo.

## Componentes desplegados

| Componente | Dónde vive | Lo despliega |
|---|---|---|
| Agentes de OpenCode (9, por esfuerzo) | `~/.config/opencode/agents/` | `install.ps1` / `install.sh` |
| Agente `cerebro` + 7 subagentes (MCPs inline) | `~/.claude/agents/` | ídem |
| Barra de estado de Claude (modelo · contexto · trabajo OpenCode) | `~/.sistema-cerebro-agentes/hub/estado-linea.mjs` + `settings.json` | ídem |
| Rol Cerebro + skill `delegar-a-opencode` | `~/.claude/CLAUDE.md` (bloque) y `~/.claude/skills/` | ídem |
| Hooks de contexto + CLI `estado` | `~/.sistema-cerebro-agentes/hooks/` | ídem |
| Cerebro Hub (app + panel) | `~/.sistema-cerebro-agentes/hub/` (nativo) o contenedor `cerebro-hub` | ídem |
| Laya | contenedor `cerebro-laya` (volumen de modelos) | ídem |
| Memoria y logs del hub | `~/.sistema-cerebro-agentes/hub-data/` | se crea sola |
| Servidor OpenCode V1 + lanzador del MCP | `~/.sistema-cerebro-agentes/server/` y `launcher.*` | ídem |

## Flujo de una tarea (con Claude)

1. **Briefing** (hook al abrir) → el cerebro ya sabe en qué proyecto está y qué había pendiente.
2. **Planificación (si la tarea es ambigua o grande)**: el subagente `planificador` saca las preguntas mínimas (máx. 5) + supuestos + plan; el Cerebro te las pregunta antes de generar nada.
3. **Spec** en la estructura del repo; el reconocimiento del proyecto se delega una sola vez.
4. **Cadena única**: preparación (Haiku o `explorador-ds`) → ejecución (`implementador`/`debugger`) → validación (`testeador`/`revisor`).
5. **Triaje**: si hay duda de a quién mandar algo, Laya decide (con reglas de respaldo); queda registrado.
6. **Vigilancia y visibilidad**: el hub avisa de atascos; el Cerebro te enseña hitos del job con `trabajo_estado` (estado, tiempo, coste, último paso) y la barra de estado de Claude muestra el trabajo en curso; el `subdirector` (Haiku) puede revisar extractos y cancelar/redirigir.
7. **Cierre**: veredicto del `revisor` contra la spec, resumen al usuario y `ESTADO.md` al día; al ~70 % de contexto, `/clear` sin pérdidas.

## Ciclo de vida de los servicios

- **OpenCode V1** (MCP): lo asegura el lanzador (`launcher.ps1/sh`) al primer uso; datos aislados en `server-data/`, puerto dinámico desde 4599.
- **Hub y Laya**: contenedores con `restart: unless-stopped`; autoarranque al iniciar sesión (Windows). El hub nativo (`hub.ps1/hub.sh`) sigue disponible como alternativa.
- **Panel antiguo** de actividad: `panel.ps1/h.sh`, puerto 4598. El panel del hub está en 4597.

## Búsqueda (indice.db, /api/buscar, CLI buscar.mjs)

El hub indexa la memoria de proyectos (BITACORA.md troceada por cabeceras, ESTADO.md, CONTEXTO-REPO.md y `checkpoints/`), las decisiones (`logs/decisiones.jsonl`), los hallazgos (`hub-data/hallazgos.jsonl`) y los skills (`config/claude/skills/<nombre>/SKILL.md`) en un índice SQLite FTS5 (`hub-data/indice.db`, `node:sqlite`, sin dependencias). Se reindexa de forma incremental al arrancar y tras cada escritura de memoria, y completo con `node hub.mjs --reindexar`. `GET /api/buscar?q=…&proyecto=…&limite=…&tipo=…` devuelve resultados con `snippet` y proyecto ordenados por `rank`; los agentes lo consultan con `node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta"`. Si `node:sqlite` no existe, no trae FTS5 (o se fuerza con `HUB_BUSCAR_FALLBACK=1`), el hub arranca igual y la búsqueda usa un recorrido lineal sobre los `.md`, sin ranking, indicándolo en la respuesta.

## Memoria: nudges y límites (spec 10 · R2)

El hook `latido.mjs` mantiene en `hub-data/estado-nudges.json` (propiedad del hook, escritura tmp+rename y read-merge-write que relee el fichero y conserva las claves ajenas) un contador por sesión y proyecto (clave `<slug>:<sesión>`) y, solo en `UserPromptSubmit`, inyecta un `additionalContext` cada `nudge_intervalo` turnos sin escritura (defecto 10; `HUB_DATA_DIR/reglas.json` manda sobre `hub/reglas.json`). El contador se reinicia cuando cambia el mtime de `ESTADO.md`; las entradas con más de 14 días sin actividad se podan y el fichero se limita a 200 entradas. Los ficheros de memoria tienen límite de **caracteres del cuerpo sin cabecera** (`ESTADO.md` ≤ 2200, `CONTEXTO-REPO.md` ≤ 4000): al superarlo, `POST /api/memoria/estado` y `/contexto` rechazan con **HTTP 422** `{ok:false, motivo:'excede', limite, actuales, contenidoActual}` para consolidar (mover lo cerrado a la bitácora); checkpoints y bitácora no se limitan.

## Ledger de trabajos (spec 10 · R3)

El trabajo en segundo plano del MCP es *process-local*: sin un registro propio, un reinicio del hub perdería qué jobs había y sus resultados. `config/hub/lib/ledger.mjs` mantiene el ledger durable `hub-data/trabajos.json` con una entrada por job `{jobId, agente, directorio, estado, creado, actualizado, deadline, ultimoPaso, motivo}` y estados formales `pendiente → en_curso → completado | fallido | cancelado | atascado | desconocido` (el `unknown` del MCP se registra como `desconocido`). Se escribe con `tmp`+`rename` y *read-merge-write* (relee justo antes de escribir, tolera un archivo corrupto), retiene 7 días y conserva 50 completados; **nunca** toca los ficheros de job del MCP.

Al arrancar y cada 60 s el hub **reconcilia** con `leerJobs()` (no existe `opencode_job_list`): lo que sigue vivo se re-engancha a `vivo.mjs` y pasa a `en_curso`; lo que desapareció o está `unknown` pasa a `desconocido` y se anota en la bitácora del proyecto (si ya está registrado) y en el registro central. La detección de atasco es por **progreso**, no por reloj: se mide con `updatedAt` del job y los eventos con `ts` de `vivo.mjs`; el umbral es `minutosAtasco` (12; `minutosAtascoHerramienta`, 12, para «dentro de una herramienta») más `minutosGraciaAtasco` (2), todos configurables en `hub-data/config.json`. Al superarlo, el job pasa a `atascado` **solo en el ledger** y se avisa reutilizando el mecanismo de alertas del vigilante; **el hub nunca cancela solo** (decide el `subdirector`). `GET /api/trabajos/ledger?estado=…` lista el ledger (sin cambiar los contratos de `/api/trabajos` ni `/api/vivo`).

Concurrencia y profundidad (`maxConcurrentes`, por defecto 3): el hub **mide y avisa** —cuenta los jobs `en_curso` y el máximo de jobs simultáneos sobre el mismo directorio— pero no impone nada. La imposición (**por defecto 3 en segundo plano y profundidad 1**) es **consigna del cerebro**, no un mecanismo del hub.

## Aprobaciones por niveles (spec 10 · R4)

El hub **clasifica** pero **no aprueba**. `config/hub/lib/aprobaciones.mjs` lee `config/hub/lib/reglas-peligro.json` (listas regex `hardline | peligroso | seguro`) y evalúa en ese orden: lo que no casa nada es `peligroso` por prudencia (motivo `sin regla`). `POST /api/aprobaciones/clasificar` `{comando|texto, sessionId}` devuelve `{nivel, motivo, accion}` (`rechazar|preguntar|aprobar`); el **cerebro resuelve** el `input_required` (rechaza hardline siempre, decide lo peligroso, aprueba lo seguro) con un alcance `una_vez | sesion | siempre`.

El allowlist es **propio del hub** (`hub-data/aprobaciones.json` `{siempre, sesion}`; `una_vez` no persiste), escrito con `tmp`+`rename` y *read-merge-write*: se relee el disco y solo se añade la entrada nueva, así lo revocado/añadido a mano no se pierde. El allowlist **nunca** salva un `hardline`. Modo en `hub-data/config.json` → `aprobaciones.modo`: `manual` (defecto), `inteligente` (hoy ≡ manual) y `abierto` (solo bloquea hardline). La cola de pendientes vive en `hub-data/pendientes/{memoria,skills}/<id>.json` (`{id, resumen, origen, creado, payload}`) y se opera por `GET/POST /api/pendientes` y `POST /api/pendientes/resolver`. Defensa en profundidad: los patrones `hardline` van además como `deny` de `bash` en el frontmatter de `config/opencode/agents/{implementador,debugger,testeador,cerebro-oc}.md`, y el panel (`config/hub/panel`) muestra modo, reglas activas, allowlist y pendientes.

## Skills autogenerados y mejora con el uso (spec 10 · R5)

El cerebro **propone** skills al cerrar una tarea compleja, pero **no los crea**: un skill solo existe tras la aprobación del usuario. `config/hub/lib/skills.mjs` valida la propuesta con el linter+guard (`config/hooks/skill-lint.mjs`) sobre una carpeta temporal, la encola en `hub-data/pendientes/skills/<id>.json` (payload con el contenido) y, al aprobar (`POST /api/skills/aprobar {id}`), vuelve a validar, escribe `CLAUDE_DIR/skills/<nombre>/SKILL.md` (+ `references/`) con `tmp`+`rename` y resuelve el pendiente. Si el skill ya existe, se rechaza (para eso está `parchear()`).

Linter (R5.3): frontmatter con `name` + `description`; `name` casa `^[a-z0-9][a-z0-9_-]*$` y coincide con la carpeta; `description` ≤ 300 chars; cuerpo ≤ 24 000 chars; ficheros prohibidos en cualquier nivel (`README.md`, `CHANGELOG.md`, `.env`, `install.sh`). Guard (R5.4): veredicto `seguro | precaucion | peligroso`; `peligroso` (`curl|wget … | sh|bash`, `base64`+`eval`, lectura de `~/.ssh`/tokens/credenciales, «ignore previous instructions» y variantes en español) **bloquea**; `precaucion` (`sudo`, `rm -r`, `chmod 777`, `eval` suelto) solo avisa. CLI: `node skill-lint.mjs <carpeta>` imprime el JSON y sale 0/1.

Contador de uso en el sidecar `hub-data/skills.usage.json` (`{uso,visto,parcheado,ultimo_uso}`; `tmp`+`rename` y *read-merge-write*): lo alimenta el hook `skills-uso.mjs` (Stop/SessionEnd) parseando el transcript (menciones `/<nombre>`, `skills/<nombre>` o `"skill":"<nombre>"`) y `POST /api/skills/uso`. Limitación (R5.5): no cuenta usos fuera de Claude Code (OpenCode, ejecución directa). Un skill sin uso en 60 días se **propone para archivar** (`GET /api/skills/archivo`); **nunca se borra solo**. Regla «una lección = una regla» (R5.6): `proponer` busca el duplicado (R1 con `tipo=skill`, o similitud de palabras) y avisa `duplicado` con el nombre en lugar de apilar. Panel: la pestaña «Aprobaciones» lista los skills pendientes con Aprobar/Rechazar y la tabla de uso.

## Evolución

`VERSION`, `CHANGELOG.md` y tags; los cambios se hacen en este repositorio y se despliegan con `scripts/actualizar`. Decisiones y contexto en [contexto-y-decisiones.md](contexto-y-decisiones.md).
