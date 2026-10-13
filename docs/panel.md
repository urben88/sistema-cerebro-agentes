# Panel web en tiempo real

Dashboard local de **solo lectura** para ver qué está haciendo el sistema y cómo está configurado.

## Arrancar

```powershell
# Windows (desde el repositorio)
powershell -ExecutionPolicy Bypass -File .\scripts\panel.ps1
# o desde la copia instalada:
powershell -NoProfile -ExecutionPolicy Bypass -File ~\.sistema-cerebro-agentes\panel.ps1
```

```bash
# macOS / Linux
bash scripts/panel.sh
```

Se abre el navegador en `http://127.0.0.1:4598` (o el primer puerto libre desde 4598; se guarda en `~/.sistema-cerebro-agentes/web-port.txt`).

| Opción | Windows | macOS/Linux |
|---|---|---|
| Parar | `panel.ps1 -Stop` | `bash panel.sh --stop` |
| Estado | `panel.ps1 -Status` | `bash panel.sh --status` |
| Sin abrir navegador | `panel.ps1 -NoOpen` | `bash panel.sh --no-open` |

## Qué muestra

| Zona | Contenido |
|---|---|
| Pipeline visual | Cerebro (Claude Code) → Puente (opencode-mcp) → Servidor V1 (opencode-ai + puerto) → Agentes, con estado en vivo |
| Métricas | Sesiones totales, activas (últimos 5 min), trabajos MCP, nº de agentes y última actividad |
| Trabajos del MCP | `opencode_fire` / `run`: estado (aceptado, en curso, completado, fallido, pide permiso…), título, directorio y cuándo |
| Sesiones | Sesiones del servidor V1 por actividad reciente; clic → últimos mensajes |
| Agentes | Cada agente con su **modo**, **modelo**, descripción y si coincide con la versión del repositorio; clic → fichero completo |
| Ficheros | Visor de toda la configuración: agentes (instalados), CLAUDE.md, skill, opencode.jsonc, lanzadores, docs del repo |

Se refresca cada 2,5 s.

## Gestión de bots (agentes de OpenCode)

El panel permite crear y editar tus propios bots sin tocar ficheros a mano:

- **➕ Nuevo bot** → nombre, descripción, **modo** (`primary` / `subagent` / `all`), **modelo** (el que quieras del catálogo completo, agrupado por proveedor — o «heredar» para que use el del sistema) y el **prompt** (su personalidad e instrucciones).
- **✏️ Editar** en cualquier tarjeta de bot → misma ficha, con lectura del prompt actual.
- **🗑️ Eliminar** → pide confirmación y guarda copia de seguridad en `~/.sistema-cerebro-agentes/backups/agentes-<fecha>/`.
- Al guardar, el bot se escribe **en el repositorio** (`config/opencode/agents/<nombre>.md`) **y en OpenCode** (`~/.config/opencode/agents/`), y queda disponible para el Cerebro al momento.
- Validaciones incluidas: nombre seguro (no se permiten nombres reservados de JavaScript como `constructor`, que rompen el servidor de OpenCode).

El Cerebro usa el bot que le pidas al delegar (por defecto `implementador`); si tu bot tiene un modelo propio, se respeta.

## Seguridad

- Escucha **solo en `127.0.0.1`** (nunca expuesto a la red).
- Es de **solo lectura**: no modifica nada. Para editar configuración, hazlo en el repositorio y ejecuta `install` o `scripts/actualizar`.
- No expone credenciales (`auth.json` y `service.json` quedan excluidos de la lista de ficheros).

## Cómo funciona

`config/web/servidor-web.mjs` (Node ≥ 22, **sin dependencias**) sirve el dashboard y una pequeña API local:

| Endpoint | Devuelve |
|---|---|
| `GET /api/ping` | Salud del propio panel |
| `GET /api/estado` | Servidor V1 (salud, puerto, versión) + agentes + trabajos + versiones (Claude, OpenCode, Node) + rutas |
| `GET /api/actividad` | Sesiones recientes y trabajos del MCP |
| `GET /api/sesion/:id` | Últimos mensajes de una sesión |
| `GET /api/ficheros` | Registro de ficheros de configuración (grupos) |
| `GET /api/archivo?i=N` | Contenido de un fichero del registro |
| `GET /api/modelos` | Catálogo de modelos disponibles (agrupables por proveedor) |
| `POST /api/bot` | Crear/actualizar un bot (`{nombre, descripcion, modo, modelo, prompt}`) |
| `POST /api/bot/eliminar` | Eliminar un bot (`{nombre}`), con copia de seguridad |

El frontend (`config/web/public/`) es HTML/CSS/JS puro, sin CDNs (funciona sin conexión).

## Cambiar el puerto base

Edita `BasePort` en `panel.ps1` (o `BASE_PORT` en `panel.sh`). El puerto real se publica en `web-port.txt`.

## Actualización con el repositorio

El panel vive en el repositorio (`config/web`) y se despliega con el instalador. Al ejecutar `scripts/actualizar` (o `install`), además de hacer `git pull` se redespliega el panel y, **si estaba abierto, se reinicia solo** para aplicar la versión nueva. Nada manual.
