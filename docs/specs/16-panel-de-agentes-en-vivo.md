# Spec 16 · Panel de agentes en vivo (Claude + OpenCode) y entrar en ellos

> Estado: **borrador**. Petición del usuario del 2026-10-15; falta investigar la API de mods y cerrar el diseño.

## Petición
«Cuando se generan subagentes, quiero un menú más claro de los que están corriendo, tanto de Claude como de OpenCode. Parece que no lo veo. Quiero que se vea cuando se esté ejecutando y poder entrar dentro de él. Eso no puedo.»

## Lo que hay hoy
- **Barra (claude-hud, spec 15):** línea de subagentes de Claude (`◐ explorador [haiku]: … (2m)`) y, en la línea del sistema, el trabajo de OpenCode en curso. Solo una línea resumida; no se puede entrar.
- **Mod «mesa de trabajo»** (`config/mods/mesa-de-trabajo/hooks/register.js`): banda sobre el prompt con hasta 2 trabajos de OpenCode y los subagentes; comandos `/trabajos`, `/errores`, `/parar-todo`. Solo texto; no se puede entrar.
- **Claude Code nativo:** los subagentes en segundo plano salen en su panel y `/tasks`; desde ahí se puede abrir su transcripción (comprobar en 2.1.300 qué permite).
- **Panel web del hub** (`127.0.0.1:4597`): al pinchar un agente se ve su razonamiento en directo. Está fuera de la terminal.
- **OpenCode:** cada trabajo es una sesión del servidor V1 (puerto en `server-port.txt`); se puede abrir en la TUI de OpenCode adjunta a esa sesión (comprobar el comando exacto).

## Objetivo
Un único sitio, **dentro de Claude Code**, con todos los agentes vivos (Claude y OpenCode): quién, modelo · esfuerzo, estado, tiempo y coste, y **entrar** en cualquiera para ver qué está haciendo en directo (y, en OpenCode, responder a sus preguntas).

## Por investigar (primer paso de la siguiente sesión)
1. Qué permite la API de mods (skill `plugin-authoring`): ¿panel o pane vivo con selección? ¿comando que abra una vista?
2. Qué ofrece Claude Code 2.1.300 de forma nativa para entrar en subagentes (panel de agentes, `/tasks`, atajos).
3. Cómo abrir una sesión concreta del servidor V1 en la TUI de OpenCode (`opencode attach` / `-s <sesión>`), o en una pestaña o panel nuevo de Windows Terminal (`wt -w 0 sp …`).
4. Si hay un mod o plugin conocido que ya lo haga (regla «buscar antes de crear»).

## Propuesta inicial (a validar)
- Comando `/agentes` del mod: lista numerada de todos los agentes vivos (Claude + OpenCode) con estado, modelo, tiempo y coste; `/agentes N` entra: si es de OpenCode, abre su sesión en un panel nuevo de Windows Terminal con la TUI de OpenCode adjunta; si es de Claude, indica el atajo nativo o abre su transcripción en vivo.
- Banda del mod más clara: un renglón por agente vivo con icono por familia (Claude/OpenCode) y aviso si espera respuesta.
