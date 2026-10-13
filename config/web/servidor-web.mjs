#!/usr/bin/env node
/**
 * Panel web en tiempo real de sistema-cerebro-agentes.
 *
 * Servidor local SIN dependencias (Node >= 22) que:
 *  - conecta con el servidor OpenCode V1 del sistema (puerto en server-port.txt)
 *  - muestra sesiones y trabajos del MCP en vivo
 *  - lista y permite ABRIR los ficheros de configuración y los agentes
 *
 * Solo escucha en 127.0.0.1 y es de SOLO LECTURA (no modifica nada).
 *
 * Uso: node servidor-web.mjs [--port 4598]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(HOME, '.sistema-cerebro-agentes')
const PORT_FILE = path.join(SYSTEM_DIR, 'server-port.txt')
const PANEL_CONFIG = path.join(SYSTEM_DIR, 'panel-config.json')
const PUBLIC_DIR = path.join(__dirname, 'public')
const MAX_LECTURA = 300 * 1024 // 300 KB por fichero

const argPort = process.argv.indexOf('--port')
const LISTEN_PORT = argPort >= 0 ? parseInt(process.argv[argPort + 1], 10) || 4598 : 4598

const MCP_TASKS = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'opencode-mcp', 'tasks')
  : path.join(process.env.XDG_STATE_HOME || path.join(HOME, '.local', 'state'), 'opencode-mcp', 'tasks')

// ---------------------------------------------------------------- utilidades

function readText(file, max = MAX_LECTURA) {
  const buf = fs.readFileSync(file)
  const truncado = buf.length > max
  return { texto: buf.subarray(0, max).toString('utf8'), truncado, bytes: buf.length }
}

function findRepoRoot() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PANEL_CONFIG, 'utf8'))
    if (cfg.repoRoot && fs.existsSync(path.join(cfg.repoRoot, 'VERSION'))) return cfg.repoRoot
  } catch { /* sin panel-config */ }
  const candidato = path.resolve(__dirname, '..', '..')
  if (fs.existsSync(path.join(candidato, 'VERSION'))) return candidato
  return null
}

let ocPortCache = { puerto: 0, ts: 0 }
function ocPuerto() {
  const ahora = Date.now()
  if (ahora - ocPortCache.ts < 2000) return ocPortCache.puerto
  let p = 0
  try { p = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10) || 0 } catch { p = 0 }
  ocPortCache = { puerto: p, ts: ahora }
  return p
}

async function ocGet(ruta, timeout = 3000) {
  const puerto = ocPuerto()
  if (!puerto) return { ok: false, error: 'servidor OpenCode V1 no arrancado (falta server-port.txt)' }
  try {
    const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, { signal: AbortSignal.timeout(timeout) })
    const texto = await res.text()
    return { ok: res.ok, status: res.status, texto }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

const verCache = new Map()
function verCmd(cmd) {
  const ahora = Date.now()
  const prev = verCache.get(cmd)
  if (prev && ahora - prev.ts < 60000) return prev.valor
  let valor = null
  try { valor = execSync(cmd, { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0] } catch { valor = null }
  verCache.set(cmd, { valor, ts: ahora })
  return valor
}

function versionServidorOc() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(SYSTEM_DIR, 'server', 'node_modules', 'opencode-ai', 'package.json'), 'utf8'))
    return pkg.version || null
  } catch { return null }
}

// ---------------------------------------------------------------- agentes

function parseFrontmatter(texto) {
  const m = texto.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!m) return { data: {} }
  const data = {}
  for (const linea of m[1].split(/\r?\n/)) {
    if (/^\s/.test(linea)) continue // listas/indentados (p.ej. permissions)
    const i = linea.indexOf(':')
    if (i > 0) {
      const k = linea.slice(0, i).trim()
      const v = linea.slice(i + 1).trim()
      if (k) data[k] = v
    }
  }
  return { data }
}

function repoCompara(nombre, texto) {
  const root = findRepoRoot()
  if (!root) return null
  try { return fs.readFileSync(path.join(root, 'config', 'opencode', 'agents', nombre), 'utf8') === texto } catch { return null }
}

function leerAgentes() {
  const grupos = [
    { dir: path.join(HOME, '.config', 'opencode', 'agents'), origen: 'agents/' },
    { dir: path.join(HOME, '.config', 'opencode', 'agent'), origen: 'agent/' },
  ]
  const lista = []
  for (const g of grupos) {
    let entradas = []
    try { entradas = fs.readdirSync(g.dir) } catch { continue }
    for (const nombre of entradas.filter((n) => n.endsWith('.md')).sort()) {
      const full = path.join(g.dir, nombre)
      let texto = ''
      try { texto = fs.readFileSync(full, 'utf8') } catch { continue }
      const { data } = parseFrontmatter(texto)
      const desc = data.description || ''
      lista.push({
        nombre: nombre.replace(/\.md$/, ''),
        modo: data.mode || '(por defecto)',
        modelo: data.model || '(hereda)',
        descripcion: desc,
        ruta: full,
        origen: g.origen,
        bytes: Buffer.byteLength(texto, 'utf8'),
        repoIgual: repoCompara(nombre, texto),
      })
    }
  }
  return lista
}

