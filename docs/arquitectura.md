# Arquitectura

## Visión general

Dos capas con un puente MCP local:

```
 Tú
  │  (lenguaje natural: "añade X", "corrige Y", "crea Z")
  ▼
┌──────────────────────────────────────────────────┐
│ 🧠 Claude Code — CEREBRO                         │
│   · investiga, decide, documenta                 │
│   · escribe docs/specs/NN-feature.md             │
│   · vigila y revisa el trabajo de las manos      │
│   · herramientas MCP: opencode_*                 │
└──────────────────────┬───────────────────────────┘
                       │ MCP (stdio, local, npx)
                       ▼
┌──────────────────────────────────────────────────┐
│ 🔌 opencode-mcp  (servidor MCP)                  │
│   · traduce las llamadas a la API HTTP de        │
│     OpenCode                                     │
│   · AUTO_SERVE: arranca OpenCode solo cuando     │
│     hace falta (sin pasos manuales)              │
└──────────────────────┬───────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────┐
│ 🤖 OpenCode — MANOS                              │
│   agentes: constructor · revisor · testeador     │
│   modelos: DeepSeek V4.1 Flash (OpenRouter)      │
│            GPT-6 Luna disponible (1 línea)       │
└──────────────────────────────────────────────────┘
```

## Responsabilidades

| Capa | Hace | No hace |
|---|---|---|
| Cerebro (Claude Code) | Analizar, decidir, escribir specs y documentación, delegar, revisar resultados, hablar contigo | Escribir código de producción (salvo petición explícita o cambios triviales) |
| Manos (OpenCode) | Implementar specs, compilar, ejecutar tests, revisar diffs, escribir pruebas | Decidir el diseño o cambiar el alcance |

## Componentes desplegados

| Componente | Dónde vive | Lo despliega |
|---|---|---|
| MCP `opencode` (registro en Claude Code, scope usuario) | Configuración de Claude Code | `install.ps1` / `install.sh` |
| Rol Cerebro | `~/.claude/CLAUDE.md` (bloque gestionado entre marcadores) | `install.ps1` / `install.sh` |
| Skill `delegar-a-opencode` | `~/.claude/skills/delegar-a-opencode/` | `install.ps1` / `install.sh` |
| Agentes `constructor`, `revisor`, `testeador` | `~/.config/opencode/agents/` | `install.ps1` / `install.sh` |

## Flujo de una tarea

1. **Spec** — El Cerebro escribe `docs/specs/NN-feature.md` en el proyecto (objetivo, requisitos, criterios de aceptación).
2. **Delegación** — `opencode_fire({directory, agent: "constructor", prompt: "...spec..."})` → devuelve `jobId` + `sessionId`.
3. **Vigilancia** — `opencode_wait` / `opencode_check` hasta `completed` (o `failed` / `input_required`).
4. **Requisitos de entrada** — Si OpenCode pide permisos o pregunta, el Cerebro responde con `opencode_job_input` (o consulta al usuario si es una decisión de producto).
5. **Revisión** — `opencode_review_changes` (diffs) y verificación contra la spec; revisiones independientes con `agent: "revisor"` y pruebas con `agent: "testeador"`.
6. **Iteración** — Correcciones con `opencode_reply` (misma sesión) o nuevos `opencode_fire`.
7. **Cierre** — El Cerebro resume al usuario y actualiza la spec/documentación.

## Ciclo de vida del servidor OpenCode

- El MCP arranca con Claude Code (proceso hijo, stdio).
- Con `OPENCODE_AUTO_SERVE=true`, el MCP levanta un servidor OpenCode local **solo cuando se necesita** y lo apaga al desconectarse.
- La TUI de OpenCode usa su propio servicio en segundo plano; ambos conviven, pero si algún día notas conflictos por uso intensivo simultáneo (dos servidores compartiendo almacenamiento), la alternativa es un único servidor persistente (`opencode serve` + `OPENCODE_BASE_URL`). No es necesario hoy.

## Evolución del sistema

El repositorio `sistema-cerebro-agentes` es la fuente de verdad. Los cambios se hacen en `config/`, se versionan (`VERSION`, `CHANGELOG.md`, tags) y se despliegan con el instalador en cada máquina. Las decisiones y su contexto están en [contexto-y-decisiones.md](contexto-y-decisiones.md).
