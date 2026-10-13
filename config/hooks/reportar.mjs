/**
 * Reporta un error de un hook al registro central del hub (`POST /api/log`).
 *
 * Best effort: nunca lanza y no bloquea (tope de 800 ms). Si el hub está apagado,
 * el error se pierde: los hooks no pueden depender de nada que esté caído.
 */
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

export async function reportarError(origen, error, contexto = null) {
  try {
    await fetch(`${HUB}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origen: `hook:${origen}`,
        severidad: 'error',
        mensaje: String(error?.message || error || 'error desconocido'),
        stack: error?.stack || null,
        contexto: { ...(contexto && typeof contexto === 'object' ? contexto : {}), pid: process.pid },
      }),
      signal: AbortSignal.timeout(800),
    })
  } catch { /* hub apagado o lento */ }
}
