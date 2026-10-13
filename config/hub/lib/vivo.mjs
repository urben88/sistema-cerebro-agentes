/**
 * Vista viva — recopila automáticamente lo que hacen los agentes para que el panel
 * lo enseñe sin pedirlo en cada clic, y para que quede la última copia aunque el
 * servidor tarde o caiga.
 *
 * Dos fuentes:
 *   · Trabajos de OpenCode (servidor V1): /session/{id}/message (razonamiento,
 *     textos, herramientas, parches) y /session/{id}/todo (siguientes pasos).
 *   · Sesiones de Claude (transcript local del hook de latido): lee SOLO lo que
 *     Claude hace — herramientas, archivos, textos y subtareas lanzadas. El
 *     pensamiento interno de Claude no está en el transcript (va firmado), así
 *     que no hay nada que extraer ni se intenta.
 *
 * Guarda por trabajo/sesión un buffer circular de eventos (con ids para no
 * repetir) y una copia en disco en `hub-data/trabajos-vivo/` (se conservan 3
 * días). Sin dependencias; nunca lanza: los fallos se registran y se reintentan.
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_EVENTOS = 800
const MAX_TEXTO = 12000
const DIAS_CONSERVAR = 3
const VENTANA_ACTIVO_MS = 6 * 60 * 60 * 1000
const VENTANA_TERMINADO_MS = 15 * 60 * 1000
const SEGUIR_CLAUDE_MS = 30 * 60 * 1000

/** Resume la entrada de una herramienta de Claude en una línea corta. */
function resumirEntradaClaude(input) {
  if (!input || typeof input !== 'object') return null
  const claves = ['file_path', 'command', 'pattern', 'query', 'description', 'path', 'url', 'prompt']
  for (const k of claves) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return `${k}: ${v.slice(0, 160)}`
  }
  const primera = Object.entries(input).find(([, v]) => typeof v === 'string' && v.trim())
  return primera ? `${primera[0]}: ${String(primera[1]).slice(0, 160)}` : null
}

/** Saca eventos legibles de una línea del transcript de Claude (sin pensamiento). */
function eventosDeLinea(e) {
  const eventos = []
  if (!e || typeof e !== 'object') return eventos
  if (e.isSidechain) return eventos // la actividad de los subagentes se ve por la subtarea lanzada
  const uuid = e.uuid || null
  const ts = e.timestamp ? Date.parse(e.timestamp) || null : null
  const contenido = e.message?.content

  if (e.type === 'assistant' && Array.isArray(contenido)) {
    contenido.forEach((p, i) => {
      if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
        eventos.push({ id: `${uuid}:t${i}`, ts, tipo: 'texto', texto: p.text.slice(0, MAX_TEXTO) })
      } else if (p?.type === 'tool_use') {
        if (p.name === 'Task' || p.name === 'Agent') {
          eventos.push({
            id: `${uuid}:u${i}`, ts, tipo: 'subtarea',
            subagente: p.input?.subagent_type || p.input?.agent_type || null,
            texto: String(p.input?.description || p.input?.prompt || '').slice(0, 200),
          })
        } else {
          eventos.push({ id: `${uuid}:u${i}`, ts, tipo: 'herramienta', tool: p.name || 'tool', estado: null, entrada: resumirEntradaClaude(p.input) })
        }
      }
    })
  } else if (e.type === 'user' && Array.isArray(contenido)) {
    contenido.forEach((p, i) => {
      if (p?.type === 'tool_result') {
        const trozos = Array.isArray(p.content) ? p.content : []
        const texto = trozos.map((x) => (typeof x === 'object' ? x.text : x)).filter((x) => typeof x === 'string').join(' ').trim()
        eventos.push({ id: `${uuid}:r${i}`, ts, tipo: 'resultado', error: p.is_error === true, texto: texto.slice(0, 300) })
      } else if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
        eventos.push({ id: `${uuid}:p${i}`, ts, tipo: 'pregunta', texto: p.text.slice(0, 400) })
      }
    })
  }
  return eventos
}

