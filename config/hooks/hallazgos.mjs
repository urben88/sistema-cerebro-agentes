#!/usr/bin/env node
/**
 * CLI `hallazgos` — registro compartido de «cosas ya hechas» (librerías, herramientas,
 * repos) que los agentes descubren ANTES de crear nada nuevo.
 *
 * Filosofía: buscar → validar con el usuario → integrar si encaja → si no, crear.
 *
 *   node hallazgos.mjs --proponer "nombre" [--url ...] [--nota ...] [--por agente]
 *   node hallazgos.mjs --listar [--estado propuesto|validado|descartado|integrado]
 *   node hallazgos.mjs --validar <id> | --descartar <id> | --integrar <id>
 *   (--cwd RUTA para asociarlo a un proyecto; por defecto, la carpeta actual)
 */
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const args = process.argv.slice(2)

function valorDe(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

async function llamar(ruta, opciones = {}) {
  const r = await fetch(`${HUB}${ruta}`, { ...opciones, signal: AbortSignal.timeout(6000) })
  return r.json()
}

try {
  if (args.includes('--proponer')) {
    const nombre = valorDe('--proponer')
    if (!nombre) { console.error('Falta el nombre del hallazgo'); process.exit(1) }
    const j = await llamar('/api/hallazgos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        url: valorDe('--url') || '',
        nota: valorDe('--nota') || '',
        por: valorDe('--por') || 'agente',
        proyecto: valorDe('--cwd') || process.cwd(),
      }),
    })
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    console.log(`Hallazgo registrado: [${j.hallazgo.id}] ${j.hallazgo.nombre} (estado: propuesto)`)
    console.log('El Cerebro se lo preguntará al usuario para validarlo antes de integrar nada.')
  } else if (args.includes('--listar')) {
    const estado = valorDe('--estado')
    const j = await llamar(`/api/hallazgos${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`)
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    if (!j.hallazgos.length) { console.log('Sin hallazgos registrados.'); process.exit(0) }
    for (const h of j.hallazgos) {
      console.log(`[${h.id}] ${h.nombre} · ${h.estado}${h.url ? ` · ${h.url}` : ''}${h.por ? ` · por ${h.por}` : ''}`)
    }
  } else if (args.includes('--validar') || args.includes('--descartar') || args.includes('--integrar')) {
    const estado = args.includes('--validar') ? 'validado' : args.includes('--descartar') ? 'descartado' : 'integrado'
    const id = valorDe('--validar') || valorDe('--descartar') || valorDe('--integrar')
    if (!id) { console.error('Falta el id'); process.exit(1) }
    const j = await llamar('/api/hallazgos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado }),
    })
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    console.log(`Hallazgo ${id} → ${estado}.`)
  } else {
    console.log('Uso: node hallazgos.mjs --proponer "nombre" [--url ...] [--nota ...] [--por agente]')
    console.log('     node hallazgos.mjs --listar [--estado propuesto]')
    console.log('     node hallazgos.mjs --validar|--descartar|--integrar <id>')
    process.exit(1)
  }
} catch (e) {
  console.error(`No se pudo hablar con el hub (${HUB}): ${e?.message || e}`)
  process.exit(1)
}
