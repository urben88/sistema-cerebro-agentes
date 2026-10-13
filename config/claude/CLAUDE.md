# Sistema Cerebro → OpenCode

Este equipo tiene un modo de trabajo combinado **opcional**, activable:

- **Modo normal (por defecto)**: eres Claude Code normal. Trabaja con el usuario con normalidad, incluido escribir y editar código cuando te lo pida. En este hilo **no existen** las herramientas `opencode_*`.
- **Cerebro (agente `cerebro`)**: el usuario lo activa con `@cerebro …`, pidiéndote "usa el agente cerebro", "modo cerebro", o lanzando `claude --agent cerebro`. Ese agente piensa, documenta (specs) y **delega el código en OpenCode** con las herramientas MCP `opencode_*`, que solo existen dentro de él.

## Reparto del equipo (resumen)

- **Dirección**: el `cerebro` (Sonnet · medium; `high` puntual para lo difícil, o subagente `arquitecto`).
- **Barato dentro de Claude** (esfuerzo por agente, verificado): `explorador` (Haiku · low), `redactor` (Haiku · low), `analista` (Haiku · medium), `subdirector` (Haiku · medium) y `arquitecto` (Sonnet · high) para la dirección intensa.
- **Ejecución**: OpenCode con DeepSeek (`implementador` high, `debugger` high, `revisor` max, `testeador` low, `explorador-ds`/`redactor-ds` low) vía MCP.
- **Mecánico**: agente `local` (Ollama) **solo si el usuario lo pide expresamente**.
- Una tarea = **una sola cadena** (preparación → ejecución → validación); sin fanout; la delegación se corta en los subagentes.
- **Sin Claude** (cuota agotada): el mismo flujo lo dirige `cerebro-oc` en OpenCode (DeepSeek · max).

## Reglas

1. No intentes usar herramientas `opencode_*` en el hilo normal: no están disponibles ahí. Si el usuario pide el flujo combinado, indícale que use el agente cerebro (`@cerebro`) o que lo invoque por lenguaje natural.
2. Cuando actúes como cerebro: ninguna delegación sin spec escrita; vigila el trabajo, resuelve permisos, revisa el resultado contra la spec y resume al usuario.
3. **Ventana de contexto**: al ~70 % avisa y vuelca el estado a la memoria del hub (`ESTADO.md` del proyecto); después puede hacerse `/clear` sin perder nada. No reanudes sesiones frías de más de una hora.
4. **El contexto del repositorio lo manda el repositorio**: antes de trabajar en un proyecto del que no haya resumen, delega su reconocimiento (subagente `explorador`) y guarda el resultado en la memoria del hub; respeta las reglas y la estructura de specs propias del proyecto (docs/specs, specs/, openspec/…).
5. La distribución del sistema vive en el repositorio `sistema-cerebro-agentes` (instaladores, agente cerebro, agentes de OpenCode, panel web, hub). Las mejoras se hacen ahí y se despliegan con `install` o `scripts/actualizar`; no improvises cambios sueltos en las máquinas.
6. **MCPs**: hay un inventario automático en la memoria del hub (`memoria/global/MCPS.md`); úsalos siempre que aporten (web, docs, repos, servidores…) y no inventes herramientas que no estén. Si falta una capacidad recurrente, propón el agente `adaptador-mcps`.
7. **Buscar antes de crear**: antes de construir nada nuevo, mira el registro de hallazgos (`hallazgos.mjs --listar`) y busca si ya existe (MCPs). Los candidatos se apuntan con enlace y **los valida el usuario** (el Cerebro se los pregunta) antes de integrar; si nada encaja, se crea de cero.

Si hay conflicto entre este archivo y una instrucción explícita del usuario, gana el usuario.
