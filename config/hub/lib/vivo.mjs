/**
 * Vista viva — recopila automáticamente lo que hace cada agente de OpenCode para
 * que el panel lo enseñe sin pedirlo al servidor en cada clic, y para que quede
 * la última copia aunque el servidor tarde o caiga.
 *
 * Fuentes (servidor OpenCode V1):
 *   · /session/{id}/message → razonamiento, textos, herramientas y parches
 *   · /session/{id}/todo    → siguientes pasos pensados
 *
 * Guarda por trabajo un buffer circular de eventos (con ids para no repetir) y
 * una copia en disco en `hub-data/trabajos-vivo/<jobId>.json` (se conservan 3
 * días). Sin dependencias; nunca lanza: los fallos se registran y se reintenta.
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_EVENTOS = 800
const MAX_TEXTO = 12000
const DIAS_CONSERVAR = 3
const VENTANA_ACTIVO_MS = 6 * 60 * 60 * 1000
const VENTANA_TERMINADO_MS = 15 * 60 * 1000

export function crearVivo({ oc, dirDatos, emitir = null, intervaloMs = 4000 } = {}) {
  const dir = path.join(dirDatos, 'trabajos-vivo')
  const porJob = new Map() // jobId -> { sessionId, eventos, ids, todos, ultimaLectura, error, actualizado }
  let timer = null
  let enCurso = false
  let ultimoTick = 0
  let ultimoError = null

  function entorno(jobId) {
    let e = porJob.get(jobId)
    if (!e) {
      e = { sessionId: null, eventos: [], ids: new Set(), todos: [], ultimaLectura: null, error: null, actualizado: null }
      porJob.set(jobId, e)
    }
    return e
  }

  function guardar(jobId) {
    const e = porJob.get(jobId)
    if (!e) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = path.join(dir, `${jobId}.tmp`)
      const final = path.join(dir, `${jobId}.json`)
      fs.writeFileSync(tmp, JSON.stringify({ sessionId: e.sessionId, eventos: e.eventos, todos: e.todos, actualizado: e.actualizado, ultimaLectura: e.ultimaLectura }), 'utf8')
      fs.renameSync(tmp, final)
    } catch { /* sin disco: se sigue en memoria */ }
  }

  function cargarDeDisco() {
    let entradas = []
    try { entradas = fs.readdirSync(dir) } catch { return }
    for (const nombre of entradas) {
      if (!nombre.endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, nombre), 'utf8'))
        const jobId = nombre.replace(/\.json$/, '')
        const eventos = Array.isArray(j.eventos) ? j.eventos.slice(-MAX_EVENTOS) : []
        porJob.set(jobId, {
          sessionId: j.sessionId || null,
          eventos,
          ids: new Set(eventos.map((x) => x.id).filter(Boolean)),
          todos: Array.isArray(j.todos) ? j.todos : [],
          ultimaLectura: j.ultimaLectura || null,
          error: null,
          actualizado: j.actualizado || null,
          persistido: true,
        })
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
    const e = entorno(job.jobId)
    e.sessionId = job.sessionId || e.sessionId
    if (!e.sessionId) return { jobId: job.jobId, nuevos: [], todos: null, error: 'el trabajo no tiene sesión' }
    const rm = await oc.sesionMensajes(e.sessionId)
    if (!rm.ok) {
      e.error = rm.error
      return { jobId: job.jobId, nuevos: [], todos: null, error: rm.error }
    }
    const nuevos = extraerEventos(rm.mensajes).filter((x) => !e.ids.has(x.id))
    for (const x of nuevos) { e.ids.add(x.id); e.eventos.push(x) }
    if (e.eventos.length > MAX_EVENTOS) e.eventos = e.eventos.slice(-MAX_EVENTOS)
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
      guardar(job.jobId)
      e.persistido = true
    }
    return { jobId: job.jobId, nuevos, todos: todoCambiado, error: null }
  }

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
        if (r.nuevos?.length && emitir) emitir({ tipo: 'trabajo', jobId: r.jobId, nuevos: r.nuevos })
        if (r.todos && emitir) emitir({ tipo: 'todos', jobId: r.jobId, todos: r.todos })
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

  /** Datos recopilados de un trabajo (memoria primero; si no, lo que haya en disco). */
  function detalle(jobId) {
    const e = porJob.get(jobId)
    return {
      recopilado: !!e,
      eventos: e?.eventos || [],
      todos: e?.todos || [],
      colector: { ultimaLectura: e?.ultimaLectura || null, error: e?.error || null, ultimoTick, ultimoError, activo: !!timer },
    }
  }

  function estado() { return { activo: !!timer, ultimoTick, ultimoError, jobs: porJob.size } }

  return { arrancar, parar, tick, recolectar, detalle, estado }
}
