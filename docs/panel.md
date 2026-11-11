# Panel web en tiempo real

Dashboard local para ver qué está haciendo el sistema y cómo está configurado. Tiene tres pestañas: **Panel** (lo de siempre), **Agentes** (perfiles de modelos) y **Modelos** (ficha comparativa).

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

## Perfiles de modelos (pestaña «Agentes»)

Un perfil dice qué modelo y qué esfuerzo usa cada agente, para Claude Code y para OpenCode. Está en `config/perfiles/<id>.json`:

```json
{
  "nombre": "Propuesta",
  "descripcion": "…",
  "claude":   { "consultor": { "model": "fable", "effort": "low" } },
  "opencode": { "revisor":   { "model": "deepseek/deepseek-flash", "variant": "max" } }
}
```

- Vienen dos: **actual** (lo que hay hoy) y **propuesta** (igual, con Fable solo en `consultor` low y `arquitecto` high). Para crear otro, copia uno y cámbiale los valores.
- Un agente que no aparece en el perfil no se toca. Si aparece uno que no existe, se muestra el error y no se aplica nada.
- En la pestaña eliges el perfil y pulsas **Aplicar**: primero ves qué cambia (agente: antes → después) y confirmas. Se reescriben solo las líneas `model:`, `effort:` y `variant:`, en el repositorio y en la copia instalada; el resto de cada fichero queda igual.
- La página dice qué perfil coincide con lo instalado, o «personalizado».
- **Tope de esfuerzo:** un perfil con `fable` y `xhigh` o `max` se rechaza, salvo que lleve `"permitirMasDeHigh": true`.
- El modelo del hilo principal (`/model`) no entra en los perfiles.
- **Instalador:** tras aplicar, el registro de `install` (`instalado.json`) se actualiza si esos agentes estaban sin cambios, así que `install` no los toma por editados a mano. Si ya los habías tocado a mano o el repo estaba por delante, no se registra (para que `install` siga avisando) y la página te lo dice.
- Los perfiles se leen del repositorio (`repoRoot` de `panel-config.json`); si el panel no lo encuentra, la pestaña lo avisa.

## Ficha de modelos (pestaña «Modelos»)

Tabla ordenable (clic en la cabecera) con índice de inteligencia, coste y tiempo por tarea, nivel de Engineering e **inteligencia por dólar**, más una gráfica de inteligencia frente a coste (eje X logarítmico). Los modelos que usa el sistema van con ★. Debajo, plegadas, las capturas originales. Los datos (aproximados, Artificial Analysis, 2026-11-11) están en `config/web/public/modelos.json`; edítalo para añadir modelos.

Pruebas: `node scripts/test-perfiles.mjs` (usa carpetas temporales; no toca tu instalación).

## Seguridad

- Escucha **solo en `127.0.0.1`** (nunca expuesto a la red).
- Casi todo es de lectura. Solo modifican ficheros los bots y los perfiles de modelos, y esas rutas aceptan únicamente `POST` desde `127.0.0.1`, con `Content-Type: application/json` y sin cabecera `Origin` ajena al panel. Para el resto de la configuración, edita el repositorio y ejecuta `install` o `scripts/actualizar`.
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

## Panel del hub: coste, uso y cambios (spec 22)

El panel del Cerebro Hub (`http://127.0.0.1:4597`) añade:

| Dónde | Qué muestra | Ruta del hub |
|---|---|---|
| Oficina · «Coste por subagente» | Por subagente: tokens (entrada, salida, caché), coste estimado, modelo y duración | `GET /api/agentes/coste?dias=7&limite=50&sesion=` |
| Pestaña Uso | Tokens y coste por modelo, día y proyecto, racha de días y trabajos de OpenCode (igual que `/odd:stats`) | `GET /api/stats?dias=30` |
| Pestaña Cambios | Lo que está sin commit en el repo de la sesión y en sus worktrees (archivos y `--stat`); el diff se carga al abrir un archivo | `GET /api/cambios`, `GET /api/cambios/diff?arbol=&archivo=` |

- Los datos de coste salen de los transcripts de Claude Code (`~/.claude/projects`), no del hook.
- Los precios están en `config/hub/precios.json` (USD por millón de tokens, por familia de modelo). Para cambiarlos sin tocar el repo, copia el archivo a `hub-data/precios.json`: manda sobre el del repo y se relee en cada consulta. Es una estimación.
- `/agentes` (mod mesa-de-trabajo) añade el coste de los subagentes recientes; `/agentes <n>` incluye el del agente elegido.
- Cambios: `?cwd=` (repetible) elige el repo; sin él se usan las carpetas de las sesiones en marcha. Solo lectura (`git status` y `git diff`).
