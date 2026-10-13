#!/usr/bin/env node
/**
 * Registro de errores desde la terminal.
 *
 * Uso:
 *   node errores.mjs                 → lista los últimos 50
 *   node errores.mjs 200             → lista los últimos 200
 *   node errores.mjs --exportar 80   → informe Markdown listo para pasar a una IA
 *   node errores.mjs --resumen       → reparto por origen y severidad
 *
 * En la máquina instalada:  node ~/.sistema-cerebro-agentes/hub/errores.mjs --exportar
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = process.env.SISTEMA_CEREBRO_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(RAIZ, 'hub-data')

const { crearLogErrores } = await import(new URL('./lib/errores-log.mjs', import.meta.url).href)
const log = crearLogErrores({ dirLogs: path.join(DATA_DIR, 'logs') })

const args = process.argv.slice(2)
const n = parseInt(args.find((a) => /^\d+$/.test(a)) || '50', 10)

if (args.includes('--exportar') || args.includes('-e')) {
  console.log(log.exportar({ limite: n }))
  process.exit(0)
}
if (args.includes('--resumen') || args.includes('-r')) {
  console.log(JSON.stringify(log.resumen(), null, 2))
  process.exit(0)
}
const errores = log.listar({ limite: n })
if (!errores.length) {
  console.log('Sin errores registrados.')
  process.exit(0)
}
for (const e of errores) {
  console.log(`${e.fecha.slice(0, 19).replace('T', ' ')} · ${e.severidad.padEnd(7)} · ${e.origen} · ${String(e.mensaje).slice(0, 180)}`)
  if (e.contexto) console.log(`         contexto: ${String(e.contexto).slice(0, 240)}`)
}
