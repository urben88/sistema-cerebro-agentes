/**
 * Actividad del equipo («La oficina»).
 *
 * Combina tres fuentes en una sola vista agrupada por proyecto (clave: `directory`
 * normalizado, válido en Windows y Linux):
 *   (a) jobs del MCP          · `agent`, `status`, `directory`, `title`
 *   (b) sesiones de OpenCode  · solo las tocadas en los últimos 5 min
 *   (c) latidos de Claude     · mapa en memoria del hub, caduca a los 3 min
 *
 * Devuelve el esquema de R1:
 *   { proyectos: [{ ruta, nombre, slug, ultimaActividad,
 *                   personajes: [{ id, agente, familia, modelo, estado, tarea, desde, origen }],
 *                   delegaciones: [{ de, a, jobId }] }], generado }
 *
 * Sin dependencias. Factoría `crearActividad({...})` con fuentes inyectables para poder
 * probarla sin hub ni OpenCode.
 */
import crypto from 'node:crypto'

// Ventanas de tiempo (R2/R3)
const VENTANA_SESION_MS = 5 * 60 * 1000
const VENTANA_TERMINADO_MS = 2 * 60 * 1000
const VENTANA_LATIDO_MS = 3 * 60 * 1000
const VENTANA_JOB_MS = 24 * 60 * 60 * 1000

// R4 · familia por nombre de agente. Lo que no esté aquí va a `familiaGenerica`.
const FAMILIAS = {
  cerebro: 'direccion',
  subdirector: 'direccion',
  'cerebro-oc': 'direccion',
  arquitecto: 'direccion',
  explorador: 'exploracion',
  'explorador-ds': 'exploracion',
  redactor: 'documentacion',
  'redactor-ds': 'documentacion',
  analista: 'verificacion',
  implementador: 'implementacion',
  debugger: 'depuracion',
  revisor: 'revision',
  testeador: 'pruebas',
  local: 'mecanico',
}

// Normalización de rutas por comparación de cadenas (no toca el sistema de archivos).
const normalizar = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const nombreDe = (r) => String(r || '').split(/[\\/]/).filter(Boolean).pop() || 'proyecto'

// Mismo slug que `memoria.mjs` (duplicado a propósito: no se toca la memoria).
function slugLocal(ruta) {
  const base = nombreDe(ruta).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto'
  const h = crypto.createHash('sha1').update(normalizar(ruta)).digest('hex').slice(0, 6)
  return `${base}-${h}`
}

// Mapeo de estado de los jobs del MCP (R2)
function estadoDeJob(job, atascado, ahora) {
  if (atascado) return 'atascado'
  const s = job.status
  if (s === 'running' || s === 'accepted') return 'trabajando'
  if (s === 'input_required') return 'esperando'
  if (s === 'completed') return ahora - (job.updatedAt || 0) < VENTANA_TERMINADO_MS ? 'terminado' : 'inactivo'
  return 'inactivo'
}

// Mapeo de estado de los latidos de Claude (R3)
function estadoDeLatido(evento) {
  if (evento === 'Stop' || evento === 'SubagentStop') return 'terminado'
  return 'trabajando'
}

const PRIORIDAD = { trabajando: 0, atascado: 1, esperando: 2, terminado: 3 }

