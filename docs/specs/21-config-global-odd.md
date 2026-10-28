# Spec 21 · Configuración global de Claude adaptada a ODD

## Objetivo
Adaptar la configuración global de Claude Code (desplegada desde `config/claude/` con `install`) a ODD de Gentle AI. Se conservan los agentes y el reparto barato. Rama: `feat/spec20-gentle-ai` (se suma a la spec 20). Riesgo: item 2 (permisos) e item 5 (instalador).

## Auditoría (resumen, 2026-10-28)
- `~/.claude/CLAUDE.md` pesa 102 KB (~25k tokens por sesión). Nuestro bloque ocupa 69 líneas y el orquestador de Gentle AI 395.
- Hay reglas que chocan entre nuestro bloque y ODD: delegar frente a hacerlo inline, PLAN/EJECUTAR frente a Authorize, y «preguntas agrupadas» frente a «una cada vez».
- Hay tres memorias sin un papel claro para cada una.
- `defaultMode: auto` con Bash sin lista de permitidos. El deny no cubre `~/.claude/.credentials.json` ni `~/.claude.json`.
- Se ejecutan 4 hooks en cada prompt.
- No existe `~/.claude/commands`.
- Los 5 roles ODD ya existen: explorador, planificador, resolutor (más retocador y ayudante), `review-*` y analista.

## Requisitos
- **S1 · Bloque CLAUDE.md compacto.** Hecho en `config/claude/CLAUDE.md`, de 67 a unas 50 líneas:
  - el reparto barato con la tabla de roles ODD;
  - «el coste ES un motivo válido para delegar», que anula el «never for a price ratio» de ODD;
  - un papel para cada memoria;
  - sin Laya.
- **S2 · Orquestador modular.** Gentle AI se instala para Claude con `--claude-orchestrator-modules`, así queda un núcleo más módulos en `~/.claude/gentle-ai/orchestrator/`. Va en el paso Gentle AI del instalador (spec 20, S2) y se aplica una vez en esta máquina.
- **S3 · Reparto conservado.** Los agentes mantienen nombre, `model` y `effort`. Su `description` añade el rol ODD, por ejemplo «Rol ODD: explorer».
- **S4 · Comandos `/odd:*`.** En `config/claude/commands/odd/` se crean `start`, `plan`, `implement`, `verify`, `review`, `status` y `handoff` (.md). Son finos: remiten al flujo ODD y al reparto de CLAUDE.md, sin repetirlo. El instalador los copia en `~/.claude/commands/odd/`.
- **S5 · Permisos prudentes** (en la fusión de `settings.json` que hace el instalador):
  - `ask`: `git push`, `npm install`/`pip install`/`winget`/`choco`, `rm -r` y `Remove-Item -Recurse`.
  - `deny`: lectura y edición de `~/.claude/.credentials.json`, `~/.claude.json` y `~/.ssh/**` (rutas absolutas, además de las relativas).
  - `allow`: lectura, git de solo lectura (`status`, `diff`, `log`), tests y lint.
  - Sin quitar permisos que ya existan.
- **S6 · Hooks.** No se tocan los hooks de Gentle AI ni de CodeGraph, porque sus instaladores los regeneran. Se documenta el coste por prompt.
- **S7 · Instalador y verificar.** `install.ps1`/`install.sh` y `verificar.*` cubren S2, S4 y S5. `verificar` comprueba:
  - que existen los comandos `odd/`;
  - que el bloque no menciona Laya;
  - que existe el directorio del orquestador modular.
- **S8 · Docs.** README y CHANGELOG (0.11.0, compartido con la spec 20).

## Tareas
| ID | Specs | Ruta | Estado |
|---|---|---|---|
| T1 | S1 | inline | hecho (pendiente de commit) |
| T2 | S2–S8 + spec 20 T2 | delegado (resolutor · high) | hecho (falta aplicar `install` en esta máquina) |

