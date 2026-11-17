/**
 * Estado del servidor de la red local para la barra: activo o no responde al ping.
 *
 * La barra se refresca cada 3 s y un ping sin respuesta tarda casi 1 s, así que el resultado
 * se guarda unos segundos en un archivo temporal compartido entre sesiones. La IP sale de
 * CEREBRO_SERVIDOR_IP; vacía, desactiva la comprobación.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const IP_POR_DEFECTO = '192.168.0.100'
export const CACHE_MS = 10_000
export const NOMBRE_CACHE = 'cerebro-servidor-lan.json'

const ESPERA_MS = 800

function argumentosPing(ip) {
  if (process.platform === 'win32') return ['-n', '1', '-w', String(ESPERA_MS), ip]
  if (process.platform === 'darwin') return ['-c', '1', '-W', String(ESPERA_MS), ip]
  return ['-c', '1', '-W', '1', ip]
}

function hacerPing(ip) {
  const r = spawnSync('ping', argumentosPing(ip), { encoding: 'latin1', timeout: ESPERA_MS + 700, windowsHide: true })
  return r.stdout || ''
}

function leerCache(ruta, ip, ahora) {
  try {
    const c = JSON.parse(fs.readFileSync(ruta, 'utf8'))
    return c.ip === ip && ahora - c.ts < CACHE_MS ? c.activo : null
  } catch { return null }
}

/** true (responde), false (no responde) o null (sin IP configurada). */
export function estadoServidor({
  ip = process.env.CEREBRO_SERVIDOR_IP ?? IP_POR_DEFECTO,
  ahora = Date.now(),
  ping = hacerPing,
  cache = path.join(os.tmpdir(), NOMBRE_CACHE),
} = {}) {
  if (!ip) return null
  const guardado = leerCache(cache, ip, ahora)
  if (guardado !== null) return guardado
  // Windows sale con 0 en «host de destino inaccesible»: solo vale una respuesta real, con TTL.
  const activo = /ttl=/i.test(ping(ip))
  try { fs.writeFileSync(cache, JSON.stringify({ ip, ts: ahora, activo })) } catch { /* sin caché: se repite el ping */ }
  return activo
}

/** Etiqueta corta para la barra («🟢 .100» / «🔴 .100»); vacía si no hay IP configurada. */
export function etiquetaServidor(opciones = {}) {
  const activo = estadoServidor(opciones)
  if (activo === null) return ''
  const ip = opciones.ip ?? process.env.CEREBRO_SERVIDOR_IP ?? IP_POR_DEFECTO
  return `${activo ? '🟢' : '🔴'} ${/\.\d+$/.exec(ip)?.[0] ?? ip}`
}
