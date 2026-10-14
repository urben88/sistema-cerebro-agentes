# 09 · Adopción de proyectos externos validados

## Objetivo
Sustituir piezas hechas a mano por proyectos con tracción real **solo cuando cubran lo mismo o más** y funcionen en Windows. Cada pieza se cambia sola, con prueba antes y después, y con vuelta atrás por `git revert`.

## Verificación (2026-10-14, leída en GitHub)
| Pieza | Proyecto | Licencia | ★ | Windows | Decisión |
|---|---|---|---|---|---|
| Puente | AlaeddineMessadi/opencode-mcp v3.0.0 | MIT | 149 | Sí (rutas Windows/UNC, Node ≥ 22) | **Ya lo usamos** (`npx -y opencode-mcp`). Nada que sustituir; solo fijar versión (R1). |
| Barra | daniel3303/ClaudeCodeStatusLine | MIT | 614 | Sí (`statusline.ps1`, PS 5.1) | **No adoptar** (R2, decidido tras leer `statusline.ps1`): llama a api.anthropic.com y api.github.com, lee el token OAuth en claro, falsea el User-Agent, no es extensible y su aviso de actualización lleva instrucciones para Claude. Todo lo que muestra ya llega en el JSON de entrada. Se copian solo los segmentos (esfuerzo, límites 5 h / 7 d). |
| Visor | jhlee0409/claude-code-history-viewer | MIT | 2.3k | Sí (.exe y .zip) | **Adoptar como app complementaria** (R3). Lee sesiones de OpenCode y subagentes de Claude. No es solo lectura en todas las fuentes. |
| Enrutado | Qcko/claude-code-effort-router | MIT (README sin licencia) | 0 | Sí (PS 5.1) | **No adoptar**: solo añade pistas, no cambia modelo ni esfuerzo. Se mantiene Laya. Se puede copiar su taxonomía de tareas. |
| Memoria | basicmachines-co/basic-memory | AGPL-3.0 (sin verificar aquí) | ~4.2k (sin verificar) | Declarado | **No migrar; convivir opcional** (R4, evaluado): AGPL-3.0, 4,2k★ (verificadas), requiere Python 3.12 + uv y no confirma Windows para su CLI. No sustituye nuestro briefing automatico por hooks (ESTADO.md, bitacora, checkpoints). |
| Control de coste/bucles, panel del hub | — | — | — | — | **Se mantiene propio**: no hay candidato maduro. |

La afirmación sobre el visor claude-code-viewer (sin Windows) procede de otro informe y no está verificada; las cifras de basic-memory sí se comprobaron en GitHub.

## Estado (2026-10-14)
- R2 hecho: `config/hub/estado-linea.mjs` muestra `🧠 CEREBRO`/`💬 normal`, modelo·esfuerzo, contexto y límites 5 h / 7 d. Probado con JSON simulado (3 casos). Pendiente: consumo acumulado por modelo (necesita contador en el hub) y confirmar el campo `agent` real en una sesión con `--agent cerebro`.

## Estado final (2026-10-14)
- R1 hecho: lanzadores fijan `opencode-mcp@3.0.0` (variable `OPENCODE_MCP_VERSION` para subir a proposito). Smoke test OK (status, fire, check, wait, review_changes, job_input).
- R2 hecho (no adoptado; segmentos copiados).
- R3 hecho: seccion «Herramientas opcionales» en `docs/instalacion.md`.
- R4 hecho: basic-memory evaluado. Nuestra memoria (219 lineas, `hub/lib/memoria.mjs`) es por proyecto y se inyecta sola por hooks; basic-memory necesita que el agente llame al MCP, anade Python/uv y es AGPL. Migrar no compensa. Si algun dia se quiere busqueda por grafo, se puede apuntar su MCP a `hub-data/memoria`, pero nuestras notas no llevan frontmatter ni wikilinks, asi que el grafo saldria pobre.
- R5 sin cambios.

## Requisitos
1. **R1 · Puente.** Fijar la versión de `opencode-mcp` en el lanzador (`npx -y opencode-mcp@3.x`) para que una actualización inesperada no rompa el flujo. Comprobar que `opencode_fire`, `opencode_review_changes`, `opencode_job_cancel` y `opencode_job_input` siguen funcionando.
2. **R2 · Barra.** Leer `statusline.ps1`/`statusline.sh` y decidir entre dos vías: (a) nuestra barra invoca la suya y le añade la etiqueta de modo, los subagentes y el consumo por modelo; (b) mantener la nuestra e imitar sus segmentos (límites 5 h / 7 d, esfuerzo, colores). No sustituir si se pierde la banda de subagentes o los trabajos de OpenCode.
3. **R3 · Visor.** Documentar su instalación en `docs/instalacion.md` como herramienta opcional. No integrarlo en el instalador. Comprobar que muestra subagentes y sesiones de OpenCode.
4. **R4 · Memoria.** Comparar basic-memory con nuestra memoria markdown (`hub/lib/memoria.mjs`): licencia AGPL, uso local, formato de las notas, conservación del `ESTADO.md`. No migrar nada sin decisión explícita.
5. **R5 · Enrutado.** Sin cambios: Laya sigue decidiendo. Documentar que ni un hook ni un MCP pueden cambiar el modelo de la sesión en caliente; la decisión se aplica al lanzar cada subagente (ver spec 08).

## Fuera de alcance
- Sustituir el hub, el panel, el control de coste/bucles o el mod.
- Instalar nada sin que el usuario valide cada hallazgo.

## Criterios de aceptación
- CA1: `claude mcp list` conecta `opencode` con la versión fijada y un `opencode_fire` de prueba termina en `completed`.
- CA2: la barra decidida muestra modo, modelo, esfuerzo, límites y subagentes sin perder nada de lo actual.
- CA3: el visor abre una sesión de OpenCode y un subagente de Claude en esta máquina.
- CA4: informe breve de basic-memory con recomendación (adoptar, convivir o descartar).
- CA5: los hallazgos quedan en estado `integrado` o `descartado`, con motivo.
