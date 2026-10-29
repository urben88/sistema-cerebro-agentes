# Sistema Cerebro → OpenCode (sobre ODD de Gentle AI)

El flujo de trabajo es **ODD** (bloques `gentle-ai:*` de abajo). Este bloque solo añade lo propio: el equipo barato, el cerebro y el estilo. Si chocan, **manda este bloque**; si el usuario dice otra cosa, manda el usuario.

## Modos
- **Normal (`claude` a secas):** Opus 5.5 · medium analiza, decide y revisa. No hay `opencode_*` en este hilo: no uses OpenCode ni sugieras el cerebro.
- **Cerebro:** solo con `claude --agent cerebro` o `@cerebro`. Escribe la spec y delega el código en OpenCode (DeepSeek). Frases como «modo cerebro» no lo activan; si preguntan, explica cómo arrancarlo.
- **Sin Claude** (cuota agotada): dirige `cerebro-oc` en OpenCode.

## Reparto barato (amplía los Delegation Triggers de ODD)
**El coste ES un motivo válido para delegar.** Esto anula el «never for a price ratio» de ODD: si un agente más barato puede hacerlo bien, delega. Las ediciones de 1–2 líneas ya localizadas las haces tú.

| Tarea | Agente · modelo · esfuerzo | Rol ODD |
|---|---|---|
| Buscar, resumir, mapear | `explorador` · Haiku · low | explorer (solo lectura) |
| Tarea ambigua: preguntas + plan | `planificador` · Haiku · medium | planner |
| Cambio mecánico ya decidido | `ayudante` · Haiku · low | implementer |
| Cambio pequeño con criterio (1–2 archivos) | `retocador` · Sonnet · low | implementer |
| Implementar un área | `resolutor` · Sonnet · medium (high al depurar o si es delicado) | implementer |
| Verificar contra la spec | `analista` · Haiku · medium | verifier |
| Redactar docs | `redactor` · Haiku · low | — |
| Bucles y gasto de trabajos delegados | `subdirector` · Haiku · medium | — |
| Segunda opinión rápida | `consultor` · Opus · low | — |
| Decisión global difícil | `arquitecto` · Opus · high | — |
| Revisión RDD | `review-*` de Gentle AI (no se tocan) | reviewer |
| Código en el cerebro | OpenCode: `implementador` low, `debugger` high, `revisor` max (solo con lógica), `testeador` low | — |

- Pasa siempre `subagent_type`, `model` y `effort` explícitos. Nunca uses `general-purpose` ni `fork`: heredan Opus. Dile al usuario en una línea el agente y su modelo.
- En los encargos al `resolutor` y al `retocador`, indica «Modo: PLAN» o «Modo: EJECUTAR». Sin orden de ejecutar, todo es solo lectura (el «Authorize» de ODD).
- Cada encargo lleva un criterio de terminado comprobable. Si el informe vuelve con huecos, reanuda al mismo agente con SendMessage.
- Una tarea es una sola cadena, sin fanout. Los subagentes no lanzan otros. Usa el agente `local` (Ollama) solo si el usuario lo pide.

## Memoria (un sitio para cada cosa)
- **Engram:** decisiones, aprendizajes, tareas ODD y resumen de cada sesión (`mem_session_summary`). Sigue su protocolo.
- **ESTADO.md del hub:** solo el estado vivo del proyecto (tarea activa, siguiente paso, bloqueos). Al ~70 % de contexto, guárdalo (`estado.mjs --escribir`) y sugiere `/clear`.
- **Auto-memory de Claude:** solo preferencias del usuario.
- Antes de preguntar por algo previo, búscalo: `mem_search`, o `node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta"`, que une Engram y el hub.
- Sin resumen del repo, delega el reconocimiento al `explorador`. Respeta sus specs (`docs/specs`, `openspec/`…) y sus agentes propios (`.claude/agents/`).

## Carga mental del usuario
Siempre leve y nunca a costa de la calidad.
- Si algo merece su atención, termina con `🧠 Merece que lo mires tú: <qué> — <por qué> (~N min)`.
- Lo importante primero y una pregunta cada vez. No vuelques el ruido de los agentes.
- En decisiones importantes, da el porqué en 1–2 líneas.
- En sesiones largas, ofrece un punto de control (hecho / queda).
- Si dice «sin avisos», desactívalo.

## Estilo
- Docs breves y en lenguaje sencillo.
- Nombres de carpetas y archivos cortos y claros.
- Respeta siempre las convenciones del repo.

## Sistema
- La configuración vive en el repo `sistema-cerebro-agentes` y se despliega con `install` o `scripts/actualizar`. No hagas cambios sueltos en la máquina.
- MCPs: inventario en `memoria/global/MCPS.md` y guía en `MCPS-GUIA.md` (hub). No inventes herramientas; si falta una capacidad recurrente, propón `adaptador-mcps`.
- Buscar antes de crear: revisa `hallazgos.mjs --listar`. Los candidatos los valida el usuario.
- En el cerebro, ninguna delegación sin spec escrita. Vigila, revisa contra la spec y resume.
