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
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { clasificarError } from './errores.mjs'

// Ventanas de tiempo (R2/R3)
const VENTANA_SESION_MS = 5 * 60 * 1000
const VENTANA_TERMINADO_MS = 2 * 60 * 1000
const VENTANA_LATIDO_MS = 3 * 60 * 1000
const VENTANA_JOB_MS = 24 * 60 * 60 * 1000

// A2 · Trabajos zombi: un job `running|accepted` sin actualizar no puede animar a nadie
// tecleando. A partir de 30 min se marca «atascado» y a partir de 12 h se oculta.
const ZOMBI_ATASCO_MS = 30 * 60 * 1000
const ZOMBI_OCULTO_MS = 12 * 60 * 60 * 1000

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

// A3 · Nombre de agente: `Object`, vacío o «desconocido» nunca llegan a la escena.
// Se muestran como «Agente» con la familia genérica (nunca se imprime «Object»).
const NOMBRES_INVALIDOS = new Set(['object', '[object object]', 'desconocido'])
export function normalizarAgente(nombre) {
  const n = String(nombre ?? '').trim()
  if (!n || NOMBRES_INVALIDOS.has(n.toLowerCase())) return 'Agente'
  return n
}

// Mapeo de estado de los jobs del MCP (R2 + A2)
export function estadoDeJob(job, atascado, ahora) {
  const s = job.status
  if (s === 'running' || s === 'accepted') {
    const edad = ahora - (job.updatedAt || 0)
    if (edad > ZOMBI_OCULTO_MS) return 'inactivo'      // zombi viejo: fuera de la escena
    if (atascado || edad > ZOMBI_ATASCO_MS) return 'atascado' // zombi reciente: atasco
    return 'trabajando'
  }
  if (s === 'input_required') return atascado ? 'atascado' : 'esperando'
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
    for (const [nombre, familia] of Object.entries(FAMILIAS)) mapa.set(nombre, { familia, modelo: null, esfuerzo: null })
    let datos = { claude: [], opencode: [] }
    try { datos = organizacion?.datos() || datos } catch { /* sin organización */ }
    for (const a of [...(datos.claude || []), ...(datos.opencode || [])]) {
      if (!a?.nombre) continue
      const actual = mapa.get(a.nombre) || { familia: familiaGenerica, modelo: null, esfuerzo: null }
      mapa.set(a.nombre, { familia: actual.familia, modelo: a.modelo || actual.modelo || null, esfuerzo: actual.esfuerzo || a.esfuerzo || null })
    }
    return mapa
  }

  async function calcular() {
    const t = ahora()
    const agentes = mapaAgentes()
    const info = (nombre) => agentes.get(nombre) || { familia: familiaGenerica, modelo: null, esfuerzo: null }

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
      const agente = normalizarAgente(j.agent)
      const s = sala(j.directory)
      anadir(s, {
        id: `job:${j.jobId || j.sessionId || agente}`,
        agente,
        familia: info(agente).familia,
        // R1 · el modelo real del job (y su variant) manda sobre el del frontmatter.
        modelo: j.modelo || info(agente).modelo,
        variant: j.variant || info(agente).esfuerzo || null,
        estado,
        tarea: j.title || null,
        desde: j.createdAt || j.updatedAt || t,
        origen: 'opencode-job',
        jobId: j.jobId || null,
        sesion: j.sessionId || null,
        evento: null,
        // Compatibilidad: `error` sigue siendo el texto crudo; `errorInfo` añade la versión legible (R5).
        error: j.error || null,
        errorInfo: j.error ? clasificarError(j.error) : null,
      }, j.updatedAt || t)
      if (agente !== 'Agente') {
        const d = `${agente}:${j.jobId || ''}`
        if (!s._delegaciones.has(d)) {
          s._delegaciones.add(d)
          s.delegaciones.push({ de: 'cerebro', a: agente, jobId: j.jobId || null })
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
      const agente = se.agent ? normalizarAgente(se.agent) : 'cerebro-oc'
      const s = sala(se.directory)
      anadir(s, {
        id: `sesion:${se.id || normalizar(se.directory)}`,
        agente,
        familia: info(agente).familia,
        modelo: se.modelo || info(agente).modelo,
        variant: se.variant || info(agente).esfuerzo || null,
        estado: 'trabajando',
        tarea: se.title || null,
        desde: se.updatedAt,
        origen: 'opencode-sesion',
        jobId: null,
        sesion: se.id || null,
        evento: null,
        error: null,
        errorInfo: null,
      }, se.updatedAt)
    }

    // (c) latidos de Claude (caducan a los 3 min)
    let listaLatidos = []
    try { listaLatidos = latidos() || [] } catch { listaLatidos = [] }
    for (const l of listaLatidos) {
      if (!l?.cwd || t - (l.ts || 0) >= VENTANA_LATIDO_MS) continue
      const estado = estadoDeLatido(l.evento)
      if (estado === 'inactivo') continue
      const agente = l.agente ? normalizarAgente(l.agente) : 'cerebro'
      const s = sala(l.cwd)
      anadir(s, {
        id: `latido:${l.sesion || ''}:${agente}`,
        agente,
        familia: info(agente).familia,
        // R2 · el modelo del latido manda; si no lo trae, cae al del frontmatter.
        modelo: l.modelo || info(agente).modelo,
        variant: l.variant || info(agente).esfuerzo || null,
        estado,
        tarea: l.tarea || null,
        desde: l.desde || l.ts,
        origen: 'claude',
        jobId: null,
        sesion: l.sesion || null,
        evento: l.evento || null,
        error: null,
        errorInfo: null,
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

// ---------------------------------------------------------------- pruebas (A2/A3)
// Lógica pura: se ejecutan solo al lanzar este archivo directamente, nunca al importarlo
// (hub.mjs lo importa). No arrancan servidores ni tocan la red.
//   node config/hub/lib/actividad.mjs
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let fallos = 0
  const af = (cond, msg) => { if (cond) console.log(`  OK: ${msg}`); else { fallos++; console.error(`  FALLO: ${msg}`) } }

  const T = 1_700_000_000_000 // instante fijo de referencia
  const min = (n) => n * 60 * 1000
  const horas = (n) => n * 60 * 60 * 1000
  const job = (extra) => ({ jobId: 'j1', sessionId: 's1', directory: '/tmp/proyecto-a', agent: 'implementador', status: 'running', createdAt: T - min(5), updatedAt: T - min(1), title: 'Tarea', ...extra })

  console.log('A2 · trabajos zombi (estadoDeJob)')
  af(estadoDeJob(job(), false, T) === 'trabajando', 'running reciente → trabajando')
  af(estadoDeJob(job({ status: 'accepted' }), false, T) === 'trabajando', 'accepted reciente → trabajando')
  af(estadoDeJob(job({ updatedAt: T - min(30) }), false, T) === 'trabajando', 'running a 30 min exactos → trabajando (el umbral es «más de» 30)')
  af(estadoDeJob(job({ updatedAt: T - min(31) }), false, T) === 'atascado', 'running a 31 min → atascado (zombi reciente)')
  af(estadoDeJob(job({ updatedAt: T - horas(2) }), false, T) === 'atascado', 'running a 2 h → atascado')
  af(estadoDeJob(job({ updatedAt: T - horas(12) }), false, T) === 'atascado', 'running a 12 h exactas → atascado (el umbral es «más de» 12 h)')
  af(estadoDeJob(job({ updatedAt: T - horas(13) }), false, T) === 'inactivo', 'running a 13 h → oculto (fuera de la escena)')
  af(estadoDeJob(job({ updatedAt: T - horas(2) }), true, T) === 'atascado', 'atasco del vigilante → atascado')
  af(estadoDeJob(job({ updatedAt: T - horas(13) }), true, T) === 'inactivo', 'zombi de más de 12 h → oculto aunque el vigilante lo marque')
  af(estadoDeJob(job({ status: 'input_required', updatedAt: T - horas(1) }), false, T) === 'esperando', 'input_required → esperando')
  af(estadoDeJob(job({ status: 'completed', updatedAt: T - min(1) }), false, T) === 'terminado', 'completed reciente → terminado')
  af(estadoDeJob(job({ status: 'completed', updatedAt: T - min(5) }), false, T) === 'inactivo', 'completed antiguo → inactivo')

  console.log('A3 · nombre de agente (normalizarAgente)')
  af(normalizarAgente('Object') === 'Agente', "'Object' → «Agente»")
  af(normalizarAgente('[object Object]') === 'Agente', "'[object Object]' → «Agente»")
  af(normalizarAgente('') === 'Agente', "vacío → «Agente»")
  af(normalizarAgente('   ') === 'Agente', 'solo espacios → «Agente»')
  af(normalizarAgente(null) === 'Agente', 'null → «Agente»')
  af(normalizarAgente(undefined) === 'Agente', 'undefined → «Agente»')
  af(normalizarAgente('desconocido') === 'Agente', "'desconocido' → «Agente»")
  af(normalizarAgente('DESCONOCIDO') === 'Agente', "'DESCONOCIDO' (mayúsculas) → «Agente»")
  af(normalizarAgente('implementador') === 'implementador', 'nombre válido se conserva')
  af(normalizarAgente(' cerebro ') === 'cerebro', 'se recortan los espacios de un nombre válido')

  console.log('A2/A3 · integración (crearActividad)')
  const organizacionFuente = { datos: () => ({ claude: [], opencode: [] }) }
  const calcular = (over = {}) => crearActividad({
    leerJobs: () => over.jobs || [],
    sesiones: () => over.sesiones || [],
    latidos: () => over.latidos || [],
    organizacion: organizacionFuente,
    ahora: () => T,
  }).calcular()

  void (async () => {
    const vivo = await calcular({ jobs: [job({ updatedAt: T - min(5) })] })
    af(vivo.proyectos.length === 1 && vivo.proyectos[0].personajes[0].estado === 'trabajando', 'job vivo aparece como trabajando en su sala')

    const zombi = await calcular({ jobs: [job({ updatedAt: T - horas(1) })] })
    af(zombi.proyectos.length === 1 && zombi.proyectos[0].personajes[0].estado === 'atascado', 'job zombi (1 h) aparece como atascado')

    const muerto = await calcular({ jobs: [job({ updatedAt: T - horas(13) })] })
    af(muerto.proyectos.length === 0, 'job zombi viejo (13 h) queda fuera de la escena')

    const sinNombre = await calcular({ jobs: [job({ agent: 'Object', updatedAt: T - min(2) })] })
    const p = sinNombre.proyectos[0]?.personajes[0]
    af(!!p && p.agente === 'Agente' && p.familia === 'generica', "'Object' → agente «Agente» y familia genérica")
    af(sinNombre.proyectos[0]?.delegaciones.length === 0, 'un agente sin nombre no genera delegación desde «cerebro»')
    af(JSON.stringify(sinNombre).includes('"Object"') === false, 'la cadena «Object» no aparece en la salida')

    const desconocido = await calcular({ jobs: [job({ agent: 'desconocido', updatedAt: T - min(2) })] })
    const d = desconocido.proyectos[0]?.personajes[0]
    af(!!d && d.agente === 'Agente' && d.familia === 'generica', "'desconocido' → agente «Agente» y familia genérica")

    console.log('R1/R2 · elección de modelo (job > latido > frontmatter)')
    const orgConModelos = { datos: () => ({ claude: [{ nombre: 'cerebro', modelo: 'sonnet' }], opencode: [{ nombre: 'implementador', modelo: 'deepseek-frontmatter' }] }) }
    const calcular2 = (over = {}) => crearActividad({
      leerJobs: () => over.jobs || [],
      sesiones: () => [],
      latidos: () => over.latidos || [],
      organizacion: orgConModelos,
      ahora: () => T,
    }).calcular()

    const conJob = await calcular2({ jobs: [job({ modelo: 'deepseek-v3.2', variant: 'high' })] })
    const pj = conJob.proyectos[0]?.personajes[0]
    af(pj?.modelo === 'deepseek-v3.2', 'job con modelo → usa el del job')
    af(pj?.variant === 'high', 'job con variant → lo expone')
    af(pj?.errorInfo === null, 'job sin error → errorInfo null')

    const jobSinModelo = await calcular2({ jobs: [job()] })
    af(jobSinModelo.proyectos[0]?.personajes[0]?.modelo === 'deepseek-frontmatter', 'job sin modelo → cae al frontmatter')

    const conLatido = await calcular2({ latidos: [{ cwd: '/tmp/proyecto-a', sesion: 's1', agente: 'cerebro', evento: 'SubagentStart', modelo: 'claude-sonnet-4-5', ts: T - min(1) }] })
    const pl = conLatido.proyectos[0]?.personajes[0]
    af(pl?.modelo === 'claude-sonnet-4-5', 'latido con modelo → usa el del latido')
    af(pl?.evento === 'SubagentStart', 'latido expone el evento (R8)')

    const latidoSinModelo = await calcular2({ latidos: [{ cwd: '/tmp/proyecto-a', sesion: 's1', agente: 'cerebro', evento: 'Stop', ts: T - min(1) }] })
    af(latidoSinModelo.proyectos[0]?.personajes[0]?.modelo === 'sonnet', 'latido sin modelo → cae al frontmatter')

    const conError = await calcular2({ jobs: [job({ error: 'Timeout esperando al servidor local' })] })
    const pe = conError.proyectos[0]?.personajes[0]
    af(pe?.error === 'Timeout esperando al servidor local', 'error crudo se conserva')
    af(pe?.errorInfo?.tipo === 'timeout', 'errorInfo clasifica el error (R5)')

    console.log(fallos === 0 ? '\nPRUEBAS actividad.mjs: TODO OK' : `\nPRUEBAS actividad.mjs: ${fallos} fallo(s)`)
    process.exitCode = fallos === 0 ? 0 : 1
  })()
}
