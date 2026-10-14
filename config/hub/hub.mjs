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
import { crearBuscar } from './lib/buscar.mjs'
import { crearOpenCode } from './lib/opencode.mjs'
import { crearVigilante } from './lib/vigilante.mjs'
import { crearOrganizacion } from './lib/organizacion.mjs'
import { crearVentana } from './lib/ventana.mjs'
import { crearTriaje } from './lib/triaje.mjs'
import { crearActividad } from './lib/actividad.mjs'
import { clasificarAlerta } from './lib/errores.mjs'
import { crearVivo } from './lib/vivo.mjs'
import { crearLogErrores } from './lib/errores-log.mjs'
import { crearLedger, ESTADOS as ESTADOS_LEDGER } from './lib/ledger.mjs'
import { crearAprobaciones } from './lib/aprobaciones.mjs'
import { crearSkills } from './lib/skills.mjs'
import { crearLanzador } from './lib/lanzador.mjs'
import { crearCron, parsearSchedule } from './lib/cron.mjs'
import { crearCompresion } from './lib/compresion.mjs'

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
// R5 · skills autogenerados: misma carpeta que indexa la búsqueda (tipo=skill).
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills')
const AUTH_JSON = process.env.OPENCODE_AUTH || path.join(HOME, '.local', 'share', 'opencode', 'auth.json')
const OPENCODE_HOST = process.env.OPENCODE_HOST || null
const MAX_CUERPO = 1024 * 1024

// ----------------------------------------------------------------- config

const CONFIG_DEFECTO = {
  puerto: 4597,
  minutosAtasco: 12,
  // R3 · umbrales del ledger de trabajos (configurables en hub-data/config.json).
  minutosAtascoHerramienta: null, // null = hereda minutosAtasco (spec 10, R3.4)
  minutosGraciaAtasco: 2,
  maxConcurrentes: 3,
  minutosPermiso: 20,
  minutosEnfriamiento: 30,
  horasMaxJob: 24,
  temporalDias: 14,
  autolimpiarHoras: 6,
  // R4/R8 · aprobaciones por niveles: el hub clasifica y aplica reglas duras; el cerebro
  // resuelve (lo peligroso lo evalúa el guardián en modo `inteligente`).
  aprobaciones: { modo: 'manual' },
}

