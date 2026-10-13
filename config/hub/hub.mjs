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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(HOME, '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const MEMORIA_DIR = process.env.HUB_MEMORIA_DIR || path.join(DATA_DIR, 'memoria')
const LOGS_DIR = path.join(DATA_DIR, 'logs')
const PANEL_DIR = path.join(__dirname, 'panel')
const PLANTILLAS_DIR = path.join(__dirname, 'plantillas')
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

const argPort = process.argv.indexOf('--port')
const puertoArg = argPort >= 0 ? parseInt(process.argv[argPort + 1], 10) || 0 : 0
const config = cargarConfig()
const LISTEN_PORT = puertoArg || config.puerto

fs.mkdirSync(LOGS_DIR, { recursive: true })

// ----------------------------------------------------------------- piezas

const memoria = crearMemoria(MEMORIA_DIR, { temporalDias: config.temporalDias, plantillasDir: PLANTILLAS_DIR })
memoria.inicializar()
const oc = crearOpenCode({ systemDir: SYSTEM_DIR })
const organizacion = crearOrganizacion({ home: HOME })
const ventana = crearVentana()

function registrarAlerta(a) {
  try { fs.appendFileSync(path.join(LOGS_DIR, 'vigilante.jsonl'), JSON.stringify({ ...a, fecha: new Date().toISOString() }) + '\n') } catch { /* nada */ }
}
const vigilante = crearVigilante({ leerJobs: (n) => oc.leerJobs(n), config, registrar: registrarAlerta })
vigilante.arrancar(60 * 1000)
try { memoria.limpiarTemporales() } catch { /* nada */ }
setInterval(() => { try { memoria.limpiarTemporales() } catch { /* nada */ } }, config.autolimpiarHoras * 60 * 60 * 1000).unref?.()

// ----------------------------------------------------------------- gasto

let cacheGasto = { ts: 0, datos: null }
async function gasto(forzar = false) {
  const ahora = Date.now()
  if (!forzar && cacheGasto.datos && ahora - cacheGasto.ts < 5 * 60 * 1000) return cacheGasto.datos
  const datos = { generado: ahora }
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(HOME, '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
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
      return enviarJson(res, {
        ok: true, app: 'cerebro-hub', version: '0.2.0', puerto: LISTEN_PORT,
        datos: DATA_DIR, memoria: MEMORIA_DIR,
        servidorV1: oc.puerto() || null, servidorV1Ok: v1.ok,
        alertas: vigilante.alertas().length, hora: Date.now(),
      })
    }
    if (ruta === '/api/briefing') {
      const cwd = u.searchParams.get('cwd') || '.'
      return enviarJson(res, {
        ok: true,
        proyecto: memoria.buscarProyecto(cwd),
        texto: memoria.briefing(cwd, { alertas: vigilante.alertas(), jobs: oc.leerJobs(80) }),
        alertas: vigilante.alertas(),
      })
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
    if (ruta === '/api/vigilante') return enviarJson(res, { ok: true, alertas: vigilante.alertas(), trabajos: oc.leerJobs(40) })
    if (ruta === '/api/vigilante/revisar' && req.method === 'POST') {
      vigilante.revisar()
      return enviarJson(res, { ok: true, alertas: vigilante.alertas() })
    }
    if (ruta === '/api/organizacion') return enviarJson(res, { ok: true, ...organizacion.datos() })
    if (ruta === '/api/gasto') return enviarJson(res, await gasto())
    if (ruta === '/api/ventana') return enviarJson(res, { ok: true, ...(await ventana.calcular()) })
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
    enviarJson(res, { ok: false, error: String(e?.message || e) }, 500)
  }
})

servidor.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`Cerebro Hub en http://127.0.0.1:${LISTEN_PORT}`)
  console.log(`Datos:   ${DATA_DIR}`)
  console.log(`Memoria: ${MEMORIA_DIR}`)
  console.log(`Servidor OpenCode V1: ${oc.puerto() ? `127.0.0.1:${oc.puerto()}` : '(no arrancado)'}`)
})
