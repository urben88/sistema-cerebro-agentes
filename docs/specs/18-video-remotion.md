# Spec 18 (vídeo) · Vídeo Remotion «un día de trabajo»

Estado: **implementada** (2026-10-16; revisor: apto). Pendiente de confirmar `OPUS_FACTOR`. Sub-spec del punto 4 de `docs/specs/18-documentacion-y-video.md`. Solo el vídeo: no tocar README, GIFs VHS ni otros archivos del repo fuera de lo listado.

## Objetivo
Vídeo animado de ~75 s, sin voz, con subtítulos grandes, que explica por qué usar el sistema: Opus decide, agentes baratos ejecutan, y el gasto real de un día.

## Requisitos
1. Proyecto Remotion (TypeScript, React) en `docs/media/src/video/` con su propio `package.json` (dependencias `remotion`, `@remotion/cli` y lo mínimo necesario; versiones exactas fijadas, sin `^`). `node_modules/` y la caché de Remotion no se versionan (`.gitignore` local en esa carpeta).
2. Formato: 1920×1080, 30 fps, 2250 frames (75 s). Salida H.264 `.mp4`, ≤ 10 MB.
3. Dos composiciones con el mismo componente y textos distintos: `DemoEN` (inglés) y `DemoES` (español). Todos los textos en un solo archivo `src/textos.ts` (objeto `en` / `es`). Todas las cifras en `src/datos.ts`, cada una con un comentario de su fuente.
4. Scripts npm en esa carpeta:
   - `npm run render` → genera `../../demo.mp4` (EN) y `../../demo.es.mp4` (ES), es decir `docs/media/demo.mp4` y `docs/media/demo.es.mp4`.
   - `npm run poster` → `docs/media/demo-poster.png` (un frame de la escena 4 de `DemoEN`, con `npx remotion still`).
   - `npm run preview` → `remotion studio`.
5. Estilo: fondo oscuro (#0d1117 o similar), tipografía sans del sistema (sin descargar fuentes), acento por modelo: Opus morado, Sonnet naranja, Haiku verde, DeepSeek azul. Subtítulo en la franja inferior, ≥ 56 px, alto contraste, uno por escena o cambio de idea. Animaciones con `interpolate`/`spring` de Remotion; nada de vídeo ni imágenes externas, sin audio.
6. Nada personal: sin rutas de usuario, emails, nombres de proyectos privados ni claves.

## Guion (frames a 30 fps)
| # | Escena | Frames | Archivo | Visual | Subtítulo EN / ES |
|---|---|---|---|---|---|
| 1 | Problema | 0–360 | `src/escenas/Problema.tsx` | Barra de cuota que se llena hasta 100 % en rojo + contador de coste subiendo | "Using the top model for everything is expensive…" → "…and your quota runs out mid-day." / "Usar el modelo top para todo es caro…" → "…y la cuota se agota a media jornada." |
| 2 | La idea | 360–810 | `src/escenas/Idea.tsx` | 4 niveles que aparecen de arriba abajo: **Opus** decide · **Sonnet** resuelve un área · **Haiku** busca, redacta y verifica · **DeepSeek** escribe el código | "One brain decides. Cheaper agents do the work." / "Un cerebro decide. Agentes más baratos hacen el trabajo." |
| 3 | Un día de trabajo | 810–1650 | `src/escenas/Dia.tsx` | 5 filas que entran una a una (tarea → agente → coste) y un total acumulado que sube con cada fila | "A real day of work, task by task." / "Un día real de trabajo, tarea a tarea." |
| 4 | Resultado | 1650–2010 | `src/escenas/Resultado.tsx` | Dos barras: «This team» (real) vs «Opus for everything» (marcada *estimate*/*estimación*) | "$1.94 for the whole day." / "1,94 $ por todo el día." |
| 5 | Instalar | 2010–2250 | `src/escenas/Instalar.tsx` | Terminal con `git clone https://github.com/urben88/sistema-cerebro-agentes.git` y `powershell -ExecutionPolicy Bypass -File .\install.ps1` (y debajo `bash install.sh`) | "Install it in one command." / "Instálalo con un comando." |

Transiciones: fundido corto (~10 frames) entre escenas, usando `<Sequence>` o `<Series>`.

## Cifras (reales, métricas del hub, 2026-10-15/16, 38 jobs DeepSeek con coste)
Fuente: `GET /api/metricas` del hub, eventos `tipo: job`. Copiarlas tal cual en `src/datos.ts`.
| Tarea (EN / ES) | Agente | Jobs | Coste $ |
|---|---|---|---|
| Explore a repo / Explorar un repo | explorador-ds | 1 | 0.04 |
| Write the docs / Escribir la documentación | redactor-ds | 1 | 0.03 |
| Ship features & fixes / Features y arreglos | implementador | 23 | 1.59 |
| Review every change / Revisar cada cambio | revisor | 11 | 0.27 |
| Run the tests / Pasar los tests | testeador | 1 | 0.01 |
| **Total del día** (incl. 0.005 de una prueba) | | 38 | **1.94** |

- Nota en pantalla (pequeña, escena 3 y 4): "Real DeepSeek cost from hub metrics. Claude (Opus/Haiku) usage runs on your subscription and is not included." / "Coste real de DeepSeek según las métricas del hub. El uso de Claude (Opus/Haiku) va en tu suscripción y no está incluido."
- Comparación con Opus (escena 4): **estimación**, `OPUS_FACTOR = 30` en `datos.ts` (comentario: «estimación: ratio aproximado de tarifa por token Opus vs DeepSeek; pendiente de confirmar»), mostrado como `≈ $58 (estimate)` / `≈ 58 $ (estimación)`, calculado como total × factor y redondeado.

## Criterios de aceptación
- `npm install` y `npm run render` en `docs/media/src/video/` terminan sin errores y crean `docs/media/demo.mp4` y `docs/media/demo.es.mp4` de 1920×1080, ~75 s, ≤ 10 MB cada uno (comprobar con `ffprobe`).
- `npm run poster` crea `docs/media/demo-poster.png`.
- `npx tsc --noEmit` sin errores.
- Las 5 escenas existen en los archivos de la tabla y siguen el guion.
- Ningún texto contiene datos personales.

## Supuestos (tomados por el cerebro)
- Idioma: EN principal (como el README) + versión ES del mismo componente.
- Duración 75 s (la spec madre pide 60–90 s).
- `scripts/media.ps1` queda para la parte de GIFs; por ahora el vídeo se regenera con `npm run render` en su carpeta.
- El factor Opus×30 es una estimación marcada; el usuario debe confirmarlo.

## Fuera de alcance
README, README.es.md, tapes VHS, GIF del panel, `scripts/media.ps1`, `docs/media/README.md`.
