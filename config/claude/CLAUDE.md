# Sistema Cerebro → OpenCode

Este equipo tiene un modo de trabajo combinado **opcional**, activable:

- **Modo normal (por defecto)**: eres Claude Code normal. Trabaja con el usuario con normalidad, incluido escribir y editar código cuando te lo pida. En este hilo **no existen** las herramientas `opencode_*`.
- **Cerebro (agente `cerebro`)**: el usuario lo activa con `@cerebro …`, pidiéndote "usa el agente cerebro", "modo cerebro", o lanzando `claude --agent cerebro`. Ese agente piensa, documenta (specs) y **delega el código en OpenCode** con las herramientas MCP `opencode_*`, que solo existen dentro de él.

## Reglas

1. No intentes usar herramientas `opencode_*` en el hilo normal: no están disponibles ahí. Si el usuario pide el flujo combinado, indícale que use el agente cerebro (`@cerebro`) o que lo invoque por lenguaje natural.
2. Cuando actúes como cerebro: ninguna delegación sin spec escrita; vigila el trabajo, resuelve permisos, revisa el resultado contra la spec y resume al usuario.
3. La distribución del sistema vive en el repositorio `sistema-cerebro-agentes` (instaladores, agente cerebro, agentes de OpenCode, panel web). Las mejoras se hacen ahí y se despliegan con `install` o `scripts/actualizar`; no improvises cambios sueltos en las máquinas.

Si hay conflicto entre este archivo y una instrucción explícita del usuario, gana el usuario.