function cargarConfig() {
  const archivo = path.join(DATA_DIR, 'config.json')
  // Merge superficial + uno profundo para `aprobaciones` (objeto anidado, R4).
  const fusionar = (usuario) => {
    const base = { ...CONFIG_DEFECTO, ...(usuario && typeof usuario === 'object' ? usuario : {}) }
    const ap = usuario && typeof usuario.aprobaciones === 'object' ? usuario.aprobaciones : {}
    base.aprobaciones = { ...CONFIG_DEFECTO.aprobaciones, ...ap }
    return base
  }
  try { return fusionar(JSON.parse(fs.readFileSync(archivo, 'utf8'))) }
  catch {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(archivo, JSON.stringify(CONFIG_DEFECTO, null, 2) + '\n') } catch { /* sin datos */ }
    return fusionar(null)
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

// --------------------------------------------------------- búsqueda (R1 · spec 10)
// Índice FTS5 (`node:sqlite`) con fallback lineal si no hay FTS5 o HUB_BUSCAR_FALLBACK=1.
const buscar = crearBuscar({
  dataDir: DATA_DIR,
  memoriaDir: MEMORIA_DIR,
  skillsDir: SKILLS_DIR,
  logsDir: LOGS_DIR,
})

// `node hub.mjs --reindexar` reconstruye el índice completo y sale con código 0.
if (process.argv.includes('--reindexar')) {
  try {
    const r = buscar.reindexar()
    console.log(`Reindexado (${r.modo}): ${r.documentos} documento(s)${r.motivo ? ` · ${r.motivo}` : ''}`)
    process.exit(r.ok ? 0 : 1)
  } catch (e) {
    console.error(`Error al reindexar: ${e?.message || e}`)
    process.exit(1)
  }
}

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

// ----------------------------------------------------------------- aprobaciones (R4/R8 · spec 10)
// El hub CLASIFICA comandos/peticiones, aplica las reglas duras del guardián (R8) y mantiene
// su propio allowlist; no aprueba por sí mismo (resuelve el cerebro vía MCP). Reglas en
// `lib/reglas-peligro.json`, allowlist y circuit-breaker en `hub-data/aprobaciones.json`
// (tmp+rename con read-merge-write), veredictos en `hub-data/guardian.jsonl` y cola de
// pendientes en `hub-data/pendientes/`.
const aprobaciones = crearAprobaciones({ dataDir: DATA_DIR, config })

// ----------------------------------------------------------------- skills (R5 · spec 10)
// Propuesta → pendiente → aprobación (nunca existe sin aprobar). Linter+guard en
// `config/hooks/skill-lint.mjs`, contador de uso en `hub-data/skills.usage.json` y
// detección de duplicados con `buscar` (tipo=skill, R1).
const skills = crearSkills({ dataDir: DATA_DIR, skillsDir: SKILLS_DIR, aprobaciones, buscar })

// ----------------------------------------------------------------- cron (R6 · spec 10)
// Planificador persistente (`hub-data/cron/jobs.json`): el hub reclama cada job vencido con
// un claim de TTL y lo lanza por la API V1 con `config/hub/lib/lanzador.mjs` (R0). Los avisos
// (fallos, reintentos) quedan en `hub-data/cron/avisos.json` para la barra del panel. El tope
// de coste sale de `reglas.json` (`presupuestos[agente]`).
const lanzador = crearLanzador({ systemDir: SYSTEM_DIR, host: OPENCODE_HOST })
const cron = crearCron({ dataDir: DATA_DIR, lanzador, reglas })
try { cron.recuperar() } catch { /* nada */ } // recupera claims caducados al arrancar (R6.6)
function cicloCron() {
  try {
    const p = cron.tick()
    if (p && typeof p.catch === 'function') {
      p.catch((e) => { try { logErrores.registrar({ origen: 'cron', severidad: 'aviso', mensaje: `Ciclo del cron falló: ${e?.message || e}` }) } catch { /* nada */ } })
    }
  } catch (e) {
    try { logErrores.registrar({ origen: 'cron', severidad: 'aviso', mensaje: `Ciclo del cron falló: ${e?.message || e}` }) } catch { /* nada */ }
  }
}
setInterval(cicloCron, 30 * 1000).unref?.()

// ------------------------------------------------- compresión de bitácora (R7 · spec 10)
// Resumen propio de contexto: cuando BITACORA.md supera `bitacora_max_chars`
// (reglas.json; 60 000 por defecto) se archiva lo intermedio en BITACORA-archivo/ y
// se deja un resumen (redactor-ds por la API V1, fallback determinista). Máx. una
// compresión por proyecto y día. Reindexa en `buscar` (R1) tras comprimir.
const compresion = crearCompresion({ memoria, lanzador, reglas, buscar })

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

// Tareas de subagentes anunciadas por el mod (agent.spawn) antes o después del latido.
const TAREA_TTL = 2 * 60 * 1000
const tareasPendientes = new Map()
const normDir = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// Lanzamientos de subagentes por modelo y sesión (haiku / sonnet / otro). Es un conteo
// de lanzamientos, no de tokens. Se acota a las 50 sesiones más recientes.
const usoPorSesion = new Map()
const familiaModelo = (m) => { const s = String(m || "").toLowerCase(); return s.includes("haiku") ? "haiku" : s.includes("sonnet") ? "sonnet" : s.includes("opus") ? "opus" : s ? "otro" : "desconocido" }
function contarUso(sesion, modelo) {
  const k = String(sesion || "anon")
  const u = usoPorSesion.get(k) || { haiku: 0, sonnet: 0, opus: 0, otro: 0, desconocido: 0 }
  u[familiaModelo(modelo)]++
  usoPorSesion.delete(k); usoPorSesion.set(k, u)
  while (usoPorSesion.size > 50) usoPorSesion.delete(usoPorSesion.keys().next().value)
}

function tareaPendiente(cwd, agente) {
  const clave = normDir(cwd) + "|" + agente
  const p = tareasPendientes.get(clave)
  return p && Date.now() - p.ts < TAREA_TTL ? p.tarea : null
}

function anunciarTarea(b) {
  const agente = String(b.agente || "")
  if (!agente) return
  const tarea = String(b.tarea || "").replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!tarea) return
  tareasPendientes.set(normDir(b.cwd) + "|" + agente, { tarea, ts: Date.now() })
  // Si el latido del subagente ya existe sin tarea, se la ponemos.
  for (const l of latidos.values()) {
    if (l.agente === agente && normDir(l.cwd) === normDir(b.cwd) && !l.tarea) l.tarea = tarea
  }
}

