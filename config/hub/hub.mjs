#!/usr/bin/env node
/**
 * Cerebro Hub — backend de la aplicación sistema-cerebro-agentes.
 *
 *   · Memoria compartida FUERA de los repos (global / por proyecto / temporal)
 *   · Briefing para los hooks de Claude (SessionStart/PreCompact/…)
 *   · Vigilante de trabajos (atascos, permisos colgados)
 *   · Vista de organización (agentes, modelo y esfuerzo)
 *   · Gasto: saldo DeepSeek + coste de sesiones + estimación de la ventana de Claude
 *   · Panel web minimalista
 *
 * Sin dependencias (Node >= 22). Escucha SOLO en 127.0.0.1.
 *
 * Uso: node hub.mjs [--port 4597]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { crearMemoria } from './lib/memoria.mjs'
import { crearOpenCode } from './lib/opencode.mjs'
import { crearVigilante } from './lib/vigilante.mjs'
import { crearOrganizacion } from './lib/organizacion.mjs'
import { crearVentana } from './lib/ventana.mjs'
import { crearTriaje } from './lib/triaje.mjs'
import { crearActividad } from './lib/actividad.mjs'
import { clasificarAlerta } from './lib/errores.mjs'
import { crearVivo } from './lib/vivo.mjs'
import { crearLogErrores } from './lib/errores-log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(HOME, '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const MEMORIA_DIR = process.env.HUB_MEMORIA_DIR || path.join(DATA_DIR, 'memoria')
const LOGS_DIR = path.join(DATA_DIR, 'logs')
const PANEL_DIR = path.join(__dirname, 'panel')
const PLANTILLAS_DIR = path.join(__dirname, 'plantillas')
const OPENCODE_DIR = process.env.OPENCODE_DIR || path.join(HOME, '.config', 'opencode')
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(HOME, '.claude')
const AUTH_JSON = process.env.OPENCODE_AUTH || path.join(HOME, '.local', 'share', 'opencode', 'auth.json')
const OPENCODE_HOST = process.env.OPENCODE_HOST || null
const MAX_CUERPO = 1024 * 1024

// ----------------------------------------------------------------- config

const CONFIG_DEFECTO = {
  puerto: 4597,
  minutosAtasco: 12,
  minutosPermiso: 20,
  minutosEnfriamiento: 30,
  horasMaxJob: 24,
  temporalDias: 14,
  autolimpiarHoras: 6,
}

function cargarConfig() {
  const archivo = path.join(DATA_DIR, 'config.json')
  try { return { ...CONFIG_DEFECTO, ...JSON.parse(fs.readFileSync(archivo, 'utf8')) } }
  catch {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(archivo, JSON.stringify(CONFIG_DEFECTO, null, 2) + '\n') } catch { /* sin datos */ }
    return { ...CONFIG_DEFECTO }
  }
}

// Acepta `--port 4651` y `--port=4651` (los lanzadores hub.ps1/hub.sh usan la segunda).
function puertoDeArgs(argv) {
  const conIgual = argv.find((a) => a.startsWith('--port='))
  if (conIgual) return parseInt(conIgual.slice('--port='.length), 10) || 0
  const i = argv.indexOf('--port')
  return i >= 0 ? parseInt(argv[i + 1], 10) || 0 : 0
}
const puertoArg = puertoDeArgs(process.argv)
const config = cargarConfig()
const LISTEN_PORT = puertoArg || config.puerto
const LISTEN_HOST = process.env.HUB_HOST || '127.0.0.1'

fs.mkdirSync(LOGS_DIR, { recursive: true })

// ----------------------------------------------------------------- piezas

const memoria = crearMemoria(MEMORIA_DIR, { temporalDias: config.temporalDias, plantillasDir: PLANTILLAS_DIR })
memoria.inicializar()

