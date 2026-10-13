# 01 · Panel visual del equipo («La oficina»)

## Objetivo
Rehacer el panel del Cerebro Hub (`config/hub/panel/`) para que se entienda de un vistazo cómo trabaja el equipo: una escena animada con personajes (agentes y subagentes) agrupados por proyecto/directorio, que muestra quién está activo ahora, quién delega en quién y en qué estado está cada uno.

## Contexto (reconocimiento)
- Hub: Node ≥22 sin dependencias, ESM `.mjs`, sin punto y coma, comentarios en español. Panel: HTML+CSS+JS vanilla, sin build. Puerto 4597, solo 127.0.0.1.
- Hoy el panel hace polling cada 5 s (`/api/salud`, `/api/organizacion`, `/api/proyectos`, `/api/vigilante`) y no hay SSE.
- Los jobs del MCP (`leerJobs` en `config/hub/lib/opencode.mjs`) traen `agent`, `directory`, `status`, `title`, `updatedAt`. El panel no muestra `agent`.
- Las sesiones de OpenCode (`/session`) traen `directory` y `time.updated`, pero el hub solo devuelve su recuento.
- No hay señal de «Claude Code trabajando ahora»: los hooks actuales son SessionStart, PreCompact y SessionEnd.

## Requisitos

### Backend (hub)
1. **R1 · `GET /api/actividad`**: devuelve la actividad agrupada por proyecto (clave: `directory` normalizado):
   `{ proyectos: [{ ruta, nombre, slug, ultimaActividad, personajes: [{ id, agente, familia, modelo, estado, tarea, desde, origen }], delegaciones: [{ de, a, jobId }] }], generado }`.
   - `estado` ∈ `trabajando | esperando | atascado | terminado | inactivo`.
   - `familia` ∈ `direccion | exploracion | documentacion | verificacion | implementacion | depuracion | revision | pruebas | mecanico`.
   - `origen` ∈ `claude | opencode-job | opencode-sesion`.
2. **R2 · Fuentes de datos**: combinar (a) jobs del MCP (`agent`, `status`), (b) sesiones de OpenCode con `time.updated` < 5 min (ampliar `opencode.mjs` para exponer la lista), (c) latidos de Claude (R3). Mapeo de estado: `running|accepted` → trabajando; `input_required` → esperando; vigilante marca atasco → atascado; `completed` reciente (<2 min) → terminado; el resto, inactivo y fuera de la escena.
3. **R3 · Latidos de Claude**: nuevo `POST /api/latido` `{ cwd, sesion, evento, agente?, tarea? }` y nuevo hook `config/hooks/latido.mjs`, registrado desde `settings-merge.mjs` para los eventos `UserPromptSubmit`, `Stop`, `SubagentStart` y `SubagentStop`. Mantiene un mapa en memoria con caducidad (un latido sin renovar en 3 min pasa a inactivo). El hook debe ser silencioso, con tope de 1 s y no bloquear nunca a Claude si el hub está caído.
4. **R4 · Mapa de familias** `agente → familia/modelo` leído de `organizacion.mjs`; los agentes desconocidos van a una familia genérica sin romper nada.
5. **R5 · Tiempo real**: `GET /api/eventos` (SSE) que emite `actividad` cuando cambia el estado de algún personaje (comprobación cada 2 s en el servidor). El panel usa SSE y cae a polling de 3 s si la conexión falla.
6. **R6 · `GET /api/gasto/equipo`** (o ampliación de `/api/ventana`): reparto por familia/modelo para el gráfico (R12). Si no hay datos reales, devolver vacío, no inventar nada.

### Panel (frontend)
7. **R7 · Vista principal «Oficina»**: una sala por proyecto activo. Cabecera de la sala con nombre, ruta y hora de la última actividad. Selector/pestañas para abrir un solo proyecto a pantalla completa y volver a «todos». Los proyectos sin actividad en 30 min se pliegan.
8. **R8 · Personajes**: cada agente es una figura SVG/CSS hecha a mano (sin imágenes externas ni librerías). Cada familia tiene color, accesorio y silueta propios. Nombre bajo la figura y chip con el modelo.
9. **R9 · Animaciones por estado** (solo CSS/SVG; respetar `prefers-reduced-motion`):
   - trabajando: teclea en su mesa, con puntos de actividad;
   - esperando: levanta la mano con un «?» (permiso o respuesta pendiente);
   - atascado: parpadeo rojo y aviso;
   - terminado: marca de verificación y se atenúa;
   - llegada/salida de personajes con transición suave.
