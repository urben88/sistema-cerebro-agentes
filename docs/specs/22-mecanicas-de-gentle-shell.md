# Spec 22 · Mecánicas tomadas de gentle-shell

## Objetivo
Llevar a Claude Code las mecánicas útiles de gentle-shell (https://github.com/Gentleman-Programming/gentle-shell) que el sistema no tiene todavía. Rama: `feat/spec20-gentle-ai`. Riesgo: ninguno de la lista alta (no toca permisos ni datos).

## Requisitos
- **S1 · Coste por agente.** El panel («La oficina») y `/agentes` muestran por cada subagente los tokens (entrada, salida y caché), el coste estimado, el modelo y la duración. Los datos salen del transcript o de los eventos de `SubagentStop`. Si ya existe en parte, se amplía. El precio por modelo va en una tabla de configuración, no fijado en el código.
- **S2 · `/odd:stats`.** Comando (`config/claude/commands/odd/stats.md`) y ruta del hub que dan el uso local: tokens y coste por modelo, por día y por proyecto, más la racha de días. Reutiliza las métricas que ya tiene el hub. El panel tiene una vista equivalente.
- **S3 · Cambios pendientes.** El panel muestra lo que está sin commit en el repo de la sesión y en los worktrees de los subagentes: archivos y `--stat`, con el diff cargado solo al abrirlo.
- **S4 · Tarea caducada.** El hook `latido` avisa con un mensaje breve, como mucho una vez cada N minutos, cuando se está editando código y la spec o el ESTADO.md del proyecto llevan más de N minutos sin actualizarse. N se configura (por defecto 30). No avisa en sesiones de solo lectura.
- **S5 · `/odd:doctor`.** Comando que hace un diagnóstico único:
  - `verificar` (resumen);
  - `gentle-ai doctor`;
  - `opencode mcp list`;
  - que `defaultMode` de `~/.claude/settings.json` no sea `bypassPermissions` (avisa si lo es);
  - que el hook `gentle-ai review stop-hook` esté presente.

  Es de solo lectura. Muestra un semáforo por punto.
- **S6 · Sonido al terminar.**
  - **Cuándo suena:** hook `Stop` (solo la sesión principal, no `SubagentStop`). Es opcional: un interruptor en la configuración del hub lo activa o desactiva, y por defecto está activo.
  - **Qué suena:** el primer archivo que exista de `~/.sistema-cerebro-agentes/sonidos/fin.{mp3,wav,ogg}`. Si no hay ninguno, el sonido del sistema.
  - **Reproducción:**
    - Windows: PowerShell con `System.Windows.Media.MediaPlayer`, o `SoundPlayer` para wav.
    - macOS: `afplay`.
    - Linux: `paplay` o `aplay`.
  - **Comportamiento:** se reproduce en segundo plano, sin bloquear ni retrasar el cierre (async), y no falla si no hay audio.
  - **Registro:** el hook se da de alta en `settings-merge` como hook propio, conservando los ajenos.
  - El usuario pone el archivo. El sistema no descarga audio de YouTube.

## Tareas
| ID | Specs | Ruta | Estado |
|---|---|---|---|
| T1 | S1, S2, S3 | delegado (resolutor A · medium, paralelo) | pendiente |
| T2 | S4, S5, S6 | delegado (resolutor B · medium, paralelo) | pendiente |

## Log
- **L1 (2026-10-28, usuario):** «aplica el 3,4,5,6,7,8 para el sonido pon https://www.youtube.com/watch?v=irZrMgLox28 solo cuando termine». Los números son los de la propuesta: 3 coste por agente, 4 `/odd:stats`, 5 cambios pendientes, 6 tarea caducada, 7 `/odd:doctor` y 8 avisos sonoros.
- **L2:** el audio de YouTube no se descarga, por sus condiciones y por los derechos. Se reproduce el archivo local que ponga el usuario.