## Log
- **L1 (2026-10-28):** el usuario pegó un encargo en 7 fases para adaptar su configuración global a ODD (subagentes odd-explorer/planner/implementer/reviewer/verifier, comandos /odd:*, CLAUDE.md breve, permisos prudentes, backup en `~/.claude/backup-odd-YYYY-MM-DD-HHMM/`). Pidió «EMPIEZA SOLO CON LA FASE 1».
- **L2 (usuario):** «si haz las mejoras, manten el reparto de subagentes con modelos mas baratos y esfuerzos diferentes».
- **L3:** los cambios se hacen en el repo porque el instalador pisa `~/.claude` (regla 7). Los nombres `odd-*` se dejan como roles en la descripción y no como agentes nuevos, para no duplicarlos ni romper el hub, el panel y el cerebro. Backup hecho en `~/.claude/backup-odd-2026-10-28-*`.
- **L4 (T2, resolutor):**
  - S2: `--claude-orchestrator-modules` va en el paso Gentle AI de los instaladores; el directorio `~/.claude/gentle-ai/orchestrator` aún no existe en esta máquina hasta ejecutar `install` (`verificar` lo marcará hasta entonces).
  - S3: los 6 agentes con rol (`explorador`, `planificador`, `ayudante`, `retocador`, `resolutor`, `analista`) añaden «Rol ODD: <rol>.» al final de la `description`, sin comillas (las descripciones ya llevaban `: ` y funcionan sin ellas). Modelo, esfuerzo y herramientas intactos.
  - S4: 7 comandos en `config/claude/commands/odd/`, copiados a `~/.claude/commands/odd` (solo esa carpeta; `uninstall` la quita).
  - S5: `config/hub/settings-merge.mjs` (línea del `writeFileSync` final, ~170) está fuera de la superficie permitida, así que la fusión de permisos vive en `config/claude/permisos.mjs`, llamado desde el paso 5b justo después de `settings-merge`. Idempotente (probado dos veces sobre una copia: segunda pasada +0) y conserva `defaultMode` y lo existente. Rutas `Read`/`Edit` en forma `~/` y absoluta (`//c/Users/...`). Limitación: `Bash(prefijo:*)` solo casa al inicio del comando.
  - S6: coste de los hooks documentado en `docs/ventanas-y-ahorro.md`; no se tocó ningún hook.
  - S7: `verificar.*` comprueba comandos `odd/`, que el bloque no mencione Laya, el orquestador modular, los permisos, `engram` y `default_agent` de OpenCode.
  - S8: README y CHANGELOG 0.11.0.
- **L5 (hallazgos del cierre de T2):**
  - **Bloqueo abierto (S3/S6):** `config/hub/settings-merge.mjs:58` (`registrarContexto`) y `:72` (`s.hooks.SessionEnd = grupos`) sustituyen enteros los arrays de `SessionStart`, `PreCompact` y `SessionEnd`. Como ahora el paso de Gentle AI va antes, `settings-merge` borra el hook `gentle-ai review stop-hook` de `SessionStart`. Comprobado: tras un `install` real en esta máquina ese hook desapareció (Stop y UserPromptSubmit quedaron intactos). Arreglo propuesto: que `registrarContexto` y el bloque de `SessionEnd` reemplacen solo las entradas cuyo `command` contenga nuestro fichero, como ya hace `latido.mjs`. El archivo está fuera de la superficie de T2.
  - Los comandos `/odd:*` sí llevan el prefijo: la documentación de Claude Code confirma que `.claude/commands/<carpeta>/<archivo>.md` se invoca como `/<carpeta>:<archivo>`.
  - `verificar` mira `opencode mcp list` (engram `connected`), no el texto del archivo.
  - Sin probar con una salida interactiva: la salida de `gentle-ai install` va capturada, así que si pidiera algo el instalador se quedaría esperando sin mostrarlo.
