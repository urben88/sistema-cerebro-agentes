# Spec 19 · Esfuerzos más bajos y roles `retocador` y `consultor`

## Objetivo
Que cada rol gaste lo justo: bajar los esfuerzos que estaban por encima de lo necesario y añadir dos roles que hoy no existen (uno barato para cambios pequeños y otro para una segunda opinión rápida). El triaje local (**Laya**) debe poder elegir los dos, no solo las palabras clave.

## Decisiones del usuario (2026-10-16)
- Bajar esfuerzos: `resolutor` a **Sonnet · medium** (high al depurar o si es delicado), `implementador` a **DeepSeek · medium**. `debugger` sigue en high; `revisor` sigue en max, pero solo cuando hay código con lógica que revisar.
- `cerebro` sigue en **Opus · medium**; el esfuerzo lo sube el usuario a mano (`/effort high`); el agente no lo sube solo.
- Dos roles nuevos: **`retocador`** (Sonnet · low) y **`consultor`** (Opus · low, solo lectura).
- **Laya debe poder elegirlos.** Hasta ahora su catálogo trata como OpenCode todo lo que no sea `cerebro` o `arquitecto` (la spec 15 lo dejaba expresamente fuera de alcance); esto lo revierte.
- «ajusta» y «retoca» son palabras demasiado comunes: no deben mandar al `retocador` tareas que necesitan el `resolutor`.

## Reparto (cambios)
| Rol | Antes | Ahora |
|---|---|---|
| `resolutor` | Sonnet · high | Sonnet · **medium** (high al depurar o si es delicado) |
| `implementador` | DeepSeek · high | DeepSeek · **medium** |
| `debugger` | DeepSeek · high | sin cambios |
| `revisor` | DeepSeek · max | max, **solo con código con lógica** que revisar |
| `cerebro` | Opus · medium | sin cambios (lo sube el usuario con `/effort high`) |
| `retocador` (nuevo) | — | **Sonnet · low** |
| `consultor` (nuevo) | — | **Opus · low** (solo lectura) |

## Requisitos
- **R1 · Esfuerzos.** En el frontmatter de los agentes (`config/claude/agents/*.md` con `model`/`effort`; `config/opencode/agents/*.md` con `variant`) y en las reglas de `reglas.json`. `reparto-claude.mjs` traduce: `implementador`/`debugger` → `resolutor` (Sonnet) y sube a **high** si el origen es `debugger` o hay `escalar`/`riesgo`.
- **R2 · Roles nuevos.** `retocador` y `consultor` en `config/claude/agents/`, con `maxTurns`, `color` y `disallowedTools: Agent` (no delegan). Registrados en `reparto-claude.mjs` (`CLAUDE_AGENTES` + notas), `CLAUDE.md`, `cerebro.md`, el skill `delegar-a-opencode`, `actividad.mjs` y el panel (familia `direccion` para `consultor`); instaladores (`install.ps1`/`install.sh`) y `verificar.ps1`/`verificar.sh`.
- **R3 · Catálogo de Laya.** `CATALOGO_AGENTES` de `config/hub/lib/triaje.mjs` incluye `retocador` y `consultor`; una lista `AGENTES_CLAUDE` (exportada) fija su capa a **`claude`** (antes estaba escrito a mano: solo `cerebro`/`arquitecto`). El resto del camino (Laya → `aClaude` en el MCP de triaje) no cambia.
- **R4 · Palabras clave.** En `reglas.json`, la regla del `retocador` solo casa si el encargo **dice** que el cambio es pequeño (`cambio pequeño`, `cambio puntual`, `pequeño arreglo/ajuste`, `arreglo/ajuste pequeño`, `un retoque`, `retoca el detalle`). «ajusta»/«retoca» sueltos pasan a la regla de `implementador` (→ `resolutor`, o `local-codigo` si el encargo es acotado); «fallo»/«bug»/«arregla» siguen mandando a `debugger`. La regla de `arquitecto` pasa delante de la de `consultor` (una decisión técnica con «valida la decisión» es del arquitecto, no de una opinión rápida).
- **R5 · Docs y pruebas.** `scripts/test-opus-reparto.mjs` cubre los esfuerzos, los roles nuevos, el catálogo de Laya y los casos de palabras clave; README, `docs/`, CHANGELOG y esta spec.

## Criterios de aceptación
1. `aClaude({agente:'implementador'})` → `resolutor · sonnet · medium`; con `escalar:true` o desde `debugger` → **high**.
2. `aClaude({agente:'retocador'})` → `sonnet · low`; `aClaude({agente:'consultor'})` → `opus · low`.
3. `CATALOGO_AGENTES` incluye `retocador` y `consultor`, y ambos caen en la capa `claude`.
4. «un cambio pequeño en el botón» → `retocador`; «ajusta los esfuerzos de los agentes» y «retoca el README» → **no** `retocador`; «retoca este fallo» → `debugger`; «valida la decisión técnica del contrato» → `arquitecto`.
5. `node scripts/test-opus-reparto.mjs` y `scripts/verificar` pasan. Antes de desplegar, los dos únicos fallos esperados de `verificar` son los agentes `retocador` y `consultor` sin instalar.

## Fuera de alcance
- Que el triaje sepa el modo (normal/cerebro): Laya sigue devolviendo la capa en `capa` y el MCP traduce en modo normal.
- Ajustar los pesos de Laya: se afinan con el uso real y `logs/decisiones.jsonl`.
