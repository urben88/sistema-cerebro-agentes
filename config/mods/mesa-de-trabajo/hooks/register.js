// Mesa de trabajo — mod del sistema Cerebro → OpenCode para Claude Code.
//
//   · Banda sobre el prompt: trabajos de OpenCode en vivo (agente · esfuerzo ·
//     tiempo · coste), subagentes de Claude con su modelo (Haiku visible) y el
//     contexto/ventanas de la sesión. Lee del Cerebro Hub (127.0.0.1:4597).
//   · Comandos: /trabajos, /errores y /parar-todo.
//   · Guardián de subagentes: fija el modelo de cada subagente según su
//     definición (haiku/sonnet) y deja constancia de cada lanzamiento en el
//     registro del hub.
//
// Sin dependencias: corre dentro de Claude Code y solo usa la API de mods.

const HUB = 'http://127.0.0.1:4597'
const REFRESCO_MS = 4000

// Respaldo si no se puede leer la definición del subagente.
const MODELO_RESPALDO = {
  explorador: 'haiku',
  redactor: 'haiku',
  analista: 'haiku',
  subdirector: 'haiku',
  planificador: 'haiku',
  'adaptador-mcps': 'haiku',
  arquitecto: 'sonnet',
}

const ESFUERZO = { low: 'bajo', medium: 'medio', high: 'alto', max: 'máximo', default: 'def' }
const EN_CURSO = ['running', 'accepted', 'input_required']

function minutos(desde, hasta) {
  if (!desde) return ''
  const m = Math.max(0, Math.round(((hasta || Date.now()) - desde) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function avisoEstancado(j) {
  return j.updatedAt && Date.now() - j.updatedAt > 60 * 60 * 1000 ? ' ⚠' : ''
}

function nombreEsfuerzo(v) {
  return ESFUERZO[String(v || '').toLowerCase()] || v || ''
}

function recortar(t, n) {
  const s = String(t || '')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

async function pedirJson($, ruta, opciones) {
  const r = await $.http.fetch(`${HUB}${ruta}`, opciones)
  if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : '?'} en ${ruta}`)
  return JSON.parse(r.text || '{}')
}

async function registrarEnHub($, datos) {
  try {
    await $.http.fetch(`${HUB}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    })
  } catch { /* hub apagado: mejor esfuerzo */ }
}

/** Modelo declarado en la definición del subagente (`model:` del frontmatter). */
async function modeloDeSubagente($, tipo, cwd) {
  if (!tipo) return null
  const rutas = []
  if (cwd) rutas.push(`${String(cwd).replace(/\\/g, '/')}/.claude/agents/${tipo}.md`)
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
  if (home) rutas.push(`${home.replace(/\\/g, '/')}/.claude/agents/${tipo}.md`)
  for (const ruta of rutas) {
    try {
      const texto = await $.fs.read(ruta)
      const fm = texto.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
      if (!fm) continue
      const linea = fm[1].split(/\r?\n/).find((l) => /^model:\s*/i.test(l))
      if (linea) {
        const v = linea.replace(/^model:\s*/i, '').trim()
        if (v) return v
      }
    } catch { /* sin fichero en esa ruta */ }
  }
  return MODELO_RESPALDO[tipo] || null
}

/** Estado para la banda: trabajos, subagentes y uso de la sesión. */
async function datosBanda($) {
  const salida = { lineas: [] }
  try {
    const v = await pedirJson($, '/api/vigilante')
    const trabajos = (v.trabajos || []).filter((j) => EN_CURSO.includes(j.status)).slice(0, 2)
    for (const j of trabajos) {
      const esfuerzo = j.variant ? ` (${nombreEsfuerzo(j.variant)})` : ''
      const coste = typeof j.cost === 'number' ? ` · ${j.cost.toFixed(3)} $` : ''
      salida.lineas.push(`🤖 ${j.agent || '?'}${esfuerzo} · ${minutos(j.createdAt, j.updatedAt)}${avisoEstancado(j)}${coste} · ${recortar(j.title || '(sin título)', 60)}`)
    }
  } catch { /* hub apagado */ }
  try {
    const l = await pedirJson($, '/api/latidos')
    const subs = (l.latidos || [])
      .filter((x) => x.agente && x.agente !== 'cerebro' && x.evento !== 'SubagentStop')
      .sort((a, b) => Number(!!b.modelo) - Number(!!a.modelo) || (b.ts || 0) - (a.ts || 0))
      .slice(0, 2)
    for (const s of subs) {
      salida.lineas.push(`👥 ${s.agente}${s.modelo ? ` (${s.modelo})` : ''} · ${minutos(s.desde || s.ts)}${s.tarea ? ` · ${recortar(s.tarea, 60)}` : ''}`)
    }
  } catch { /* hub apagado */ }
  try {
    const uso = await $.session.usage()
    const pct = uso && uso.context && typeof uso.context.percent === 'number' ? Math.round(uso.context.percent) : null
    const ventanas = []
    for (const rl of (uso && uso.rateLimits) || []) {
      if (rl && typeof rl.percentUsed === 'number' && rl.kind) ventanas.push(`${rl.kind} ${Math.round(rl.percentUsed)}%`)
    }
    if (pct != null || ventanas.length) {
      salida.lineas.unshift(`🧠 ctx ${pct != null ? `${pct}%` : '?'}${ventanas.length ? ` · ${ventanas.join(' · ')}` : ''}`)
    }
  } catch { /* sin uso */ }
  return salida
}

