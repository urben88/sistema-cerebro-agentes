#!/usr/bin/env node
/**
 * CLI `buscar` — busca en la memoria del hub, bitácoras, decisiones, hallazgos y
 * skills a través de `GET /api/buscar` (R1 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 *   node buscar.mjs "consulta" [--proyecto x] [--limite n] [--tipo tipo]
 *
 * El hub escucha por defecto en 127.0.0.1:4597 (como el resto de hooks; se puede
 * cambiar con HUB_URL). Si Engram responde, añade sus resultados (tipo `engram:<tipo>`;
 * `--tipo engram` busca solo ahí; spec 23 · S4). Si no responde ni el hub ni Engram,
 * avisa y sale con código 1.
 */
import { buscarEngram, engramDisponible } from './engram.mjs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const args = process.argv.slice(2)

function valorDe(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const consulta = args[0] && !args[0].startsWith('--') ? args[0] : null

function uso() {
  console.log('Uso: node buscar.mjs "consulta" [--proyecto x] [--limite n] [--tipo tipo]')
  console.log('  tipos: bitacora | estado | contexto | checkpoint | decision | hallazgo | skill | engram')
}

if (!consulta || args.includes('--help') || args.includes('-h')) {
  uso()
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1)
}

const params = new URLSearchParams({ q: consulta })
if (valorDe('--proyecto')) params.set('proyecto', valorDe('--proyecto'))
if (valorDe('--limite')) params.set('limite', valorDe('--limite'))
if (valorDe('--tipo')) params.set('tipo', valorDe('--tipo'))

// Spec 23 · S4 · también busca en Engram (si responde) y une los resultados.
const soloEngram = valorDe('--tipo') === 'engram'
const limite = Number(valorDe('--limite')) || 10
// Con otro --tipo o con --proyecto (slug del hub), el filtro es del hub y Engram no entra.
if (soloEngram && valorDe('--proyecto')) { console.error('--proyecto no se aplica a Engram: quítalo o usa otro --tipo.'); process.exit(1) }
const conEngram = soloEngram || (!valorDe('--tipo') && !valorDe('--proyecto'))
// Arranca ya: va en paralelo con la consulta al hub (null = Engram ausente o fallido).
const pEngram = conEngram ? buscarEngram(consulta, { limite }) : Promise.resolve([])

let resultados = []
let modo = null
let fallo = null
if (!soloEngram) {
  try {
    const r = await fetch(`${HUB}/api/buscar?${params}`, { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (!j.ok) fallo = `Error: ${j.error || `HTTP ${r.status}`}`
    else { resultados = Array.isArray(j.resultados) ? j.resultados : []; modo = j.modo }
  } catch (e) {
    fallo = `No se pudo hablar con el hub (${HUB}): ${e?.message || e}\nArranca el hub: bash ~/.sistema-cerebro-agentes/hub.sh (o hub.ps1 en Windows).`
  }
}
// Sin hub y sin nada de Engram, se avisa y se sale con 1, como siempre.
const engramRes = await pEngram
const deEngram = engramRes || []
if (soloEngram && engramRes === null) { console.error('Engram no responde o su plugin no está activo (revisa: node doctor.mjs).'); process.exit(1) }
if (!soloEngram && engramRes === null && engramDisponible()) console.error('Aviso: la búsqueda en Engram falló; se muestran solo los resultados del hub.')
if (fallo && !deEngram.length) { console.error(fallo); process.exit(1) }
if (fallo) console.error(`${fallo.split('\n')[0]} · se muestran solo los resultados de Engram.`)
resultados = [...resultados, ...deEngram]
// --limite sigue siendo el tope de lo que se muestra, también al unir las dos memorias.
if (valorDe('--limite')) resultados = resultados.slice(0, limite)

if (!resultados.length) {
  console.log(`Sin resultados para «${consulta}».`)
  if (modo === 'fallback') console.log('(búsqueda en modo fallback: sin FTS5)')
  process.exit(0)
}
console.log(`${resultados.length} resultado(s) para «${consulta}»${modo === 'fallback' ? ' (modo fallback)' : ''}:\n`)
for (const x of resultados) {
  const proyecto = x.proyecto ? ` · ${x.proyecto}` : ''
  console.log(`[${x.tipo}]${proyecto}${x.fecha ? ` · ${x.fecha}` : ''}`)
  console.log(`  ${x.titulo}`)
  if (x.snippet) console.log(`  ${x.snippet.replace(/\s+/g, ' ').trim()}`)
  console.log('')
}
