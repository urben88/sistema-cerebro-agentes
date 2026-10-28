---
description: Muestra el estado de la tarea ODD en curso (hecho, en marcha, pendiente)
---
Resume el estado de la tarea actual en pocas líneas, sin tocar nada:

- Documento `odd/tasks/<nombre>.md` si existe: tareas hechas, en curso y pendientes, con su commit.
- `git status --short` y la rama.
- Trabajos delegados en marcha (`trabajo_estado`) y bloqueos o preguntas pendientes.
- Memoria: busca la última nota con Engram (`mem_context`) si no hay documento.

Termina con el siguiente paso concreto y lo único que necesita decidir el usuario, si lo hay.
