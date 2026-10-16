# Spec 15 · Opus dirige el equipo y lo mejor de `configurar-claude.ps1`

## Objetivo
Mezclar los cuatro niveles del equipo — **Opus 5.5 · Sonnet · Haiku · OpenCode** — y traer al sistema las buenas ideas del script `configurar-claude.ps1` (equipo Opus → `coder` Sonnet → `explorer`/`helper` Haiku), adaptadas al hub, a la memoria y a los dos modos que ya existen.

## Decisiones del usuario (2026-10-15)
- Opus 5.5 dirige **en los dos modos** (normal y cerebro).
- Sin indicación, se trabaja en **PLAN** salvo lo trivial.
- Se copian: avisos de contexto en consola, nota de última sesión con Haiku, carga mental y estilo, agente ayudante (Haiku) y límites en los agentes.

## Reparto nuevo
| Nivel | Quién | Modelo · esfuerzo | Función |
|---|---|---|---|
| 1 | Sesión principal / `cerebro` | **Opus 5.5** · medium | Analiza, decide **dónde** profundizar, orquesta y revisa |
| 1 | `arquitecto` | **Opus 5.5** · high | Decisiones globales difíciles con contexto aislado |
| 2 | `resolutor` (nuevo) | Sonnet · high | Decide **cómo** dentro de un área acotada. Modo normal: resuelve. Cerebro: solo si OpenCode falla dos veces |
| 3 | `explorador`, `redactor`, `analista`, `planificador`, `subdirector` | Haiku | Lo ligero |
| 3 | `ayudante` (nuevo) | Haiku · low | Cambios ya decididos con instrucciones exactas |
| 4 | OpenCode (`implementador`, `debugger`, `revisor`, `testeador`…) | DeepSeek | El código en modo cerebro |

Regla de coste: el agente más barato que pueda hacer la tarea. Haiku por defecto → Sonnet si hace falta criterio → Opus solo para analizar y decidir lo global.

## Requisitos
- **O1 · Modelos.** `cerebro` y `arquitecto` con `model: opus`. Agentes nuevos `resolutor` (Sonnet · high) y `ayudante` (Haiku · low). Todos los subagentes con `maxTurns`, `color` y `disallowedTools: Agent` (la delegación se corta en ellos). `settings-merge.mjs` deja `model: "opus"` y `effortLevel: medium` para `claude-opus-5-5` solo si faltan.
- **O2 · Triaje.** En modo normal (`solo_claude`), `triaje_decidir` manda implementar/depurar al `resolutor` (Sonnet), lo mecánico al `ayudante` (Haiku) y lo delicado al `arquitecto` (Opus). «Hazlo tú» queda para lo trivial y lo global. El mod fija también el modelo de los agentes nuevos.
- **O3 · PLAN / EJECUTAR.** «plan/planifica/propón» → investiga y propone sin cambiar nada; «ejecuta/hazlo/aplica» → resuelve y verifica. Sin indicación: PLAN, salvo cambios triviales o preguntas rápidas. El modo se indica en cada encargo al `resolutor`; el `ayudante` solo en EJECUTAR. En el cerebro, PLAN = spec propuesta sin delegar código.
- **O4 · Avisos en consola.** `aviso-contexto.mjs` mide **tokens reales** (uso de la última respuesta del hilo principal) en lugar de MB, avisa al pasar de 100k y cada +50k (`CONTEXTO_AVISO`, `CONTEXTO_PASO`), sin repetir nivel, y además de avisar al modelo (`additionalContext`) **lo muestra al usuario** en la consola (`systemMessage`).
- **O5 · Nota de última sesión.** Al cerrar la sesión o hacer `/clear`, `session-end.mjs` lanza en segundo plano `resumir-sesion.mjs`, que resume con Haiku (`claude -p --model haiku`) en ≤ 5 líneas y escribe `hub-data/memoria/ultima-sesion/<proyecto>.md`. Sesiones triviales (< 2 mensajes del usuario) no pisan la nota. `session-start.mjs` la inyecta (espera hasta 60 s si el resumen sigue en curso). Sin bucles (`ULTIMA_SESION_RESUMIENDO`).
- **O6 · Carga mental y estilo.** En `CLAUDE.md`: nota «🧠 Merece que lo mires tú» solo cuando aporte, el porqué de las decisiones en 1–2 líneas, puntos de control en sesiones largas, «sin avisos» la desactiva; estilo por defecto (docs breves, nombres claros) salvo convenciones del repo.
- **O8 · Barra de estado con claude-hud** (validado por el usuario el 2026-10-15: primero se probó ccstatusline y no gustó; se elige la más recomendada, claude-hud, ~19,6k estrellas). El instalador añade el plugin y `settings-merge.mjs` apunta la barra a `hub/hud.mjs` (`hud.cmd` con Git Bash): lanza la versión más nueva de claude-hud y añade la línea del sistema con `--extra-cmd` → `estado-linea.mjs --widget` (modo y OpenCode, ≤ 50 caracteres; JSON de Claude por `CEREBRO_BARRA_DATOS`). Config inicial de claude-hud solo si no existe (herramientas, subagentes, tareas, coste, duración, esfuerzo). Sin plugin o con `SIN_CLAUDE_HUD=1`, indicador propio. El desinstalador retira la barra si es la nuestra.
- **O7 · Docs y pruebas.** README, `docs/` (arquitectura, uso diario, ventanas), decisión nueva, CHANGELOG 0.9.0 + `VERSION`. Prueba de `aviso-contexto` y del triaje en modo normal.

## Criterios de aceptación
1. `claude --agent cerebro` corre en Opus; el `arquitecto` también; los Haiku siguen en Haiku.
2. `triaje_decidir {solo_claude:true}` con «implementa X» devuelve `resolutor · sonnet · high`; con «renombra X» devuelve `ayudante · haiku · low`.
3. Con un transcript de >100k tokens, el hook devuelve `systemMessage` y `additionalContext`, y no repite el aviso en el mismo nivel.
4. Tras `/clear` con una sesión real, la siguiente sesión muestra la nota de última sesión.
5. `scripts/verificar` pasa.
6. Con claude-hud instalado, la barra muestra sus líneas y la del sistema (modo y OpenCode); una config de claude-hud propia no se pisa.

## Fuera de alcance
- Cambiar los agentes de OpenCode o Laya (el catálogo de Laya no cambia; la traducción a Claude se hace en el MCP).
