# Agentes por proyecto (además de los roles por defecto)

El sistema instala una **plantilla de roles por defecto** que está disponible en **todos** los proyectos (global):

- **Claude Code** (`~/.claude/agents/`): `cerebro`, `planificador`, `explorador`, `redactor`, `analista`, `arquitecto`, `subdirector`, `adaptador-mcps`.
- **OpenCode** (`~/.config/opencode/agents/`): `cerebro-oc`, `planificador`, `implementador`, `debugger`, `revisor`, `testeador`, `explorador-ds`, `redactor-ds`, `local`.

Encima de eso, **cada proyecto puede añadir sus propios agentes** (aditivos). No hay que copiar ni registrar nada: cada herramienta descubre su carpeta dentro del repositorio.

| Capa | Dónde vive | Alcance |
|---|---|---|
| Claude Code | `<proyecto>/.claude/agents/<nombre>.md` | Ese proyecto (se pueden anidar subcarpetas) |
| OpenCode | `<proyecto>/.opencode/agents/<nombre>.md` | Ese proyecto (se busca desde el directorio actual hacia el root del proyecto) |

## Reglas de convivencia

1. **Los roles por defecto no se tocan**: siempre están; un proyecto no puede dejar «sin equipo» a otro.
2. **Los agentes de proyecto son aditivos**: se suman a los globales. Si un proyecto no define ninguno, sigue teniendo los por defecto.
3. **Mismo nombre = ajuste local**: si un agente de proyecto se llama igual que uno por defecto (p. ej. `revisor`), solo pisa **en ese proyecto** (OpenCode) o tiene prioridad en ese proyecto (Claude Code). Úsalo para especializar un rol con las reglas del repo, no para duplicar.
4. **Se versionan en git**: los agentes de proyecto son de equipo; commitéalos junto al código.
5. **Nombres seguros**: nada de nombres que sean propiedades reservadas de JavaScript (`constructor`, `hasOwnProperty`, `toString`…) — rompen el servidor OpenCode V1; y sin `:` (reservado). En Claude Code, `name` y `description` son obligatorios.
6. **Un agente, un rol**: si el prompt es un «haz de todo», no es un agente: es un problema. Para todo lo demás ya está `cerebro`.

## Cómo crear uno

**Claude Code** — `<proyecto>/.claude/agents/revisor-api.md`:

```markdown
---
name: revisor-api
description: Revisa cambios de la API interna contra los contratos de docs/api/ (paginación, errores, versionado). Solo lectura.
model: haiku
effort: low
tools: Read, Grep, Glob, Bash
---
Eres el revisor de la API de este proyecto. Compara el diff con los contratos de
docs/api/ y lista desviaciones por severidad, con archivo y línea. No edites nada.
```

**OpenCode** — `<proyecto>/.opencode/agents/migrador-prisma.md`:

```markdown
---
description: Migraciones de Prisma — crea y revisa migraciones siguiendo las convenciones del repo. No cambia el esquema sin spec.
mode: subagent
model: deepseek/deepseek-flash
variant: high
---
Eres el migrador de este proyecto. Sigue las convenciones de docs/migraciones.md;
toda migración nace de una spec. Si falta información, anótalo y detente.
```

## Probar un agente de proyecto

- **Claude Code**: `claude --agent revisor-api` para una sesión, o pídelo por mención (`@revisor-api …`). Si acabas de crear la carpeta `agents`, reinicia Claude Code una vez (después se detectan los cambios en caliente).
- **OpenCode**: si es `primary`/`all`, cambia a él con **Tab**; si es `subagent`, pídeselo a `cerebro-oc` («usa migrador-prisma para…») o al agente principal.

## Cuándo merece la pena

- **Conocimiento local**: convenciones, dominio, APIs internas que los roles generales no pueden adivinar.
- **Un rol que no existe**: p. ej. experto en el motor de plantillas del repo, migrador de datos, revisor de accesibilidad.
- **Especializar un rol por defecto**: mismo nombre + reglas del repo (solo en ese proyecto).

## Qué se ve en el hub

El panel muestra la **organización global** (roles por defecto) y los trabajos en vivo: un job lanzado con un agente de proyecto aparece con **su nombre** en la oficina y en los trabajos. Los agentes de proyecto viven en el repositorio: se ven desde Claude/OpenCode, no se copian al hub.
