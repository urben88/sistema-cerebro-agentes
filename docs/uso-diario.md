# Uso diario

## Lo básico

1. Abre **Claude Code dentro de la carpeta del proyecto** (`cd mi-proyecto && claude`).
2. Pide lo que quieras en lenguaje natural.
3. El Cerebro investigará, escribirá la especificación en `docs/specs/`, delegará el código a OpenCode y vigilará el trabajo.
4. Al terminar, te dará un resumen: qué se hizo, qué archivos cambiaron, qué pruebas se ejecutaron y qué queda pendiente.

Tú no tienes que invocar el MCP a mano: la skill `delegar-a-opencode` hace que Claude sepa cuándo y cómo delegar.

## Ejemplo completo

**Tú:**
> Añade un endpoint POST /api/tareas que cree una tarea con título y descripción, con validación y tests.

**Qué pasa por debajo:**

1. El Cerebro explora el proyecto, decide el diseño y escribe `docs/specs/01-api-tareas.md`.
2. Lanza el trabajo:

```
opencode_fire({
  directory: "C:\\dev\\mi-proyecto",
  agent: "implementador",
  title: "endpoint POST /api/tareas",
  prompt: "Lee docs/specs/01-api-tareas.md y impleméntala. Trabaja por pasos; al terminar compila y ejecuta los tests disponibles; reporta archivos tocados, comandos, resultados y dudas."
})
```

3. Vigila con `opencode_wait` hasta que termine.
4. Revisa con `opencode_review_changes` y, si el cambio es importante, lanza al `revisor` y al `testeador`.
5. Si hay fallos: `opencode_reply` en la misma sesión («Corrige: …») y vuelve a vigilar.
6. Te resume el resultado.

## Consejos

- **Specs claras = código bueno.** Cuanto mejor sea la spec (requisitos numerados, criterios de aceptación), menos iteraciones necesitarás. El Cerebro las escribe, pero revísalas si algo no te cuadra.
- **Proyectos por carpeta.** Un proyecto = un `directory` absoluto. Abre Claude Code en la carpeta correcta.
- **Trabajos largos:** puedes seguir hablando con el Cerebro mientras OpenCode trabaja; el `jobId` mantiene la referencia.
- **Paralelizar:** para dos tareas independientes del mismo repo, mejor una después de otra o en worktrees/ramas separadas (dos sesiones que tocan los mismos archivos se pisan).
- **Costes:** Claude (suscripción) piensa; OpenCode gasta tokens baratos. Si quieres abaratar más, el `constructor` ya delega los pasos mecánicos a tu modelo local gratis (`chat-local`).
- **Ver estado sin Claude:** `scripts/verificar.ps1` / `verificar.sh`.

## Cambiar el modelo de un agente

Edita `config/opencode/agents/<agente>.md` en el repo, en la línea `model:`, y despliega:

```powershell
git add -A; git commit -m "agente: cambio de modelo"; git push
.\scripts\actualizar.ps1
```

Ejemplo — activar GPT-6 Luna en el revisor (requiere crédito en OpenRouter):

```yaml
model: openrouter/openai/gpt-6-luna
```

Modelos relevantes (a fecha de v0.1.0):

| Modelo | ID en OpenCode | Requisito |
|---|---|---|
| DeepSeek V4.1 Flash (oficial, por defecto) | `deepseek/deepseek-flash` | Cuenta DeepSeek conectada |
| DeepSeek V4 Pro (oficial) | `deepseek/deepseek-v4-pro` | Cuenta DeepSeek conectada |
| DeepSeek V4.1 Flash (OpenRouter) | `openrouter/deepseek/deepseek-v4.1-flash` | OpenRouter con crédito |
| GPT-6 Luna (OpenRouter) | `openrouter/openai/gpt-6-luna` | OpenRouter con crédito |

> Si las peticiones fallan con «requires more credits, or fewer max_tokens», la cuenta de OpenRouter no tiene crédito suficiente: recarga o vuelve al modelo oficial.

## Añadir un agente nuevo

1. Crea `config/opencode/agents/<nombre>.md` (copia la estructura de `implementador.md`: frontmatter `description`, `mode`, `model`, y el prompt en el cuerpo). **No uses nombres que sean propiedades reservadas de JavaScript** (`constructor`, `hasOwnProperty`, `toString`…): rompen el servidor V1.
2. `git add`, `commit`, `push`.
3. Despliega en cada máquina (`scripts/actualizar`).
4. Documenta el cambio en `CHANGELOG.md` y, si hace falta, en `docs/uso-diario.md`.
