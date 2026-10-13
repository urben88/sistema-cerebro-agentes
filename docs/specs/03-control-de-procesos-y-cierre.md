# 03 · Control de procesos, cierre limpio y detalle de trabajos

## Objetivo
Que el usuario tenga control estricto sobre todo lo que consume (jobs de OpenCode, servidor, tokens): verlo, pausarlo, pararlo de golpe y que **al cerrar Claude se cierre también OpenCode**. Además, que cada resumen de trabajo en «La oficina» se pueda abrir para ver más información y sus logs.

## Contexto (reconocimiento)
- `config/mcp/servidor.ps1|sh` lanza `opencode.exe serve` detached (`Start-Process -WindowStyle Hidden` / `nohup`); sobrevive a Claude. `servidor.ps1 -Stop` existe pero no se invoca al cerrar.
- `config/hooks/cerrar-trabajos.mjs` (SessionEnd, 8 s) solo cancela jobs vía `oc.cancelarTrabajos`; corre con cualquier `reason`, incluido `clear`. No mata el servidor.
- `config/hub/lib/opencode.mjs#cancelarTrabajos`; `POST /api/trabajos/cancelar {directory,todo,dryRun}`; CLI `config/hub/parar-todo.mjs`; herramienta MCP `parar_trabajos`.
- `config/hub/lib/vigilante.mjs` (cada 60 s) solo avisa (`atascado`, `permiso-colgado`); no cancela.
- Panel (`config/hub/panel/*`): sin botones de parar/pausar; gasto agregado en `/api/gasto`, sin coste/tokens por personaje.
- Hay jobs fantasma (`accepted` sin arrancar, restos de horas) que ensucian el panel.
- `cerrar-trabajos.mjs`, `parar-todo.mjs` y `config/bin/cerebro-parar*` aparecen sin versionar: hay que versionarlos.

## Requisitos
### A. Cierre limpio
1. **R1 · Registro de sesiones**: cada sesión de Claude registra su latido/ID en el hub (o fichero de sesiones) al arrancar (`SessionStart`) y lo retira en `SessionEnd`. Se descartan sesiones sin latido reciente (caducidad configurable, defecto 10 min) para no depender de cierres abruptos.
2. **R2 · Cierre de sesión**: al `SessionEnd` con `reason` ≠ `clear` se cancelan los jobs activos de esa sesión/proyecto (comportamiento actual). Con `reason=clear` NO se apaga nada (la sesión continúa).
3. **R3 · Apagado de OpenCode al cerrar la última**: si tras retirar la sesión no queda ninguna sesión viva, el hook ejecuta el apagado de `opencode.exe serve` (equivalente a `servidor.ps1|sh -Stop`) tras cancelar los jobs. Si quedan otras sesiones vivas, no se apaga. El hub y Laya (Docker) NO se apagan.
4. **R4 · Arranque perezoso**: el servidor se levanta al abrir el MCP `opencode` (launcher, ya existente); no queda ningún proceso de OpenCode al cerrar la última sesión. Verificable listando procesos.
5. **R5 · Limpieza al arrancar**: `SessionStart` y el hub descartan jobs fantasma (`accepted` sin sesión > N min, `running` sin actividad > 1 h) marcándolos cancelados y abortando su sesión si existe. **Si el servidor OpenCode no está arrancado**, `cancelarTrabajos` (y por tanto «Parar todo») marca igualmente los registros `job_*.json` como cancelados en local (hoy responde «NO cancelado · servidor V1 no arrancado» y deja los fantasmas, caso real verificado con 9 jobs huérfanos).
6. **R6 · Robustez**: el hook nunca bloquea el cierre más de 8 s; si el hub está caído, actúa directamente contra el servidor OpenCode / procesos. Registra lo hecho en bitácora.

### B. Topes y control automático
7. **R7 · Topes por job**: configurables (defecto: 30 min de duración y 1,00 USD por job). El vigilante, además de avisar, **cancela** el job que supere cualquiera de los dos topes y lo anota (motivo visible en el panel y en bitácora).
8. **R8 · Atascos**: jobs `atascado` más allá de un segundo umbral (defecto 20 min sin actividad) se cancelan automáticamente. Los `permiso-colgado` no se cancelan solos: se destacan para que el usuario decida.
9. **R9 · Pausa global**: interruptor persistente (hub) que bloquea el lanzamiento de jobs nuevos (`opencode_fire`/`run` quedan rechazados con mensaje claro) hasta reanudar. No cancela lo que ya corre. Estado visible en panel y barra de estado.
10. **R10 · Parar todo**: acción única que cancela todos los jobs activos (todos los proyectos), activa la pausa global y opcionalmente apaga el servidor OpenCode. Disponible en: panel (botón), CLI `cerebro-parar` y herramienta MCP `parar_trabajos`. Responde en < 5 s y confirma cuántos jobs se pararon.