// ---------------------------------------------------------------- trabajos MCP

function leerJobs(limite = 25) {
  const out = []
  const walk = (dir) => {
    let entradas = []
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entradas) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.startsWith('job_') && e.name.endsWith('.json')) {
        try {
          const j = JSON.parse(fs.readFileSync(full, 'utf8'))
          out.push({
            jobId: j.jobId,
            sessionId: j.sessionId,
            directory: j.directory,
            status: j.status,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            title: j.session?.title || null,
            error: j.error?.message || null,
          })
        } catch { /* job corrupto */ }
      }
    }
  }
  walk(MCP_TASKS)
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out.slice(0, limite)
}

// ---------------------------------------------------------------- ficheros

function construirFicheros() {
  const lista = []
  const add = (grupo, ruta, nombre) => lista.push({
    i: lista.length,
    grupo,
    nombre: nombre || path.basename(ruta),
    ruta,
    ext: (path.extname(ruta).slice(1) || 'txt').toLowerCase(),
    existe: fs.existsSync(ruta),
  })
  const glob = (grupo, dir, filtro) => {
    let entradas = []
    try { entradas = fs.readdirSync(dir) } catch { return }
    for (const n of entradas.sort()) if (filtro(n)) add(grupo, path.join(dir, n), n)
  }

  glob('Agentes · instalados', path.join(HOME, '.config', 'opencode', 'agents'), (n) => n.endsWith('.md'))
  glob('Agentes · instalados', path.join(HOME, '.config', 'opencode', 'agent'), (n) => n.endsWith('.md'))

  add('Cerebro · Claude Code', path.join(HOME, '.claude', 'CLAUDE.md'), 'CLAUDE.md')
  add('Cerebro · Claude Code', path.join(HOME, '.claude', 'skills', 'delegar-a-opencode', 'SKILL.md'), 'SKILL.md')
  add('Cerebro · Claude Code', path.join(HOME, '.claude', 'skills', 'delegar-a-opencode', 'plantilla-spec.md'), 'plantilla-spec.md')

  add('OpenCode · TUI', path.join(HOME, '.config', 'opencode', 'opencode.jsonc'), 'opencode.jsonc')

  for (const n of ['launcher.ps1', 'launcher.sh', 'servidor.ps1', 'servidor.sh', 'server-port.txt', 'web-port.txt', 'panel-config.json']) {
    add('Sistema · instalado', path.join(SYSTEM_DIR, n), n)
  }

  const root = findRepoRoot()
  if (root) {
    for (const n of ['README.md', 'CHANGELOG.md', 'VERSION']) add('Repositorio', path.join(root, n), n)
    add('Repositorio', path.join(root, 'config', 'claude', 'CLAUDE.md'), 'config/claude/CLAUDE.md')
    add('Repositorio', path.join(root, 'config', 'claude', 'skills', 'delegar-a-opencode', 'SKILL.md'), 'config/claude/skills/SKILL.md')
    add('Repositorio', path.join(root, 'config', 'claude', 'skills', 'delegar-a-opencode', 'plantilla-spec.md'), 'config/claude/skills/plantilla-spec.md')
    glob('Repositorio', path.join(root, 'config', 'opencode', 'agents'), (n) => n.endsWith('.md'))
    glob('Repositorio', path.join(root, 'config', 'mcp'), () => true)
    glob('Repositorio', path.join(root, 'docs'), (n) => n.endsWith('.md'))
  }
  return lista
}

// ---------------------------------------------------------------- API

async function apiEstado() {
  const resSession = await ocGet('/session', 4000)
  let sesionesTotal = 0
  let activas = 0
  let ultimaSesion = null
  if (resSession.ok) {
    try {
      const arr = JSON.parse(resSession.texto)
      if (Array.isArray(arr)) {
        sesionesTotal = arr.length
        const ahora = Date.now()
        const orden = arr.slice().sort((a, b) => (b?.time?.updated || 0) - (a?.time?.updated || 0))
        activas = orden.filter((s) => ahora - (s?.time?.updated || 0) < 5 * 60 * 1000).length
        const u = orden[0]
        if (u) ultimaSesion = { id: u.id, titulo: u.title || '', directory: u.directory || '', updated: u?.time?.updated || null }
      }
    } catch { /* respuesta no JSON */ }
  }
  const puerto = ocPuerto()
  return {
    hora: Date.now(),
    servidor: {
      ok: resSession.ok,
      puerto: puerto || null,
      version: versionServidorOc(),
      error: resSession.ok ? null : (resSession.error || `HTTP ${resSession.status}`),
    },
    sesionesTotal,
    activas,
    ultimaSesion,
    jobs: leerJobs(25),
    agentes: leerAgentes(),
    motores: {
      mcp: '3.0.0',
      claude: verCmd('claude --version'),
      opencodeTui: verCmd('opencode --version'),
      node: process.version,
    },
    rutas: {
      sistema: SYSTEM_DIR,
      servidorOc: path.join(SYSTEM_DIR, 'server'),
      repo: findRepoRoot(),
    },
  }
}

