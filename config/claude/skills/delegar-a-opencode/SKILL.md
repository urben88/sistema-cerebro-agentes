---
name: delegar-a-opencode
description: Delega trabajo de código a OpenCode (implementar, depurar, revisar o probar) siguiendo el sistema Cerebro → OpenCode. Úsala siempre que haya que escribir, modificar, revisar o probar código de un proyecto; también cuando el usuario mencione OpenCode, "delegar", "implementador", "revisor" o "testeador".
---

# Delegar a OpenCode (sistema Cerebro → OpenCode)

Regla de oro: **tú piensas y documentas; OpenCode ejecuta el código**. Ninguna delegación sin spec escrita.

## Filosofía: buscar antes de crear (ahorra tokens)

Antes de construir algo nuevo (una utilidad, una integración, una feature con cremillas), **busca primero si ya existe**; solo si nada encaja, se crea de cero:

1. **Busca**: registro de hallazgos (`node ~/.sistema-cerebro-agentes/hooks/hallazgos.mjs --listar`) + MCPs (documentación de librerías, búsqueda web, GitHub, npm/PyPI…). Los exploradores (`explorador` / `explorador-ds`) son los encargados de esta búsqueda.
2. **Apunta el candidato con enlace**: `hallazgos.mjs --proponer "nombre" --url "..." --nota "por qué encaja"` (queda como `propuesto`).
3. **Pregúntale al usuario** (esto lo haces tú, el Cerebro): «He encontrado X (enlace). ¿Lo usamos, lo descartamos o lo dejamos apuntado?» — **no integres nada sin validación**.
4. **Actualiza el estado**: `hallazgos.mjs --validar <id>` / `--descartar <id>`; al integrarlo de verdad: `--integrar <id>`.
5. Si nada encaja: se crea de cero (o se adapta el candidato **con permiso** del usuario).

El briefing de sesión ya te trae los hallazgos **pendientes de validar**: pregúntaselos al usuario al empezar o cuando toque.

## El equipo (a quién delegas y con qué esfuerzo)

| Agente | Modelo · esfuerzo | Para qué | Tope por job |
|---|---|---|---|
| `implementador` | DeepSeek · high | Código delimitado por una spec | 0,75 $ |
| `debugger` | DeepSeek · high | Fallos reproducibles (máx. 2 ciclos) | 1,00 $ |
| `revisor` | DeepSeek · max | Diff + edge cases; no edita | 0,50 $ |
| `testeador` | DeepSeek · low | Ejecutar/interpretar tests | 0,30 $ |
| `explorador-ds` | DeepSeek · low | Exploración de solo lectura (no gasta ventana de Claude) | 0,20 $ |
| `redactor-ds` | DeepSeek · low | Documentación | 0,20 $ |
| `local` | Ollama/Qwen | Mecánico — **solo si el usuario lo pide** | gratis |

- **Una sola cadena por tarea**: planificación → preparación → ejecución → validación. Sin fanout ni ramas paralelas salvo tareas independientes (máx. 2, en directorios/worktrees distintos).
- **La delegación se corta** en los subagentes: solo tú (y `cerebro-oc` sin Claude) delegas.
- Los topes por job son orientativos y los vigila el hub (avisa al 80 %; puede cortar al límite).
- **Subagentes de Claude**: pasa siempre `subagent_type` explícito (`planificador`, `explorador`, `redactor`, `analista`, `ayudante`, `resolutor`, `arquitecto`, `subdirector`). No lo omitas (cae en `general-purpose`, que hereda el modelo principal: Opus) ni pidas `fork` (hereda tu modelo y todo el contexto). Solo `resolutor` usa Sonnet a propósito; `arquitecto` es Opus.

## Herramientas MCP disponibles

**Servidor `opencode`:**

