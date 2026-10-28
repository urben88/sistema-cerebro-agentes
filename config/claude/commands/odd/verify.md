---
description: Verifica lo hecho contra la spec o la petición, con evidencias (no arregla nada)
argument-hint: <spec, tarea o cambio a verificar>
---
Verifica: $ARGUMENTS

Fase de verificación de ODD, solo lectura.

1. Lee el documento de la tarea completo (todas las `S#`) o, si no hay, la petición original.
2. Para ello puedes usar el `analista` (rol verifier en la tabla de CLAUDE.md). Dale la spec por referencia.
3. Ejecuta los ejemplos y los tests de la spec contra una copia o un estado aislado si modifican datos.
4. Devuelve un veredicto por cada `S#`: cumple, no cumple o sin comprobar, con la evidencia (comando y resultado).

Si algo falla, reprodúcelo antes de decir que ya funciona. No corrijas: informa de los bloqueos.
