---
name: delegar-a-opencode
description: Delega trabajo de código a OpenCode (implementar, revisar o probar) siguiendo el sistema Cerebro → OpenCode. Úsala siempre que haya que escribir, modificar, revisar o probar código de un proyecto; también cuando el usuario mencione OpenCode, "delegar", "constructor", "revisor" o "testeador".
---

# Delegar a OpenCode (sistema Cerebro → OpenCode)

Regla de oro: **tú piensas y documentas; OpenCode ejecuta el código**. Ninguna delegación sin spec escrita.

## Herramientas MCP disponibles (servidor `opencode`)

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

## Agentes de OpenCode

| Agente | Para qué |
|---|---|
| `constructor` | Implementa la spec (código, build, pruebas básicas) |
| `revisor` | Revisa el diff contra la spec, sin editar archivos |
| `testeador` | Escribe y ejecuta pruebas del cambio |

El modelo de cada agente se configura en `~/.config/opencode/agents/*.md` (repo `sistema-cerebro-agentes`).

## Protocolo

### Paso 1 — Spec escrita (obligatorio)

Crea o actualiza `docs/specs/NN-slug.md` en el proyecto (usa `plantilla-spec.md` como base): objetivo, alcance, requisitos numerados, criterios de aceptación, archivos previstos, fuera de alcance y dudas abiertas. La spec debe ser autocontenida: el constructor no ve vuestra conversación.

### Paso 2 — Lanzar el trabajo

```
opencode_fire({
  directory: "RUTA ABSOLUTA del proyecto",
  agent: "constructor",
  title: "nombre corto de la feature",
  prompt: "Lee docs/specs/NN-slug.md y impleméntala. Trabaja por pasos; al terminar compila y ejecuta los tests disponibles; reporta archivos tocados, comandos, resultados y dudas."
})
```

Guarda el `jobId` y el `sessionId` que devuelve.

### Paso 3 — Vigilar

- `opencode_wait({jobId, timeoutSeconds: 120})` en bucle, o `opencode_check({jobId, detailed: true})`.
- Un timeout de observación **no** es un fallo: la tarea sigue; vuelve a llamar.
- Si el estado es `input_required`: usa `opencode_question_list` / `opencode_permission_list` y responde con `opencode_job_input`. Consulta al usuario solo si la decisión no se deduce de la spec.
- Si el trabajo es largo: informa al usuario del progreso y mantén el `jobId` a mano.

### Paso 4 — Revisar

1. `opencode_review_changes({sessionId})` → diffs.
2. Comprueba requisito a requisito contra la spec.
3. Revisión independiente (recomendado en cambios importantes): lanza otra tarea con `agent: "revisor"` sobre el mismo `directory`, indicándole la spec y qué revisar (commit o diff). Para pruebas: `agent: "testeador"`.
4. Si hay fallos: `opencode_reply({sessionId, prompt: "Corrige: …"})` (misma sesión, conserva contexto) o un nuevo `opencode_fire`.

### Paso 5 — Cierre

Resume al usuario: qué se hizo, archivos, pruebas y qué queda pendiente. Actualiza la spec (estado → `implementada`) o la documentación del proyecto si procede.

## Ejemplos de prompts para las manos

- **Constructor**: "Implementa docs/specs/03-api-usuarios.md. No cambies el alcance; si algo es ambiguo, sé fiel a la spec y anótalo en tu informe."
- **Revisor**: "La spec es docs/specs/03-api-usuarios.md. Revisa el diff de la sesión (git diff) contra ella e infórmame por severidad con archivo y línea."
- **Corrección**: "El revisor detectó: (lista). Corrige exactamente eso y vuelve a ejecutar los tests."

## Reglas

- Un proyecto = un `directory` absoluto. Nunca rutas relativas.
- Para cambios de modelo/proveedor: editar el `model:` del agente en el repo `sistema-cerebro-agentes` y reinstalar; no improvisar configuración suelta en la máquina.
- Nunca delegues trabajo de código sin spec (las preguntas puntuales con `opencode_ask` son la excepción).
- Mantén el contexto de la delegación (jobId, sessionId, ruta de la spec) para poder retomar el trabajo.
