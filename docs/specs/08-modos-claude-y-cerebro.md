# 08 · Modos `claude` y `claude --agent cerebro`, enrutado por Laya y barra de modo

## Objetivo
Separar con nitidez los dos modos de trabajo y hacer visible cuál está activo:

- **`claude` (modo normal)**: Sonnet 5.5 · medium como inteligencia. Delega lo ligero en subagentes **Haiku** (o Sonnet alto si de verdad hace falta). **Sin OpenCode y sin modo cerebro.**
- **`claude --agent cerebro` (modo cerebro)**: el flujo actual (specs + OpenCode vía MCP `opencode`/`triaje`). Solo se activa si el usuario lo nombra exactamente.

El reparto de tareas entre modelos/esfuerzos lo decide **Laya** (triaje local), no Sonnet, para no gastarle contexto ni razonamiento al cerebro.

## Estado (2026-10-14)
- Hecho: R1, R2, R3 y R4 (CLAUDE.md global reescrito; session-start neutral; triaje registrado a nivel de usuario; `triaje_decidir` con `solo_claude` que traduce a Haiku/Sonnet + tabla de reserva en CLAUDE.md regla 10). R5 en parte (modo, esfuerzo y limites; falta consumo por modelo). R8 cubierto.
- Probado: triaje real con Laya (revisar diff -> analista Haiku medium; README -> redactor Haiku low; refactor -> hilo principal Sonnet medium). verificar 65/65.
- Hecho tambien: R5 (contador `Σ haiku×N sonnet×M` = subagentes lanzados por modelo en la sesion, NO tokens) y R6 (el mod anuncia la tarea al hub en `agent.spawn`; el hub la asocia al latido). Probado con eventos simulados. El campo real que trae el encargo en `agent.spawn` no esta confirmado: el mod registra las `claves` del evento en el log del hub para comprobarlo.
- Hecho: R7 (`/agentes` lista y `/agentes <n>` da el detalle: modelo, esfuerzo, tarea y actividad reciente de la sesion que lo lanzo; el transcript es el del hilo, no el del subagente). Probado con `claude -p "/agentes"` contra el hub. Confirmado en los tipos del mod: `agent.spawn` trae `description` y `prompt`; `command.run` trae `args`.
- Pendiente: comprobar CA1/CA2/CA5 en sesiones reales (modo normal sin `opencode_*`, etiqueta CEREBRO con `--agent cerebro`, tarea visible).

## Requisitos
1. **R1 · Activación exacta del cerebro.** El modo cerebro solo arranca con `claude --agent cerebro` o `@cerebro` escrito literalmente. Se eliminan del `CLAUDE.md` global y de `session-start.mjs` las frases que lo sugieren por lenguaje natural («modo cerebro», «usa el agente cerebro», «delega en OpenCode») y toda sugerencia proactiva. En modo normal no se menciona ni se busca el cerebro.
2. **R2 · Modo normal sin OpenCode.** Los MCP `opencode` quedan **solo** dentro del frontmatter de `cerebro.md` (como hoy). El `CLAUDE.md` global describe el modo normal: Sonnet·medium + subagentes Haiku, y prohíbe usar `opencode_*`.
3. **R3 · MCP globales para ambos modos.** Los MCP que el usuario tenga instalados en Claude (inventario en `memoria/global/MCPS.md`) están disponibles en los dos modos; se usan cuando el usuario lo pide o cuando aportan claramente (web, docs, repos…).
4. **R4 · Laya enruta los subagentes.** `triaje` se registra a nivel de usuario (disponible en modo normal) con un parámetro `capa: "claude"` en `triaje_decidir` que restringe el resultado a Haiku/Sonnet y esfuerzo (`low|medium|high`). Regla en `CLAUDE.md`: antes de lanzar un subagente de una tarea no trivial, consultar `triaje_decidir`; lanzar el subagente con `subagent_type` y `model`/`effort` según la respuesta. Tareas triviales: sin consulta. Tabla de reserva si Laya no responde: buscar/resumir → Haiku·low; redactar → Haiku·low; verificar → Haiku·medium; decisión difícil → Sonnet·high.
5. **R5 · Barra de estado con modo y consumo.** `estado-linea.mjs` muestra: etiqueta `🧠 CEREBRO` o `normal` (según el agente de la sesión), modelo y esfuerzo actuales, subagentes en curso (modelo·esfuerzo·tiempo·tarea) y **acumulado de uso por modelo** (Sonnet/Haiku) de la sesión, a partir de los latidos del hub.
6. **R6 · Defecto de la barra.** La tarea del subagente aparece como `?` (captura del usuario: `explorador (haiku) · 0m ?`): debe mostrar la descripción corta del encargo.
7. **R7 · Ver/entrar en subagentes.** Investigar qué ofrece Claude Code nativo (`/tasks`, selección desde la barra) y añadir al mod el comando `/agentes` (lista) y `/agentes <n>` (extracto de la actividad en vivo desde el hub, spec 05), sin volcar la conversación entera.
8. **R8 · Seguridad de no romper.** Todo con `try/catch`; si el hub o Laya no responden, se usa la tabla de reserva y la barra sigue funcionando.

## Fuera de alcance
- Cambiar el flujo interno del cerebro/OpenCode.
- Entrenar o cambiar Laya; solo se usa su decisión actual.

## Criterios de aceptación
- CA1: `claude` sin flags no ve herramientas `opencode_*` y su prompt no sugiere el cerebro; `claude --agent cerebro` sí las tiene.
- CA2: frase «usa el modo cerebro» en modo normal → no arranca el cerebro (solo se explica cómo activarlo si se pregunta).
- CA3: en modo normal, una tarea de resumir un módulo acaba en un subagente `haiku` con el esfuerzo que devolvió `triaje_decidir`, verificable en el log del hub.
- CA4: la barra muestra el modo correcto en ambos arranques y el contador por modelo sube al lanzar un subagente Haiku.
- CA5: la tarea del subagente ya no sale como `?`.
- CA6: `/agentes` lista los subagentes activos y `/agentes 1` muestra su último actividad.
- CA7: `verificar` sigue en verde tras `scripts/actualizar`.

## Preguntas abiertas
- Cómo detecta la barra el agente activo (¿campo `agent` en el JSON de la statusline?): comprobar en la implementación.
- Qué hace `/tasks` de serie para abrir un subagente (R7).
