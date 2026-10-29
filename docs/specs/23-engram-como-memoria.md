# Spec 23 · Engram como memoria, junto al hub

## Objetivo
Engram (instalado por Gentle AI) pasa a ser la memoria de decisiones, sesiones y búsqueda. El hub deja de repetir lo que Engram ya hace y sigue con lo suyo: ESTADO.md, contexto del repo, alertas, gasto, aprobaciones y panel. Los dos funcionan a la vez; sin Engram todo sigue como antes. Rama: `feat/spec23-engram`. Pruebas: `scripts/test-engram.mjs` dentro de `verificar`. Riesgo: item 5 (instalador) y item 3 (salida del CLI `buscar`, solo se añade).

## Requisitos
- **S1 · Detección.** Un módulo `config/hooks/engram.mjs` dice si Engram responde (`engram version`) y busca en él (`engram search`). `ENGRAM_BIN` cambia el binario (pruebas) y `ENGRAM_DESACTIVADO=1` lo apaga. Si falla o tarda, se trata como ausente; nunca rompe un hook.
- **S2 · Briefing sin duplicados.** Con Engram, el briefing de `SessionStart` no incluye «Últimos movimientos (bitácora)» ni «Última sesión en este proyecto», porque Engram ya inyecta su contexto de sesiones. Siguen ESTADO.md, contexto del repo, alertas, trabajos y hallazgos. El cierre dice que las decisiones y sesiones van en Engram. Sin Engram, el briefing es el de siempre.
- **S3 · Sin resumen Haiku duplicado.** Con Engram, `SessionEnd` no lanza el resumen de última sesión (spec 15) y `SessionStart` no lo espera. El checkpoint de `/clear` sigue.
- **S4 · `buscar` une las dos memorias.** `node buscar.mjs "consulta"` añade los resultados de Engram (tipo `engram:<tipo>`) a los del hub, con el mismo formato. Si el hub está apagado pero Engram responde, muestra los de Engram y sale con 0. `--tipo engram` busca solo en Engram. Sin Engram, la salida es la de hoy.
- **S5 · Comprobaciones.** `/odd:doctor` añade el punto `engram`: verde si el binario responde y el plugin `engram@engram` está activo en `settings.json`; amarillo si responde pero el plugin no está activo; rojo si no responde. `verificar` comprueba Engram en Claude Code y pasa `test-engram.mjs`.
- **S6 · Instalador.** Tras `gentle-ai install`, `install.ps1` e `install.sh` comprueban que `engram version` responde y, si no, avisan con el arreglo.
- **S7 · Docs.** CLAUDE.md, README, `docs/contexto-sesiones.md` y CHANGELOG explican el reparto: Engram para decisiones, sesiones y búsqueda; el hub para el estado vivo (ESTADO.md) y la operación.

Fuera de alcance: las rutas `/api/memoria/*`, el panel y los datos de `hub-data/memoria` no cambian ni se borran. Importar la bitácora antigua a Engram queda como decisión aparte.

## Tareas
| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| T1 | S1–S4 | inline | pendiente | |
| T2 | S5–S6 | inline | pendiente | |
| T3 | S7 | inline | pendiente | |

## Log
- **L1 (2026-10-29, usuario):** «Vale, pues entonces quiero que esta herramienta y también su instalación aplique engram y también adapte para que se puedan usar los dos a la vez. Es decir, si tengo que recortar cosas del hub porque ya lo hace engram, puedes hacer eso.»
- **L2:** El plugin de Engram ya engancha SessionStart (también tras compactar), UserPromptSubmit, SubagentStop y SessionEnd. Por eso se recortan el bloque de bitácora, la nota de última sesión y el resumen Haiku. PreCompact no lo cubre Engram, así que el checkpoint del hub se queda. Integración en el host (hooks y CLI), no en el servidor del hub: va en Docker y no ve el binario de Engram.