function formatearTrabajos(v) {
  const trabajos = (v.trabajos || []).filter((j) => EN_CURSO.includes(j.status))
  if (!trabajos.length) return 'No hay trabajos de OpenCode en curso.'
  const lineas = trabajos.map((j) => {
    const esfuerzo = j.variant ? ` (${nombreEsfuerzo(j.variant)})` : ''
    const coste = typeof j.cost === 'number' ? ` · ${j.cost.toFixed(3)} $` : ''
    const estado = avisoEstancado(j) ? `${j.status} ⚠ sin actividad hace ${minutos(j.updatedAt)}` : j.status
    return `- ${j.agent || '?'}${esfuerzo} · ${estado} · ${minutos(j.createdAt, j.updatedAt)}${coste} · ${j.title || '(sin título)'}\n  ${j.jobId} · ${j.directory || ''}`
  })
  return `Trabajos de OpenCode (${trabajos.length}):\n${lineas.join('\n')}`
}

function formatearErrores(l) {
  const errores = l.errores || []
  if (!errores.length) return 'Sin errores registrados en el hub.'
  const lineas = errores.slice(0, 10).map((e) => `- [${e.severidad}] ${e.origen}: ${recortar(e.mensaje, 160)}\n  ${e.fecha}`)
  return `Últimos errores (${errores.length}):\n${lineas.join('\n')}\n\nInforme completo: http://127.0.0.1:4597 (pestaña Errores) o \`hub/errores.mjs --exportar\`.`
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'trabajos', description: 'Ver los trabajos de OpenCode en vivo (Cerebro Hub)' })
    await $.command.register({ name: 'errores', description: 'Ver los últimos errores registrados (Cerebro Hub)' })
    await $.command.register({ name: 'parar-todo', description: 'Parar TODOS los trabajos de OpenCode en segundo plano', immediate: true })
    // La banda se refresca sola (los datos vienen del hub).
    $.clock.every(REFRESCO_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('command.run', { command: 'trabajos' }, async ($) => {
    try {
      return { text: formatearTrabajos(await pedirJson($, '/api/vigilante')) }
    } catch {
      return { text: 'El Cerebro Hub no responde (127.0.0.1:4597). Arráncalo o revisa `hub.ps1 status`.' }
    }
  })

  on('command.run', { command: 'errores' }, async ($) => {
    try {
      return { text: formatearErrores(await pedirJson($, '/api/logs?limite=10')) }
    } catch {
      return { text: 'El Cerebro Hub no responde (127.0.0.1:4597).' }
    }
  })

  on('command.run', { command: 'parar-todo' }, async ($) => {
    try {
      const r = await pedirJson($, '/api/trabajos/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todo: true }),
      })
      return { text: r.revisados === 0 ? 'No había trabajos activos que parar.' : `Cancelados ${r.cancelados} de ${r.revisados} trabajos activos.` }
    } catch {
      return { text: 'No se pudo parar: el Cerebro Hub no responde.' }
    }
  })

  // Guardián: fija el modelo del subagente según su definición y lo registra.
  on('agent.spawn', async ($, e, next) => {
    try {
      if (!e.fork) {
        const modelo = await modeloDeSubagente($, e.subagentType, e.cwd)
        await registrarEnHub($, {
          origen: 'mod:mesa-de-trabajo',
          severidad: 'info',
          mensaje: `Subagente ${e.subagentType} → ${modelo || e.model || 'por defecto'}`,
          contexto: { tipo: e.subagentType, modeloPedido: e.model || null, modeloForzado: modelo, padre: e.parentModel, fork: e.fork },
        })
        if (modelo) return next({ ...e, model: modelo })
      }
    } catch { /* nunca romper un lanzamiento */ }
    return next(e)
  }).catch(async ($, e, next) => {
    // Ante cualquier fallo del hook, el lanzamiento sigue como iba.
    return next(e)
  })

  // Banda encima del prompt: lo que está pasando, en vivo y sin salir de Claude.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const suyo = await next(e)
    try {
      const { lineas } = await datosBanda($)
      if (!lineas.length) return suyo
      const { Box, Text } = $.ui.resolve(e)
      const propias = lineas.map((t, i) => Box({ key: `mesa-${i}`, children: [Text({ children: [t], dimColor: i === 0 })] }))
      return Box({ flexDirection: 'column', children: [suyo, ...propias] })
    } catch { /* sin banda antes que banda rota */ }
    return suyo
  }).catch(async ($, e, next) => {
    // Si el dibujo falla, el motor dibuja lo suyo.
    return next(e)
  })
}