// Registro central de errores: lo alimentan el hub, el colector, los hooks, el MCP
// y el panel; se lee desde /api/logs y se exporta para pasárselo a una IA.
const logErrores = crearLogErrores({ dirLogs: LOGS_DIR })
process.on('unhandledRejection', (e) => {
  try { logErrores.registrarYLog({ origen: 'hub', severidad: 'aviso', mensaje: `Promesa rechazada sin capturar: ${e?.message || e}`, stack: e?.stack }) } catch { /* nada */ }
})
process.on('uncaughtException', (e) => {
  try { logErrores.registrarYLog({ origen: 'hub', severidad: 'critico', mensaje: `Excepción no capturada: ${e?.message || e}`, stack: e?.stack }) } catch { /* nada */ }
  process.exit(1)
})
const oc = crearOpenCode({ systemDir: SYSTEM_DIR, host: OPENCODE_HOST })
const organizacion = crearOrganizacion({ home: HOME, opencodeDir: OPENCODE_DIR, claudeDir: CLAUDE_DIR })
const ventana = crearVentana({ baseDir: path.join(CLAUDE_DIR, 'projects') })

// Reglas de reparto: las del usuario (en la carpeta de datos) mandan sobre las de serie
function cargarReglas() {
  const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  return leer(path.join(DATA_DIR, 'reglas.json')) || leer(path.join(__dirname, 'reglas.json')) || { reglas: [], porDefecto: {} }
}
const reglas = cargarReglas()
const triaje = crearTriaje({ reglas, logDecisiones: path.join(LOGS_DIR, 'decisiones.jsonl') })

// ---------------------------------------------------------------- hallazgos (buscar antes de crear)
const HALLAZGOS_JSONL = path.join(DATA_DIR, 'hallazgos.jsonl')

function leerHallazgos(estado = null) {
  let texto = ''
  try { texto = fs.readFileSync(HALLAZGOS_JSONL, 'utf8') } catch { return [] }
  const porId = new Map()
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue
    try {
      const e = JSON.parse(linea)
      porId.set(e.id, { ...(porId.get(e.id) || {}), ...e })
    } catch { /* nada */ }
  }
  let lista = [...porId.values()].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
  if (estado) lista = lista.filter((h) => h.estado === estado)
  return lista
}

function registrarHallazgo(datos) {
  const entrada = {
    id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fecha: new Date().toISOString(),
    estado: 'propuesto',
    nombre: String(datos.nombre || '').slice(0, 200),
    url: String(datos.url || '').slice(0, 500),
    nota: String(datos.nota || '').slice(0, 500),
    por: String(datos.por || 'agente').slice(0, 60),
    proyecto: String(datos.proyecto || '').slice(0, 300),
  }
  fs.appendFileSync(HALLAZGOS_JSONL, JSON.stringify(entrada) + '\n')
  return entrada
}

function cambiarEstadoHallazgo(id, estado) {
  if (!['propuesto', 'validado', 'descartado', 'integrado'].includes(estado)) return { ok: false, error: 'estado inválido' }
  const actual = leerHallazgos().find((h) => h.id === id)
  if (!actual) return { ok: false, error: 'hallazgo no encontrado' }
  const entrada = { ...actual, estado, fecha: new Date().toISOString() }
  fs.appendFileSync(HALLAZGOS_JSONL, JSON.stringify(entrada) + '\n')
  return { ok: true, hallazgo: entrada }
}

function registrarAlerta(a) {
  try { fs.appendFileSync(path.join(LOGS_DIR, 'vigilante.jsonl'), JSON.stringify({ ...a, fecha: new Date().toISOString() }) + '\n') } catch { /* nada */ }
  // Las alertas del vigilante también van al registro central (con contexto).
  try {
    logErrores.registrar({
      origen: 'vigilante',
      severidad: 'aviso',
      mensaje: `Vigilante: ${a?.tipo || 'aviso'}${a?.minutos ? ` (${a.minutos} min)` : ''} · ${a?.title || a?.jobId || ''}`,
      contexto: { jobId: a?.jobId || null, directory: a?.directory || null, sesionId: a?.sessionId || null },
    })
  } catch { /* nada */ }
}
const vigilante = crearVigilante({ leerJobs: (n) => oc.leerJobs(n), config, registrar: registrarAlerta })
vigilante.arrancar(60 * 1000)

