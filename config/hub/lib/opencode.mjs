/**
 * Cliente del servidor OpenCode V1 (el que usa el puente MCP) y lector de
 * trabajos del MCP. Sin dependencias.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Normaliza el campo `agent` de un job: en ficheros antiguos puede venir como objeto o como «Object». */
function nombreAgente(j) {
  const limpio = (v) => {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (!s || s === 'Object' || s === '[object Object]') return null
    return s
  }
  const a = j?.agent
  if (a && typeof a === 'object') return limpio(a.name) || limpio(a.id)
  const directo = limpio(a)
  if (directo) return directo
  const s = j?.session?.agent
  if (s && typeof s === 'object') return limpio(s.name) || limpio(s.id)
  return limpio(s)
}

export function crearOpenCode({ systemDir, host = null }) {
  const portFile = path.join(systemDir, 'server-port.txt')
  const baseUrl = (p) => (host ? `http://${host}:${p}` : `http://127.0.0.1:${p}`)
  const tareasMcp = process.env.OPENCODE_MCP_TASKS || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'opencode-mcp', 'tasks')
    : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'opencode-mcp', 'tasks'))

  let cachePuerto = { puerto: 0, ts: 0 }
  function puerto() {
    const ahora = Date.now()
    if (ahora - cachePuerto.ts < 3000) return cachePuerto.puerto
    let p = 0
    try { p = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10) || 0 } catch { p = 0 }
    cachePuerto = { puerto: p, ts: ahora }
    return p
  }

  async function get(ruta, timeout = 4000) {
    const p = puerto()
    if (!p) return { ok: false, error: 'servidor V1 no arrancado (falta server-port.txt)' }
    try {
      const res = await fetch(`${baseUrl(p)}${ruta}`, { signal: AbortSignal.timeout(timeout) })
      const texto = await res.text()
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, texto }
      return { ok: true, texto }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  }

  async function sesiones() {
    const r = await get('/session', 5000)
    if (!r.ok) return { ok: false, error: r.error }
    try {
      const arr = JSON.parse(r.texto)
      return { ok: true, sesiones: Array.isArray(arr) ? arr : [] }
    } catch { return { ok: false, error: 'respuesta no JSON' } }
  }

  /**
   * Lista de sesiones normalizada para la actividad del panel: expone `directory` y
   * `time.updated` (como `updatedAt`) y filtra las que no se han tocado en la ventana
   * indicada (por defecto 5 min). Devuelve hoja plana, ordenada de más reciente a más
   * antigua, para no obligar a quien la use a conocer la forma cruda de `/session`.
   */
  async function sesionesRecientes(ventanaMs = 5 * 60 * 1000) {
    const r = await sesiones()
    if (!r.ok) return { ok: false, error: r.error, sesiones: [] }
    const ahora = Date.now()
    const lista = r.sesiones
      .map((s) => ({
        id: s?.id || null,
        directory: s?.directory || null,
        updatedAt: s?.time?.updated || null,
        title: s?.title || null,
        agent: s?.agent || null,
        cost: typeof s?.cost === 'number' ? s.cost : 0,
      }))
      .filter((s) => s.directory && s.updatedAt && ahora - s.updatedAt < ventanaMs)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { ok: true, sesiones: lista }
  }

  function leerJobs(limite = 60) {
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
              agent: nombreAgente(j),
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
    walk(tareasMcp)
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return out.slice(0, limite)
  }

  /**
   * Lista pensada para la barra de estado y los resúmenes: primero mira fechas de
   * modificación (barato) y solo parsea los ficheros dentro de la ventana pedida.
   */
  function leerJobsRecientes(ventanaMs = 12 * 60 * 60 * 1000, limite = 40) {
    const ahora = Date.now()
    const candidatos = []
    const walk = (dir) => {
      let entradas = []
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entradas) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.startsWith('job_') && e.name.endsWith('.json')) {
          try {
            const st = fs.statSync(full)
            if (ahora - st.mtimeMs <= ventanaMs) candidatos.push({ full, mtime: st.mtimeMs })
          } catch { /* ilegible */ }
        }
      }
    }
    walk(tareasMcp)
    candidatos.sort((a, b) => b.mtime - a.mtime)
    const out = []
    for (const c of candidatos.slice(0, limite)) {
      try {
        const j = JSON.parse(fs.readFileSync(c.full, 'utf8'))
        out.push({
          jobId: j.jobId,
          sessionId: j.sessionId,
          directory: j.directory,
          agent: nombreAgente(j),
          status: j.status,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
          title: j.session?.title || null,
          cost: typeof j.session?.cost === 'number' ? j.session.cost : null,
          modelo: j.session?.model?.id || null,
          variant: j.session?.model?.variant || null,
          error: j.error?.message || null,
        })
      } catch { /* job corrupto */ }
    }
    return out
  }

  /**
   * Detalle de un trabajo para los resúmenes de progreso: estado, coste, tokens,
   * último paso y últimas herramientas. Sin volcar la conversación entera.
   */
  function detalleJob(jobId) {
    const esperado = `job_${String(jobId || '').replace(/^job_/, '')}.json`
    let encontrado = null
    const walk = (dir) => {
      if (encontrado) return
      let entradas = []
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entradas) {
        if (encontrado) return
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === esperado) encontrado = full
      }
    }
    walk(tareasMcp)
    if (!encontrado) return { ok: false, error: `trabajo no encontrado: ${jobId}` }
    let j
    try { j = JSON.parse(fs.readFileSync(encontrado, 'utf8')) } catch { return { ok: false, error: 'el fichero del trabajo no se pudo leer' } }
    const partes = Array.isArray(j.result?.parts) ? j.result.parts : []
    const textos = partes.filter((p) => p.type === 'text' && p.text).map((p) => String(p.text))
    const ultimoTexto = (textos.length ? textos[textos.length - 1] : String(j.result?.text || '')).trim()
    const herramientas = partes.filter((p) => p.type === 'tool').slice(-5).map((p) => ({ tool: p.tool || '?', estado: p.state?.status || null }))
    const parches = partes.filter((p) => p.type === 'patch').flatMap((p) => (Array.isArray(p.files) ? p.files : []))
    return {
      ok: true,
      job: {
        jobId: j.jobId,
        sessionId: j.sessionId,
        agent: nombreAgente(j),
        title: j.session?.title || null,
        directory: j.directory || null,
        status: j.status,
        createdAt: j.createdAt || null,
        updatedAt: j.updatedAt || null,
        error: j.error?.message || (typeof j.error === 'string' ? j.error : null),
        cost: typeof j.session?.cost === 'number' ? j.session.cost : null,
        tokens: j.session?.tokens || null,
        modelo: j.session?.model?.id || null,
        variant: j.session?.model?.variant || null,
        inputs: Array.isArray(j.inputs) ? j.inputs.length : 0,
        ultimoTexto: ultimoTexto.slice(0, 2000),
        herramientas,
        archivosPatch: parches.slice(0, 20),
      },
    }
  }

  return { puerto, get, sesiones, sesionesRecientes, leerJobs, leerJobsRecientes, detalleJob }
}
