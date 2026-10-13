/**
 * Cliente del servidor OpenCode V1 (el que usa el puente MCP) y lector de
 * trabajos del MCP. Sin dependencias.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function crearOpenCode({ systemDir }) {
  const portFile = path.join(systemDir, 'server-port.txt')
  const tareasMcp = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'opencode-mcp', 'tasks')
    : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'opencode-mcp', 'tasks')

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
      const res = await fetch(`http://127.0.0.1:${p}${ruta}`, { signal: AbortSignal.timeout(timeout) })
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
              agent: j.agent || j.session?.agent || null,
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

  return { puerto, get, sesiones, leerJobs }
}