export function crearVivo({ oc, dirDatos, emitir = null, latidos = () => [], intervaloMs = 4000 } = {}) {
  const dir = path.join(dirDatos, 'trabajos-vivo')
  const porJob = new Map() // jobId -> entrada
  const porSesion = new Map() // sesion -> entrada (Claude)
  let timer = null
  let enCurso = false
  let ultimoTick = 0
  let ultimoError = null

  function entornoJob(jobId) {
    let e = porJob.get(jobId)
    if (!e) {
      e = { sessionId: null, eventos: [], ids: new Set(), todos: [], ultimaLectura: null, error: null, actualizado: null }
      porJob.set(jobId, e)
    }
    return e
  }

  function entornoSesion(sesion) {
    let e = porSesion.get(sesion)
    if (!e) {
      e = { agente: null, ruta: null, offset: 0, resto: '', eventos: [], ids: new Set(), ultimaLectura: null, error: null, actualizado: null }
      porSesion.set(sesion, e)
    }
    return e
  }

  function guardar(nombre, payload) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = path.join(dir, `${nombre}.tmp`)
      const final = path.join(dir, `${nombre}.json`)
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      fs.renameSync(tmp, final)
    } catch { /* sin disco: se sigue en memoria */ }
  }

  function guardarJob(jobId) {
    const e = porJob.get(jobId)
    if (e) guardar(jobId, { sessionId: e.sessionId, eventos: e.eventos, todos: e.todos, actualizado: e.actualizado, ultimaLectura: e.ultimaLectura })
  }

  function guardarSesion(sesion) {
    const e = porSesion.get(sesion)
    if (!e) return
    const nombre = `claude-${sesion.replace(/[^a-zA-Z0-9_-]/g, '')}`
    guardar(nombre, { sesion, agente: e.agente, ruta: e.ruta, offset: e.offset, resto: e.resto, eventos: e.eventos, actualizado: e.actualizado, ultimaLectura: e.ultimaLectura })
  }

  function cargarDeDisco() {
    let entradas = []
    try { entradas = fs.readdirSync(dir) } catch { return }
    for (const nombre of entradas) {
      if (!nombre.endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, nombre), 'utf8'))
        if (nombre.startsWith('claude-')) {
          if (!j.sesion) continue
          const eventos = Array.isArray(j.eventos) ? j.eventos.slice(-MAX_EVENTOS) : []
          porSesion.set(j.sesion, { agente: j.agente || null, ruta: j.ruta || null, offset: j.offset || 0, resto: j.resto || '', eventos, ids: new Set(eventos.map((x) => x.id).filter(Boolean)), ultimaLectura: j.ultimaLectura || null, error: null, actualizado: j.actualizado || null })
        } else {
          const jobId = nombre.replace(/\.json$/, '')
          const eventos = Array.isArray(j.eventos) ? j.eventos.slice(-MAX_EVENTOS) : []
          porJob.set(jobId, { sessionId: j.sessionId || null, eventos, ids: new Set(eventos.map((x) => x.id).filter(Boolean)), todos: Array.isArray(j.todos) ? j.todos : [], ultimaLectura: j.ultimaLectura || null, error: null, actualizado: j.actualizado || null, persistido: true })
        }
      } catch { /* fichero corrupto: se ignora */ }
    }
  }

  function podarViejos() {
    const limite = Date.now() - DIAS_CONSERVAR * 24 * 60 * 60 * 1000
    let entradas = []
    try { entradas = fs.readdirSync(dir) } catch { return }
    for (const nombre of entradas) {
      if (!nombre.endsWith('.json') && !nombre.endsWith('.tmp')) continue
      try {
        const f = path.join(dir, nombre)
        if (fs.statSync(f).mtimeMs < limite) fs.unlinkSync(f)
      } catch { /* nada */ }
    }
  }

  function añadir(entrada, nuevos, max = MAX_EVENTOS) {
    const frescos = nuevos.filter((x) => x.id && !entrada.ids.has(x.id))
    for (const x of frescos) { entrada.ids.add(x.id); entrada.eventos.push(x) }
    if (entrada.eventos.length > max) entrada.eventos = entrada.eventos.slice(-max)
    return frescos
  }

  function extraerEventos(mensajes) {
    const nuevos = []
    for (const m of mensajes) {
      for (const p of m.partes) {
        if (!p.id) continue
        if (p.tipo === 'reasoning' && p.texto) nuevos.push({ id: p.id, ts: m.creado, tipo: 'razonamiento', texto: p.texto.slice(0, MAX_TEXTO), agente: m.agente })
        else if (p.tipo === 'text' && p.texto) nuevos.push({ id: p.id, ts: m.creado, tipo: 'texto', texto: p.texto.slice(0, MAX_TEXTO), agente: m.agente })
        else if (p.tipo === 'tool') nuevos.push({ id: p.id, ts: m.creado, tipo: 'herramienta', tool: p.tool, estado: p.estado, entrada: p.entrada, agente: m.agente })
        else if (p.tipo === 'patch') nuevos.push({ id: p.id, ts: m.creado, tipo: 'parche', archivos: p.archivos, agente: m.agente })
        else if (p.tipo === 'step-finish') nuevos.push({ id: p.id, ts: m.creado, tipo: 'paso', coste: m.coste, modelo: m.modelo, variant: m.variant, tokens: m.tokens, agente: m.agente })
      }
    }
    return nuevos
  }

  async function revisarJob(job) {
    const e = entornoJob(job.jobId)
    e.sessionId = job.sessionId || e.sessionId
    if (!e.sessionId) return { clave: `job:${job.jobId}`, jobId: job.jobId, nuevos: [], todos: null, error: 'el trabajo no tiene sesión' }
    const rm = await oc.sesionMensajes(e.sessionId)
    if (!rm.ok) {
      e.error = rm.error
      return { clave: `job:${job.jobId}`, jobId: job.jobId, nuevos: [], todos: null, error: rm.error }
    }
    const nuevos = añadir(e, extraerEventos(rm.mensajes))
    e.ultimaLectura = Date.now()
    e.actualizado = job.updatedAt || e.actualizado
    e.error = null
    let todoCambiado = null
    const rt = await oc.sesionTodo(e.sessionId)
    if (rt.ok && JSON.stringify(rt.todos) !== JSON.stringify(e.todos)) {
      e.todos = rt.todos
      todoCambiado = rt.todos
    }
    if (nuevos.length || todoCambiado || !e.persistido) {
      guardarJob(job.jobId)
      e.persistido = true
    }
    return { clave: `job:${job.jobId}`, jobId: job.jobId, nuevos, todos: todoCambiado, error: null }
  }

  /** Lee lo nuevo del transcript de una sesión de Claude (solo actividad). */
  function revisarSesion(sesion, ruta, agente) {
    const e = entornoSesion(sesion)
    if (agente) e.agente = agente
    if (ruta) e.ruta = ruta
    if (!e.ruta) return { clave: `claude:${sesion}`, sesion, nuevos: [], error: 'sin transcript' }
    let nuevos = []
    try {
      const st = fs.statSync(e.ruta)
      if (st.size < e.offset) { e.offset = 0; e.resto = '' } // el fichero se recreó
      if (st.size > e.offset) {
        const bytes = st.size - e.offset
        const fd = fs.openSync(e.ruta, 'r')
        try {
          const buf = Buffer.alloc(bytes)
          fs.readSync(fd, buf, 0, bytes, e.offset)
          e.offset = st.size
          const texto = e.resto + buf.toString('utf8')
          const lineas = texto.split('\n')
          e.resto = lineas.pop() || ''
          for (const linea of lineas) {
            const l = linea.trim()
            if (!l) continue
            try { nuevos = nuevos.concat(eventosDeLinea(JSON.parse(l))) } catch { /* línea cortada o no JSON */ }
          }
        } finally { fs.closeSync(fd) }
      }
      nuevos = añadir(e, nuevos)
      e.ultimaLectura = Date.now()
      e.actualizado = st.mtimeMs
      e.error = null
      if (nuevos.length || !e.persistido) {
        guardarSesion(sesion)
        e.persistido = true
      }
      return { clave: `claude:${sesion}`, sesion, agente: e.agente, nuevos, error: null }
    } catch (err) {
      e.error = String(err?.message || err)
      return { clave: `claude:${sesion}`, sesion, nuevos: [], error: e.error }
    }
  }

  async function tick() {
    if (enCurso) return
    enCurso = true
    ultimoTick = Date.now()
    try {
      const jobs = oc.leerJobsRecientes(VENTANA_ACTIVO_MS, 60)
      const activos = jobs.filter((j) => j.sessionId && ['running', 'accepted', 'input_required'].includes(j.status))
      const recienTerminados = jobs.filter((j) =>
        j.sessionId &&
        ['completed', 'failed', 'cancelled'].includes(j.status) &&
        Date.now() - (j.updatedAt || 0) < VENTANA_TERMINADO_MS &&
        (!porJob.get(j.jobId) || (porJob.get(j.jobId).actualizado || 0) < (j.updatedAt || 0)))
      for (const job of [...activos, ...recienTerminados]) {
        const r = await revisarJob(job)
        if (r.error) ultimoError = r.error
        if (r.nuevos?.length && emitir) emitir({ tipo: 'trabajo', clave: r.clave, jobId: r.jobId, nuevos: r.nuevos })
        if (r.todos && emitir) emitir({ tipo: 'todos', clave: r.clave, jobId: r.jobId, todos: r.todos })
      }

      // Sesiones de Claude: las del latido activo y las vistas hace poco (por si
      // el latido caduca mientras el turno sigue).
      const claude = new Map()
      for (const l of latidos()) {
        if (l?.sesion && l?.transcript) claude.set(l.sesion, { ruta: l.transcript, agente: l.agente })
      }
      for (const [sesion, e] of porSesion) {
        if (!claude.has(sesion) && e.ruta && e.ultimaLectura && Date.now() - e.ultimaLectura < SEGUIR_CLAUDE_MS) {
          claude.set(sesion, { ruta: e.ruta, agente: e.agente })
        }
      }
      for (const [sesion, datos] of claude) {
        const r = revisarSesion(sesion, datos.ruta, datos.agente)
        if (r.error && r.error !== 'sin transcript') ultimoError = r.error
        if (r.nuevos?.length && emitir) emitir({ tipo: 'trabajo', clave: r.clave, sesion, nuevos: r.nuevos })
      }
    } catch (e) {
      ultimoError = String(e?.message || e)
    } finally {
      enCurso = false
    }
  }

  function arrancar() {
    cargarDeDisco()
    podarViejos()
    tick()
    timer = setInterval(tick, intervaloMs)
    timer.unref?.()
    return timer
  }

  function parar() { if (timer) { clearInterval(timer); timer = null } }

  /**
   * Recoge un trabajo puntual aunque no esté en la ventana del colector (p. ej. al
   * abrir su detalle por primera vez). Cachea 15 s por trabajo para no repetir.
   */
  async function recolectar(jobId) {
    const e = porJob.get(jobId)
    if (e && e.ultimaLectura && Date.now() - e.ultimaLectura < 15000) return false
    const j = oc.leerJobsRecientes(30 * 24 * 60 * 60 * 1000, 200).find((x) => x.jobId === jobId)
    if (!j || !j.sessionId) return false
    try {
      await revisarJob(j)
      return true
    } catch { return false }
  }

  /** Recoge una sesión de Claude al abrir su detalle (si el latido ya no está). */
  function recolectarClaude(sesion) {
    const e = porSesion.get(sesion)
    if (e && e.ultimaLectura && Date.now() - e.ultimaLectura < 15000) return false
    const l = latidos().find((x) => x?.sesion === sesion && x?.transcript)
    const ruta = l?.transcript || e?.ruta
    if (!ruta) return false
    revisarSesion(sesion, ruta, l?.agente || e?.agente)
    return true
  }

  /** Datos recopilados de un trabajo de OpenCode. */
  function detalle(jobId) {
    const e = porJob.get(jobId)
    return {
      recopilado: !!e,
      origen: 'opencode',
      eventos: e?.eventos || [],
      todos: e?.todos || [],
      colector: { ultimaLectura: e?.ultimaLectura || null, error: e?.error || null, ultimoTick, ultimoError, activo: !!timer },
    }
  }

  /** Datos recopilados de una sesión de Claude (actividad; sin pensamiento interno). */
  function detalleAgente({ sesion = null } = {}) {
    const e = sesion ? porSesion.get(sesion) : null
    return {
      recopilado: !!e,
      origen: 'claude',
      eventos: e?.eventos || [],
      todos: [],
      colector: { ultimaLectura: e?.ultimaLectura || null, error: e?.error || null, ultimoTick, ultimoError, activo: !!timer },
    }
  }

  function estado() { return { activo: !!timer, ultimoTick, ultimoError, jobs: porJob.size, sesiones: porSesion.size } }

  return { arrancar, parar, tick, recolectar, recolectarClaude, detalle, detalleAgente, estado }
}
