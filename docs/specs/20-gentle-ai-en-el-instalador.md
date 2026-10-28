# Spec 20 · Gentle AI dentro del instalador

## Objetivo
Que `install` deje la máquina con el sistema actual **y** con Gentle AI (ODD, RDD, Engram, CodeGraph, Context7, skills, GGA) configurado en **Claude Code y en OpenCode**. Claude dirige con esa filosofía y los subagentes de OpenCode (DeepSeek) usan las mismas herramientas.
Rama: `feat/spec20-gentle-ai` · Riesgo: item 5 (instalador).

## Contexto comprobado (2026-10-28)
- Gentle AI 4.3.1 ya está en esta máquina (`~/go/bin/gentle-ai`), pero instalado a mano. Lo que escribió para Claude Code:
  - `~/.claude/CLAUDE.md`, en bloques `<!-- gentle-ai:* -->` que conviven con nuestro bloque;
  - `engram`/`codegraph`/`context7` en `~/.claude.json`;
  - las skills, los agentes `review-*` y `jd-*`, el hook `gentle-ai review stop-hook` y el estilo `gentleman`.
- En OpenCode **no** está: solo tiene `context7` y nuestros agentes.
- El servidor OpenCode V1 del MCP solo aísla los **datos** (`XDG_DATA_HOME`); la configuración es la común (`~/.config/opencode`). Lo que Gentle AI escriba ahí también lo verán los agentes que lanza el cerebro.
- `gentle-ai install --dry-run --agent opencode --preset full-gentleman` planifica 10 pasos: `claude-theme, context7, persona, engram, gga, opencode-gentle-logo, permissions, skills`.
- Instalación del binario según la documentación:
  - Windows: `go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@<versión>` (necesita Go ≥ 1.25.10);
  - Linux y macOS: `curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash`.

## Requisitos
- **S1 · Binario.** El instalador comprueba si existe `gentle-ai`. Si falta, lo instala con una versión fija (`$VersionGentle = '4.3.1'`): `go install` en Windows y el script oficial en Linux y macOS. Sin Go en Windows, avisa con el comando exacto y sigue; no rompe el resto de la instalación.
- **S2 · Configuración sin preguntas.** Ejecuta `gentle-ai install` sin modo interactivo para `claude-code` y `opencode`, con el preset `full-gentleman` y la persona `gentleman`. Debe ser idempotente: repetir `install` no duplica bloques ni MCPs.
- **S3 · No pisar lo nuestro.** Hace backup de `~/.config/opencode` y `~/.claude` antes (`Backup-Item`). Después de Gentle AI, nuestros agentes, skills, hooks y el bloque `sistema-cerebro-agentes` siguen intactos. El orden de los pasos lo garantiza: nuestros pasos van después de Gentle AI, o se comprueba por diff.
- **S4 · Engram compartido.** Claude y OpenCode usan el mismo Engram y resuelven el mismo proyecto por `cwd`. Lo que guarda uno, el otro lo encuentra.
- **S5 · ODD decide el reparto.** La delegación la decide solo ODD: delegar únicamente con un motivo concreto; lo pequeño lo hace Claude. El *a quién* sale de una tabla fija en nuestro `CLAUDE.md` (buscar → `explorador`, cambio mecánico → `ayudante`, área → `resolutor`…), sin consultar a ningún modelo. *(Supuesto: la tabla fija.)*
- **S10 · Quitar Laya por completo.** Se retiran:
  - la herramienta `triaje_decidir` y su lógica (`config/hub/lib/triaje.mjs`, `reglas.json`, `reparto-claude.mjs` si solo sirve a Laya);
  - el contenedor `cerebro-laya` y `docker/laya/`;
  - la pestaña Triaje·Laya del panel;
  - las menciones en `CLAUDE.md`, `cerebro.md`, `cerebro-oc.md`, `subdirector.md`, el skill `delegar-a-opencode` y las docs;
  - sus pruebas.

  **Se mantienen** `trabajo_estado` y `parar_trabajos`, que siguen en el MCP. El instalador quita el contenedor de las máquinas que ya lo tienen.
- **S6 · Cerebro y OpenCode.** El agente `cerebro` y el skill `delegar-a-opencode` pasan la spec por referencia (ruta, tarea y `S#`) y piden al subagente que use Engram y las skills.
- **S7 · `-Check` y verificar.** `install -Check` informa del estado de Gentle AI sin escribir. `verificar.ps1` y `verificar.sh` comprueban:
  - que `gentle-ai` existe y tiene la versión fijada;
  - que están los bloques `gentle-ai:*` en `CLAUDE.md`;
  - que `engram` está en la configuración de OpenCode.
