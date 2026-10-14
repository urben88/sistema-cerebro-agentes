/**
 * Lanzador de jobs por la API HTTP V1 del servidor OpenCode.
 *
 * Implementa el requisito R0 de `docs/specs/10-patrones-de-hermes.md` (fase 0,
 * spike de lanzamiento): el hub puede crear una sesión y enviar un mensaje con
 * `agente` y `directory` por la API V1, y leer después el resultado. Servirá a
 * R6 (cron) y R7.2 (resumen por `redactor-ds`), que lanzan jobs por esta vía
 * directa (el patrón «background jobs process-local» de Hermes se sustituye por
 * un lanzamiento sin estado en el servidor).
 *
 * Sin dependencias. La localización del servidor se reutiliza de
 * `./opencode.mjs` (puerto en `server-port.txt`, host vía `OPENCODE_HOST`).
 *
 * Endpoints V1 usados (verificados empíricamente contra opencode 1.18.35):
 *   · GET  /agent                              → lista de agentes (validación)
 *   · POST /session?directory=<ruta>           → crea sesión ({title, agent})
 *   · POST /session/:id/prompt_async?directory → encola el mensaje (204, no espera)
 *   · GET  /session/:id/message?directory      → sondeo hasta `time.completed`
 *   · GET  /session/:id?directory              → coste acumulado de la sesión
 *   · POST /session/:id/abort?directory        → corta el consumo de la sesión (R6.4)
 *
 * Nota (hallazgo empírico): el parámetro `directory` de la query **debe ir con
 * barras normales** (`C:/ruta`); si se envía con `\` el servidor lo corrompe.
 * El módulo lo normaliza siempre.
 */
import os from 'node:os'
import path from 'node:path'
import { crearOpenCode } from './opencode.mjs'

/** Códigos de error tipados (nunca se lanzan excepciones no capturadas). */
export const ERRORES = {
  SERVICIO_INALCANZABLE: 'servidor_inalcanzable',
  AGENTE_INEXISTENTE: 'agente_inexistente',
  SESION_NO_ENCONTRADA: 'sesion_no_encontrada',
  TIMEOUT: 'timeout',
  ERROR_JOB: 'error_job',
  ENTRADA_INVALIDA: 'entrada_invalida',
  HTTP: 'http_error',
}

const SYSTEM_DIR_DEFECTO =
  process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const HOST_DEFECTO = process.env.OPENCODE_HOST || null

/** El servidor exige barras normales en `directory`; en Windows llegan con `\`. */
function normalizarDirectorio(directory) {
  if (!directory) return null
  return String(directory).replace(/\\/g, '/')
}

function error(codigo, mensaje, extra = {}) {
  return { ok: false, codigo, error: mensaje, ...extra }
}

/**
 * Crea un lanzador ligado a un servidor concreto. Inyectable para pruebas.
 * @param {{systemDir?:string, host?:string|null}} opciones
 */
