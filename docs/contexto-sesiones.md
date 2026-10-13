# Contexto y sesiones (Cerebro Hub)

El hub gestiona la memoria y el contexto de **todos** los proyectos desde fuera de los repositorios: nada de esto vive en tu código.

## Dónde vive la memoria

```
~/.sistema-cerebro-agentes/hub-data/
├── memoria/
│   ├── global/                    conocimiento compartido entre proyectos
│   ├── proyectos/<slug>/          ESTADO.md · BITACORA.md · CONTEXTO-REPO.md · checkpoints/
│   └── temporal/                  notas de sesión con caducidad (14 días por defecto)
├── logs/                          decisiones.jsonl · vigilante.jsonl
├── config.json                    puerto y umbrales (atasco, permisos, caducidad…)
└── reglas.json                    (si existe) reglas de reparto del usuario
```

El **slug** del proyecto se deriva de su ruta absoluta (nombre + hash corto); las rutas se normalizan, así que la memoria funciona igual en Windows y dentro de los contenedores Linux.

## El ciclo de una sesión

1. **Al abrir** (hook `SessionStart`, matchers `startup|resume|clear|compact`): el hub inyecta el *briefing* del proyecto actual: `ESTADO.md` + `CONTEXTO-REPO.md` + últimos movimientos de la bitácora + alertas del vigilante + trabajos en curso. Si el hub está apagado, el hook lee la memoria del disco directamente; si el proyecto no tiene memoria, no dice nada.
2. **Mientras trabajas**: el agente mantiene el `ESTADO.md` al día (una página: tarea activa, quién la tiene, siguiente paso, decisiones y bloqueos).
3. **Al 70 % de contexto**: el agente vuelca el estado y te avisa; haces `/clear` y la siguiente sesión arranca informada, sin explicar nada.
4. **Antes de compactar** (hook `PreCompact`, manual o automático): se guarda un *checkpoint* completo en `checkpoints/` y se recuerda completar el `ESTADO.md`.
5. **Al cerrar con `/clear`** (hook `SessionEnd`): checkpoint de seguridad.

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
