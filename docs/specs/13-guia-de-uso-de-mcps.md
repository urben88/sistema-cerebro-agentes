# Spec 13 · Guía de uso de MCPs (saber cuál usar, sin tocar los MCPs)

## Problema
Claude y los agentes de OpenCode no aciertan qué MCP usar: el inventario (`MCPS.md`) solo dice «qué capacidad hay», no **cuándo** usarlo ni con qué petición. Los agentes de OpenCode ni siquiera lo leen.

## Restricciones (del usuario)
- **No tocar los MCPs**: ni su configuración (`opencode.jsonc`, `~/.claude`), ni instalarlos/quitarlos.
- **No borrar ni cambiar el historial/inventario existente**: `MCPS.md`, `mcps.json` y el registro de hallazgos siguen generándose exactamente igual.
- Solo se **añade** una guía aparte y se enlaza desde los agentes.

## Requisitos
- **N1 · Plantilla de guía.** `config/hub/plantillas/mcps-guia.md`, en español y breve (≤ 4000 caracteres). Por cada MCP del inventario (agentation, context7, github, pieces, playwright, ssh, web-search; y los de Claude: claude-in-chrome, claude.ai Claude Docs, opencode, triaje): **Úsalo cuando…**, **No lo uses para…**, **Ejemplo de petición**, y nombre real de las herramientas principales. Arriba, una tabla «Si necesitas X → usa Y» (docs de una librería → context7; página web/JS → playwright o claude-in-chrome; búsqueda general → web-search; repo remoto/PR/issue → github; servidor remoto → ssh; trabajo de OpenCode → opencode/triaje). Cierra con 3 reglas: consultar la guía antes de decir «no se puede»; si el MCP no está o falla, decirlo y seguir sin inventar; citar la fuente que devuelva.
- **N2 · Instalación sin pisar.** `config/hub/mcps.mjs` copia la plantilla a `hub-data/memoria/global/MCPS-GUIA.md` **solo si no existe** (lo que edite el usuario se conserva); `--forzar-guia` la regenera. Generar `MCPS.md` y `mcps.json` no cambia en nada. `install` y `scripts/actualizar` (`.sh` y `.ps1`) dejan la plantilla disponible en el sistema instalado.
- **N3 · Contexto para Claude.** `session-start.mjs` añade al briefing un resumen de ≤ 1200 caracteres de la guía (la tabla «Si necesitas X → usa Y» y las 3 reglas, si el fichero existe). `config/claude/CLAUDE.md`, `agents/cerebro.md`, `agents/explorador.md` y `agents/analista.md` apuntan a `MCPS-GUIA.md` (una línea, sin duplicar el contenido).
- **N4 · Contexto para OpenCode.** En los agentes de `config/opencode/agents/` que pueden necesitar datos externos (`explorador-ds`, `implementador`, `debugger`, `redactor-ds`, `revisor`, `cerebro-oc`, `local-codigo` no) se añade una línea: «Si la tarea necesita información externa (web, docs de librerías, repos remotos, servidores), lee antes `~/.sistema-cerebro-agentes/hub-data/memoria/global/MCPS-GUIA.md` y usa el MCP que indica». No se cambia nada más de esos agentes (ni su `permission`).
- **N5 · Pruebas y docs.** `scripts/test-mcps-guia.mjs` (enganchado en `verificar.sh/.ps1`; conserva el BOM de `verificar.ps1`): la copia no sobrescribe un fichero editado; `--forzar-guia` sí; `MCPS.md` generado es idéntico con y sin guía; el resumen del briefing respeta el tope y es vacío si no hay guía. `docs/arquitectura.md`, `docs/pruebas.md` y CHANGELOG (0.7.0, `VERSION`).

## Criterios de aceptación
1. Ninguna configuración de MCP ni `MCPS.md`/`mcps.json`/hallazgos cambian (diff del repo y del sistema instalado lo confirma).
2. Tras instalar, existe `MCPS-GUIA.md`; si el usuario la edita y se vuelve a actualizar, su edición sigue ahí.
3. El briefing de una sesión nueva contiene la tabla «Si necesitas X → usa Y» (≤ 1200 caracteres).
4. Los agentes de OpenCode listados en N4 mencionan la ruta de la guía.
5. Todos los tests existentes siguen pasando.

## Fuera de alcance
Instalar o quitar MCPs, autodetectar herramientas de cada MCP en vivo, medir qué MCP se usa (puede venir con la spec de métricas/comunicación).
