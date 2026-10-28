---
description: Uso local: tokens y coste por modelo, día y proyecto, más la racha de días
argument-hint: "[días, por defecto 30]"
---
Muestra el uso local de Claude Code sin tocar nada. Los datos los da el Cerebro Hub (salen de los transcripts de `~/.claude/projects`; el precio por modelo está en `precios.json`, es una estimación).

1. Pide los datos con Bash (solo lectura): `curl -s "http://127.0.0.1:4597/api/stats?dias=${ARGUMENTS:-30}"`.
2. Si el hub no responde, dilo en una línea y sugiere arrancarlo (`hub.ps1` o `hub.sh`); no inventes cifras.
3. Resume en pocas líneas, con cifras redondeadas (k / M):
   - Total del periodo: tokens de entrada y salida (la caché aparte) y coste estimado.
   - Por modelo: una línea cada uno, del más caro al más barato.
   - Por día: los últimos 7 días con uso; destaca el día más caro.
   - Por proyecto: los 5 primeros por coste.
   - Racha: días seguidos con uso (`racha.actual`) y la mejor (`racha.mejor`).
   - OpenCode: trabajos y coste (`opencode`), si hay.
4. Para el coste de cada subagente: `curl -s "http://127.0.0.1:4597/api/agentes/coste?dias=7"` (o la pestaña Oficina del panel y el comando `/agentes`).

Termina con una sola observación útil si algo destaca (p. ej. un modelo que concentra casi todo el coste). Sin sermones.