// ----------------------------------------------------------------- latidos (R3)

// Mapa en memoria de latidos de Claude. Cada latido se identifica por sesión+agente y
// caduca a los 3 min sin renovarse. Nunca se persiste: si el hub se reinicia, se pierde.
const LATIDO_TTL = 3 * 60 * 1000
const latidos = new Map()

function registrarLatido(b) {
  const ahora = Date.now()
  const clave = `${b.sesion || 'anon'}:${b.agente || 'cerebro'}`
  const previo = latidos.get(clave)
  latidos.set(clave, {
    cwd: b.cwd || previo?.cwd || process.cwd(),
    sesion: b.sesion || previo?.sesion || null,
    evento: b.evento || previo?.evento || 'desconocido',
    agente: b.agente || previo?.agente || 'cerebro',
    tarea: b.tarea || null,
    modelo: b.modelo || previo?.modelo || null,
    transcript: b.transcript || previo?.transcript || null,
    ts: ahora,
    desde: previo && ahora - previo.ts < LATIDO_TTL ? previo.desde : ahora,
  })
}

function latidosActivos() {
  const ahora = Date.now()
  const activos = []
  for (const [clave, l] of latidos) {
    if (ahora - l.ts >= LATIDO_TTL) { latidos.delete(clave); continue }
    activos.push(l)
  }
  return activos
}

// ------------------------------------------------- estado real de Claude (contexto y ventanas)
// Lo empuja la barra de estado de Claude Code (estado-linea.mjs) con los datos que
// Claude da en vivo: contexto usado, ventanas de 5 h / 7 d y coste. Caduca a los 2 min.

const ESTADO_CLAUDE_TTL = 2 * 60 * 1000
const estadosClaude = new Map()

const numONulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function registrarEstadoClaude(b) {
  const clave = String(b.sesion || 'anon')
  estadosClaude.set(clave, {
    cwd: b.cwd || null,
    sesion: b.sesion || null,
    nombre: b.nombre || null,
    modelo: b.modelo || null,
    contextoPct: numONulo(b.contextoPct),
    cincoPct: numONulo(b.cincoPct),
    sietePct: numONulo(b.sietePct),
    coste: numONulo(b.coste),
    cincoReset: b.cincoReset || null,
    sieteReset: b.sieteReset || null,
    ts: Date.now(),
  })
}

function estadosClaudeActivos(cwd = null) {
  const ahora = Date.now()
  const norm = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const out = []
  for (const [clave, v] of estadosClaude) {
    if (ahora - v.ts >= ESTADO_CLAUDE_TTL) { estadosClaude.delete(clave); continue }
    if (cwd && norm(v.cwd) !== norm(cwd)) continue
    out.push(v)
  }
  return out
}

// Cache corto de sesiones de OpenCode: la actividad puede pedirse cada 2 s (SSE) y no
// queremos martillear al servidor V1.
let cacheSesiones = { ts: 0, datos: [] }
async function sesionesActivas() {
  const ahora = Date.now()
  if (ahora - cacheSesiones.ts < 3000) return cacheSesiones.datos
  const r = await oc.sesionesRecientes(5 * 60 * 1000)
  cacheSesiones = { ts: ahora, datos: r.ok ? r.sesiones : [] }
  return cacheSesiones.datos
}

const actividad = crearActividad({
  leerJobs: (n) => oc.leerJobs(n),
  sesiones: () => sesionesActivas(),
  latidos: () => latidosActivos(),
  organizacion,
  buscarProyecto: (ruta) => memoria.buscarProyecto(ruta),
  vigilante,
})
try { memoria.limpiarTemporales() } catch { /* nada */ }
setInterval(() => { try { memoria.limpiarTemporales() } catch { /* nada */ } }, config.autolimpiarHoras * 60 * 60 * 1000).unref?.()

