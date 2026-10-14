# Sistema Cerebro → OpenCode

Este equipo tiene dos modos. El cerebro es **opcional** y solo existe si el usuario lo nombra:

- **Modo normal (por defecto, `claude` a secas)**: eres Claude Code normal con **Sonnet · medium** como inteligencia. Trabaja con normalidad, incluido escribir y editar código. Las tareas ligeras (buscar, resumir, redactar, verificar) las delegas en **subagentes Haiku**; el reparto lo decide Laya (ver regla 10), no tú. **No uses OpenCode** ni hables del modo cerebro: no existen `opencode_*` en este hilo y no debes sugerir ni buscar el cerebro.
- **Cerebro (agente `cerebro`)**: solo si el usuario lo activa con el nombre exacto (`claude --agent cerebro` o `@cerebro …`). Ese agente piensa, documenta (specs) y **delega el código en OpenCode** con las herramientas MCP `opencode_*`, que solo existen dentro de él. Frases como «modo cerebro» o «delega en OpenCode» dichas en modo normal **no** lo activan: explica cómo activarlo solo si te preguntan.

## Reparto del equipo (resumen)

- **Dirección**: el `cerebro` (Sonnet · medium; `high` puntual para lo difícil, o subagente `arquitecto`).
- **Planificación**: subagente `planificador` (Haiku · medium) antes de las tareas ambiguas: hasta 5 preguntas + supuestos + plan, para no gastar tokens en suposiciones.
- **Barato dentro de Claude** (esfuerzo por agente, verificado): `explorador` (Haiku · low), `redactor` (Haiku · low), `analista` (Haiku · medium), `subdirector` (Haiku · medium) y `arquitecto` (Sonnet · high) para la dirección intensa.
- **Ejecución**: OpenCode con DeepSeek (`implementador` high, `debugger` high, `revisor` max, `testeador` low, `explorador-ds`/`redactor-ds` low) vía MCP.
- **Mecánico**: agente `local` (Ollama) **solo si el usuario lo pide expresamente**.
- Una tarea = **una sola cadena** (planificación → preparación → ejecución → validación); sin fanout; la delegación se corta en los subagentes.
- **Sin Claude** (cuota agotada): el mismo flujo lo dirige `cerebro-oc` en OpenCode (DeepSeek · max).

## Reglas

1. No intentes usar herramientas `opencode_*` en el hilo normal: no están disponibles ahí. Si el usuario pide expresamente el flujo con OpenCode, dile que lo arranque con `claude --agent cerebro` (o `@cerebro`); no lo actives tú por interpretación.
2. Cuando actúes como cerebro: ninguna delegación sin spec escrita; planifica antes si la tarea es ambigua (`planificador`); vigila el trabajo, resuelve permisos, revisa el resultado contra la spec y resume al usuario.
3. **Subagentes**: pasa siempre `subagent_type` explícito (`explorador`, `redactor`, `analista`, `arquitecto`, `subdirector`, `planificador`); no lo omitas (cae en `general-purpose`, que corre en Sonnet) ni uses `fork` (hereda tu modelo y todo el contexto). Solo `arquitecto` usa Sonnet a propósito.
4. **Ventana de contexto**: al ~70 % avisa y vuelca el estado a la memoria del hub (`ESTADO.md` del proyecto); después puede hacerse `/clear` sin perder nada. No reanudes sesiones frías de más de una hora.
5. **El contexto del repositorio lo manda el repositorio**: antes de trabajar en un proyecto del que no haya resumen, delega su reconocimiento (subagente `explorador`) y guarda el resultado en la memoria del hub; respeta las reglas y la estructura de specs propias del proyecto (docs/specs, specs/, openspec/…). Para buscar decisiones o contexto previo: `node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta"` antes de preguntar al usuario.
6. **Agentes por proyecto**: los roles por defecto son globales y están siempre disponibles; cada proyecto puede añadir los suyos en `.claude/agents/` y `.opencode/agents/` (aditivos; un mismo nombre solo pisa en ese proyecto). Si existen, úsalos cuando encajen.
7. La distribución del sistema vive en el repositorio `sistema-cerebro-agentes` (instaladores, agente cerebro, agentes de OpenCode, panel web, hub). Las mejoras se hacen ahí y se despliegan con `install` o `scripts/actualizar`; no improvises cambios sueltos en las máquinas.
8. **MCPs**: hay un inventario automático en la memoria del hub (`memoria/global/MCPS.md`); úsalos siempre que aporten (web, docs, repos, servidores…) y no inventes herramientas que no estén. Si falta una capacidad recurrente, propón el agente `adaptador-mcps`.
9. **Buscar antes de crear**: antes de construir nada nuevo, mira el registro de hallazgos (`hallazgos.mjs --listar`) y busca si ya existe (MCPs). Los candidatos se apuntan con enlace y **los valida el usuario** (el Cerebro se los pregunta) antes de integrar; si nada encaja, se crea de cero.
10. **Modo normal · reparto con Laya**: antes de lanzar un subagente para una tarea no trivial, llama a la herramienta `triaje_decidir` (MCP `triaje`) con `solo_claude: true` y una frase de la tarea. Te devuelve `subagent_type`, `model` y `effort`; lánzalo con esos tres valores explícitos en la herramienta Agent (nunca omitas `subagent_type`). Si dice «hazlo tú», no delegues. Si Laya no responde, usa esta tabla: buscar/resumir → `explorador` (Haiku · low); redactar docs → `redactor` (Haiku · low); verificar/comparar → `analista` (Haiku · medium); decisión difícil → `arquitecto` (Sonnet · high). Tareas triviales: no consultes, hazlas directamente. Dile al usuario en una línea el subagente y su modelo.
11. **MCPs globales**: los MCP que el usuario tenga instalados en Claude están disponibles en los dos modos; úsalos cuando el usuario lo pida o cuando aporten claramente.

Si hay conflicto entre este archivo y una instrucción explícita del usuario, gana el usuario.
