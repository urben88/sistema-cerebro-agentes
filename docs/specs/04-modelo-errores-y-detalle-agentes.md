# 04 · Modelo real, errores claros y detalle de cada agente en el panel

## Objetivo
1. Que el panel nunca muestre «sin modelo» para un agente que trabaja (hoy ocurre con `cerebro` y con cualquier agente de Claude sin `model:` en su frontmatter).
2. Que los errores sean legibles y accionables, no un texto crudo.
3. Que se vea mejor qué hace cada agente: paso actual, herramientas recientes, coste, tokens, archivos tocados.

## Contexto (reconocimiento hecho)
- `config/hub/lib/actividad.mjs` toma el modelo solo del frontmatter (`organizacion.mjs`). `config/claude/agents/cerebro.md` y `adaptador-mcps.md` no declaran `model:` → `null` → el panel pinta «sin modelo» (`config/hub/panel/app.js` ~L232, L421, L553).
- Los jobs de OpenCode ya traen el modelo real (`session.model.id/variant`) y `leerJobsRecientes` lo expone como `modelo`/`variant`, pero `actividad.mjs` lo ignora.
- `lib/opencode.mjs#detalleJob(jobId)` ya devuelve estado, coste, tokens, `ultimoTexto`, `herramientas` (últimas 5) y `archivosPatch`; el panel no lo usa en el panel lateral (`abrirDetalle`, app.js ~L409).
- Los latidos de Claude (`config/hooks/latido.mjs` → `POST /api/latido`, `hub.mjs#registrarLatido`) no llevan modelo.
- El error de un job es `j.error?.message` (texto crudo) y se muestra tal cual en `Error`.

## Requisitos
1. **R1 · Modelo real en jobs**: en `actividad.mjs`, el personaje de origen job usa `j.modelo` (y `j.variant`) cuando existan; si no, el del frontmatter. Se expone también `variant`.
2. **R2 · Modelo en latidos de Claude**: `latido.mjs` envía `modelo` si el payload del hook lo trae (p. ej. `model`/`model.id`/`display_name`); si no, lo deduce del último mensaje `assistant` del transcript (`transcript_path`, leer solo la cola, con tope de tiempo de 1 s). `registrarLatido` lo guarda y `actividad.mjs` lo usa antes del frontmatter. No bloquear nunca a Claude.
3. **R3 · Respaldo declarado**: añadir `model: sonnet` a `config/claude/agents/cerebro.md` solo si no rompe `--agent cerebro` (si dudas, no lo toques y confía en R2). `adaptador-mcps.md` → `model: haiku`.
4. **R4 · Etiqueta honesta**: si aun así no hay modelo, el panel muestra «modelo no informado» en lugar de «sin modelo» y en el detalle explica «hereda el del hilo principal». Los alias (`haiku`, `sonnet`) se muestran tal cual, nunca como vacío.
5. **R5 · Errores legibles**: nuevo módulo `config/hub/lib/errores.mjs` con `clasificarError(texto)` → `{ tipo, titulo, causa, accion, crudo }`. Tipos mínimos: `timeout`, `permiso`, `cuota/limite`, `sin_servidor` (OpenCode/Hub caído), `modelo` (proveedor/modelo no disponible), `cancelado`, `desconocido`. Español, una frase de causa y una de acción concreta. Se aplica en `actividad.mjs` (campo `error` pasa a objeto o se añade `errorInfo`) manteniendo `error` crudo por compatibilidad.
6. **R6 · Panel de errores**: en la tarjeta del personaje, el chip de error muestra `titulo`; en el panel lateral, bloque «Qué falló» con causa, acción sugerida y el texto crudo plegado. Las alertas del vigilante usan el mismo clasificador.
7. **R7 · Detalle vivo de cada agente**: `abrirDetalle` pide `GET` del detalle del job (reutilizar el endpoint existente de `detalleJob`; si no hay, añadir `GET /api/trabajos/:jobId`) cuando hay `jobId` y muestra: modelo·variant, duración, coste, tokens, último paso (`ultimoTexto` recortado a ~400 car.), lista de herramientas recientes con su estado (✓/⏳/✗) y archivos modificados. Se refresca mientras el panel lateral está abierto (cada ~3 s, solo si el job está en curso).
8. **R8 · Agentes sin job** (Claude/latidos): el detalle muestra qué se sabe: tarea, evento (`UserPromptSubmit`/`SubagentStart`…), desde cuándo y modelo; sin inventar nada.
9. **R9 · Demo y pruebas**: los datos demo cubren error clasificado y detalle. Pruebas puras para `clasificarError` y para la elección de modelo (job > latido > frontmatter) siguiendo el patrón de pruebas de `actividad.mjs`.

## Fuera de alcance
- Streaming de mensajes del agente; conversación completa.
- Cambiar el esfuerzo/modelo de ningún agente.

## Criterios de aceptación
- CA1: un job real de `implementador` muestra `deepseek-…` y su variant en tarjeta y detalle, no «sin modelo».
- CA2: un latido de `cerebro` con modelo en el payload/transcript muestra ese modelo; sin ninguno, «modelo no informado» (no «sin modelo»).
- CA3: `clasificarError` devuelve tipo correcto para al menos 6 textos de ejemplo (probado).
- CA4: el panel lateral de un job en curso muestra herramientas recientes y coste, y se actualiza.
- CA5: `scripts/verificar` sigue en verde; el hook de latido no bloquea con el hub caído.
- CA6: sin dependencias nuevas.