export function crearActividad({
  leerJobs = () => [],
  sesiones = () => [],
  latidos = () => [],
  organizacion = null,
  buscarProyecto = null,
  vigilante = null,
  familiaGenerica = 'generica',
  ahora = () => Date.now(),
} = {}) {
  // Mapa agente -> { familia, modelo }. La familia sale de R4 y el modelo se completa
  // con lo que declara `organizacion.mjs` (los agentes desconocidos quedan genéricos).
  function mapaAgentes() {
    const mapa = new Map()
    for (const [nombre, familia] of Object.entries(FAMILIAS)) mapa.set(nombre, { familia, modelo: null })
    let datos = { claude: [], opencode: [] }
    try { datos = organizacion?.datos() || datos } catch { /* sin organización */ }
    for (const a of [...(datos.claude || []), ...(datos.opencode || [])]) {
      if (!a?.nombre) continue
      const actual = mapa.get(a.nombre) || { familia: familiaGenerica, modelo: null }
      mapa.set(a.nombre, { familia: actual.familia, modelo: a.modelo || actual.modelo || null })
    }
    return mapa
  }

  async function calcular() {
    const t = ahora()
    const agentes = mapaAgentes()
    const info = (nombre) => agentes.get(nombre) || { familia: familiaGenerica, modelo: null }

    // Atascos marcados por el vigilante, por jobId
    const atascos = new Set()
    try {
      for (const a of vigilante?.alertas?.() || []) {
        if (a?.tipo === 'atascado' && a.jobId) atascos.add(a.jobId)
      }
    } catch { /* sin vigilante */ }

    const salas = new Map()

    function sala(directorio) {
      const clave = normalizar(directorio)
      let s = salas.get(clave)
      if (!s) {
        let reg = null
        try { reg = buscarProyecto ? buscarProyecto(directorio) : null } catch { reg = null }
        s = {
          ruta: String(directorio || reg?.ruta || ''),
          nombre: reg?.nombre || nombreDe(directorio),
          slug: reg?.slug || slugLocal(directorio),
          ultimaActividad: 0,
          personajes: [],
          delegaciones: [],
          _ids: new Set(),
          _delegaciones: new Set(),
        }
        salas.set(clave, s)
      }
      return s
    }

    function anadir(s, personaje, ts) {
      if (!personaje?.id || s._ids.has(personaje.id)) return
      s._ids.add(personaje.id)
      s.personajes.push(personaje)
      if ((ts || 0) > s.ultimaActividad) s.ultimaActividad = ts || 0
    }

    // (a) jobs del MCP
    const jobs = (() => { try { return leerJobs(120) || [] } catch { return [] } })()
    const sesionesConJob = new Set()
    for (const j of jobs) {
      if (!j?.directory || (j.updatedAt || 0) < t - VENTANA_JOB_MS) continue
      const estado = estadoDeJob(j, j.jobId ? atascos.has(j.jobId) : false, t)
      if (estado === 'inactivo') continue
      // Solo las sesiones con un job vivo se saltan la fuente (b) para no duplicar.
      if (j.sessionId) sesionesConJob.add(j.sessionId)
      const agente = j.agent || 'desconocido'
      const s = sala(j.directory)
      anadir(s, {
        id: `job:${j.jobId || j.sessionId || agente}`,
        agente,
        familia: info(agente).familia,
        modelo: info(agente).modelo,
        estado,
        tarea: j.title || null,
        desde: j.createdAt || j.updatedAt || t,
        origen: 'opencode-job',
        jobId: j.jobId || null,
        sesion: j.sessionId || null,
        error: j.error || null,
      }, j.updatedAt || t)
      if (j.agent) {
        const d = `${j.agent}:${j.jobId || ''}`
        if (!s._delegaciones.has(d)) {
          s._delegaciones.add(d)
          s.delegaciones.push({ de: 'cerebro', a: j.agent, jobId: j.jobId || null })
        }
      }
    }

    // (b) sesiones de OpenCode recientes (< 5 min), sin duplicar las de un job ya listado
    let sesionesRecientes = []
    try { sesionesRecientes = (await Promise.resolve(sesiones())) || [] } catch { sesionesRecientes = [] }
    for (const se of sesionesRecientes) {
      if (!se?.directory || !se.updatedAt) continue
      if (t - se.updatedAt >= VENTANA_SESION_MS) continue
      if (se.id && sesionesConJob.has(se.id)) continue
      const agente = se.agent || 'cerebro-oc'
      const s = sala(se.directory)
      anadir(s, {
        id: `sesion:${se.id || normalizar(se.directory)}`,
        agente,
        familia: info(agente).familia,
        modelo: info(agente).modelo,
        estado: 'trabajando',
        tarea: se.title || null,
        desde: se.updatedAt,
        origen: 'opencode-sesion',
        jobId: null,
        sesion: se.id || null,
        error: null,
      }, se.updatedAt)
    }

    // (c) latidos de Claude (caducan a los 3 min)
    let listaLatidos = []
    try { listaLatidos = latidos() || [] } catch { listaLatidos = [] }
    for (const l of listaLatidos) {
      if (!l?.cwd || t - (l.ts || 0) >= VENTANA_LATIDO_MS) continue
      const estado = estadoDeLatido(l.evento)
      if (estado === 'inactivo') continue
      const agente = l.agente || 'cerebro'
      const s = sala(l.cwd)
      anadir(s, {
        id: `latido:${l.sesion || ''}:${agente}`,
        agente,
        familia: info(agente).familia,
        modelo: info(agente).modelo,
        estado,
        tarea: l.tarea || null,
        desde: l.desde || l.ts,
        origen: 'claude',
        jobId: null,
        sesion: l.sesion || null,
        error: null,
      }, l.ts || t)
    }

    const proyectos = [...salas.values()]
      .filter((s) => s.personajes.length > 0)
      .map((s) => ({
        ruta: s.ruta,
        nombre: s.nombre,
        slug: s.slug,
        ultimaActividad: s.ultimaActividad,
        personajes: s.personajes.sort((a, b) => (PRIORIDAD[a.estado] ?? 9) - (PRIORIDAD[b.estado] ?? 9) || (a.desde || 0) - (b.desde || 0)),
        delegaciones: s.delegaciones,
      }))
      .sort((a, b) => b.ultimaActividad - a.ultimaActividad)

    return { generado: t, proyectos }
  }

  return { calcular }
}