- **S8 · Paridad.** Los mismos cambios en `install.ps1` e `install.sh`, y en sus `verificar`.
- **S9 · Docs.** README, CHANGELOG (0.11.0) y esta spec.

- **S11 · CLAUDE.md más corto.**
  - El instalador usa `--claude-orchestrator-modules`, de modo que el orquestador de Gentle AI queda como núcleo más módulos bajo demanda.
  - Nuestro bloque se compacta: sin reglas duplicadas con ODD (delegación, PLAN/EJECUTAR, verificación).
  - Los bloques `gentle-ai:*` **no se editan a mano**, porque `gentle-ai sync` los regenera.

## Fuera de alcance
- `uninstall` no desinstala Gentle AI, porque es una herramienta externa. Solo avisa de `gentle-ai uninstall`. *(Supuesto.)*
- Pi: no se toca. Se arregla aparte cambiando su proveedor a DeepSeek.

## Tareas
| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| T1 | S2, S3 | inline | pendiente | — |
| T2 | S1, S2, S3, S7, S8, S10 | inline | pendiente (incluye quitar Laya de install.*, verificar.*, actualizar.*: espera laya==true en /api/salud) | — |
| T3 | S4 | inline | pendiente | — |
| T4 | S5, S6 | inline | pendiente | — |
| T5 | S9, S10 | inline | pendiente (README, CHANGELOG, docs/ventanas-y-ahorro.md, docs/contexto-sesiones.md) | — |
| T6 | S5, S10 | delegado (resolutor · high, contexto) | hecho (tests 13/13, MCP sin triaje_decidir) | ver git log |

T1 comprueba con `--dry-run` y `--help` los flags exactos: varios agentes, sin preguntas, persona. Luego aplica Gentle AI a OpenCode en esta máquina y compara el resultado con el backup.

## Log
- **L1 (2026-10-28, petición del usuario):** «quiero que aplique los cambios, pero que lo añadas en el instalador de esta aplicación. para ello cuando hago install en el sistema cerebro agentes va a tener todas estas configuraciones además de instalar también lo que sería la herramienta de este sistema de Genlent AI, quiero cuando le dé install, instale todo esto, quiero tener este programa un sistema donde configure todo esto y tenga el sistema actual que tengo montado»
- **L2:** antes había pedido: «que todo esto empiece a hacerlo desde el agente de cloud y luego puede llamar subagentes pero que cloud y el subagente, si es open code mejor, pueda usar todas las herramientas y el potencial de este harness».
- **L4 (2026-10-28, usuario):** «Quiero que quites por completo la ya, no quiero usar la ya, quiero que lo decida ODT.» → «la ya» = Laya y «ODT» = ODD. Se reescribe S5 y se añade S10/T6. El cambio de `docker-compose.yml` sin commit (Laya con `restart: "no"`) queda absorbido por S10.
- **L5 (2026-10-28, usuario):** «¿Puestas aplicar estos camios y mejoras además que quiero que mires el tema de poder optimizar el cloud.md general porque parece que es muy extenso si se puede optimizar mucho mejor» → se añade S11.
- **L6:** `~/.claude/CLAUDE.md` tiene 679 líneas: 67 son nuestras y unas 610 de Gentle AI (el orquestador ocupa unas 400). `gentle-ai install --help` ofrece `--claude-orchestrator-modules`, que deja un núcleo corto más módulos bajo demanda en `~/.claude/gentle-ai/orchestrator/`.
- **L7:** T1 está bloqueado. `gentle-ai install --agent opencode` exige `@opencode/plugin@2.0.4` en `~/.config/opencode` (lo pide con `npm install --save-exact`). Auto mode denegó el `npm install`, así que lo tiene que ejecutar el usuario. Riesgo: el servidor V1 (1.18.35) comparte esa carpeta, así que hay que comprobar que siga arrancando. Backup en `~/.sistema-cerebro-agentes/backups/spec20-20261028-201400`. T6 se delegó en `resolutor` (Sonnet · high) por el límite de contexto.
- **L3:** la spec va en `docs/specs/` por convención del repositorio, en lugar de `odd/tasks/`.
