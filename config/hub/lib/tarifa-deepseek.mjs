/**
 * Tramo de precio de la API de DeepSeek (hora punta / hora valle).
 *
 * Fuente oficial (api-docs.deepseek.com/quick_start/pricing, vigente desde 2026-08-16):
 * punta = lunes a viernes 01:00–04:00 y 06:00–10:00 UTC; el resto (fines de semana
 * incluidos) es valle, a mitad de precio. Los festivos chinos también son valle, pero
 * no se detectan aquí: esos días se mostrará «punta» en esas franjas.
 */

const FRANJAS_PUNTA = [[1, 4], [6, 10]] // horas UTC [inicio, fin)

/** ¿Es hora punta en `fecha`? */
export function esPunta(fecha = new Date()) {
  const dia = fecha.getUTCDay()
  if (dia === 0 || dia === 6) return false
  const h = fecha.getUTCHours()
  return FRANJAS_PUNTA.some(([ini, fin]) => h >= ini && h < fin)
}

/**
 * Tramo actual y cuándo cambia: `{ punta, cambiaEnMin }`. Las franjas empiezan en hora
 * en punto, así que basta con recorrer las horas siguientes (máx. 3 días: un fin de semana).
 */
export function tramoDeepseek(fecha = new Date()) {
  const punta = esPunta(fecha)
  const t = new Date(fecha)
  t.setUTCMinutes(0, 0, 0)
  for (let i = 0; i < 72; i++) {
    t.setUTCHours(t.getUTCHours() + 1)
    if (esPunta(t) !== punta) return { punta, cambiaEnMin: Math.round((t - fecha) / 60000) }
  }
  return { punta, cambiaEnMin: null }
}

/** Texto corto para la barra: «🌙 DS valle ½ (punta en 2h05)» / «🔥 DS punta (valle en 40m)». */
export function etiquetaDeepseek(fecha = new Date()) {
  const { punta, cambiaEnMin: m } = tramoDeepseek(fecha)
  const falta = m == null ? '' : m < 60 ? `${m}m` : m < 24 * 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 1440)}d`
  return punta
    ? `🔥 DS punta${falta ? ` (valle en ${falta})` : ''}`
    : `🌙 DS valle ½${falta ? ` (punta en ${falta})` : ''}`
}
