# 02 · Planificador previo y visibilidad de los trabajos

## Objetivo
Reducir los tokens gastados en suposiciones (preguntar antes de generar) y hacer visible el trabajo de las manos (OpenCode) dentro de la interfaz de Claude, con un Indicador además en la barra de estado.

## Contexto (reconocimiento)
- Hoy `cerebro`/`cerebro-oc` pasan directos de la petición a la spec/delegación; las dudas se resuelven improvisando.
- Al delegar por MCP, el usuario solo ve «una llamada MCP»: el progreso no se cuenta en el chat.
- Claude Code V2.1.296 usa `general-purpose` (modelo principal, Sonnet) cuando se omite `subagent_type`; los subagentes de Claude deben pasar tipo explícito.
- El hub ya lee los ficheros `job_*.json` del MCP (`config/hub/lib/opencode.mjs`) y tiene endpoints de actividad.
- `settings-merge.mjs` fusiona hooks en `~/.claude/settings.json`; Claude Code soporta `statusLine` con `refreshInterval`.

## Requisitos
1. **R1 · Agente `planificador` (Claude)**: Haiku · medium, herramientas Read/Grep/Glob/Bash/Write/Edit; devuelve ≤5 preguntas que cambian el trabajo + supuestos por defecto + plan (preparación → ejecución → validación) + criterios de aceptación + riesgos. Puede ser subagente (cerebro) o agente principal (entrevista). No escribe código; puede dejar el plan/spec escrito.
2. **R2 · Agente `planificador` (OpenCode)**: DeepSeek Flash · high, `mode: all`, sin `task` (no delega). Mismo formato.
3. **R3 · Puerta de planificación**: `cerebro` y `cerebro-oc` lanzan `planificador` antes de la spec cuando la petición es ambigua/grande o el usuario lo pide; el cerebro pregunta las dudas al usuario (supuestos como opción). No se planifican tareas triviales ni lo ya respondido por el repo/memoria.
4. **R4 · Visibilidad barata**: herramienta MCP `trabajo_estado` (servidor `triaje`): sin argumentos lista trabajos (en curso / sin actividad / recientes); con `jobId` devuelve detalle (estado, duración, coste, tokens, modelo/variant, último paso, últimas herramientas, pregunta pendiente). Sin volcar conversaciones.
5. **R5 · Protocolo de hitos en el chat**: al lanzar un job, tarjeta (agente · modelo · jobId · tope); cada ~1 min, actualización con `trabajo_estado`; al terminar, informe final + diffstat + veredicto de revisión. `opencode_conversation` solo bajo petición.
6. **R6 · Barra de estado de Claude Code** (`config/hub/estado-linea.mjs`): modelo · contexto % · carpeta · trabajo OpenCode en curso (o cierre reciente). `settings-merge.mjs` la registra solo si el usuario no tiene una propia; se puede desactivar teniendo una propia.
7. **R7 · Subagentes de Claude**: el prompt de `cerebro` y `CLAUDE.md` exigen `subagent_type` explícito y prohíben `fork`/`general-purpose`; se anuncia el modelo (Haiku; Sonnet solo `arquitecto`).
8. **R8 · Agentes por proyecto**: documentados en `docs/agentes-por-proyecto.md` (nativos en `.claude/agents/` y `.opencode/agents/`, aditivos a los roles por defecto, versionados).
9. **R9 · Despliegue**: instaladores, desinstaladores y verificadores cubren los agentes nuevos, la barra de estado y `trabajo_estado`; `settings-merge` no registra hooks ni statusLine que no existan (regresión del error `MODULE_NOT_FOUND`).

## Fuera de alcance
- Emitir en streaming cada mensaje del agente OpenCode (se resumen por hitos; el detalle completo queda en su transcript).
- Panel del hub: no se toca (ya muestra trabajos y actividad).

## Criterios de aceptación
- CA1: con un job real, `trabajo_estado` por stdio devuelve lista y detalle correctos (probado).
- CA2: `estado-linea.mjs` imprime la línea con trabajo en curso, sin trabajos y con el hub caído (probado).
- CA3: `settings-merge.mjs` es idempotente, registra la statusLine solo si no hay propia y limpia registros de hooks ausentes (probado con HOME temporal).
- CA4: `scripts/verificar.ps1` sale en verde con los agentes nuevos y la barra registrada.
- CA5: el instalador despliega `planificador.md` (Claude y OpenCode) y `hub/estado-linea.mjs`.
