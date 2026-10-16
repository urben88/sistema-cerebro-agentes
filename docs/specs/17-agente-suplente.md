# Spec 17 · Agente `suplente` (contesta por el usuario)

Estado: **borrador** (modo PLAN; sin implementar).

## Objetivo
Un agente de OpenCode que **hace el papel del usuario**: contesta las preguntas del orquestador (`cerebro-oc`) para que la tarea siga hasta terminar, sin que el usuario esté delante. Nunca pregunta; solo responde.

## Decisiones del usuario (2026-10-15)
- Se llama **`suplente`**.
- Solo lo activa el usuario. Ningún agente lo conoce, lo llama ni es llamado por él.
- Debe decidir «como el usuario»: necesita contexto propio.

## Supuestos por defecto (pendientes de confirmar)
- Modelo: DeepSeek · max (como `cerebro-oc`).
- Tope: 10 rondas de pregunta/respuesta por tarea.
- El perfil del usuario lo redacta Claude con lo que ya sabe y lo corrige el usuario.

## Cómo funciona
1. El usuario lanza `autopiloto "tarea"` (comando en `~/.local/bin`, como `cerebro`).
2. `hub/autopiloto.mjs` abre una sesión de `cerebro-oc` en el servidor OpenCode V1 y le manda la tarea.
3. Cuando `cerebro-oc` acaba su turno:
   - Con una pregunta marcada (`[PREGUNTA]`) → se la pasa al `suplente` con su contexto y devuelve la respuesta a la misma sesión.
   - Con `[TERMINADO]` → fin.
4. Se repite hasta terminar, llegar al tope o recibir `ESCALAR`.

El bucle vive **fuera** de los agentes. Por eso nadie puede invocar al `suplente`.

## Requisitos
- **S1 · Agente.** `config/opencode/agents/suplente.md` (descripción con el prefijo `★ MÍO ·`, como el resto): oculto (`hidden: true`) y con `permission.task: deny` (no delega) y sin herramientas de escritura. No aparece en el prompt de ningún otro agente.
- **S2 · Contexto.** En cada respuesta lee: `memoria/global/PERFIL.md` (nuevo: prioridades, gustos, estilo, qué aprueba y qué no), `ESTADO.md` y `CONTEXTO-REPO.md` del proyecto, las últimas decisiones de `decisiones.jsonl` y las reglas del sistema (PLAN/EJECUTAR, coste, carga mental).
- **S3 · Formato de respuesta.** Una respuesta directa + `Porqué:` en una línea. O bien `ESCALAR: <motivo>`.
- **S4 · No decide (siempre ESCALAR):** commit, push, borrar archivos o datos, gastar dinero, instalar cosas fuera del repo, cambios de arquitectura o de contratos públicos, comandos `hardline`/`peligroso` del hub, y cualquier duda real.
- **S5 · Límites.** Tope de rondas (`SUPLENTE_MAX_RONDAS`, 10) y de coste por tarea. Si se supera, para y deja el estado.
- **S6 · Marcas en `cerebro-oc`.** Su prompt pide terminar cada turno con `[PREGUNTA] …` o `[TERMINADO]`. No menciona al `suplente`. Sin marca → se trata como pregunta.
- **S7 · Registro.** `hub-data/memoria/proyectos/<proyecto>/suplente.log`: pregunta, respuesta y porqué. Al escalar o terminar, se deja un resumen en la bitácora para que el usuario lo vea al volver.
- **S8 · Instalación.** El instalador copia el agente, el comando y crea `PERFIL.md` solo si no existe. El desinstalador los retira.

## Por investigar
- Si `hidden: true` lo excluye de verdad de la herramienta `task`, o solo del autocompletado `@` (por eso, además, S1 y el bucle externo).
- Cómo detectar fiable el fin de turno con la API del servidor V1 (`/session/:id/message`, estado de la sesión).
- Cómo pasar permisos pendientes (`input_required`) por el clasificador del hub en lugar de al `suplente`.

## Criterios de aceptación
1. `autopiloto "tarea de prueba"` termina sin intervención en una tarea que necesite al menos una pregunta.
2. Una pregunta de commit/borrado provoca `ESCALAR` y el bucle para.
3. Ningún otro agente puede listar ni lanzar al `suplente`.
4. El tope de rondas corta el bucle.
5. `suplente.log` refleja cada ronda.
6. `verificar.ps1` sigue en verde y añade estas comprobaciones.
