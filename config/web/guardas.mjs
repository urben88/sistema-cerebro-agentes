/**
 * Guardas de las rutas del panel que MODIFICAN algo (spec perfiles-modelos · S3).
 *
 * Solo se aceptan: POST, desde 127.0.0.1, con `Content-Type: application/json`, con `Host` del propio
 * panel y, si llega `Origin`, también del propio panel (así otra web abierta en el navegador no puede
 * escribir en el panel por el usuario). Sin dependencias.
 */

const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** `null` si la petición puede escribir; si no, `{ status, error }`. `puerto` es el puerto real del panel. */
export function comprobarEscritura(req, puerto) {
  const h = req.headers || {}
  const propios = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`])
  if (req.method !== 'POST') return { status: 405, error: 'solo se acepta POST' }
  if (!LOCALES.has(req.socket?.remoteAddress)) return { status: 403, error: 'las escrituras solo se aceptan desde 127.0.0.1' }
  if (!propios.has(String(h.host || '').toLowerCase())) return { status: 403, error: 'Host no permitido' }
  if (h.origin !== undefined && !propios.has(String(h.origin).replace(/^http:\/\//i, '').toLowerCase())) return { status: 403, error: 'Origin ajeno al panel' }
  if (!/^application\/json\s*(;|$)/i.test(String(h['content-type'] || ''))) return { status: 415, error: 'hace falta Content-Type: application/json' }
  return null
}
