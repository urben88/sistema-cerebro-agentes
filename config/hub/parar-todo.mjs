#!/usr/bin/env node
/**
 * Apaga de golpe los trabajos de OpenCode en segundo plano (los que lanza el Cerebro).
 *
 * Uso:
 *   node parar-todo.mjs                 → cancela TODOS los trabajos activos
 *   node parar-todo.mjs <directorio>    → solo los de ese proyecto
 *   node parar-todo.mjs --seco          → no cancela: dice lo que haría
 *
 * Es lo que ejecuta el comando `cerebro-parar` y sirve de botón de pánico si algo
 * se quedó corriendo (por ejemplo, si Claude se cerró de golpe y su hook de cierre
 * no llegó a ejecutarse).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = process.env.SISTEMA_CEREBRO_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dirigido = args.find((a) => !a.startsWith('-')) || null
const seco = args.includes('--seco') || args.includes('--dry-run')
const todo = !dirigido || args.includes('--todo') || args.includes('--todos')

const { crearOpenCode } = await import(new URL('./lib/opencode.mjs', import.meta.url).href)
const oc = crearOpenCode({ systemDir: RAIZ })

try {
  const r = await oc.cancelarTrabajos({ todo, directory: dirigido, dryRun: seco })
  if (!r.revisados) {
    console.log('No había trabajos de OpenCode activos.')
    process.exit(0)
  }
  const alcance = todo ? 'todos los proyectos' : dirigido
  console.log(`Trabajos activos (${alcance}): ${r.revisados}${seco ? ' · modo seco (no se ha cancelado nada)' : ` · cancelados: ${r.cancelados}`}`)
  for (const x of r.resultados) console.log(`  - ${x.jobId} · ${x.agente || '?'} · ${x.cancelado ? 'cancelado' : (seco ? 'se cancelaría' : 'NO cancelado')} · ${x.motivo}`)
  if (!seco && r.cancelados < r.revisados) {
    console.log('Aviso: algún trabajo no se pudo cancelar; comprueba que el servidor V1 esté en marcha.')
  }
  process.exit(0)
} catch (e) {
  console.error(`No se pudo consultar los trabajos: ${String(e?.message || e)}`)
  process.exit(1)
}