async function apiActividad() {
  const res = await ocGet('/session', 4000)
  let sesiones = []
  if (res.ok) {
    try {
      const arr = JSON.parse(res.texto)
      if (Array.isArray(arr)) {
        sesiones = arr
          .slice()
          .sort((a, b) => (b?.time?.updated || 0) - (a?.time?.updated || 0))
          .slice(0, 30)
          .map((s) => ({
            id: s.id,
            titulo: s.title || '(sin título)',
            directory: s.directory || '',
            creada: s?.time?.created || null,
            actualizada: s?.time?.updated || null,
            costo: typeof s.cost === 'number' ? s.cost : null,
            tokens: s.tokens || null,
            padre: s.parentID || null,
          }))
      }
    } catch { /* nada */ }
  }
  return { ok: res.ok, error: res.ok ? null : (res.error || `HTTP ${res.status}`), sesiones, jobs: leerJobs(30) }
}

async function apiMensajes(id) {
  if (!/^ses_[A-Za-z0-9]+$/.test(id)) return { ok: false, error: 'id inválido' }
  const res = await ocGet(`/session/${encodeURIComponent(id)}/message`, 5000)
  if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}` }
  try {
    const datos = JSON.parse(res.texto)
    if (Array.isArray(datos)) return { ok: true, mensajes: datos.slice(-12) }
    return { ok: true, mensajes: datos }
  } catch {
    return { ok: true, texto: res.texto.slice(0, MAX_LECTURA) }
  }
}

function apiFicheros() {
  try { return { ok: true, ficheros: construirFicheros() } } catch (e) { return { ok: false, error: String(e?.message || e) } }
}

function apiArchivo(i) {
  const ficheros = construirFicheros()
  const f = ficheros[i]
  if (!f) return { ok: false, error: 'fichero no encontrado' }
  try {
    const { texto, truncado, bytes } = readText(f.ruta)
    const stat = fs.statSync(f.ruta)
    return { ok: true, nombre: f.nombre, ruta: f.ruta, contenido: texto, truncado, bytes, modificado: stat.mtimeMs }
  } catch (e) {
    return { ok: false, error: `No se pudo leer: ${String(e?.message || e)}` }
  }
}

// ---------------------------------------------------------------- servidor HTTP

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
}

function enviarJson(res, obj, status = 200) {
  const cuerpo = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': MIME.json, 'Cache-Control': 'no-store' })
  res.end(cuerpo)
}

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const ruta = u.pathname
  try {
    if (ruta === '/api/ping') return enviarJson(res, { ok: true, panel: 'sistema-cerebro-agentes', hora: Date.now() })
    if (ruta === '/api/estado') return enviarJson(res, await apiEstado())
    if (ruta === '/api/actividad') return enviarJson(res, await apiActividad())
    if (ruta.startsWith('/api/sesion/')) {
      const id = decodeURIComponent(ruta.slice('/api/sesion/'.length))
      return enviarJson(res, await apiMensajes(id))
    }
    if (ruta === '/api/ficheros') return enviarJson(res, apiFicheros())
    if (ruta === '/api/archivo') {
      const i = parseInt(u.searchParams.get('i') ?? '-1', 10)
      return enviarJson(res, apiArchivo(i))
    }
    if (ruta === '/favicon.ico') { res.writeHead(204); return res.end() }

    // estáticos (solo estos tres nombres)
    const permitidos = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }
    const archivo = permitidos[ruta]
    if (archivo) {
      const full = path.join(PUBLIC_DIR, archivo)
      const datos = fs.readFileSync(full)
      const ext = path.extname(archivo).slice(1)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      return res.end(datos)
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('No encontrado')
  } catch (e) {
    enviarJson(res, { ok: false, error: String(e?.message || e) }, 500)
  }
})

servidor.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`Panel web de sistema-cerebro-agentes en http://127.0.0.1:${LISTEN_PORT}`)
  console.log(`Sistema: ${SYSTEM_DIR}`)
  console.log(`Repositorio: ${findRepoRoot() || '(no detectado)'}`)
})
