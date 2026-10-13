# 06 · Registro central de errores

## Objetivo
Que ningún fallo se pierda: cada error o aviso —con su mensaje completo, stack y contexto— queda en un registro único (`hub-data/logs/errores.jsonl`) desde el que se puede revisar, filtrar en el panel y **exportar un informe Markdown listo para pasárselo a una IA** y corregirlo.

## Requisitos
1. **R1 · Registro** (`lib/errores-log.mjs`): JSONL con `{ id, fecha, severidad, origen, mensaje, stack, contexto }`; memoria para lectura rápida; rotación a `errores.1.jsonl` al pasar de 4 MB; ventana de 500 entradas en memoria.
2. **R2 · API**: `POST /api/log` (cualquier capa reporta), `GET /api/logs` (lista + resumen) y `GET /api/logs/exportar` (Markdown para IA).
3. **R3 · Captura automática**:
   - **hub**: errores del handler de peticiones (con ruta y método), promesas rechazadas y excepciones no capturadas (severidad crítica);
   - **vigilante**: alertas de atascos y permisos colgados;
   - **colector**: fallos leyendo sesiones/jobs y transcripts de Claude (con freno de 1/min por clave);
   - **trabajos fallidos**: cada job `failed` una sola vez, con agente, título, directorio, coste y sesión;
   - **hooks**: `hooks/reportar.mjs` avisa al hub desde el catch de cada hook (latido, cierre de trabajos, contexto…);
   - **MCP de triaje**: errores de herramienta;
   - **panel**: errores JS y promesas rechazadas del navegador (1/min como mucho).
4. **R4 · Panel**: pestaña «Errores» con lista (severidad, hora, origen, mensaje, contexto y stack desplegable), resumen por origen y botón «Copiar informe para la IA».
5. **R5 · Terminal**: `hub/errores.mjs` (`--listar`, `--exportar`, `--resumen`).
6. **R6 · Resiliencia**: el registro nunca tumba a nadie; escrituras best-effort, sin dependencias, y los hooks no se bloquean (tope 800 ms).

## Fuera de alcance
- Enviar los errores a servicios externos: todo queda local.
- Rotación por días o compresión más allá del `.1`.

## Criterios de aceptación
- CA1: un trabajo fallido y un fallo de lectura del transcript aparecen con stack/contexto en `/api/logs` (probado con la sesión real).
- CA2: `/api/logs/exportar` genera un informe Markdown con todos los campos (probado).
- CA3: la pestaña «Errores» lista, y el botón copia el informe (probado en navegador con Playwright).
- CA4: `verificar` comprueba `/api/logs` y la CLI de errores, y sigue en verde.

## Extra de esta entrega
- **Reintento de transcripts de Claude**: si el fichero aún no existe (sesión recién abierta) o la ruta enviada no es válida, el colector lo **busca por id de sesión** en `~/.claude/projects/` y **sigue reintentando** (antes, un ENOENT dejaba el detalle «sin actividad» para siempre). Probado: 178 eventos recuperados de la sesión que fallaba.
