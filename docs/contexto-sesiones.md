# Contexto y sesiones (Cerebro Hub)

El hub gestiona la memoria y el contexto de **todos** los proyectos desde fuera de los repositorios: nada de esto vive en tu código.

## Dónde vive la memoria

```
~/.sistema-cerebro-agentes/hub-data/
├── memoria/
│   ├── global/                    conocimiento compartido entre proyectos
│   ├── proyectos/<slug>/          ESTADO.md · BITACORA.md · CONTEXTO-REPO.md · checkpoints/
│   └── temporal/                  notas de sesión con caducidad (14 días por defecto)
├── memoria/ultima-sesion/         nota de la última sesión por proyecto (la escribe Haiku)
├── logs/                          decisiones.jsonl · vigilante.jsonl
├── config.json                    puerto y umbrales (atasco, permisos, caducidad…)
└── reglas.json                    (si existe) topes de coste y respaldo de agentes del usuario
```

El **slug** del proyecto se deriva de su ruta absoluta (nombre + hash corto); las rutas se normalizan, así que la memoria funciona igual en Windows y dentro de los contenedores Linux.

## El ciclo de una sesión

1. **Al abrir** (hook `SessionStart`, matchers `startup|resume|clear|compact`): el hub inyecta el *briefing* del proyecto actual: `ESTADO.md` + `CONTEXTO-REPO.md` + últimos movimientos de la bitácora + alertas del vigilante + trabajos en curso. Con Engram activo, la bitácora no entra: el historial de sesiones lo inyecta Engram (ver «Engram junto al hub»). Si el hub está apagado, el hook lee la memoria del disco directamente; si el proyecto no tiene memoria, no dice nada.
2. **Mientras trabajas**: el agente mantiene el `ESTADO.md` al día (una página: tarea activa, quién la tiene, siguiente paso, decisiones y bloqueos).
3. **Al 70 % de contexto**: el agente vuelca el estado y te avisa; haces `/clear` y la siguiente sesión arranca informada, sin explicar nada.
   El aviso de contexto (`aviso-contexto.mjs`) mide **tokens reales** de la última respuesta, avisa al pasar de 100k y cada +50k más (`CONTEXTO_AVISO`, `CONTEXTO_PASO`), sin repetir el mismo nivel. Llega al agente y también se muestra al usuario en la consola.
4. **Antes de compactar** (hook `PreCompact`, manual o automático): se guarda un *checkpoint* completo en `checkpoints/` y se recuerda completar el `ESTADO.md`.
5. **Al cerrar con `/clear`** (hook `SessionEnd`): checkpoint de seguridad.
6. **Nota de última sesión**: al cerrar o hacer `/clear`, `session-end.mjs` lanza en segundo plano `resumir-sesion.mjs`, que pide a Haiku (`claude -p --model haiku`) un resumen de ≤ 5 líneas y lo guarda en `memoria/ultima-sesion/<proyecto>.md`. Las sesiones triviales (menos de 2 mensajes del usuario) no pisan la nota. Al abrir, `session-start.mjs` la inyecta; si el resumen sigue en curso, espera hasta 60 s. Con Engram activo no se lanza ni se espera: Engram ya guarda las sesiones.

## Engram junto al hub (spec 23)

Engram (lo instala Gentle AI) y el hub funcionan a la vez, cada uno con lo suyo:

| Qué | Dónde |
|---|---|
| Decisiones, aprendizajes, tareas ODD y resumen de sesiones | Engram (`mem_save`, `mem_session_summary`, `mem_search`) |
| Estado vivo del proyecto y contexto del repo | Hub (`ESTADO.md`, `CONTEXTO-REPO.md`) |
| Alertas, trabajos, gasto, aprobaciones y panel | Hub |

- Los hooks dan Engram por activo si su plugin (`engram@engram`) está activo y `engram version` responde. Si no, todo funciona como antes.
- Bitácora (spec 24): con Engram activo, las entradas nuevas (`estado.mjs --bitacora` y el aviso de trabajos cancelados al cerrar) van a Engram; si Engram falla, van al hub. Por eso `BITACORA.md` deja de crecer y la compresión con Haiku ya no salta. La bitácora antigua se queda en el hub y `buscar` la sigue encontrando.
- `buscar.mjs` une los resultados de los dos (`[engram:<tipo>]`). `--tipo engram` busca solo en Engram (sale con 1 si no está activo). Si el hub está apagado, sigue mostrando lo de Engram.
- `/odd:doctor` y `verificar` comprueban que Engram responde y que su plugin está activo.
- `ENGRAM_DESACTIVADO=1` hace que los hooks ignoren Engram, y `ENGRAM_BIN` cambia el binario (pruebas).
- La bitácora y las notas antiguas siguen en `hub-data/memoria`; no se borran ni se importan solas.

## CLI `estado` (para agentes y para ti)

```bash
node ~/.sistema-cerebro-agentes/hooks/estado.mjs --leer
node ~/.sistema-cerebro-agentes/hooks/estado.mjs --escribir --archivo nuevo-estado.md
node ~/.sistema-cerebro-agentes/hooks/estado.mjs --bitacora "título" --texto "..."
node ~/.sistema-cerebro-agentes/hooks/estado.mjs --checkpoint "motivo"
# --cwd RUTA para operar sobre otro proyecto
```

## Reconocimiento del repositorio (una vez)

En el primer contacto con un proyecto sin `CONTEXTO-REPO.md`, el cerebro **delega** el reconocimiento (subagente `explorador` o, si es grande, `explorador-ds` por MCP) y guarda una página: qué es, stack y comandos, estructura, **dónde vive su spec** (`docs/specs/`, `specs/`, `openspec/`…), convenciones y riesgos. Se refresca solo si el repo cambia; hasta entonces, ni Haiku ni DeepSeek vuelven a leerlo entero.

El principio es fijo: **la herramienta guía; el repositorio manda**. Las instrucciones concretas (estilo, comandos, spec propia) salen siempre del proyecto.

## API del hub usada por los hooks

`GET /api/briefing?cwd=…` · `POST /api/memoria/estado` · `POST /api/memoria/contexto` · `POST /api/memoria/bitacora` · `POST /api/memoria/checkpoint` · `GET /api/vigilante` — todo en `127.0.0.1` (por defecto `:4597`).
