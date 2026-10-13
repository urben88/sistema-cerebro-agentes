# 05 · Vista viva de los agentes («La oficina»)

## Objetivo
Ver dentro de «La oficina», al pinchar en un agente de OpenCode, lo que está haciendo en ese momento: **cómo está pensando** (razonamiento), su **actividad** (herramientas, textos, parches, pasos), los **siguientes pasos** que tiene pensados y su **esfuerzo** — y que todo eso lo **recopile el hub solo**, sin pedirlo en cada clic y sin depender de que el servidor responda en ese instante.

Extiende la spec 04 (modelo real, errores legibles y detalle con refresco): aquí se añade el flujo vivo que la spec 04 dejaba fuera de alcance.

## Requisitos
1. **R1 · Fuentes**: `/session/{id}/message` (reasoning, text, tool, patch, step-finish) y `/session/{id}/todo` del servidor V1, normalizados en `lib/opencode.mjs` (`sesionMensajes`, `sesionTodo`), con recortes y sin volcar nada crudo.
2. **R2 · Colector** (`lib/vivo.mjs`): recorre cada 4 s los trabajos activos (últimas 6 h) y los terminados en los últimos 15 min; guarda por trabajo un buffer circular de 800 eventos con ids (sin duplicados) y los siguientes pasos; persiste un snapshot en `hub-data/trabajos-vivo/<jobId>.json` (se conserva 3 días) y lo recarga al arrancar.
3. **R3 · Recolección al abrir**: `GET /api/trabajos/:jobId` completa la recogida si el trabajo no estaba en la ventana (p. ej. antiguo), con caché de 15 s por trabajo.
4. **R4 · SSE**: cada lote de eventos se difunde como `event: trabajo` a los clientes de `/api/eventos`; el panel refresca el detalle abierto al instante.
5. **R5 · Panel**: bloque «vista viva» en el detalle — estado del colector (última lectura y avisos), **Pensando ahora** (último razonamiento completo), **Siguientes pasos** (lista con estados ○/⏳/✓) y **Actividad** (cronología con razonamiento y textos desplegables, herramientas con estado, parches y pasos). Sin parpadeo: solo se repinta al cambiar algo y conserva el scroll; la línea de estado se refresca sola.
6. **R6 · Esfuerzo**: modelo y esfuerzo se muestran como `modelo · variant` en tarjeta y detalle (spec 04).
7. **R7 · Fiabilidad**: si el servidor V1 no responde, el detalle enseña la última copia y el aviso del colector, sin romper el panel; sin disco, el colector sigue en memoria.
8. **R8 · Control desde la web**: botones de emergencia en «La oficina» (⛔ parar **todo**, por **sala** y por **trabajo** en su detalle) sobre `POST /api/trabajos/cancelar`, que acepta `todo`, `directory` o `jobId`.
9. **R9 · Consumo real por oficina**: la barra de estado empuja `POST /api/claude/estado` (contexto, ventanas 5 h/7 d, coste y reinicios, con TTL de 2 min); cada sala muestra chips con esos datos reales y con el **gasto DeepSeek** acumulado de sus trabajos; el detalle de un agente de Claude los lista.
10. **R10 · Vista viva de Claude**: actividad leída del transcript de la sesión (herramientas, archivos, textos, subtareas y resultados; se ignoran los subagentes dentro del fichero); el pensamiento interno no es legible y el panel lo explica. La ruta del transcript viaja en el latido.

## Fuera de alcance
- La conversación completa cruda en el panel (se ofrecen extractos desplegables).
- Modificar, responder o cancelar agentes desde el detalle (cancelar tiene su propio camino: `cerebro-parar` / `/api/trabajos/cancelar`).

## Criterios de aceptación
- CA1: un trabajo en curso enseña razonamiento y actividad en ≤ 5 s desde que ocurren.
- CA2: un trabajo terminado conserva su actividad (snapshot) tras reiniciar el hub.
- CA3: `/api/trabajos/:jobId` de un trabajo antiguo devuelve eventos sin esperar al ciclo del colector.
- CA4: con el servidor V1 caído, el detalle muestra la última copia y el aviso.
- CA5: `verificar` sigue en verde y comprueba `/api/vivo` y `/api/claude/estado`.
- CA6: los botones de parada cancelan de verdad (seco y real, probado con un trabajo simulado) y solo el objetivo pedido.
- CA7: en modo demo se ven los chips de contexto/ventanas/coste y la vista viva de un Claude (con su nota de honestidad).

## Probado
- `sesionMensajes` con una sesión real: 68 mensajes, 48 razonamientos, 80 herramientas, 30 parches.
- Colector: 240 eventos de un trabajo real, snapshot en disco y recarga correcta.
- Hub temporal: `/api/vivo` activo; `/api/trabajos/:jobId` con 240 eventos; trabajo antiguo rellenado al abrir.