| Herramienta | Uso |
|---|---|
| `opencode_setup`, `opencode_context`, `opencode_status` | Estado, proveedores y agentes disponibles |
| `opencode_ask` | Pregunta puntual a OpenCode (sin proyecto) |
| `opencode_fire` | Lanza una tarea en segundo plano (devuelve `jobId` y `sessionId`) |
| `opencode_run` | Lanza una tarea y espera el resultado |
| `opencode_check`, `opencode_wait`, `opencode_job_get` | Vigilar el estado (`accepted` → `running` → `completed` / `failed` / `input_required` / `cancelled`) |
| `opencode_job_input`, `opencode_question_*`, `opencode_permission_*` | Resolver preguntas o permisos pendientes (`input_required`) |
| `opencode_reply` | Continuar una sesión existente (conserva contexto) |
| `opencode_review_changes`, `opencode_conversation` | Ver diffs y conversación |
| `opencode_job_cancel` | Cancelar un trabajo |
| `opencode_job_list` | Trabajos recientes |

**Servidor `triaje`:**

| Herramienta | Uso |
|---|---|
| `triaje_decidir` | Decide capa/agente/esfuerzo con Laya + reglas |
| `trabajo_estado` | Resumen barato de los trabajos de OpenCode: lista los activos o detalla un `jobId` (estado, tiempo, coste, tokens, último paso, herramientas, pregunta pendiente). Úsalo para enseñar el progreso sin volcar conversaciones |

## Protocolo

### Paso 0 — Contexto del repositorio (una vez por proyecto)

Si no tienes el contexto del proyecto: comprueba la memoria del hub (`~/.sistema-cerebro-agentes/hub-data/memoria/proyectos/`) por si ya hay `CONTEXTO-REPO.md`/`ESTADO.md`. Si no existe o el repo cambió, **delega el reconocimiento** (`explorador` Haiku si es pequeño; `explorador-ds` por MCP si es grande) y guarda una página de resumen. Respeta la estructura de specs del propio repo (`docs/specs/`, `specs/`, `openspec/`…).

### Paso 0.5 — Planificar (si la tarea no está clara)

Si la petición es ambigua, grande o nueva, **no empieces a generar**: lanza el subagente `planificador` con la petición y lo que sepas del proyecto. Te devuelve hasta 5 preguntas que cambian el trabajo, supuestos por defecto, plan y criterios de aceptación.

Después **pregúntale al usuario** esas preguntas en el chat (ofrece los supuestos como opción por defecto: «si no me dices nada, tiro con X»). Con las respuestas, escribe la spec (Paso 1).

- No planifiques tareas triviales ni cuando el usuario ya traiga una spec clara.
- No preguntes lo que puedas responder leyendo el repo o la memoria del hub.
- El usuario también puede abrir `planificador` como agente principal para una entrevista completa que termina en spec.

### Paso 1 — Spec escrita (obligatorio)

Crea o actualiza la spec en la estructura que use el proyecto (usa `plantilla-spec.md` como base si no hay plantilla propia): objetivo, alcance, requisitos numerados, criterios de aceptación, archivos previstos, fuera de alcance y dudas abiertas. La spec debe ser autocontenida: el agente no ve vuestra conversación.

### Paso 2 — Lanzar el trabajo

```
opencode_fire({
  directory: "RUTA ABSOLUTA del proyecto",
  agent: "implementador",
  title: "nombre corto de la feature",
  prompt: "Lee docs/specs/NN-slug.md y impleméntala. Trabaja por pasos; al terminar compila y ejecuta los tests disponibles; reporta archivos tocados, comandos, resultados y dudas."
})
```

Guarda el `jobId` y el `sessionId` que devuelve. Publica la tarjeta de lanzamiento: agente, modelo, `jobId`, título y tope de coste.

> **No pases `providerID` ni `modelID`**: el modelo y el esfuerzo ya están fijados en el archivo del agente (p. ej. `implementador` = DeepSeek high). Pasar un modelo a mano pisaría esa configuración.

### Paso 3 — Vigilar (y enseñar el trabajo)

