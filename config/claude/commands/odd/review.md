---
description: Lanza la revisión RDD del cambio con gentle-ai (solo si el interruptor está activo)
argument-hint: [rama o rango a revisar]
---
Revisión del cambio. Alcance: $ARGUMENTS

Sigue las instrucciones de revisión del orquestador de Gentle AI (bloques `gentle-ai:*` de CLAUDE.md).

1. Mira el interruptor: `gentle-ai review mode status`. Si está desactivado, dilo y no sigas.
2. Evalúa el riesgo: `gentle-ai review assess --cwd . --agent claude-code --json`.
3. Si `review_due` es true (o el usuario lo pide), ejecuta el STATUS que devuelve y sigue solo sus transiciones.
4. Los revisores son los `review-*` de Gentle AI; no los sustituyas por otros agentes ni elijas lentes que no toquen el cambio.

Resume el resultado en pocas líneas. Entregar (commit, push, PR) sigue siendo decisión del usuario.
