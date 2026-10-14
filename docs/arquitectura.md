# Arquitectura

## Visión general (v0.2.0)

Dos puertas de entrada, un hub común y una capa de ejecución barata:

```
 Tú
  │
  ├──── PUERTA 1 · con Claude (suscripción que se estira) ──────────────────────────┐
  │     Claude Code → agente `cerebro` (Sonnet · medium; `arquitecto` para lo duro) │
  │       · subagentes Haiku: planificador · explorador · redactor · analista ·     │
│         subdirector (y arquitecto Sonnet para lo duro)                         │
  │       · MCP `opencode` → código en DeepSeek   · MCP `triaje` → ¿quién y cuánto? │
  │       · hooks → briefing, checkpoints, /clear sin pérdidas                      │
  │                                                                                 │
  └──── PUERTA 2 · sin Claude (cuota agotada) ──────────────────────────────────────┤
        OpenCode TUI → `cerebro-oc` (DeepSeek · max): specs y delegación en el resto │
                                                                                    ▼
┌─────────────────────────── CEREBRO HUB (app local, Docker) ────────────────────────┐
│  hub (Node sin deps, 127.0.0.1:4597)          laya (modelo local de decisiones)     │
│   · memoria compartida FUERA de los repos      · decide agente/esfuerzo/escalar     │
│   · briefing de sesión · vigilante             · confianza calibrada; si duda,      │
│   · organización · gasto · ventana Claude        mandan las reglas (conf < 0,60)    │
└───────────────┬─────────────────────────────────────────────────────────────────────┘
                │ (nativo, en el host: trabaja sobre tus carpetas)
                ▼
        opencode-mcp → servidor OpenCode V1 → agentes DeepSeek por esfuerzo:
        planificador · implementador · debugger · revisor · testeador ·
        explorador-ds · redactor-ds · local
```

## Responsabilidades

| Capa | Hace | No hace |
|---|---|---|
| Cerebro (Claude Code) | Decidir, especificar, revisar, conversar | Escribir código de producción salvo petición explícita |
| Hub | Memoria, contexto, vigilancia, triaje, panel | Tocar tus repositorios |
| Manos (OpenCode) | Implementar, depurar, probar, revisar por céntimos | Decidir el diseño o cambiar el alcance |

**Principio de capas**: la herramienta (reparto, esfuerzos, topes, contexto) es genérica; **el repositorio manda** sus indicaciones (CLAUDE.md/AGENTS.md, specs, convenciones). El reconocimiento las lee una vez y las resume fuera del repo.

## Componentes desplegados

| Componente | Dónde vive | Lo despliega |
|---|---|---|
| Agentes de OpenCode (9, por esfuerzo) | `~/.config/opencode/agents/` | `install.ps1` / `install.sh` |
| Agente `cerebro` + 7 subagentes (MCPs inline) | `~/.claude/agents/` | ídem |
| Barra de estado de Claude (modelo · contexto · trabajo OpenCode) | `~/.sistema-cerebro-agentes/hub/estado-linea.mjs` + `settings.json` | ídem |
| Rol Cerebro + skill `delegar-a-opencode` | `~/.claude/CLAUDE.md` (bloque) y `~/.claude/skills/` | ídem |
| Hooks de contexto + CLI `estado` | `~/.sistema-cerebro-agentes/hooks/` | ídem |
| Cerebro Hub (app + panel) | `~/.sistema-cerebro-agentes/hub/` (nativo) o contenedor `cerebro-hub` | ídem |
| Laya | contenedor `cerebro-laya` (volumen de modelos) | ídem |
| Memoria y logs del hub | `~/.sistema-cerebro-agentes/hub-data/` | se crea sola |
| Servidor OpenCode V1 + lanzador del MCP | `~/.sistema-cerebro-agentes/server/` y `launcher.*` | ídem |

## Flujo de una tarea (con Claude)

1. **Briefing** (hook al abrir) → el cerebro ya sabe en qué proyecto está y qué había pendiente.
2. **Planificación (si la tarea es ambigua o grande)**: el subagente `planificador` saca las preguntas mínimas (máx. 5) + supuestos + plan; el Cerebro te las pregunta antes de generar nada.
3. **Spec** en la estructura del repo; el reconocimiento del proyecto se delega una sola vez.
4. **Cadena única**: preparación (Haiku o `explorador-ds`) → ejecución (`implementador`/`debugger`) → validación (`testeador`/`revisor`).
5. **Triaje**: si hay duda de a quién mandar algo, Laya decide (con reglas de respaldo); queda registrado.
6. **Vigilancia y visibilidad**: el hub avisa de atascos; el Cerebro te enseña hitos del job con `trabajo_estado` (estado, tiempo, coste, último paso) y la barra de estado de Claude muestra el trabajo en curso; el `subdirector` (Haiku) puede revisar extractos y cancelar/redirigir.
7. **Cierre**: veredicto del `revisor` contra la spec, resumen al usuario y `ESTADO.md` al día; al ~70 % de contexto, `/clear` sin pérdidas.

## Ciclo de vida de los servicios

- **OpenCode V1** (MCP): lo asegura el lanzador (`launcher.ps1/sh`) al primer uso; datos aislados en `server-data/`, puerto dinámico desde 4599.
- **Hub y Laya**: contenedores con `restart: unless-stopped`; autoarranque al iniciar sesión (Windows). El hub nativo (`hub.ps1/hub.sh`) sigue disponible como alternativa.
- **Panel antiguo** de actividad: `panel.ps1/h.sh`, puerto 4598. El panel del hub está en 4597.

## Búsqueda (indice.db, /api/buscar, CLI buscar.mjs)

El hub indexa la memoria de proyectos (BITACORA.md troceada por cabeceras, ESTADO.md, CONTEXTO-REPO.md y `checkpoints/`), las decisiones (`logs/decisiones.jsonl`), los hallazgos (`hub-data/hallazgos.jsonl`) y los skills (`config/claude/skills/<nombre>/SKILL.md`) en un índice SQLite FTS5 (`hub-data/indice.db`, `node:sqlite`, sin dependencias). Se reindexa de forma incremental al arrancar y tras cada escritura de memoria, y completo con `node hub.mjs --reindexar`. `GET /api/buscar?q=…&proyecto=…&limite=…&tipo=…` devuelve resultados con `snippet` y proyecto ordenados por `rank`; los agentes lo consultan con `node ~/.sistema-cerebro-agentes/hooks/buscar.mjs "consulta"`. Si `node:sqlite` no existe, no trae FTS5 (o se fuerza con `HUB_BUSCAR_FALLBACK=1`), el hub arranca igual y la búsqueda usa un recorrido lineal sobre los `.md`, sin ranking, indicándolo en la respuesta.

## Evolución

`VERSION`, `CHANGELOG.md` y tags; los cambios se hacen en este repositorio y se despliegan con `scripts/actualizar`. Decisiones y contexto en [contexto-y-decisiones.md](contexto-y-decisiones.md).
