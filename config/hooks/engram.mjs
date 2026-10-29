/**
 * Puente con Engram (spec 23 · S1): saber si responde y buscar en él.
 *
 * Engram es la memoria de decisiones y sesiones (lo instala Gentle AI); el hub
 * deja de repetir lo que Engram ya hace. Todo va en el host porque el hub corre
 * en Docker y no ve el binario.
 *
 *   ENGRAM_BIN          binario a usar (pruebas: puede ser un .mjs)
 *   ENGRAM_DESACTIVADO  "1" → se trata como ausente
 *
 * Nunca lanza: un fallo o un timeout cuentan como «Engram ausente».
 */
import { spawnSync } from 'node:child_process'

let disponibleCache = null

function ejecutar(args, ms, cwd) {
  const bin = process.env.ENGRAM_BIN || 'engram'
  const [cmd, pre] = /\.(m?js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []]
  try {
    const r = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', timeout: ms, windowsHide: true, cwd: cwd || process.cwd() })
    if (r.error || r.status !== 0) return null
    return r.stdout || ''
  } catch { return null }
}

/** true si `engram version` responde. Se calcula una vez por proceso. */
export function engramDisponible() {
  if (process.env.ENGRAM_DESACTIVADO === '1') return false
  if (disponibleCache === null) disponibleCache = /engram/i.test(ejecutar(['version'], 3000) || '')
  return disponibleCache
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

/** Busca en Engram. Devuelve [] si no responde o no hay resultados. */
export function buscarEngram(consulta, { limite = 10, cwd } = {}) {
  if (!engramDisponible()) return []
  const salida = ejecutar(['search', consulta, '--limit', String(limite)], 8000, cwd)
  return salida ? parsearBusqueda(salida) : []
}
