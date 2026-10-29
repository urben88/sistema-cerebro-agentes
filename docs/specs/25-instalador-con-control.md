# Spec 25 · Instalador con control y flujo de errores

## Objetivo
El instalador sabe qué había instalado antes, actualiza solo lo que cambió, pregunta antes de pisar lo que el usuario tocó a mano y, si algo falla, lo dice claro y deja esa parte como estaba. Rama: `feat/spec25-instalador` (desde `feat/spec23-engram`). Pruebas: `scripts/test-instalador.mjs` dentro de `verificar`, con `HOME` falso en un directorio temporal. Riesgo: item 5 (instalador).

## Requisitos
- **S1 · Registro de lo instalado.** Al terminar, el instalador escribe `~/.sistema-cerebro-agentes/instalado.json` con la versión del sistema y, por componente (hub, hooks, panel, mods, mcp, agentes Claude, agentes OpenCode, comandos, skill, gentle-ai, docker), su versión o la huella (sha256) de lo copiado.
- **S2 · Solo lo que cambió.** Si un componente tiene la misma huella en el repo y en el registro, y lo instalado sigue igual, se salta con `[=] sin cambios`. Si cambió en el repo, se actualiza (con copia de seguridad, como hoy).
- **S3 · Cambios a mano.** Si lo instalado no coincide con la huella del registro (el usuario lo tocó), pregunta: `[s] sobrescribir (con copia) / [n] conservar / [d] ver diferencias`. Sin consola interactiva o con `-Force`: *supuesto*: conserva lo del usuario y lo avisa en el resumen.
- **S4 · Reinstalar todo.** `-Reinstalar` ignora el registro y reinstala todos los componentes.
- **S5 · Gentle AI y Engram.** `gentle-ai install` solo se ejecuta si no está instalado, cambia la versión fijada o cambia su configuración (persona, agentes). Si se ejecuta, después se reinicia el servidor OpenCode V1 para que vuelva a conectar Engram.
- **S6 · Flujo de errores.** Cada componente se instala como un paso con resultado `OK`, `sin cambios`, `aviso` o `error`. Un error en un paso no corta los demás, salvo los prerrequisitos. *Supuesto*: si un paso falla a medias, se restaura desde su copia de seguridad. Todo se escribe en `~/.sistema-cerebro-agentes/logs/install-<fecha>.log`. Al final, un resumen con cada error, su causa y cómo arreglarlo, y código de salida distinto de 0 si hubo errores.
- **S7 · Comprobación final.** Tras instalar, ejecuta `verificar -Smoke` (como `actualizar`), salvo con `-SinVerificar`.
- **S8 · Paridad.** `install.sh` hace lo mismo que `install.ps1` (registro, `--reinstalar`, `--force`, `--sin-verificar`). README y `-Check` explican las opciones nuevas.

## Tareas
| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| T1 | S1, S2, S4 | inline | pendiente | |
| T2 | S3 | inline | pendiente | |
| T3 | S5 | inline | pendiente | |
| T4 | S6, S7 | inline | pendiente | |
| T5 | S8 | inline | pendiente | |
| T6 | todos | verificador independiente (`analista`, item 5) | pendiente | |

## Log
- **L1 (2026-10-29, usuario):** «Tengo una duda, a la hora de instalar estás haciendo comprobaciones de si ya tiene el archivo, si no lo tiene ProPuntar para instalar, si ya tenía tu instalado no volver a reinstalar, a no ser que tú lo decidas. A la hora de instalar tiene que saber si lo tenías instalado antes para reinstalar o no. Esto es importante. Es decir, tener un mayor control a la hora de instalar para dar opciones al usuario. y todas estas instalaciones se hacen en modo general o instala algo en local, es decir, instala algo donde está el instalador en esa misma ruta o lo hace de manera genérica.»
- **L2 (2026-10-29, usuario):** «Quiero mejorar el instalador, que sea más potente, que tenga más funcionalidades y tenga un flujo de error, para comprobar errores, instalación, hacer lo que has comentado antes.»
- **L3:** Hoy todo se copia siempre (con backup) salvo `opencode-ai` y las imágenes Docker; no hay preguntas (`-Force` no hace nada). Todo es global (`~/.sistema-cerebro-agentes`, `~/.claude`, `~/.config/opencode`, `~/.local/bin`, Inicio de Windows, Docker); en el repo solo se lee `config/`. El reinstalar `gentle-ai` tumbó Engram en el servidor V1 (no se reinicia). Mirror de Engram pendiente: Engram desconectado en esta sesión.