10. **R10 · Globo de tarea**: sobre cada personaje activo, el título corto de la tarea y el tiempo transcurrido. Clic → panel lateral con detalle (jobId, sesión, estado, error si lo hay, enlace a la memoria del proyecto).
11. **R11 · Delegaciones**: líneas animadas entre personajes (p. ej. Cerebro → Implementador) con un paquete que viaja en el sentido del encargo.
12. **R12 · Gráficos**: (a) organigrama del equipo con los agentes de Claude y de OpenCode agrupados por familia, resaltando los activos; (b) barra o donut de reparto por familia/modelo; (c) mantener los datos de gasto y ventana actuales, pero en una pestaña «Datos».
13. **R13 · Cabecera global** con contadores (personajes activos, proyectos activos, alertas) e indicador de conexión (SSE/polling, hub, servidor OpenCode, Laya).
14. **R14 · Estado vacío**: con nada activo, mostrar la oficina vacía con un mensaje claro («Nadie trabajando ahora») y los agentes disponibles en reposo.
15. **R15 · Conservar** la funcionalidad actual (modal de memoria de proyecto, vigilante, triaje, gasto, ventana) dentro de pestañas secundarias: no se pierde nada.
16. **R16 · Visual**: tema oscuro por defecto con claro opcional, tipografía del sistema, responsive (≥ 360 px), contraste AA. Sin dependencias externas ni CDN (funciona sin red).

### Modo demostración
17. **R17 · `?demo=1`**: genera actividad simulada en el cliente (2 proyectos, todos los estados) para ver y probar el panel sin trabajos reales. Debe estar rotulado como demo de forma visible.

## Fuera de alcance
- Cambiar el vigilante, el triaje o la memoria.
- Autenticación o acceso remoto (el hub sigue en 127.0.0.1).
- Controlar o cancelar jobs desde el panel (lectura únicamente).

## Criterios de aceptación
- CA1: con el hub levantado, `GET /api/actividad` responde 200 con el esquema de R1, incluso sin ningún job (`proyectos: []`).
- CA2: un job `running` del MCP en un directorio X aparece como personaje `trabajando` del agente correcto en la sala de X, y pasa a `terminado` y luego desaparece al completarse.
- CA3: un `POST /api/latido` con `SubagentStart` muestra al subagente en la sala del `cwd`; sin renovación, desaparece a los 3 min.
- CA4: si el hub está caído, el hook `latido.mjs` termina en menos de 1 s sin error visible en Claude.
- CA5: `?demo=1` muestra al menos un personaje en cada estado, con animación, y `prefers-reduced-motion` la desactiva.
- CA6: sin red, el panel carga completo (sin recursos externos).
- CA7: las secciones antiguas (memoria, vigilante, triaje, gasto, ventana) siguen funcionando.
- CA8: `scripts/verificar` sigue en verde y se le añaden comprobaciones de `/api/actividad`, `/api/latido` y de que el hook no bloquea.
- CA9: documentación actualizada (`docs/panel.md`, `CHANGELOG.md`; `VERSION` → 0.3.0).

## Plan de ejecución (una sola cadena, 2 tramos)
- **Tramo A · backend** (`implementador`): R1–R6, hook y `settings-merge`. Validación: `testeador` con curl/node contra el hub en un puerto libre (no el 4597 en uso) + `revisor`.
- **Tramo B · frontend** (`implementador`): R7–R17 sobre la API del tramo A. Validación: `testeador` con `?demo=1` y revisión visual en navegador por mí + `revisor`.
- Cada tramo se cierra antes de abrir el siguiente.

## Convenciones a respetar
ESM sin dependencias, sin punto y coma, factorías `crearX({...})`, JSDoc de cabecera, comentarios y UI en español, `try/catch` silencioso en lo no crítico, rutas con `path` y compatibilidad Windows/Linux.