### C. Panel «La oficina»
11. **R11 · Barra de control** siempre visible: contador de jobs activos, coste acumulado de la sesión, botón rojo **Parar todo** (con confirmación), interruptor **Pausar/Reanudar** y estado del servidor OpenCode (encendido/apagado).
12. **R12 · Parar uno**: cada personaje/job activo tiene botón «Parar» en su ficha (cancela solo ese job; confirmación ligera).
13. **R13 · Coste y tokens por personaje**: la ficha de cada job muestra modelo/variant, duración, coste, tokens entrada/salida y el tope restante (tiempo y USD).
14. **R14 · Sin errores visuales**: estados coherentes (trabajando, esperando, atascado, cancelado por tope, terminado, inactivo); los jobs fantasma no aparecen como personajes activos; el modo demo sigue funcionando.

### D. Resúmenes y logs
15. **R15 · Resumen mejorado**: cada tarjeta/comentario de resumen muestra: tarea, agente, estado, último paso en lenguaje claro, archivos tocados y resultado (si terminó). Textos cortos y legibles, sin volcados crudos.
16. **R16 · Abrir detalle**: al abrir un personaje/job se ve una vista de detalle con: resumen completo, cronología de pasos y herramientas usadas, preguntas/permisos pendientes, diffstat y errores.
17. **R17 · Logs**: el detalle incluye un visor de logs (paginado/recortado, con filtro por tipo: pasos, herramientas, errores) obtenido de un endpoint nuevo del hub (`GET /api/trabajos/:jobId/log`), sin cargar la conversación entera por defecto y con aviso si se recorta. Se puede copiar.
18. **R18 · Seguridad de logs**: el visor oculta valores que parezcan secretos (tokens/claves) y no expone rutas fuera del proyecto.

## Supuestos (cambiables)
- Topes por defecto: 30 min / 1,00 USD por job; atasco 20 min; caducidad de sesión 10 min.
- Hub y Laya siguen vivos al cerrar Claude (decisión del usuario: se apagan solo OpenCode y los trabajos).
- Apagado solo al cerrarse la última sesión de Claude (decisión del usuario).

## Fuera de alcance
- Apagar Docker/hub/panel web al cerrar.
- Streaming en vivo de cada mensaje del agente (el log se consulta bajo demanda).
- Cambios en el modelo o esfuerzo de los agentes.

## Criterios de aceptación
- CA1: abrir Claude + lanzar un job + cerrar la única sesión → 0 jobs activos y ningún proceso `opencode` vivo en < 10 s (probado listando procesos).
- CA2: con dos sesiones abiertas, cerrar una no apaga OpenCode; cerrar la segunda sí. `/clear` no apaga nada.
- CA3: un job que supera el tope (usar tope de prueba bajo) se cancela solo y el panel muestra el motivo.
- CA4: «Parar todo» desde panel, CLI y MCP cancela todos los jobs y activa la pausa; con la pausa activa, `opencode_fire` es rechazado; «Reanudar» lo permite.
- CA5: los jobs fantasma desaparecen del panel tras el arranque/limpieza.
- CA6: la ficha de un job muestra coste, tokens, tope restante y botón Parar; el detalle abre cronología y logs recortados, con secretos ocultos.
- CA7: `cerrar-trabajos.mjs`, `parar-todo.mjs` y `cerebro-parar*` están versionados y cubiertos por instaladores/desinstaladores/verificadores; `scripts/verificar` en verde.
- CA8: el hook de cierre no tarda más de 8 s ni falla con el hub apagado.

## Plan de ejecución (una cadena, dos tramos)
- **Tramo A (backend/cierre, R1–R10, R17 endpoint)**: `implementador` → `testeador` → `revisor`.
- **Tramo B (panel, R11–R18 UI)**: `implementador` → `revisor`, tras cerrar A.
- Antes de lanzar: terminar la revisión pendiente del Tramo A del panel visual y decidir qué hacer con los cambios sin commitear actuales.
