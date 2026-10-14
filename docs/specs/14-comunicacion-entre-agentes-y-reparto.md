# Spec 14 · Comunicación entre agentes (A2A-lite por el hub) y reparto de carga

## Objetivo
Ahorrar tokens de Claude y repartir mejor la carga: que el contexto largo (lecturas, búsquedas, informes) lo manejen los agentes baratos y que al cerebro solo lleguen respuestas compactas. Se hace con un **mediador en el hub** (no con servidores A2A por agente) y se deja el formato compatible con A2A (Agent Card) por si algún día se quiere interoperar.

## Principios
- El **hub media**: los agentes no se hablan entre sí directamente; todo mensaje pasa por el hub, que impone límites y deja rastro.
- **Profundidad 1**: una consulta no puede originar otra consulta. Solo se pregunta a agentes de **lectura** (`explorador-ds`, `revisor`, `testeador`, `redactor-ds`).
- Respuestas **cortas por contrato** (≤ 1200 caracteres) y con tope de coste.
- Sin prompts ni respuestas completas en los logs de métricas (solo tamaños, agente, coste, ms).

## Requisitos
- **C1 · Directorio de agentes (Agent Card ligera).** `GET /api/a2a/agentes` devuelve, para cada agente del catálogo, `{name, description, version, skills:[{id,name,description}], modelo, esfuerzo, capa:'claude'|'opencode', solo_lectura, coste_estimado, salud}` (salud desde `salud-agentes`). Fuentes: frontmatter de `config/opencode/agents/*.md` y `config/claude/agents/*.md` instalados + `reglas.json`. Sin dependencias nuevas.
- **C2 · Consulta síncrona mediada.** `POST /api/a2a/consultar` `{de, para, pregunta, directory, sessionId?}`: valida (`para` ∈ agentes de lectura; `pregunta` ≤ 2000 chars; `directory` existente y absoluto), lanza el job con `lanzador.mjs` al agente `para`, espera hasta `timeoutMs` (default 120 s) y devuelve `{ok, jobId, respuesta (≤1200 chars, recortada con «…»), coste, ms}`. Antepone al encargo una instrucción fija: «responde en ≤ 10 líneas, solo hechos y rutas, sin código largo». Respeta el tope de coste de `presupuestos` (aborta la sesión al pasarlo) y el límite de concurrencia del ledger. Rechaza (409) si `de` ya está dentro de una consulta (profundidad 1) o si hay > 3 consultas en curso.
- **C3 · Buzón asíncrono por tarea.** `POST /api/a2a/mensajes` `{de, para, tipo:'aviso'|'pregunta'|'resultado', ref (jobId o spec), cuerpo (≤ 1200)}`, `GET /api/a2a/mensajes?para=&estado=&ref=`, `POST /api/a2a/mensajes/responder` `{id, cuerpo}`. Estados `pendiente|respondido|expirado` (TTL 30 min), máx. 20 pendientes por destinatario (429 al superarlo). Persistencia atómica en `hub-data/a2a.json` (read-merge-write). Una respuesta no puede crear otro mensaje de tipo `pregunta`.
- **C4 · Triaje en el camino.** `POST /api/a2a/consultar` y el lanzamiento de cualquier job desde el cerebro registran la decisión de triaje (`decisiones.jsonl`) cuando no la hay ya reciente para ese encargo; así `decisiones.jsonl` deja de estar casi vacío. Las guías de `cerebro.md` y `cerebro-oc.md` pasan a decir: «antes de delegar, `triaje_decidir`; para lecturas largas, `a2a/consultar` en vez de leer tú».
- **C5 · Reparto medido.** `GET /api/reparto?dias=7` agrega desde ledger + métricas (spec 11) + `decisiones.jsonl`: por agente `{trabajos, completados, fallidos, cancelados, coste, mediaMs}`, por capa (claude/opencode), `% de jobs con decisión de triaje previa`, y `consultasA2A {total, coste, mediaRespuestaChars}`. Una tarjeta «Reparto» en el panel con una tabla simple. Evento de métricas `a2a` (tipo `consulta|mensaje`, de, para, estado, chars, coste, ms; sin texto).
- **C6 · Limpiar el ruido del ledger.** Investigar por qué hay entradas con agente `?` (cancelados/desconocido) y corregirlo en el origen si el job tiene agente conocido (completar `agente` al reconciliar con el registro del job). Documentar lo que no se pueda resolver.
- **C7 · Guías, docs y pruebas.** Línea en los agentes de OpenCode de lectura y en `implementador`/`debugger` explicando cuándo usar `consultar` (curl al hub) y los límites; `docs/arquitectura.md` (diagrama del mediador), `docs/pruebas.md`, CHANGELOG 0.8.0 + `VERSION`. `scripts/test-a2a.mjs` enganchado en `verificar.sh/.ps1` (conserva el BOM): validaciones, tope de profundidad, TTL, límite de pendientes, recorte de respuesta, lanzador simulado.

## Criterios de aceptación
1. `GET /api/a2a/agentes` lista todos los agentes con capa, modelo y salud.
2. Una consulta a `explorador-ds` devuelve ≤ 1200 chars, con coste y ms, y deja un job en el ledger y un evento `a2a` en métricas (sin texto).
3. Una consulta a un agente que no es de lectura, o hecha desde un agente que ya está consultando, es rechazada.
4. El buzón respeta TTL, límite de pendientes y que las respuestas no generan preguntas.
5. `GET /api/reparto` y la tarjeta del panel muestran carga por agente y % con triaje previo.
6. Las entradas nuevas del ledger traen siempre `agente`.
7. Los tests existentes siguen pasando.

## Fuera de alcance
Servidores A2A reales por agente (JSON-RPC/streaming), autenticación entre agentes, consultas hacia agentes que escriben código.