// ---------------------------------------------------------------- vista viva
// Colector automático (razonamiento, actividad y siguientes pasos por trabajo):
// alimenta el detalle del panel aunque nadie lo pida, y avisa por SSE a quien
// esté mirando en ese momento.
const clientesSSE = new Set()
function difundirSSE(evento, datos) {
  const texto = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`
  for (const c of clientesSSE) {
    try { c.write(texto) } catch { /* conexión muerta: se limpia sola al cerrar */ }
  }
}
const vivo = crearVivo({ oc, dirDatos: DATA_DIR, emitir: (ev) => difundirSSE('trabajo', ev), latidos: () => latidosActivos(), registrarLog: (d) => logErrores.registrarYLog(d), intervaloMs: 4000 })
vivo.arrancar()

// ----------------------------------------------------------------- gasto

let cacheGasto = { ts: 0, datos: null }
async function gasto(forzar = false) {
  const ahora = Date.now()
  if (!forzar && cacheGasto.datos && ahora - cacheGasto.ts < 5 * 60 * 1000) return cacheGasto.datos
  const datos = { generado: ahora }
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_JSON, 'utf8'))
    const key = auth?.deepseek?.key
    if (key) {
      const r = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      const j = await r.json()
      const b = j?.balance_infos?.[0] || {}
      datos.deepseek = { ok: true, disponible: j?.is_available === true, saldo: b.total_balance ?? null, moneda: b.currency || 'USD' }
    } else {
      datos.deepseek = { ok: false, error: 'DeepSeek no está conectado en OpenCode' }
    }
  } catch (e) { datos.deepseek = { ok: false, error: String(e?.message || e) } }
  try {
    const s = await oc.sesiones()
    if (s.ok) {
      const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0)
      const hoy = s.sesiones.filter((x) => (x?.time?.updated || 0) >= inicioDia.getTime())
      datos.sesiones = {
        ok: true,
        hoy: hoy.length,
        coste: hoy.reduce((a, x) => a + (typeof x.cost === 'number' ? x.cost : 0), 0),
        total: s.sesiones.length,
      }
    } else datos.sesiones = { ok: false, error: s.error }
  } catch (e) { datos.sesiones = { ok: false, error: String(e?.message || e) } }
  cacheGasto = { ts: ahora, datos }
  return datos
}

// Reparto por familia/modelo del equipo activo (R6). Solo datos reales: si no hay
// personajes activos, los arrays van vacíos (no se inventa nada).
async function gastoEquipo() {
  const act = await actividad.calcular()
  const porFamilia = new Map()
  const porModelo = new Map()
  for (const p of act.proyectos) {
    for (const c of p.personajes) {
      const f = porFamilia.get(c.familia) || { familia: c.familia, personajes: 0, agentes: new Set() }
      f.personajes++
      f.agentes.add(c.agente)
      porFamilia.set(c.familia, f)
      const m = porModelo.get(c.modelo || 'desconocido') || { modelo: c.modelo || null, personajes: 0, agentes: new Set() }
      m.personajes++
      m.agentes.add(c.agente)
      porModelo.set(c.modelo || 'desconocido', m)
    }
  }
  return {
    ok: true,
    generado: Date.now(),
    familias: [...porFamilia.values()].map((f) => ({ familia: f.familia, personajes: f.personajes, agentes: [...f.agentes] })).sort((a, b) => b.personajes - a.personajes),
    modelos: [...porModelo.values()].map((m) => ({ modelo: m.modelo, personajes: m.personajes, agentes: [...m.agentes] })).sort((a, b) => b.personajes - a.personajes),
  }
}

// ----------------------------------------------------------------- utilidades HTTP

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

function enviarJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': MIME.json, 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function leerCuerpo(req, limite = MAX_CUERPO) {
  return new Promise((resolve, reject) => {
    let datos = ''
    req.on('data', (c) => { datos += c; if (datos.length > limite) { reject(new Error('cuerpo demasiado grande')); req.destroy() } })
    req.on('end', () => resolve(datos))
    req.on('error', reject)
  })
}

async function cuerpoJson(req) {
  const texto = await leerCuerpo(req)
  try { return JSON.parse(texto || '{}') } catch { throw new Error('JSON inválido') }
}

// ----------------------------------------------------------------- servidor

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const ruta = u.pathname
  try {
    if (ruta === '/api/salud') {
      const v1 = await oc.get('/config', 2500)
      const laya = await triaje.disponible()
      return enviarJson(res, {
        ok: true, app: 'cerebro-hub', version: '0.2.0', puerto: LISTEN_PORT,
        datos: DATA_DIR, memoria: MEMORIA_DIR,
        servidorV1: oc.puerto() || null, servidorV1Ok: v1.ok,
        laya,
        alertas: vigilante.alertas().length, hora: Date.now(),
      })
    }
    if (ruta === '/api/briefing') {
      const cwd = u.searchParams.get('cwd') || '.'
      return enviarJson(res, {
        ok: true,
        proyecto: memoria.buscarProyecto(cwd),
        texto: memoria.briefing(cwd, { alertas: vigilante.alertas(), jobs: oc.leerJobs(80), hallazgos: leerHallazgos('propuesto') }),
        alertas: vigilante.alertas(),
      })
    }
    if (ruta === '/api/hallazgos' && req.method === 'GET') {
      const estado = u.searchParams.get('estado') || null
      return enviarJson(res, { ok: true, hallazgos: leerHallazgos(estado) })
    }
    if (ruta === '/api/hallazgos' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.nombre) return enviarJson(res, { ok: false, error: 'falta nombre' }, 400)
      return enviarJson(res, { ok: true, hallazgo: registrarHallazgo(b) })
    }
    if (ruta === '/api/hallazgos/estado' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      const r = cambiarEstadoHallazgo(String(b.id || ''), String(b.estado || ''))
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/proyectos') return enviarJson(res, { ok: true, proyectos: memoria.proyectos() })
    if (ruta === '/api/memoria/proyecto') {
      const cwd = u.searchParams.get('cwd') || '.'
      const p = memoria.buscarProyecto(cwd)
      if (!p) return enviarJson(res, { ok: false, error: 'proyecto no registrado todavía' }, 404)
      return enviarJson(res, {
        ok: true, proyecto: p,
        estado: memoria.leerEstado(p.slug), contexto: memoria.leerContexto(p.slug),
        bitacora: (memoria.leerBitacora(p.slug) || '').slice(-4000),
      })
    }
    if (ruta === '/api/memoria/estado' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || typeof b.contenido !== 'string') return enviarJson(res, { ok: false, error: 'faltan cwd o contenido' }, 400)
      return enviarJson(res, { ok: true, proyecto: memoria.escribirEstado(b.cwd, b.contenido) })
    }
    if (ruta === '/api/memoria/contexto' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || typeof b.contenido !== 'string') return enviarJson(res, { ok: false, error: 'faltan cwd o contenido' }, 400)
      return enviarJson(res, { ok: true, proyecto: memoria.escribirContexto(b.cwd, b.contenido) })
    }
    if (ruta === '/api/memoria/bitacora' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || !b.titulo) return enviarJson(res, { ok: false, error: 'faltan cwd o titulo' }, 400)
      return enviarJson(res, { ok: true, proyecto: memoria.agregarBitacora(b.cwd, b.titulo, b.texto || '') })
    }
    if (ruta === '/api/memoria/checkpoint' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd) return enviarJson(res, { ok: false, error: 'falta cwd' }, 400)
      const r = memoria.checkpoint(b.cwd, b.motivo || 'manual', b.nota || '')
      memoria.agregarBitacora(b.cwd, `Checkpoint (${b.motivo || 'manual'})`, b.nota || '')
      return enviarJson(res, { ok: true, proyecto: r.proyecto, archivo: r.archivo })
    }
    if (ruta === '/api/vigilante') {
      // R6 · las alertas del vigilante se muestran con el mismo clasificador que los errores.
      const alertas = vigilante.alertas().map((a) => ({ ...a, info: clasificarAlerta(a) }))
      return enviarJson(res, { ok: true, alertas, trabajos: oc.leerJobs(40) })
    }
    if (ruta.startsWith('/api/trabajos/') && req.method === 'GET') {
      // R7 · detalle vivo de un trabajo (lo usa el panel lateral). Incluye lo que
      // el colector ha ido recopilando (razonamiento, actividad y siguientes pasos).
      const jobId = decodeURIComponent(ruta.slice('/api/trabajos/'.length))
      if (!jobId || jobId === 'cancelar') return enviarJson(res, { ok: false, error: 'falta jobId' }, 400)
      const d = oc.detalleJob(jobId)
      if (d.ok) {
        // Fiable al abrir: si el colector no lo tenía (trabajo antiguo o recién
        // abierto), se recoge en el momento; si ya está fresco, es barato.
        try { await vivo.recolectar(jobId) } catch { /* nada */ }
        d.vivo = vivo.detalle(jobId)
      }
      return enviarJson(res, d, d.ok ? 200 : 404)
    }
    if (ruta === '/api/vivo') return enviarJson(res, { ok: true, ...vivo.estado() })
    if (ruta === '/api/vivo/agente') {
      // Vista viva de una sesión de Claude (actividad; su pensamiento no es legible).
      const sesion = u.searchParams.get('sesion') || ''
      if (!sesion) return enviarJson(res, { ok: false, error: 'falta sesion' }, 400)
      try { vivo.recolectarClaude(sesion) } catch { /* nada */ }
      return enviarJson(res, { ok: true, vivo: vivo.detalleAgente({ sesion }) })
    }
    if (ruta === '/api/trabajos/cancelar' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      const r = await oc.cancelarTrabajos({ directory: b.directory || null, todo: b.todo === true, dryRun: b.dryRun === true, jobId: b.jobId || null })
      return enviarJson(res, r)
    }
    if (ruta === '/api/vigilante/revisar' && req.method === 'POST') {
      vigilante.revisar()
      return enviarJson(res, { ok: true, alertas: vigilante.alertas() })
    }
    if (ruta === '/api/organizacion') return enviarJson(res, { ok: true, ...organizacion.datos() })
    if (ruta === '/api/mcps') {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mcps.json'), 'utf8'))
        return enviarJson(res, { ok: true, ...j })
      } catch {
        return enviarJson(res, { ok: true, total: 0, mcps: [], nota: 'sin inventario todavía; ejecuta hub/mcps.mjs o el agente adaptador-mcps' })
      }
    }
    if (ruta === '/api/actividad') return enviarJson(res, { ok: true, ...(await actividad.calcular()) })
    if (ruta === '/api/latido' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd) return enviarJson(res, { ok: false, error: 'falta cwd' }, 400)
      registrarLatido(b)
      return enviarJson(res, { ok: true })
    }
    if (ruta === '/api/claude/estado' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      registrarEstadoClaude(b)
      return enviarJson(res, { ok: true })
    }
    if (ruta === '/api/claude/estado' && req.method === 'GET') {
      return enviarJson(res, { ok: true, estados: estadosClaudeActivos(u.searchParams.get('cwd')) })
    }
    if (ruta === '/api/log' && req.method === 'POST') {
      // Lo usan hooks, MCP y panel para reportar errores con su stack y contexto.
      const b = await cuerpoJson(req)
      const e = logErrores.registrar({
        origen: b.origen,
        severidad: b.severidad,
        mensaje: b.mensaje,
        stack: b.stack,
        contexto: { ...(b.contexto && typeof b.contexto === 'object' ? b.contexto : {}), ...(b.cwd ? { cwd: b.cwd } : {}) },
      })
      return enviarJson(res, { ok: true, id: e.id })
    }
    if (ruta === '/api/logs') {
      return enviarJson(res, {
        ok: true,
        resumen: logErrores.resumen(),
        errores: logErrores.listar({
          limite: parseInt(u.searchParams.get('limite'), 10) || 100,
          origen: u.searchParams.get('origen') || null,
          severidad: u.searchParams.get('severidad') || null,
        }),
      })
    }
    if (ruta === '/api/logs/exportar') {
      const texto = logErrores.exportar({ limite: parseInt(u.searchParams.get('limite'), 10) || 50 })
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(texto)
    }
    if (ruta === '/api/eventos') {
      // SSE: emite `actividad` solo cuando cambia el estado de algún personaje (cada 2 s).
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      res.write(': conectado\n\n')
      clientesSSE.add(res)
      let firmaAnterior = null
      let cerrado = false
      const emitir = async () => {
        if (cerrado) return
        try {
          const datos = await actividad.calcular()
          // Firma solo con el estado relevante (presencia/estado/tarea y delegaciones), no
          // con los sellos de tiempo, que el MCP reescribe aunque no pase nada.
          const firma = JSON.stringify(datos.proyectos.map((p) => [p.slug, p.personajes, p.delegaciones]))
          if (firma !== firmaAnterior) {
            firmaAnterior = firma
            res.write(`event: actividad\ndata: ${JSON.stringify(datos)}\n\n`)
          } else {
            res.write(': latido\n\n')
          }
        } catch { /* se reintenta en el siguiente ciclo */ }
      }
      const timer = setInterval(emitir, 2000)
      timer.unref?.()
      emitir()
      req.on('close', () => { cerrado = true; clearInterval(timer); clientesSSE.delete(res) })
      return
    }
    if (ruta === '/api/gasto/equipo') return enviarJson(res, await gastoEquipo())
    if (ruta === '/api/gasto') return enviarJson(res, await gasto())
    if (ruta === '/api/ventana') return enviarJson(res, { ok: true, ...(await ventana.calcular()) })
    if (ruta === '/api/reglas') return enviarJson(res, { ok: true, reglas })
    if (ruta === '/api/laya') return enviarJson(res, { ok: true, url: process.env.LAYA_URL || 'http://127.0.0.1:8000', disponible: await triaje.disponible() })
    if (ruta === '/api/triaje' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.tarea) return enviarJson(res, { ok: false, error: 'falta tarea' }, 400)
      const d = await triaje.decidir({ tarea: b.tarea, contexto: b.contexto || '' })
      return enviarJson(res, { ok: true, ...d, presupuestos: reglas.presupuestos || {}, paraleloMax: reglas.paraleloMax ?? 2 })
    }
    if (ruta === '/api/decisiones') {
      let texto = ''
      try { texto = fs.readFileSync(path.join(LOGS_DIR, 'decisiones.jsonl'), 'utf8') } catch { /* sin log */ }
      const lineas = texto.trim().split('\n').filter(Boolean).slice(-30).reverse()
      const decisiones = []
      for (const l of lineas) { try { decisiones.push(JSON.parse(l)) } catch { /* nada */ } }
      return enviarJson(res, { ok: true, decisiones })
    }
    if (ruta === '/favicon.ico') { res.writeHead(204); return res.end() }

    const estaticos = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }
    const archivo = estaticos[ruta]
    if (archivo) {
      const full = path.join(PANEL_DIR, archivo)
      const datos = fs.readFileSync(full)
      res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      return res.end(datos)
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('No encontrado')
  } catch (e) {
    try {
      logErrores.registrarYLog({ origen: 'hub', severidad: 'error', mensaje: `Error atendiendo ${req.method} ${ruta}: ${e?.message || e}`, stack: e?.stack, contexto: { metodo: req.method, ruta } })
    } catch { /* nada */ }
    enviarJson(res, { ok: false, error: String(e?.message || e) }, 500)
  }
})

servidor.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`Cerebro Hub en http://${LISTEN_HOST}:${LISTEN_PORT}`)
  console.log(`Datos:   ${DATA_DIR}`)
  console.log(`Memoria: ${MEMORIA_DIR}`)
  console.log(`Servidor OpenCode V1: ${oc.puerto() ? `127.0.0.1:${oc.puerto()}` : '(no arrancado)'}`)
})