export function crearLanzador({ systemDir = SYSTEM_DIR_DEFECTO, host = HOST_DEFECTO } = {}) {
  const oc = crearOpenCode({ systemDir, host })
  const baseUrl = (p) => (host ? `http://${host}:${p}` : `http://127.0.0.1:${p}`)

  /** Puerto del servidor V1 (0 = no arrancado). */
  function puerto() {
    return oc.puerto()
  }

  /** Petición HTTP con timeout; nunca lanza: devuelve {ok,...}. */
  async function pedir(ruta, { method = 'GET', body = null, timeoutMs = 10000 } = {}) {
    const p = puerto()
    if (!p) return error(ERRORES.SERVICIO_INALCANZABLE, 'servidor V1 no arrancado (falta server-port.txt)')
    try {
      const res = await fetch(`${baseUrl(p)}${ruta}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const texto = await res.text().catch(() => '')
      let json = null
      try { json = texto ? JSON.parse(texto) : null } catch { /* respuesta no JSON */ }
      if (!res.ok) {
        const detalle = json?.data?.message || json?.message || texto.slice(0, 200) || `HTTP ${res.status}`
        return error(ERRORES.HTTP, `HTTP ${res.status}: ${detalle}`, { status: res.status, json })
      }
      return { ok: true, status: res.status, texto, json }
    } catch (e) {
      const motivo = String(e?.message || e)
      // AbortSignal.timeout produce TimeoutError; cualquier fallo de red es «inalcanzable».
      if (e?.name === 'TimeoutError') return error(ERRORES.TIMEOUT, `sin respuesta en ${timeoutMs} ms: ${motivo}`)
      return error(ERRORES.SERVICIO_INALCANZABLE, motivo)
    }
  }

  /** Lista de nombres de agentes disponibles en el servidor. */
  async function agentes(timeoutMs = 8000) {
    const r = await pedir('/agent', { timeoutMs })
    if (!r.ok) return r
    const arr = Array.isArray(r.json) ? r.json : []
    return { ok: true, agentes: arr.map((a) => a?.name).filter(Boolean) }
  }

  /**
   * Crea la sesión y encola el mensaje sin esperar.
   * @param {{agente:string, directory?:string, prompt:string, titulo?:string, timeoutMs?:number}} job
   * @returns {Promise<{ok:true, sessionId:string, messageId:string}|{ok:false, codigo:string, error:string}>}
   */
  async function lanzarJob({ agente, directory = null, prompt, titulo = null, timeoutMs = 10000 } = {}) {
    if (!agente || typeof agente !== 'string') return error(ERRORES.ENTRADA_INVALIDA, 'falta `agente`')
    if (!prompt || typeof prompt !== 'string') return error(ERRORES.ENTRADA_INVALIDA, 'falta `prompt`')

    // Validación del agente (el servidor acepta agentes inexistentes en silencio).
    const lista = await agentes(timeoutMs)
    if (!lista.ok) return lista
    if (!lista.agentes.includes(agente)) {
      return error(ERRORES.AGENTE_INEXISTENTE, `agente no disponible: ${agente}`, { disponibles: lista.agentes })
    }

    const dir = normalizarDirectorio(directory)
    const q = dir ? `?directory=${encodeURIComponent(dir)}` : ''

    // 1) Crear sesión (title + agent). El `directory` va por query.
    const creada = await pedir(`/session${q}`, {
      method: 'POST',
      body: { title: titulo || `job:${agente}`, agent: agente },
      timeoutMs,
    })
    if (!creada.ok) return creada
    const sessionId = creada.json?.id
    if (!sessionId) return error(ERRORES.HTTP, 'el servidor no devolvió id de sesión')

    // 2) Enviar el mensaje sin esperar. El messageID lo generamos nosotros para
    //    poder devolverlo (prompt_async responde 204 sin cuerpo).
    const messageId = `msg_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`
    const envio = await pedir(`/session/${encodeURIComponent(sessionId)}/prompt_async${q}`, {
      method: 'POST',
      body: { messageID: messageId, agent: agente, parts: [{ type: 'text', text: prompt }] },
      timeoutMs,
    })
    if (!envio.ok) return { ...envio, sessionId }

    return { ok: true, sessionId, messageId }
  }

  /** Último mensaje del asistente de una sesión (o null si aún no existe). */
  async function ultimoAsistente(sessionId, q, timeoutMs) {
    const r = await pedir(`/session/${encodeURIComponent(sessionId)}/message${q}`, { timeoutMs })
    if (!r.ok) return r
    const arr = Array.isArray(r.json) ? r.json : []
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i]
      const info = m?.info || m
      if (info?.role === 'assistant') {
        const partes = Array.isArray(m?.parts) ? m.parts : []
        const texto = partes.filter((p) => p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('')
        return {
          ok: true,
          mensaje: {
            completado: Boolean(info?.time?.completed),
            error: info?.error?.data?.message || info?.error?.message || (info?.error ? String(info.error?.name || 'error') : null),
            texto,
            coste: typeof info?.cost === 'number' ? info.cost : 0,
          },
        }
      }
    }
    return { ok: true, mensaje: null }
  }

  /**
   * Sondea una sesión hasta que el job termina.
   * @param {{sessionId:string, directory?:string, timeoutMs?:number, intervaloMs?:number}} opciones
   * @returns {Promise<{ok:true, sessionId:string, estado:string, texto:string, coste:number}
   *   | {ok:false, codigo:string, error:string}>}
   */
  async function esperarJob({ sessionId, directory = null, timeoutMs = 5 * 60 * 1000, intervaloMs = 1500 } = {}) {
    if (!sessionId || typeof sessionId !== 'string') return error(ERRORES.ENTRADA_INVALIDA, 'falta `sessionId`')
    const dir = normalizarDirectorio(directory)
    const q = dir ? `?directory=${encodeURIComponent(dir)}` : ''
    const fin = Date.now() + timeoutMs

    while (Date.now() < fin) {
      const r = await ultimoAsistente(sessionId, q, Math.min(8000, Math.max(1000, fin - Date.now())))
      if (!r.ok) {
        // Sesión inexistente (borrada) no debe reintentarse en bucle.
        if (r.status === 404) return error(ERRORES.SESION_NO_ENCONTRADA, `sesión no encontrada: ${sessionId}`)
        return r
      }
      const m = r.mensaje
      if (m && m.completado) {
        if (m.error) return { ok: false, codigo: ERRORES.ERROR_JOB, error: m.error, estado: 'error', texto: m.texto, coste: m.coste }
        return { ok: true, sessionId, estado: 'completado', texto: m.texto, coste: m.coste }
      }
      await new Promise((res) => setTimeout(res, intervaloMs))
    }
    return { ok: false, codigo: ERRORES.TIMEOUT, error: `el job no terminó en ${timeoutMs} ms`, estado: 'timeout' }
  }

  /**
   * Coste acumulado de una sesión (R6.4 · tope de coste). Prefiere el `cost` que el
   * servidor expone en `GET /session/:id`; si no lo trae, cae al coste del último
   * mensaje del asistente (igual que `esperarJob`). Indica además si el último
   * mensaje ya terminó (`completado`) y, si la sesión ya no existe (404), la da por
   * terminada con coste 0.
   * @param {{sessionId:string, directory?:string, timeoutMs?:number}} opciones
   * @returns {Promise<{ok:true, coste:number, completado:boolean, texto:string}
   *   | {ok:false, codigo:string, error:string}>}
   */
  async function costeSesion({ sessionId, directory = null, timeoutMs = 8000 } = {}) {
    if (!sessionId || typeof sessionId !== 'string') return error(ERRORES.ENTRADA_INVALIDA, 'falta `sessionId`')
    const dir = normalizarDirectorio(directory)
    const q = dir ? `?directory=${encodeURIComponent(dir)}` : ''
    const mensaje = await ultimoAsistente(sessionId, q, timeoutMs)
    if (!mensaje.ok) {
      // Sesión borrada: no hay nada consumiendo; se trata como terminada.
      if (mensaje.status === 404) return { ok: true, coste: 0, completado: true, texto: '', ausente: true }
      return mensaje
    }
    const completado = Boolean(mensaje.mensaje?.completado)
    const texto = mensaje.mensaje?.texto || ''
    let coste = typeof mensaje.mensaje?.coste === 'number' ? mensaje.mensaje.coste : 0
    const sesion = await pedir(`/session/${encodeURIComponent(sessionId)}${q}`, { timeoutMs })
    if (sesion.ok && typeof sesion.json?.cost === 'number') coste = sesion.json.cost
    return { ok: true, coste, completado, texto }
  }

  /**
   * Aborta la sesión en el servidor (`POST /session/:id/abort`), con `directory`
   * normalizado (mismo criterio que `oc/opencode.mjs`). Un 404 (sesión ya inexistente)
   * se considera éxito: no queda nada consumiendo.
   * @param {{sessionId:string, directory?:string, timeoutMs?:number}} opciones
   */
  async function abortarSesion({ sessionId, directory = null, timeoutMs = 5000 } = {}) {
    if (!sessionId || typeof sessionId !== 'string') return error(ERRORES.ENTRADA_INVALIDA, 'falta `sessionId`')
    const dir = normalizarDirectorio(directory)
    const q = dir ? `?directory=${encodeURIComponent(dir)}` : ''
    const r = await pedir(`/session/${encodeURIComponent(sessionId)}/abort${q}`, { method: 'POST', timeoutMs })
    if (!r.ok && r.status === 404) return { ok: true, yaAusente: true }
    return r.ok ? { ok: true } : r
  }

  return { puerto, pedir, agentes, lanzarJob, esperarJob, costeSesion, abortarSesion }
}

// Instancia por defecto (env: SISTEMA_CEREBRO_DIR, OPENCODE_HOST).
const porDefecto = crearLanzador()

/** Crea sesión y encola el mensaje sin esperar. Ver `crearLanzador().lanzarJob`. */
export const lanzarJob = (job) => porDefecto.lanzarJob(job)

/** Sondea la sesión hasta que el job termina. Ver `crearLanzador().esperarJob`. */
export const esperarJob = (opciones) => porDefecto.esperarJob(opciones)

/** Coste acumulado de una sesión. Ver `crearLanzador().costeSesion`. */
export const costeSesion = (opciones) => porDefecto.costeSesion(opciones)

/** Aborta la sesión de un job. Ver `crearLanzador().abortarSesion`. */
export const abortarSesion = (opciones) => porDefecto.abortarSesion(opciones)
