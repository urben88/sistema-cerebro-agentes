---
description: Diagnóstico único del sistema con semáforo por punto (solo lectura)
---
Ejecuta el diagnóstico y enséñalo tal cual, sin tocar nada (solo lectura):

`node ~/.sistema-cerebro-agentes/hooks/doctor.mjs`

Comprueba, con un semáforo por punto ([OK] verde, [AVISO] amarillo, [X] rojo):

1. `verificar` (resumen de aprobadas y fallidas; solo se encuentra si lanzas Claude en la raíz del repo del sistema).
2. `gentle-ai doctor`.
3. `opencode mcp list`.
4. Que `defaultMode` de `~/.claude/settings.json` no sea `bypassPermissions`.
5. Que el hook `gentle-ai review stop-hook` esté presente.

Después de la salida, di en una línea qué punto rojo o amarillo conviene arreglar primero y cómo. No lo arregles tú: no cambies ajustes ni ejecutes instaladores.
