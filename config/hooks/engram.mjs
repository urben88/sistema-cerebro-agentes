/**
 * Puente con Engram (spec 23 · S1): saber si está activo y buscar en él.
 *
 * Engram es la memoria de decisiones y sesiones (lo instala Gentle AI); el hub
 * deja de repetir lo que Engram ya hace. Todo va en el host porque el hub corre
 * en Docker y no ve el binario.
 *
 * «Activo» = el plugin `engram@engram` está activo en settings.json (sus hooks son
 * los que inyectan y guardan las sesiones) y el binario responde. Si solo está el
 * binario, los hooks del hub siguen como antes.
 *
 *   ENGRAM_BIN          binario a usar (pruebas: puede ser un .mjs)
 *   ENGRAM_SETTINGS     settings.json donde mirar el plugin (pruebas)
 *   ENGRAM_DESACTIVADO  "1" → se trata como ausente
 *
 * Nunca lanza: un fallo o un timeout cuentan como «Engram ausente».
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

let respondeCache = null

function comando(args) {
  const bin = process.env.ENGRAM_BIN || 'engram'
  return /\.(m?js)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]
}

/** true si el plugin de Engram está activo en Claude Code. */
export function pluginActivo() {
  const f = process.env.ENGRAM_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
  try { return JSON.parse(fs.readFileSync(f, 'utf8'))?.enabledPlugins?.['engram@engram'] === true } catch { return false }
}

/** true si `engram version` responde (solo el binario). Se calcula una vez por proceso. */
export function engramResponde() {
  if (process.env.ENGRAM_DESACTIVADO === '1') return false
  if (respondeCache === null) {
    const [cmd, args] = comando(['version'])
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1500, windowsHide: true })
      respondeCache = !r.error && r.status === 0 && /engram/i.test(r.stdout || '')
    } catch { respondeCache = false }
  }
  return respondeCache
}

/** true si Engram está activo: plugin activo (lectura barata, primero) y binario que responde. */
export function engramDisponible() {
  return process.env.ENGRAM_DESACTIVADO !== '1' && pluginActivo() && engramResponde()
}

/**
 * Convierte la salida de `engram search` en resultados con la forma de `/api/buscar`:
 * `[1] #2 (decision) — Título` / snippet / `fecha | project: x | scope: y`.
 */
export function parsearBusqueda(texto) {
  const resultados = []
  let actual = null
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const cab = linea.match(/^\[\d+\]\s+#(\d+)\s+\(([^)]+)\)\s+[—-]\s+(.*)$/)
    if (cab) {
      actual = { tipo: `engram:${cab[2]}`, id: Number(cab[1]), titulo: cab[3].trim(), snippet: '', fecha: '', proyecto: '' }
      resultados.push(actual)
      continue
    }
    if (!actual || !linea.trim()) continue
    const pie = linea.match(/^\s*(\d{4}-\d{2}-\d{2}[^|]*)\|\s*project:\s*([^|]+)/)
    if (pie) { actual.fecha = pie[1].trim(); actual.proyecto = pie[2].trim() }
    else if (!actual.snippet) actual.snippet = linea.trim()
  }
  return resultados
}

/**
 * Busca en Engram sin bloquear (puede ir en paralelo con el hub).
 * Devuelve la lista de resultados, o null si Engram no está activo o la búsqueda falla.
 */
export function buscarEngram(consulta, { limite = 10, cwd } = {}) {
  if (!engramDisponible()) return Promise.resolve(null)
  const [cmd, args] = comando(['search', consulta, '--limit', String(limite)])
  return new Promise((res) => {
    let out = ''
    let hijo
    try { hijo = spawn(cmd, args, { windowsHide: true, cwd: cwd || process.cwd() }) } catch { return res(null) }
    const reloj = setTimeout(() => { try { hijo.kill() } catch { /* nada */ } res(null) }, 8000)
    hijo.stdout.on('data', (c) => { out += c })
    hijo.on('error', () => { clearTimeout(reloj); res(null) })
    hijo.on('close', (code) => { clearTimeout(reloj); res(code === 0 ? parsearBusqueda(out) : null) })
  })
}