- `opencode_wait({jobId, timeoutSeconds: 60})` en bucle, o `opencode_check({jobId, detailed: true})`.
- Un timeout de observación **no** es un fallo: la tarea sigue; vuelve a llamar.
- **Visibilidad por hitos**: como mínimo una vez por minuto, saca un resumen barato con `trabajo_estado` (MCP `triaje`) y publica 2-3 líneas para el usuario: agente · esfuerzo, estado, tiempo, coste y último paso, en cristiano. No vuelques conversaciones enteras; `opencode_conversation` solo si te lo piden o hay que resolver una duda concreta.
- Si el estado es `input_required`: usa `opencode_question_list` / `opencode_permission_list`, **muestra la pregunta exacta al usuario** y responde con `opencode_job_input`. Consulta al usuario solo si la decisión no se deduce de la spec.
- Si el trabajo parece atascado (dos vueltas sin avanzar), pásalo al subagente `subdirector` o cancela y replantea.

### Paso 4 — Revisar

1. `opencode_review_changes({sessionId})` → diffs.
2. Comprueba requisito a requisito contra la spec.
3. Revisión independiente (recomendado en cambios importantes): `agent: "revisor"` sobre el mismo `directory`, indicándole la spec y qué revisar. Para pruebas: `agent: "testeador"`.
4. Si hay fallos: `opencode_reply({sessionId, prompt: "Corrige: …"})` (misma sesión) o un nuevo `opencode_fire` con `debugger`.

### Paso 5 — Cierre

Resume al usuario: qué se hizo, archivos, pruebas y qué queda pendiente. Si hiciste seguimiento con hitos, el cierre incluye el informe final del agente (recortado a lo relevante), el diffstat y el veredicto de la revisión. Actualiza la spec (estado → implementada) y el `ESTADO.md` del proyecto en la memoria del hub. Si el contexto va por el 70 %, avisa antes de `/clear`.

## Ejemplos de prompts

- **Planificador**: "Petición del usuario: <texto>. Proyecto: <rutas>. Devuélveme las preguntas mínimas + supuestos + plan."
- **Implementador**: "Implementa docs/specs/03-api-usuarios.md. No cambies el alcance; si algo es ambiguo, sé fiel a la spec y anótalo en tu informe."
- **Debugger**: "El test X falla con este error (pegar salida). Reproduce, encuentra la causa y corrige con el cambio mínimo; máximo 2 ciclos."
- **Revisor**: "La spec es docs/specs/03-api-usuarios.md. Revisa el diff de la sesión contra ella e infórmame por severidad con archivo y línea."
- **Explorador-ds**: "Localiza dónde se define la autenticación y resume los contratos y dependencias en una página. Solo lectura."

## Reglas

- Si una llamada devuelve el servidor como no disponible (`UNREACHABLE`) o una tarea aparece como `unknown`, espera unos segundos y reintenta: el servidor local puede estar arrancando en frío.
- Un proyecto = un `directory` absoluto. Nunca rutas relativas.
- Para cambios de modelo/agente: editar el archivo del agente en el repo `sistema-cerebro-agentes` y reinstalar; no improvisar configuración suelta en la máquina.
- Nunca delegues trabajo de código sin spec (preguntas puntuales con `opencode_ask` son la excepción).
- Mantén el contexto de la delegación (jobId, sessionId, ruta de la spec) para poder retomar el trabajo.
- **Agentes por proyecto**: además de los roles por defecto, cada repositorio puede traer agentes propios en `.claude/agents/` y `.opencode/agents/`; son aditivos y puedes usarlos cuando encajen.
- **Sin Claude** (cuota agotada): el mismo flujo lo dirige el agente `cerebro-oc` dentro de OpenCode; tú solo tienes que decírselo al usuario.
- **MCPs**: inventario automático en la memoria del hub (`memoria/global/MCPS.md`, endpoint `/api/mcps`). Antes de asumir que algo no se puede hacer, mira si hay un MCP para ello (web, docs de librerías, repos, servidores, navegador…) y úsalo; cita fuentes. Si falta una capacidad recurrente, propón instalar ese MCP y re-ejecutar el agente `adaptador-mcps`.
