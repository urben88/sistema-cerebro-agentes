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
 * cambiar con HUB_URL). Si el hub no responde, avisa y sale con código 1.
 */
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const args = process.argv.slice(2)

function valorDe(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const consulta = args[0] && !args[0].startsWith('--') ? args[0] : null

function uso() {
  console.log('Uso: node buscar.mjs "consulta" [--proyecto x] [--limite n] [--tipo tipo]')
  console.log('  tipos: bitacora | estado | contexto | checkpoint | decision | hallazgo | skill')
}

if (!consulta || args.includes('--help') || args.includes('-h')) {
  uso()
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1)
}

const params = new URLSearchParams({ q: consulta })
if (valorDe('--proyecto')) params.set('proyecto', valorDe('--proyecto'))
if (valorDe('--limite')) params.set('limite', valorDe('--limite'))
if (valorDe('--tipo')) params.set('tipo', valorDe('--tipo'))

try {
  const r = await fetch(`${HUB}/api/buscar?${params}`, { signal: AbortSignal.timeout(8000) })
  const j = await r.json()
  if (!j.ok) { console.error(`Error: ${j.error || `HTTP ${r.status}`}`); process.exit(1) }
  const resultados = Array.isArray(j.resultados) ? j.resultados : []
  if (!resultados.length) {
    console.log(`Sin resultados para «${consulta}».`)
    if (j.modo === 'fallback') console.log('(búsqueda en modo fallback: sin FTS5)')
    process.exit(0)
  }
  console.log(`${resultados.length} resultado(s) para «${consulta}»${j.modo === 'fallback' ? ' (modo fallback)' : ''}:\n`)
  for (const x of resultados) {
    const proyecto = x.proyecto ? ` · ${x.proyecto}` : ''
    console.log(`[${x.tipo}]${proyecto}${x.fecha ? ` · ${x.fecha}` : ''}`)
    console.log(`  ${x.titulo}`)
    if (x.snippet) console.log(`  ${x.snippet.replace(/\s+/g, ' ').trim()}`)
    console.log('')
  }
} catch (e) {
  console.error(`No se pudo hablar con el hub (${HUB}): ${e?.message || e}`)
  console.error('Arranca el hub: bash ~/.sistema-cerebro-agentes/hub.sh (o hub.ps1 en Windows).')
  process.exit(1)
}
