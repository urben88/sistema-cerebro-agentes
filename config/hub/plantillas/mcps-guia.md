# Guía de uso de MCPs

Inventario: `memoria/global/MCPS.md`.

## Si necesitas X → usa Y

| Necesitas | Usa |
|---|---|
| Docs/API de una librería | `context7` |
| Abrir/probar una web o ejecutar JS | `playwright` (o `claude-in-chrome` en Claude) |
| Búsqueda general en internet | `web-search` |
| Repo remoto, PR o issue de GitHub | `github` |
| Un servidor remoto (comandos, ficheros) | `ssh` |
| Notas/memoria propia de Pieces | `pieces` |
| Anotaciones de UI pendientes | `agentation` |
| Delegar código en OpenCode | `opencode` (estado: `triaje`) |
| Crear/editar un doc (claude.ai) | *Claude Docs* |

### `context7` — docs de librerías
- **Úsalo cuando** preguntes por la API o configuración de una librería.
- **No lo uses para** conceptos generales ni lógica de negocio.
- **Ejemplo**: «¿Cómo se monta un router en Express 5?».
- **Herramientas**: `resolve-library-id`, `query-docs`.

### `web-search` — búsqueda web
- **Úsalo cuando** necesites una búsqueda general o noticias.
- **No lo uses para** docs de una librería concreta (mejor `context7`).
- **Ejemplo**: «Busca el estado actual de Node 24».
- **Herramientas**: `web_search`, `get_webpage_content`.

### `playwright` — navegador
- **Úsalo cuando** haya que abrir una web o comprobar su DOM/JS.
- **No lo uses para** solo leer texto (basta `web-search`).
- **Ejemplo**: «Abre example.com y dime su título».
- **Herramientas**: `browser_navigate`, `browser_snapshot`, `browser_click`.

### `claude-in-chrome` — Chrome (Claude)
- **Úsalo cuando** la web necesite tu sesión iniciada en Chrome.
- **No lo uses para** rastreos masivos ni automatismos.
- **Ejemplo**: «Abre mi pestaña de X y resúmela».
- **Herramientas**: `navigate`, `read_page`, `find`.

### `github` — GitHub
- **Úsalo cuando** sea un repo remoto, un PR o una issue.
- **No lo uses para** el repo local (usa `git` y los ficheros).
- **Ejemplo**: «Lístame los PRs abiertos de owner/repo».
- **Herramientas**: `search_repositories`, `get_file_contents`, `list_pull_requests`, `create_pull_request`.

### `ssh` — servidores remotos
- **Úsalo cuando** haya que leer o ejecutar algo en un servidor por SSH.
- **No lo uses para** la máquina local.
- **Ejemplo**: «En el servidor web mira `df -h`».
- **Herramientas**: `read-command`, `run-command`, `sftp-list`.

### `pieces` — memoria de Pieces
- **Úsalo cuando** quieras guardar o recuperar notas y snippets propios.
- **No lo uses para** la memoria del hub (`hub-data/memoria`).
- **Ejemplo**: «Guarda en Pieces esta decisión».
- **Herramientas**: las de Pieces (`pieces_*`).

### `agentation` — anotaciones de UI
- **Úsalo cuando** haya anotaciones de la interfaz que atender.
- **No lo uses para** revisar código ni documentación.
- **Ejemplo**: «¿Qué anotaciones pendientes hay?».
- **Herramientas**: `get_pending`, `watch_annotations`, `resolve`.

### `opencode` — código en OpenCode
- **Úsalo cuando** delegues código: lanzar, vigilar o recoger un job.
- **No lo uses para** investigar o decidir (hazlo tú).
- **Ejemplo**: «Lanza `implementador` aquí con esta spec».
- **Herramientas**: `opencode_fire`, `opencode_wait`, `opencode_job_input`, `opencode_review_changes`.

### `triaje` — estado de trabajos
- **Úsalo cuando** quieras ver el progreso de los trabajos de OpenCode o pararlos.
- **No lo uses para** ejecutar el trabajo (solo informa o para).
- **Ejemplo**: «¿Cómo van los trabajos?».
- **Herramientas**: `trabajo_estado`, `parar_trabajos`.

### Claude Docs — docs en claude.ai
- **Úsalo cuando** el usuario pida crear o editar un doc en claude.ai.
- **No lo uses para** buscar docs (`context7`) ni ficheros locales.
- **Ejemplo**: «Crea un doc: informe».
- **Herramientas**: `create`, `read`, `update`, `query`.

## Reglas

1. **Consulta esta guía antes de decir «no se puede»**: si la capacidad existe en un MCP, úsala.
2. **Si el MCP no está o falla, dilo y sigue** sin inventar la respuesta ni la herramienta.
3. **Cita la fuente** que devuelva el MCP (enlace o referencia).
