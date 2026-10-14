# 07 · Mod «mesa de trabajo» (dentro de Claude Code)

## Objetivo
Traer el estado del sistema **dentro de la interfaz de Claude Code**, sin cambiar de ventana: una banda sobre el prompt con lo que está pasando, comandos para consultar y parar, y una garantía de que los subagentes corren con el modelo de su definición.

## Requisitos
1. **R1 · Banda sobre el prompt** (`ui.render` → `AbovePrompt`): muestra hasta 2 trabajos de OpenCode (agente · esfuerzo · duración · coste · título), hasta 2 subagentes de Claude con su **modelo** (Haiku visible) y menos-rol, y el **contexto/ventanas de la sesión** (`$.session.usage()`). Si no hay nada o el hub no responde, no dibuja (devuelve el resultado de `next`). Se redibuja cada 4 s con `$.clock.every` + `$.ui.invalidate`.
2. **R2 · Comandos** (`$.command.register`): `/trabajos` (lista con estado, tiempo, coste, jobId y carpeta; marca «⚠ sin actividad» a los estancados), `/errores` (últimos 10 del registro central) y `/parar-todo` (`immediate`, cancela todos los trabajos vía `POST /api/trabajos/cancelar`) y `/agentes [n]` (subagentes en marcha y su detalle; spec 08 R7).
3. **R3 · Guardián de subagentes** (`agent.spawn`): lee el `model:` de la definición del subagente (proyecto primero, luego `~/.claude/agents`, con respaldo por tabla) y lo **fija** con `next({ ...e, model })`; además registra cada lanzamiento en el hub (`POST /api/log`, origen `mod:mesa-de-trabajo`, severidad info) con el modelo pedido vs. el forzado.
4. **R4 · Carga sin flags**: el instalador copia el mod a `~/.sistema-cerebro-agentes/mods/` y `settings-merge` añade su ruta a `CLAUDE_CODE_PLUGIN_DIRS` (respetando lo que el usuario tenga ahí; el desinstalador lo retira).
5. **R5 · Nunca romper nada**: todos los hooks llevan `try/catch` y `.catch()`; si el hub está apagado, la banda desaparece y los comandos lo dicen; si el guardián falla, el lanzamiento sigue como estaba.

## Fuera de alcance
- Dibujar en la app de escritorio (la banda es solo terminal).
- Sustituir el panel del hub: siguen siendo complementarios (banda = vistazo; panel = detalle).

## Criterios de aceptación
- CA1: `claude plugin validate` pasa y lista los hooks y llamadas esperadas (probado).
- CA2: `claude -p "/trabajos"` y `claude -p "/errores"` imprimen datos reales del hub (probado).
- CA3: un lanzamiento de `explorador` queda registrado como «Subagente explorador → haiku» con `modeloForzado: haiku` (probado, con respuesta real del subagente).
- CA4: `verificar` comprueba el mod instalado y `CLAUDE_CODE_PLUGIN_DIRS`; el desinstalador lo retira limpio.
