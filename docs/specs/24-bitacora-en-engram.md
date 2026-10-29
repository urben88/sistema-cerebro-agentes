# Spec 24 · Bitácora en Engram

## Objetivo
Cerrar los solapes que dejó la spec 23: con Engram activo, las entradas nuevas de bitácora van a Engram en vez de a `BITACORA.md`, y por eso la compresión con Haiku deja de dispararse. ESTADO.md y CONTEXTO-REPO.md se quedan en el hub. Sin Engram, todo sigue como antes. Rama: `feat/spec25-instalador`. Pruebas: `scripts/test-engram.mjs`. Riesgo: ninguno de la lista (solo cambia el destino de una nota, con respaldo al hub).

## Requisitos
- **S1 · Guardar en Engram.** `config/hooks/engram.mjs` añade `guardarEngram(titulo, contenido, { cwd, tipo })`, que llama a `engram save <título> <contenido> --type <tipo>` en la carpeta del proyecto. Devuelve `true` si sale con 0; un fallo o un timeout devuelven `false` y nunca lanzan.
- **S2 · `estado.mjs --bitacora` usa Engram.** Con Engram activo, la entrada se guarda en Engram (tipo `manual`) y el CLI dice «Entrada guardada en Engram.». Si Engram falla, va al hub como siempre. Sin Engram, igual que hoy («Entrada añadida a la bitácora.»).
- **S3 · Cierre de sesión.** `cerrar-trabajos.mjs` anota los trabajos cancelados en Engram cuando está activo; si falla, en el hub, como hoy.
- **S4 · Sin compresión Haiku duplicada.** Con S2 y S3, las notas nuevas ya no crecen `BITACORA.md`, así que la compresión automática del hub no se dispara. No cambia el código del hub: la compresión manual y las notas internas del hub (trabajos `desconocido`) siguen.
- **S5 · Búsqueda.** `buscar` ya une hub y Engram (spec 23 · S4): las entradas nuevas salen como `engram:manual` y la bitácora antigua sigue saliendo del hub. No cambia.
- **S6 · Docs.** `docs/contexto-sesiones.md` y CHANGELOG explican que, con Engram, la bitácora nueva va a Engram.

Fuera de alcance: ESTADO.md, CONTEXTO-REPO.md, el ledger de trabajos (`trabajos.json`), el panel y la bitácora antigua (no se importa).

## Tareas
| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| T1 | S1–S6 | inline | hecho (RED 2 fallos → GREEN) | este commit |

## Log
- **L1 (2026-10-29, usuario):** «haz lo que queda y cuando termines sube cambios»
- **L2 (2026-10-29, usuario):** sobre ESTADO.md y CONTEXTO-REPO.md eligió «Conservar ambos (Recommended)»: solo los puntos 1–3 (bitácora, compresión Haiku y búsqueda) pasan a Engram.
- **L3:** El hub va en Docker y no ve el binario de Engram; por eso el cambio va en los escritores del host (`estado.mjs`, `cerrar-trabajos.mjs`), como en la spec 23. El ledger `trabajos.json` es estado operativo, no bitácora: no se toca.
- **L4:** test-engram 15/15, y test-buscar, test-compresion, test-ledger, test-nudges y test-instalador PASAN. Desplegado con `install.ps1`: solo se actualizan los hooks y `verificar -Smoke` da OK. Spec 25: las preguntas `[s/n/d]` de `install.ps1` e `install.sh`, probadas con respuestas simuladas (inválida, `D`, ` S `, fin de entrada y modo no interactivo), van bien. Sin probar en vivo: un `engram save` real (para no ensuciar la memoria) e `install.sh` completo en Linux/macOS.
