# Ventanas de Claude y ahorro

Cómo hacer que la suscripción de Claude (20 $) rinda al máximo, con las condiciones reales del plan (octubre de 2026) y el reparto de trabajo del sistema.

## Las reglas del plan

- **Dos límites simultáneos**: una ventana *session* de **5 horas rodantes** y un límite **semanal** que resetea un día/hora fijo de tu cuenta.
- El consumo se comparte entre **Claude Code, claude.ai y Claude Desktop**.
- **La barra semanal es la crítica**: una ráfaga de trabajo (por ejemplo, muchos subagentes en paralelo — un *fanout* consume ≈7×) puede agotar la semana con la ventana de 5 h aún llena.
- El medidor fiable es **`/usage`** dentro de Claude Code (barras + desglose por subagentes/MCP). La tarjeta «Ventana Claude» del panel es una **estimación local** desde tu historial (`~/.claude/projects`), con tokens nuevos y caché por modelo.
- Los **usage credits** (pagar por token al pasarse) quedan **desactivados** por defecto.

## La estrategia del sistema

| Tarea | Quién | Modelo · esfuerzo |
|---|---|---|
| Analizar, decidir dónde profundizar, orquestar, revisar | sesión principal / cerebro (Claude) | Opus 5.5 · medium (high lo sube el usuario con `/effort high`, o `arquitecto` Opus · high; `consultor` Opus · low para una segunda opinión) |
| Resolver el cómo de un área acotada | `resolutor` (Claude) | Sonnet · medium (high al depurar o si es delicado; en el cerebro, solo si OpenCode falla dos veces) |
| Cambios pequeños con algo de criterio (1–2 archivos) | `retocador` (Claude) | Sonnet · low |
| Leer, buscar, resumir, redactar, checklists, cambios ya decididos | subagentes Haiku (Claude) | Haiku · low/medium (`ayudante` · low) |
| Escribir, depurar, probar, revisar código | OpenCode | DeepSeek · low/high/max según rol (`revisor` max solo con código con lógica) |
| Mecánico explícito | `local` (Ollama) | gratis |

**Hábitos que estiran la ventana**

1. `/clear` al cambiar de tarea — el mayor ahorro; el hub guarda el estado y lo devuelve, y Haiku deja una nota de última sesión que se carga sola al volver. El aviso de contexto (desde 100k tokens) sale en consola: es la señal para planear el `/clear`.
2. Sin fanout: una sola cadena por tarea (preparación → ejecución → validación).
3. Esfuerzo `medium` por defecto; `high` solo para el plan/diseño.
4. Specs en archivo: el cerebro delega con un prompt corto que apunta a `docs/specs/NN.md`.
5. No reanudar sesiones frías de más de una hora (la caché dura 1 h y el reproceso se paga entero).
6. Cuando la barra semanal pase de ~80 %, pasa a la **Puerta 2**: OpenCode con `cerebro-oc` hasta el reset.
7. Modo **PLAN** por defecto: se investiga y se propone antes de gastar en ejecución; ejecutar es una decisión tuya («ejecuta»).

## Delegación y coste en OpenCode

- **Topes por job** (los vigila el hub; avisa al 80 %): `explorador-ds` 0,20 $ · `redactor-ds` 0,20 $ · `testeador` 0,30 $ · `revisor` 0,50 $ · `implementador` 0,75 $ · `debugger` 1,00 $.
- **Reglas** en `hub-data/reglas.json` (o las de serie en `config/hub/reglas.json`): `presupuestos` (topes de coste por agente), `respaldo` (degradación de agentes que fallan), `nudge_intervalo`, `bitacora_max_chars`, `tarea_caducada_min` (minutos sin actualizar la spec o ESTADO.md antes de avisar, 30 por defecto) y `sonido_fin` (sonido al terminar; pon tu `fin.mp3`/`fin.wav`/`fin.ogg` en `~/.sistema-cerebro-agentes/sonidos/`).
- **ODD decide el reparto**: delegar solo con un motivo concreto (el coste lo es); lo pequeño lo hace Claude. El *a quién* sale de la tabla fija de `CLAUDE.md`, sin consultar a ningún modelo.
- **Gasto**: el panel muestra el saldo de DeepSeek, el coste de las sesiones de hoy y la ventana de Claude estimada.

## Coste de los hooks por prompt

Cada prompt ejecuta hasta 4 hooks (latido de actividad, aviso de contexto y los de Gentle AI y CodeGraph). Son procesos de Node de pocos milisegundos que no llaman a ningún modelo: no gastan ventana, solo algo de latencia. Los de Gentle AI y CodeGraph **no se tocan**, porque sus instaladores los regeneran; si molestan, se quitan desde su herramienta, no desde aquí.

## Rutina semanal recomendada

1. **Bloque de pensamiento** (Claude): specs de varias features, decisiones, revisiones finales. `/clear` entre bloques.
2. **Bloque de ejecución** (OpenCode): implementadores y testers trabajando las specs — no consume tu ventana.
3. **Revisión** (Claude + `revisor`): diffs contra specs; el `analista` (Haiku) comprueba requisitos.
4. Si la semana se aprieta: `cerebro-oc` en OpenCode mantiene el flujo con las mismas specs.
