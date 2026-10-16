# Uso diario

## Lo básico

1. Abre **Claude Code dentro de la carpeta del proyecto** (`cd mi-proyecto && claude`).
2. **Activa el Cerebro** (solo cuando quieras el flujo combinado): escribe `cerebro` en la terminal (continúa tu conversación en modo Cerebro), usa `@cerebro` para una tarea suelta, o `claude --agent cerebro` para una sesión nueva. Para volver al modo normal: `claude --continue`.
3. Pide lo que quieras en lenguaje natural.
4. El Cerebro investigará, escribirá la especificación en `docs/specs/`, delegará el código a OpenCode y vigilará el trabajo. Al terminar te dará un resumen.

## Modos PLAN y EJECUTAR

- **PLAN** («plan», «planifica», «propón»…): Claude investiga y te presenta una propuesta. No cambia nada hasta que digas que ejecute.
- **EJECUTAR** («ejecuta», «hazlo», «aplica»…): resuelve y verifica.
- **Sin indicación**: trabaja en PLAN y pregunta si ejecuta. Excepción: cambios triviales o preguntas rápidas.

Si la petición es ambigua o grande, **primero te preguntará**: el `planificador` (Haiku) prepara hasta 5 preguntas que cambian el trabajo, con supuestos por defecto, y el Cerebro te las enseña antes de escribir nada. También puedes abrir el planificador cuando quieras (`@planificador …` en Claude; en OpenCode, cámbialo con Tab).

Fuera del agente `cerebro`, Claude funciona con normalidad y **no tiene** las herramientas de OpenCode (no puede delegar por accidente): el MCP vive dentro del agente.

## Ejemplo completo

**Tú:**
> Añade un endpoint POST /api/tareas que cree una tarea con título y descripción, con validación y tests.

**Qué pasa por debajo:**

1. (Solo si hay dudas) El `planificador` (Haiku) saca las preguntas mínimas + supuestos y el Cerebro te las pregunta antes de generar nada.
2. El Cerebro explora el proyecto, decide el diseño y escribe `docs/specs/01-api-tareas.md`.
3. Lanza el trabajo:

```
opencode_fire({
  directory: "C:\\dev\\mi-proyecto",
  agent: "implementador",
  title: "endpoint POST /api/tareas",
  prompt: "Lee docs/specs/01-api-tareas.md y impleméntala. Trabaja por pasos; al terminar compila y ejecuta los tests disponibles; reporta archivos tocados, comandos, resultados y dudas."
})
```

4. Te cuenta el progreso por hitos (`trabajo_estado`) mientras vigila con `opencode_wait`; la barra de estado muestra el job en curso.
5. Revisa con `opencode_review_changes` y, si el cambio es importante, lanza al `revisor` y al `testeador`.
6. Si hay fallos: `opencode_reply` en la misma sesión («Corrige: …») y vuelve a vigilar.
7. Te resume el resultado (informe final + diffstat + veredicto de la revisión).

## Consejos

- **Specs claras = código bueno.** Cuanto mejor sea la spec (requisitos numerados, criterios de aceptación), menos iteraciones necesitarás. El Cerebro las escribe, pero revísalas si algo no te cuadra.
- **Proyectos por carpeta.** Un proyecto = un `directory` absoluto. Abre Claude Code en la carpeta correcta.
- **Trabajos largos:** puedes seguir hablando con el Cerebro mientras OpenCode trabaja; el `jobId` mantiene la referencia.
- **Paralelizar:** para dos tareas independientes del mismo repo, mejor una después de otra o en worktrees/ramas separadas (dos sesiones que tocan los mismos archivos se pisan).
- **Pregunta antes de generar.** Si algo no está claro, el planificador te sacará las preguntas que de verdad cambian el trabajo; respóndele o deja que tire con los supuestos que te proponga (te los dice antes).
- **Costes.** Claude (suscripción) piensa; OpenCode gasta tokens baratos. La sesión principal y `cerebro` van en **Opus 5.5** (medium). Los subagentes baratos de Claude son **Haiku** (`planificador`, `explorador`, `redactor`, `analista`, `subdirector`, `ayudante`); solo `resolutor` y `retocador` usan Sonnet a propósito; `arquitecto` y `consultor` van en Opus. `local` (Ollama) es gratis y solo se usa si lo pides.
- **Ver estado sin Claude:** `scripts/verificar.ps1` / `verificar.sh`.

## Pararlo todo de golpe

- **Al cerrar el chat** (o hacer `/clear`), el sistema apaga solo los trabajos de OpenCode de ese proyecto: nada sigue gastando tokens en segundo plano. Queda constancia en la bitácora del hub.
- **Botón de pánico** si algo se quedó colgado (o Claude no pudo avisar al cerrarse):

  ```powershell
  cerebro-parar            # cancela TODOS los trabajos activos
  cerebro-parar --seco     # no toca nada: solo dice lo que haría
  cerebro-parar C:\ruta    # solo los de ese proyecto
  ```

  También puedes pedírselo al Cerebro en el chat («para todo»): usa la herramienta `parar_trabajos`.
- Si cierras la ventana a lo bruto (kill/crash), el aviso de cierre no siempre llega: tira de `cerebro-parar`.

## Ver quién hace qué (modelos, esfuerzo y progreso)

**Subagentes de Claude** (`planificador`, `explorador`, `redactor`, `analista`, `subdirector`, `ayudante`, `retocador`, `resolutor`, `consultor`, `arquitecto`):

- **`/tasks`** dentro de Claude Code: lista los subagentes con su **modelo y esfuerzo**; Enter abre su transcript en vivo.
- Mientras corren aparecen en el **panel de subagentes** bajo el prompt; el Cerebro te anuncia al lanzarlos el tipo y su modelo («explorador · Haiku»). Pide el tipo por su nombre (desde v0.3.0 el Cerebro ya lo hace).
- Haiku salvo `resolutor` (Sonnet · medium, high al depurar: resuelve un área acotada), `retocador` (Sonnet · low: cambios pequeños), `consultor` (Opus 5.5 · low: segunda opinión rápida) y `arquitecto` (Opus 5.5 · high: solo para lo difícil).
- Si ves un subagente en Opus sin querer, se lanzó como `general-purpose`/`fork` (heredan el modelo principal).

**Manos de OpenCode** (`implementador`, `debugger`, `revisor`, `testeador`, exploradores…):

- **Barra de estado** de Claude Code, en el proyecto donde trabaja: `🤖 implementador (medium) · 12m · $0.08` (o `⏳ pregunta` si te necesita; `✅/❌` al cerrar).
- **En el chat**: el Cerebro te cuenta hitos cada ~1 min; pregúntale «¿cómo va?» cuando quieras — saca el resumen con `trabajo_estado` (estado, tiempo, coste, tokens, último paso y herramientas usadas).
- **Panel del hub** (`http://127.0.0.1:4597`): «La oficina» y la tarjeta de trabajos en vivo; el vigilante avisa de atascos.

Reparto de esfuerzos en OpenCode: `implementador` **medium**, `debugger` **high** · `revisor` **max** · `testeador` **low** · `explorador-ds`/`redactor-ds` **low** · `planificador` **high** · `cerebro-oc` **max**.

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

### Agentes de un proyecto concreto

Si el agente es solo para un repo, **no lo pongas en el sistema**: créalo dentro del proyecto en `.opencode/agents/` (y `.claude/agents/` para Claude Code), commitéalo con el código y quedará disponible solo ahí. Los roles por defecto siguen siendo globales y están siempre disponibles. Detalles y ejemplos: [agentes-por-proyecto.md](agentes-por-proyecto.md).
