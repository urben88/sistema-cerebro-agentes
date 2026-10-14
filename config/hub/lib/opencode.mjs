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

  /** Resume la entrada de una herramienta en una línea corta y legible. */
  function resumirEntrada(input) {
    if (!input || typeof input !== 'object') return null
    const claves = ['filePath', 'command', 'pattern', 'query', 'description', 'path', 'url', 'prompt']
    for (const k of claves) {
      const v = input[k]
      if (typeof v === 'string' && v.trim()) return `${k}: ${v.slice(0, 160)}`
    }
    const primera = Object.entries(input).find(([, v]) => typeof v === 'string' && v.trim())
    return primera ? `${primera[0]}: ${String(primera[1]).slice(0, 160)}` : null
  }

  /**
   * Mensajes de una sesión V1 normalizados para la vista viva: razonamiento,
   * textos, herramientas (con estado y entrada resumida) y parches. Sin volcar
   * nada raro: todo recortado y en campos con nombre.
   */
  async function sesionMensajes(sessionId, timeout = 6000) {
    const r = await get(`/session/${encodeURIComponent(sessionId)}/message`, timeout)
    if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status}` }
    try {
      const crudos = JSON.parse(r.texto)
      const mensajes = (Array.isArray(crudos) ? crudos : []).map((m) => {
        const info = m?.info || m || {}
        const partes = (m?.parts || []).map((p) => ({
          id: p?.id || null,
          tipo: p?.type || '?',
          texto: typeof p?.text === 'string' ? p.text : null,
          tool: p?.tool || null,
          estado: p?.state?.status || null,
          entrada: resumirEntrada(p?.state?.input),
          archivos: Array.isArray(p?.files) ? p.files.slice(0, 20) : null,
        }))
        return {
          id: info.id || null,
          rol: info.role || '?',
          creado: info.time?.created || null,
          modelo: info.modelID || null,
          variant: info.variant || null,
          agente: info.agent || null,
          coste: typeof info.cost === 'number' ? info.cost : null,
          tokens: info.tokens || null,
          partes,
        }
      })
      return { ok: true, mensajes }
    } catch { return { ok: false, error: 'respuesta no JSON' } }
  }

  /** Siguientes pasos (todo list) de una sesión V1. */
  async function sesionTodo(sessionId, timeout = 5000) {
    const r = await get(`/session/${encodeURIComponent(sessionId)}/todo`, timeout)
    if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status}` }
    try {
      const t = JSON.parse(r.texto)
      const lista = Array.isArray(t) ? t : (Array.isArray(t?.todos) ? t.todos : [])
      return {
        ok: true,
        todos: lista
          .map((x) => ({
            contenido: String(x?.content || x?.text || x || '').slice(0, 300),
            estado: x?.status || null,
            prioridad: x?.priority || null,
          }))
          .filter((x) => x.contenido),
      }
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
              agent: nombreAgente(j),
              status: j.status,
              createdAt: j.createdAt,
              updatedAt: j.updatedAt,
              title: j.session?.title || null,
              modelo: j.session?.model?.id || null,
              variant: j.session?.model?.variant || null,
              cost: typeof j.session?.cost === 'number' ? j.session.cost : null,
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
  function rutaJob(jobId) {
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
    return encontrado
  }

  /**
   * ¿Sigue existiendo el fichero de un job? Lo usa el ledger para no confundir «fuera
   * del top-N de `leerJobs()`» con «desaparecido»: un job vivo con `updatedAt` viejo
   * puede no entrar en la ventana, pero su fichero sigue en disco.
   */
  function existeJob(jobId) {
    try { return !!rutaJob(jobId) } catch { return false }
  }

  function detalleJob(jobId) {
    const encontrado = rutaJob(jobId)
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

  /** Aborta la sesión de un trabajo en el servidor OpenCode V1 (corta el consumo). */
  async function abortarSesion(sessionId) {
    const p = puerto()
    if (!p) return { ok: false, error: 'servidor V1 no arrancado (falta server-port.txt)' }
    if (!sessionId) return { ok: false, status: 404, error: 'el trabajo no tiene sessionId' }
    try {
      const res = await fetch(`${baseUrl(p)}/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', signal: AbortSignal.timeout(4000) })
      if (res.ok) return { ok: true }
      const texto = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: `HTTP ${res.status}${texto ? ' ' + texto.slice(0, 120) : ''}` }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  }

  /** Marca un fichero de trabajo como cancelado (que el panel no lo deje «en curso»). */
  function marcarCancelado(jobId, nota) {
    const p = rutaJob(jobId)
    if (!p) return false
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      j.status = 'cancelled'
      j.updatedAt = Date.now()
      j.error = { message: `Cerebro: ${nota}` }
      fs.writeFileSync(p, JSON.stringify(j), 'utf8')
      return true
    } catch { return false }
  }

  /**
   * Cancela trabajos de OpenCode: uno concreto (`jobId`), los del directorio
   * indicado, o todos (`todo`). Aborta la sesión en el servidor V1 y marca el
   * fichero del trabajo; con `dryRun` solo informa de lo que cancelaría.
   */
  async function cancelarTrabajos({ directory = null, todo = false, dryRun = false, maxHoras = 24, jobId = null } = {}) {
    const normalizar = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const objetivo = directory ? normalizar(directory) : null
    const limite = Date.now() - maxHoras * 60 * 60 * 1000
    const ventana = todo ? 30 * 24 * 60 * 60 * 1000 : maxHoras * 60 * 60 * 1000
    const candidatos = leerJobsRecientes(ventana, 100).filter((j) =>
      ['running', 'accepted', 'input_required'].includes(j.status) &&
      (j.updatedAt || 0) >= limite &&
      (jobId ? j.jobId === jobId : (todo || (objetivo && normalizar(j.directory) === objetivo))))
    const resultados = []
    for (const j of candidatos) {
      if (dryRun) {
        resultados.push({ jobId: j.jobId, agente: j.agent, estado: j.status, cancelado: false, motivo: 'prueba (dry-run): no se toca' })
        continue
      }
      const ab = await abortarSesion(j.sessionId)
      // 404 = la sesión ya no existe: no hay nada consumiendo; el trabajo se descarta igual.
      const cancelado = ab.ok || ab.status === 404
      if (cancelado) marcarCancelado(j.jobId, ab.ok ? 'cancelado (sesión cerrada)' : 'descartado (la sesión ya no existía)')
      resultados.push({
        jobId: j.jobId,
        agente: j.agent,
        estado: j.status,
        cancelado,
        motivo: ab.ok ? 'abortado en el servidor V1' : (ab.status === 404 ? 'la sesión ya no existía' : ab.error),
      })
    }
    return { ok: true, revisados: candidatos.length, cancelados: resultados.filter((r) => r.cancelado).length, resultados }
  }

  return { puerto, get, sesiones, sesionesRecientes, sesionMensajes, sesionTodo, leerJobs, leerJobsRecientes, detalleJob, existeJob, abortarSesion, cancelarTrabajos }
}