function registrarLatido(b) {
  const ahora = Date.now()
  const clave = `${b.sesion || "anon"}:${b.agente || "cerebro"}`
  const previo = latidos.get(clave)
  const agente = b.agente || previo?.agente || "cerebro"
  const cwd = b.cwd || previo?.cwd || process.cwd()
  const modelo = b.modelo || previo?.modelo || null
  if (b.evento === "SubagentStart") contarUso(b.sesion, modelo)
  latidos.set(clave, {
    cwd,
    sesion: b.sesion || previo?.sesion || null,
    evento: b.evento || previo?.evento || "desconocido",
    agente,
    tarea: b.tarea || (agente !== "cerebro" ? (previo?.tarea || tareaPendiente(cwd, agente)) : null) || null,
    modelo,
    esfuerzo: b.esfuerzo || previo?.esfuerzo || null,
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

// ------------------------------------------------------- ledger de trabajos (R3 · spec 10)
// Registro durable del hub (`hub-data/trabajos.json`) que sobrevive a los reinicios: se
// reconcilia con `leerJobs()` (no con opencode_job_list), re-engancha lo vivo a `vivo.mjs`,
// marca `desconocido` lo desaparecido y detecta atascos por progreso. NUNCA toca los
// ficheros de job del MCP. Los avisos de atasco reutilizan el mecanismo del vigilante.
// Limpieza de arranque: `tmp` huérfanos de una escritura atómica interrumpida (> 1 h).
try {
  const HORA = 60 * 60 * 1000
  for (const n of fs.readdirSync(DATA_DIR)) {
    if (!/^trabajos\.json\.tmp-/.test(n)) continue
    try { if (Date.now() - fs.statSync(path.join(DATA_DIR, n)).mtimeMs > HORA) fs.unlinkSync(path.join(DATA_DIR, n)) } catch { /* nada */ }
  }
} catch { /* hub-data todavía no existe */ }

const ledger = crearLedger({
  dirDatos: DATA_DIR,
  minutosAtasco: config.minutosAtasco,
  minutosAtascoHerramienta: config.minutosAtascoHerramienta,
  minutosGraciaAtasco: config.minutosGraciaAtasco,
  maxConcurrentes: config.maxConcurrentes,
  horasMaxJob: config.horasMaxJob,
  avisar: (a) => { try { vigilante.agregar(a) } catch { /* nada */ } },
  anotarBitacora: (dir, titulo, texto) => {
    // Solo si el proyecto ya está registrado: no creamos proyectos por un job huérfano.
    try {
      if (!memoria.buscarProyecto(dir)) return
      const p = memoria.agregarBitacora(dir, titulo, texto)
      if (p?.slug) indexarProyectoSilencioso(p.slug) // como el resto de escrituras de memoria
    } catch { /* nada */ }
  },
  // Sondeo por job: un job fuera del top-N de `leerJobs()` no es «desaparecido».
  existeJob: (jobId) => oc.existeJob(jobId),
  log: (d) => { try { logErrores.registrar(d) } catch { /* nada */ } },
})

let ultimoAvisoConcurrencia = 0
function cicloLedger() {
  try {
    // top-80 por `updatedAt` para no parsear todo el histórico; un job vivo pero viejo
    // quedará fuera y el ledger lo confirma con `existeJob` (no lo marca `desconocido`).
    const jobs = oc.leerJobs(80)
    const informe = ledger.reconciliar(jobs)
    // Re-engancha a la vista viva lo que sigue vivo (recolectar ya cachea 15 s por job).
    for (const jobId of informe.reEnganchados) { try { vivo.recolectar(jobId) } catch { /* nada */ } }
    // Atasco por progreso: `updatedAt` del job + eventos con `ts` de vivo.mjs.
    const eventos = {}
    for (const e of ledger.leer()) eventos[e.jobId] = (vivo.detalle(e.jobId).eventos || [])
    ledger.revisarAtascos({ jobs, eventos })
    // Concurrencia: el hub solo mide y avisa (con freno para no inundar el registro).
    const m = ledger.medir()
    if (m.aviso && Date.now() - ultimoAvisoConcurrencia > 10 * 60 * 1000) {
      ultimoAvisoConcurrencia = Date.now()
      logErrores.registrar({ origen: 'ledger', severidad: 'aviso', mensaje: m.mensaje, contexto: { enCurso: m.enCurso, maxConcurrentes: m.maxConcurrentes, profundidad: m.profundidad } })
    }
  } catch (e) {
    try { logErrores.registrar({ origen: 'ledger', severidad: 'aviso', mensaje: `Ciclo del ledger falló: ${e?.message || e}` }) } catch { /* nada */ }
  }
}
cicloLedger() // reconciliación al arrancar (R3.3)
setInterval(cicloLedger, 60 * 1000).unref?.()

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

/** Indexa un proyecto tras escribir memoria: best-effort, pero deja rastro en el log de errores. */
function indexarProyectoSilencioso(slug) {
  try {
    const r = buscar.indexarProyecto(slug)
    if (r && r.ok === false) {
      logErrores.registrar({ origen: 'buscar', severidad: 'aviso', mensaje: `Indexado de «${slug}» falló: ${r.error || 'error desconocido'}`, contexto: { proyecto: slug } })
    }
  } catch (e) {
    logErrores.registrar({ origen: 'buscar', severidad: 'aviso', mensaje: `Indexado de «${slug}» lanzó excepción: ${e?.message || e}`, contexto: { proyecto: slug } })
  }
}

// Reindexado incremental al arrancar (R1.4): no bloquea el arranque si falla.
try {
  const r = buscar.indexarTodo()
  if (r && r.ok === false) logErrores.registrar({ origen: 'buscar', severidad: 'aviso', mensaje: `Indexado inicial falló: ${r.error || 'error desconocido'}` })
} catch (e) {
  logErrores.registrar({ origen: 'buscar', severidad: 'aviso', mensaje: `Indexado inicial lanzó excepción: ${e?.message || e}` })
}

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
    if (ruta === '/api/aprobaciones/clasificar' && req.method === 'POST') {
      // R4.2 · el hub clasifica (hardline|peligroso|seguro + motivo + acción); no aprueba.
      const b = await cuerpoJson(req)
      const texto = b.comando ?? b.texto
      if (typeof texto !== 'string' || !texto.trim()) return enviarJson(res, { ok: false, error: 'faltan comando o texto' }, 400)
      return enviarJson(res, { ok: true, ...aprobaciones.decision(texto, { sessionId: b.sessionId || null }) })
    }
    if (ruta === '/api/aprobaciones/registrar' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.comando !== 'string' || !b.comando.trim()) return enviarJson(res, { ok: false, error: 'falta comando' }, 400)
      const r = aprobaciones.registrar(b.comando, b.alcance, b.sessionId || null)
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    // R8 · el cerebro reporta aquí el veredicto del guardián; el hub aplica reglas duras.
    if (ruta === '/api/aprobaciones/veredicto' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.comando !== 'string' || !b.comando.trim()) return enviarJson(res, { ok: false, error: 'falta comando' }, 400)
      const r = aprobaciones.registrarVeredicto({ comando: b.comando, veredicto: b.veredicto, sessionId: b.sessionId || null, motivo: b.motivo })
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/aprobaciones/circuito/reiniciar' && req.method === 'POST') {
      const r = aprobaciones.reiniciarCircuito()
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/aprobaciones' && req.method === 'GET') {
      return enviarJson(res, { ok: true, ...aprobaciones.estado() })
    }
    if (ruta === '/api/pendientes' && req.method === 'GET') {
      return enviarJson(res, { ok: true, pendientes: aprobaciones.listarPendientes() })
    }
    if (ruta === '/api/pendientes' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      const r = aprobaciones.encolar(b.tipo, { resumen: b.resumen, origen: b.origen, payload: b.payload })
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/pendientes/resolver' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      const r = aprobaciones.resolverPendiente(String(b.tipo || ''), String(b.id || ''))
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    // ------------------------------------------------ skills (R5 · spec 10)
    if (ruta === '/api/skills/proponer' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.nombre !== 'string' || !b.nombre.trim()) return enviarJson(res, { ok: false, error: 'falta nombre' }, 400)
      if (typeof b.descripcion !== 'string' || !b.descripcion.trim()) return enviarJson(res, { ok: false, error: 'falta descripcion' }, 400)
      if (typeof b.cuerpo !== 'string' || !b.cuerpo.trim()) return enviarJson(res, { ok: false, error: 'falta cuerpo' }, 400)
      const r = skills.proponer({ nombre: b.nombre, descripcion: b.descripcion, cuerpo: b.cuerpo, origen: b.origen, referencias: b.referencias })
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/skills/pendientes' && req.method === 'GET') {
      return enviarJson(res, { ok: true, pendientes: skills.pendientes() })
    }
    if (ruta === '/api/skills/aprobar' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.id !== 'string' || !b.id.trim()) return enviarJson(res, { ok: false, error: 'falta id' }, 400)
      const r = skills.aprobar(String(b.id))
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/skills/rechazar' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.id !== 'string' || !b.id.trim()) return enviarJson(res, { ok: false, error: 'falta id' }, 400)
      const r = skills.rechazar(String(b.id))
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/skills/uso' && req.method === 'GET') {
      return enviarJson(res, { ok: true, uso: skills.leerUso(), candidatos: skills.candidatosArchivo() })
    }
    if (ruta === '/api/skills/uso' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.nombre !== 'string' || !b.nombre.trim()) return enviarJson(res, { ok: false, error: 'falta nombre' }, 400)
      const tipo = typeof b.tipo === 'string' && b.tipo.trim() ? b.tipo : 'uso'
      const r = skills.registrarUso(String(b.nombre), tipo, b.veces)
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/skills/archivo' && req.method === 'GET') {
      const dias = u.searchParams.get('dias') || 60
      return enviarJson(res, { ok: true, candidatos: skills.candidatosArchivo(dias) })
    }
    // ------------------------------------------------ cron (R6 · spec 10)
    if (ruta === '/api/cron' && req.method === 'GET') {
      // Jobs programados + avisos (fallos y reintentos) para la barra del panel.
      return enviarJson(res, { ok: true, jobs: cron.listar(), avisos: cron.avisos() })
    }
    if (ruta === '/api/cron' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.prompt !== 'string' || !b.prompt.trim()) return enviarJson(res, { ok: false, error: 'falta prompt' }, 400)
      let schedule = b.schedule
      if (!schedule && typeof b.cuando === 'string') {
        const p = parsearSchedule(b.cuando)
        if (!p.ok) return enviarJson(res, { ok: false, error: p.error, ejemplo: p.ejemplo }, 400)
        schedule = p.schedule
      }
      if (!schedule) {
        return enviarJson(res, { ok: false, error: 'falta cuando o schedule', ejemplo: 'p. ej. «laborables 9:00», «cada 30m» o «0 9 * * 1-5»' }, 400)
      }
      const agente = b.agente || (b.destino && b.destino.agente)
      const directory = b.directory != null ? b.directory : (b.destino && b.destino.directory)
      const r = cron.crear({
        nombre: b.nombre,
        schedule,
        destino: { agente, directory },
        prompt: b.prompt,
        aprobado_usuario: b.aprobado_usuario === true,
      })
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if ((ruta === '/api/cron/pausar' || ruta === '/api/cron/reanudar' || ruta === '/api/cron/borrar') && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.id !== 'string' || !b.id.trim()) return enviarJson(res, { ok: false, error: 'falta id' }, 400)
      const r = ruta.endsWith('/pausar') ? cron.pausar(String(b.id))
        : ruta.endsWith('/reanudar') ? cron.reanudar(String(b.id))
          : cron.borrar(String(b.id))
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/cron/ejecutar' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (typeof b.id !== 'string' || !b.id.trim()) return enviarJson(res, { ok: false, error: 'falta id' }, 400)
      const r = await cron.ejecutar(String(b.id))
      return enviarJson(res, { ok: r.ok, resultado: r, jobs: cron.listar(), avisos: cron.avisos() }, r.ok ? 200 : 400)
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
        bitacoraTamano: (memoria.leerBitacora(p.slug) || '').length,
      })
    }
    if (ruta === '/api/memoria/estado' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || typeof b.contenido !== 'string') return enviarJson(res, { ok: false, error: 'faltan cwd o contenido' }, 400)
      const p = memoria.escribirEstado(b.cwd, b.contenido)
      // R2 · el cuerpo supera el límite: 422 con lo guardado hoy para consolidar.
      if (p.excede) {
        const actual = memoria.buscarProyecto(b.cwd)
        return enviarJson(res, {
          ok: false, motivo: 'excede', limite: p.limite, actuales: p.actuales,
          contenidoActual: actual ? (memoria.leerEstado(actual.slug) || '') : '',
        }, 422)
      }
      indexarProyectoSilencioso(p.slug)
      return enviarJson(res, { ok: true, proyecto: p })
    }
    if (ruta === '/api/memoria/contexto' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || typeof b.contenido !== 'string') return enviarJson(res, { ok: false, error: 'faltan cwd o contenido' }, 400)
      const p = memoria.escribirContexto(b.cwd, b.contenido)
      // R2 · mismo contrato de exceso que ESTADO.md.
      if (p.excede) {
        const actual = memoria.buscarProyecto(b.cwd)
        return enviarJson(res, {
          ok: false, motivo: 'excede', limite: p.limite, actuales: p.actuales,
          contenidoActual: actual ? (memoria.leerContexto(actual.slug) || '') : '',
        }, 422)
      }
      indexarProyectoSilencioso(p.slug)
      return enviarJson(res, { ok: true, proyecto: p })
    }
    if (ruta === '/api/memoria/bitacora' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd || !b.titulo) return enviarJson(res, { ok: false, error: 'faltan cwd o titulo' }, 400)
      const p = memoria.agregarBitacora(b.cwd, b.titulo, b.texto || '')
      indexarProyectoSilencioso(p.slug)
      // R7 · gancho opcional: si la bitácora supera el umbral, comprime en segundo plano
      // sin bloquear la respuesta y sin romper nunca la escritura.
      try {
        if (compresion.necesitaComprimir(p.slug)) {
          const prom = compresion.comprimir(p.slug)
          if (prom && typeof prom.catch === 'function') {
            prom.catch((e) => { try { logErrores.registrar({ origen: 'compresion', severidad: 'aviso', mensaje: `Compresión de «${p.slug}» falló: ${e?.message || e}` }) } catch { /* nada */ } })
          }
        }
      } catch { /* la compresión nunca rompe la escritura de la bitácora */ }
      return enviarJson(res, { ok: true, proyecto: p })
    }
    if (ruta === '/api/memoria/comprimir' && req.method === 'POST') {
      // R7 · compresión manual/forzada. El proyecto admite slug o cwd; un slug con
      // traversal (`..`) se rechaza con 400.
      const b = await cuerpoJson(req)
      const proyecto = b.proyecto ?? b.slug ?? b.cwd
      if (typeof proyecto !== 'string' || !proyecto.trim()) {
        return enviarJson(res, { ok: false, error: 'falta proyecto' }, 400)
      }
      const r = await compresion.comprimir(proyecto, { forzar: b.forzar === true })
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/memoria/compresion' && req.method === 'GET') {
      // R7 · estado de compresión del proyecto (tamaño de bitácora, umbral, última).
      const proyecto = u.searchParams.get('proyecto') || u.searchParams.get('cwd')
      if (!proyecto) return enviarJson(res, { ok: false, error: 'falta proyecto' }, 400)
      const r = compresion.estado(proyecto)
      return enviarJson(res, r, r.ok ? 200 : 400)
    }
    if (ruta === '/api/memoria/checkpoint' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      if (!b.cwd) return enviarJson(res, { ok: false, error: 'falta cwd' }, 400)
      const r = memoria.checkpoint(b.cwd, b.motivo || 'manual', b.nota || '')
      memoria.agregarBitacora(b.cwd, `Checkpoint (${b.motivo || 'manual'})`, b.nota || '')
      indexarProyectoSilencioso(r.proyecto.slug)
      return enviarJson(res, { ok: true, proyecto: r.proyecto, archivo: r.archivo })
    }
    if (ruta === '/api/buscar') {
      // R1 · búsqueda de sesiones y bitácoras. Solo GET; `q` es obligatoria.
      if (req.method !== 'GET') return enviarJson(res, { ok: false, error: 'método no permitido; usa GET' }, 405)
      const q = u.searchParams.get('q')
      if (!q || !q.trim()) return enviarJson(res, { ok: false, error: 'falta q' }, 400)
      const tipo = u.searchParams.get('tipo') || null
      if (tipo && !buscar.tipos.includes(tipo)) {
        return enviarJson(res, { ok: false, error: `tipo inválido; válidos: ${buscar.tipos.join(', ')}` }, 400)
      }
      const r = buscar.buscar(q, {
        proyecto: u.searchParams.get('proyecto') || null,
        limite: u.searchParams.get('limite') || 10,
        tipo,
      })
      return enviarJson(res, { ok: true, modo: r.modo, aviso: r.aviso || null, resultados: r.resultados })
    }
    if (ruta === '/api/vigilante') {
      // R6 · las alertas del vigilante se muestran con el mismo clasificador que los errores.
      const alertas = vigilante.alertas().map((a) => ({ ...a, info: clasificarAlerta(a) }))
      return enviarJson(res, { ok: true, alertas, trabajos: oc.leerJobs(40) })
    }
    if (ruta === '/api/trabajos/ledger' && req.method === 'GET') {
      // R3.5 · lista del ledger durable (filtro ?estado=) + medición de concurrencia.
      // Va ANTES de la ruta genérica /api/trabajos/<jobId>.
      const estado = u.searchParams.get('estado') || null
      if (estado && !ESTADOS_LEDGER.includes(estado)) {
        return enviarJson(res, { ok: false, error: `estado inválido; válidos: ${ESTADOS_LEDGER.join(', ')}` }, 400)
      }
      const trabajos = ledger.listar({ estado })
      return enviarJson(res, { ok: true, total: trabajos.length, trabajos, medicion: ledger.medir() })
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
    if (ruta === '/api/tarea-subagente' && req.method === 'POST') {
      const b = await cuerpoJson(req)
      anunciarTarea(b)
      return enviarJson(res, { ok: true })
    }
    if (ruta === '/api/latidos') {
      // Latidos vivos (Claude y subagentes): los usa la barra de estado y el panel.
      return enviarJson(res, { ok: true, latidos: latidosActivos(), usoModelos: Object.fromEntries(usoPorSesion) })
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
