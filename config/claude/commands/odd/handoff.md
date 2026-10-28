---
description: Guarda el estado para poder hacer /clear o retomar mañana sin perder nada
---
Deja el estado guardado para retomar la tarea:

1. Escribe el estado (objetivo, hecho, queda, decisiones y archivos tocados) en un fichero temporal y guárdalo: `node ~/.sistema-cerebro-agentes/hooks/estado.mjs --escribir --archivo <fichero.md>`.
2. Si hay documento `odd/tasks/<nombre>.md`, actualízalo y su espejo en Engram.
3. Llama a `mem_session_summary` con lo mismo en pocas líneas.
4. Responde con un punto de control: hecho, queda y el primer paso al volver.

Después ya se puede hacer `/clear`. No hagas commits ni push en este paso.
