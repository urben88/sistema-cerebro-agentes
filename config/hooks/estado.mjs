#!/usr/bin/env node
/**
 * CLI `estado` — atajo para la memoria del proyecto (Cerebro Hub).
 *
 *   node estado.mjs --leer                     · muestra el ESTADO.md
 *   node estado.mjs --escribir --archivo f.md  · guarda ese fichero como ESTADO.md
 *   node estado.mjs --bitacora "título"        · añade una entrada a la bitácora
 *                                                (con Engram activo, va a Engram)
 *   node estado.mjs --checkpoint "motivo"      · guarda un checkpoint
 *   (--cwd RUTA para otro proyecto; por defecto, la carpeta actual)
 */
import fs from 'node:fs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const args = process.argv.slice(2)

function valorDe(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const cwd = valorDe('--cwd') || process.cwd()
const archivo = valorDe('--archivo')
const titulo = valorDe('--bitacora')
const motivo = valorDe('--checkpoint')

async function llamar(ruta, cuerpo) {
  const r = await fetch(`${HUB}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(6000),
  })
  return r.json()
}

try {
  if (args.includes('--leer')) {
    const r = await fetch(`${HUB}/api/memoria/proyecto?cwd=${encodeURIComponent(cwd)}`, { signal: AbortSignal.timeout(4000) })
    const j = await r.json()
    if (!j.ok) { console.error(`No hay memoria para: ${cwd} (${j.error || ''})`); process.exit(1) }
    console.log(j.estado || '(sin ESTADO.md todavía)')
  } else if (args.includes('--escribir')) {
    if (!archivo) { console.error('Falta --archivo'); process.exit(1) }
    const contenido = fs.readFileSync(archivo, 'utf8')
    const j = await llamar('/api/memoria/estado', { cwd, contenido })
    // R2 · el cuerpo supera el límite: el hub lo rechaza con lo guardado hoy.
    if (!j.ok && j.motivo === 'excede') {
      console.error(`El ESTADO.md supera el límite de ${j.limite} caracteres de cuerpo (guardado hoy: ${j.actuales}). Consolida moviendo lo cerrado a la bitácora (node estado.mjs --bitacora "título") y vuelve a intentarlo.`)
      process.exit(1)
    }
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    console.log(`ESTADO.md actualizado para ${j.proyecto.nombre} (${j.proyecto.slug}).`)
  } else if (args.includes('--bitacora')) {
    if (!titulo) { console.error('Falta el título de la bitácora'); process.exit(1) }
    const texto = valorDe('--texto') || ''
    // Spec 24 · S2: con Engram activo, la entrada va a Engram; si falla, al hub.
    const { anotarBitacora } = await import('./engram.mjs')
    const j = await anotarBitacora({ hub: HUB, cwd, titulo, texto })
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    console.log(j.destino === 'engram' ? 'Entrada guardada en Engram.' : 'Entrada añadida a la bitácora.')
  } else if (args.includes('--checkpoint')) {
    const j = await llamar('/api/memoria/checkpoint', { cwd, motivo: motivo || 'manual', nota: '' })
    if (!j.ok) { console.error(`Error: ${j.error}`); process.exit(1) }
    console.log(`Checkpoint guardado: ${j.archivo}`)
  } else {
    console.log('Uso: node estado.mjs --leer | --escribir --archivo f.md | --bitacora "título" | --checkpoint "motivo" [--cwd RUTA]')
    process.exit(1)
  }
} catch (e) {
  console.error(`No se pudo hablar con el hub (${HUB}): ${e?.message || e}`)
  process.exit(1)
}
