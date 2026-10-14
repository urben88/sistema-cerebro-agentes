# Spec 12 · Agente `local-codigo` (Ornith 9B) con respaldo automático

## Objetivo
Un agente de código local y gratuito (`ollama/hf.co/bartowski/Ornith-1.5-9B-GGUF:IQ4_XS`, 16k) que el triaje prefiera para tareas de código **bien delimitadas**, y que el hub **degrade solo a `implementador`** (DeepSeek) cuando falle demasiado, volviendo a probarlo pasado un tiempo.

## Ya hecho (no tocar)
`config/opencode/agents/local-codigo.md` y el modelo registrado en `~/.config/opencode/opencode.jsonc`.

## Requisitos
- **L1 · Catálogo y reglas.** Añadir `local-codigo` a `CATALOGO_AGENTES` en `config/hub/lib/triaje.mjs` y a `presupuestos` en `config/hub/reglas.json` (valor 0). En `reglas.json`, la regla de `implementador` (claves implementa/crear/código/endpoint/función/clase…) pasa a elegir `local-codigo` si el texto del encargo parece **acotado**: contiene alguna de `["archivo", "fichero", "función", "funcion", "test", "spec", "criterio"]` y no contiene `["arquitectura", "migración", "migracion", "refactor global", "varios módulos", "todo el"]`. Si no se cumple, sigue `implementador`. Los encargos de depuración (`debugger`), revisión y arquitectura no cambian.
- **L2 · Salud por agente.** Nuevo `config/hub/lib/salud-agentes.mjs`: `crearSaludAgentes({ledger, reglas})` → `{estado(agente), resolver(agente)}`. Calcula, sobre los **últimos N trabajos terminales** del agente en el ledger (excluye `cancelado`), la tasa de fallo (`fallido` + `atascado`) y los fallos seguidos. Configuración en `reglas.json`: `"respaldo": { "local-codigo": { "a": "implementador", "ventana": 6, "minimoMuestras": 3, "maxTasaFallo": 0.5, "maxFallosSeguidos": 2, "enfriamientoMin": 60 } }`.
- **L3 · Degradación y reintento.** `resolver('local-codigo')` devuelve `{agente:'implementador', degradado:true, motivo}` si hay ≥ `minimoMuestras` y (tasa > `maxTasaFallo` o fallos seguidos ≥ `maxFallosSeguidos`). Pasados `enfriamientoMin` desde el último fallo, devuelve el agente original **una vez a modo de prueba** (`prueba:true`); si esa prueba tiene éxito el contador se limpia; si falla, nuevo enfriamiento. El estado se deriva del ledger (sin fichero propio), así que sobrevive a reinicios.
- **L4 · Integración en el triaje.** `triaje.decidir` (tanto por reglas como por Laya) aplica `resolver()` a la decisión final cuando el agente elegido tiene respaldo, y lo explica en `motivo` («local-codigo degradado a implementador: 3 de 5 fallaron»). La decisión se registra como hoy en `decisiones.jsonl` incluyendo `degradado`.
- **L5 · API y panel.** `GET /api/agentes/salud` devuelve `{agentes:[{agente, muestras, tasaFallo, fallosSeguidos, degradado, proximaPrueba}]}`. En el panel (sección de agentes/triaje existente) una línea por agente con respaldo: «local-codigo · 4/6 OK · activo» o «degradado hasta HH:MM».
- **L6 · Guía a los cerebros.** En `config/claude/agents/cerebro.md` y `config/opencode/agents/cerebro-oc.md`: `local-codigo` se usa para código acotado y bien especificado **antes** que `implementador` si el triaje no lo ha degradado; la spec que se le pasa debe incluir archivos, cambio exacto y comando de comprobación; tras un job suyo, verificar siempre con tests/`revisor`. Si el triaje lo degrada, usar `implementador` sin discutir.
- **L7 · Docs y pruebas.** `docs/arquitectura.md`, `docs/pruebas.md`, CHANGELOG (0.5.0 si la spec 11 no lo ha usado; si no, 0.6.0) y `VERSION`. `scripts/test-salud-agentes.mjs` enganchado en `verificar.sh/.ps1` (conserva el BOM de `verificar.ps1`).

## Criterios de aceptación
1. Con ledger sin historial, `resolver('local-codigo')` devuelve `local-codigo`.
2. 3 fallos seguidos → degrada a `implementador`; tras el enfriamiento permite una prueba; éxito limpia, fallo reabre.
3. Los `cancelado` no cuentan como fallos.
4. Un encargo «crea la función X en el archivo Y con test» enruta a `local-codigo`; «migración de arquitectura» a `arquitecto`/`implementador` según reglas actuales.
5. La degradación aparece en `motivo` y en `decisiones.jsonl`.
6. `GET /api/agentes/salud` responde y el panel lo muestra.
7. Todos los tests existentes siguen pasando.

## Fuera de alcance
Fallback para otros agentes (queda configurable por `respaldo`), cambiar el modelo `local`, medir calidad del código (solo éxito/fallo del job).
