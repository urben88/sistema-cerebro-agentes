#!/usr/bin/env node
/**
 * Hook `SessionEnd` — al cerrar la sesión de Claude (o /clear), apaga los trabajos
 * de OpenCode de este proyecto para que no sigan consumiendo tokens en segundo plano.
 *
 * Llega por stdin el JSON del evento (`reason`: prompt_input_exit, logout, clear,
 * other…) con el `cwd`. Cancela los trabajos activos de ese directorio (y del
 * proyecto de la sesión, por si Claude cambió de carpeta) abortando sus sesiones
 * en el servidor OpenCode V1. Deja constancia en la bitácora del hub si cancela algo.
 *
 * Silencioso y a prueba de fallos: nunca bloquea el cierre. El registro en
 * settings-merge le da 8 s de presupuesto; en el caso normal tarda menos de 1 s.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportarError } from './reportar.mjs'

const RAIZ = process.env.SISTEMA_CEREBRO_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    let hecho = false
    const terminar = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', terminar)
    setTimeout(terminar, 400)
  })
}

try {
  const bruto = await leerStdin()
  try { process.stdin.destroy() } catch { /* stdin ya cerrado */ }
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const cwd = datos.cwd || process.cwd()
  const proyecto = process.env.CLAUDE_PROJECT_DIR || null
  const reason = datos.reason || 'other'
  const directorios = [...new Set([cwd, proyecto].filter(Boolean))]

  const { crearOpenCode } = await import(new URL('../hub/lib/opencode.mjs', import.meta.url).href)
  const oc = crearOpenCode({ systemDir: RAIZ })

  let total = 0
  for (const dir of directorios) {
    try {
      const r = await oc.cancelarTrabajos({ directory: dir })
      total += r.cancelados
    } catch { /* servidor V1 caído: no hay nada que cancelar */ }
  }

  if (total > 0) {
    try {
      await fetch(`${HUB}/api/memoria/bitacora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, titulo: `Sesión cerrada (${reason})`, texto: `Se cancelaron ${total} trabajo(s) de OpenCode en segundo plano.` }),
        signal: AbortSignal.timeout(1200),
      })
    } catch { /* hub apagado: mejor esfuerzo */ }
  }
  // Sin process.exit(): en Windows, salir con sockets de fetch cerrándose revienta
  // con una aserción de libuv. Se deja que el proceso termine solo (código 0).
  process.exitCode = 0
} catch (e) {
  await reportarError('cerrar-trabajos', e)
  process.exitCode = 0
}
