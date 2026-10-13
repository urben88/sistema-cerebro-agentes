# sistema-cerebro-agentes

Arquitectura de dos capas para desarrollo con IA, instalable en **Windows, macOS y Linux**:

| Capa | Quién | Qué hace | Coste |
|---|---|---|---|
| 🧠 **Cerebro** | Claude Code (tu suscripción) | Piensa, investiga, decide y escribe la documentación (specs, arquitectura, planes) | Suscripción de Claude |
| 🤖 **Manos** | OpenCode + modelos baratos | Escribe, revisa y prueba el código siguiendo las specs del Cerebro | Tokens baratos (DeepSeek V4.1 Flash; GPT-6 Luna cuando la cuenta de OpenRouter tenga crédito) |

El puente entre ambas capas es **[opencode-mcp](https://github.com/AlaeddineMessadi/opencode-mcp)** (servidor MCP local por stdio, sin Docker).

Este repositorio es la **fuente de verdad** del sistema: configuración, agentes e instaladores. Cualquier mejora se hace aquí y se despliega en cada máquina con `git pull` + instalador.

## Cómo funciona

```
 Tú
  │  (pides una feature, una app, una corrección…)
  ▼
┌──────────────────────────────────────────────┐
│ 🧠 Claude Code — CEREBRO                     │
│  · investiga y decide                        │
│  · escribe docs/specs/NN-feature.md          │
│  · delega por MCP ────────────────┐          │
└───────────────────────────────────│──────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ opencode-mcp (local, vía npx)│
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 🤖 OpenCode — MANOS          │
                     │  constructor · revisor ·     │
                     │  testeador                   │
                     │  (DeepSeek V4.1 Flash vía    │
                     │   OpenRouter)                │
                     └──────────────────────────────┘
```

## Requisitos

- **Node.js ≥ 22** — [nodejs.org](https://nodejs.org)
- **OpenCode V2** — [opencode.ai](https://opencode.ai), con el proveedor **DeepSeek** conectado (`opencode auth login`, o `/connect` en la TUI). Opcional: conecta también **OpenRouter** si quieres usar GPT-6 Luna (requiere crédito en la cuenta). El instalador añade su propio servidor **opencode-ai (V1)** en `~/.sistema-cerebro-agentes/server` — es el que usa el MCP; tu OpenCode V2 (TUI) no se toca.
- **Claude Code** — [claude.com/claude-code](https://claude.com/claude-code), con tu suscripción de Claude.
- **Git** — para clonar y actualizar este repositorio.

## Instalación

### Windows

```powershell
git clone <URL-DEL-REPO> %USERPROFILE%\Desktop\sistema-cerebro-agentes
cd %USERPROFILE%\Desktop\sistema-cerebro-agentes
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```bash
git clone <URL-DEL-REPO> ~/sistema-cerebro-agentes
cd ~/sistema-cerebro-agentes
bash install.sh
```

El instalador es **idempotente** (puedes ejecutarlo las veces que quieras), hace **copia de seguridad** de todo lo que reemplaza en `~/.sistema-cerebro-agentes/backups/` y **no toca** nada más de tu configuración.

Después de instalar: **reinicia Claude Code** (para que cargue el MCP) y ejecuta la verificación:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\verificar.ps1 -Smoke
```

```bash
# macOS / Linux
bash scripts/verificar.sh --smoke
```

## Qué instala exactamente

| Componente | Destino | Origen en el repo |
|---|---|---|
| Servidor OpenCode V1 (`opencode-ai`, el que usa el MCP) | `~/.sistema-cerebro-agentes/server/` (datos aislados en `server-data/`) | se instala con npm (`opencode-ai@1.18.35`) |
| Lanzador del MCP y gestor del servidor | `~/.sistema-cerebro-agentes/launcher.*`, `servidor.*` | `config/mcp/` |
| MCP `opencode` en Claude Code (scope de usuario, vía lanzador) | Configuración de Claude Code | `install.ps1` / `install.sh` |
| Rol Cerebro (memoria global) | `~/.claude/CLAUDE.md` → bloque gestionado | `config/claude/CLAUDE.md` |
| Skill de delegación | `~/.claude/skills/delegar-a-opencode/` | `config/claude/skills/delegar-a-opencode/` |
| Agentes de OpenCode | `~/.config/opencode/agents/` | `config/opencode/agents/` |

## Uso diario

1. Abre Claude Code **en la carpeta del proyecto** donde quieras trabajar.
2. Pide lo que quieras en lenguaje natural («añade autenticación», «corrige este bug», «crea un script que…»).
3. El Cerebro investiga, escribe la spec en `docs/specs/`, la delega a OpenCode y vigila la ejecución.
4. Revisa el resumen que te devuelve el Cerebro y decide el siguiente paso.

Detalles y ejemplos en [docs/uso-diario.md](docs/uso-diario.md).

## Agentes de OpenCode

| Agente | Papel | Modelo (v0.1.0) |
|---|---|---|
| `implementador` | Implementa la spec (código, build, tests) | `deepseek/deepseek-flash` |
| `revisor` | Revisa el diff contra la spec, sin editar | `deepseek/deepseek-flash` |
| `testeador` | Escribe y ejecuta pruebas | `deepseek/deepseek-flash` |

### Cambiar de modelo (p. ej. activar GPT-6 Luna)

Edita el `model:` del agente en `config/opencode/agents/*.md` y reinstala:

```yaml
# config/opencode/agents/revisor.md
model: openrouter/openai/gpt-6-luna   # requiere crédito en la cuenta de OpenRouter
```

Después: `git add -A && git commit -m "revisor: usa GPT-6 Luna" && git push` y ejecuta el instalador (o `scripts/actualizar`) en cada máquina.

> Los modelos vía OpenRouter solo funcionan con crédito en la cuenta. Si una petición falla con «requires more credits, or fewer max_tokens», recarga tu cuenta de OpenRouter (o vuelve a `deepseek/deepseek-flash`).

## Evolución (varias máquinas)

- **Máquina de desarrollo** (la tuya principal): edita aquí (tú o tu Cerebro), y sube: `git add -A && git commit && git push`.
- **Cualquier otra máquina**: `git pull` + `scripts/actualizar.ps1` (o `scripts/actualizar.sh`) → hace pull y reinstala todo.
- Versionado: `VERSION` + `CHANGELOG.md` + tags de Git. Cada cambio queda documentado.

## Estructura del repositorio

```
sistema-cerebro-agentes/
├── install.ps1 / install.sh          ← instaladores (Windows / macOS+Linux)
├── uninstall.ps1 / uninstall.sh      ← desinstaladores
├── config/                           ← LA DISTRIBUCIÓN (lo que se despliega)
│   ├── claude/
│   │   ├── CLAUDE.md                 ← rol Cerebro
│   │   └── skills/delegar-a-opencode/
│   │       ├── SKILL.md              ← protocolo de delegación
│   │       └── plantilla-spec.md     ← plantilla de specs
│   ├── mcp/                          ← lanzador del MCP y gestor del servidor V1
│   └── opencode/
│       └── agents/                   ← agentes implementador, revisor, testeador
├── docs/                             ← arquitectura, uso, pruebas, decisiones
└── scripts/                          ← verificar, actualizar, smoke test del MCP
```

## Desinstalación

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1   # Windows
```

```bash
bash uninstall.sh   # macOS / Linux
```

Quita el MCP, la skill, los agentes y el bloque gestionado de `CLAUDE.md`. Los backups quedan en `~/.sistema-cerebro-agentes/backups/` por si quieres restaurar algo. Los agentes propios que ya tenías en OpenCode (`chat-*`) no se tocan.

## Créditos

- [opencode-mcp](https://github.com/AlaeddineMessadi/opencode-mcp) — puente MCP entre Claude y OpenCode.
- [OpenCode](https://opencode.ai) — capa de ejecución.
- [Claude Code](https://claude.com/claude-code) — capa de pensamiento.
