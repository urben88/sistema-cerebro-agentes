#!/usr/bin/env node
/**
 * Barra de estado de Claude Code: modelo, contexto y trabajo de OpenCode en curso.
 * Lo registra settings-merge.mjs en ~/.claude/settings.json como `statusLine`
 * (con refreshInterval), solo si el usuario no tiene una propia.
 *
 * Silencioso y a prueba de fallos: si los trabajos no se pueden leer, imprime
 * solo la parte de Claude; si todo falla, no imprime nada.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearOpenCode } from './lib/opencode.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    let hecho = false
    const terminar = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', terminar)
    // Tope corto: no esperar al cierre del stdin si Claude tarda en cerrarlo.
    setTimeout(terminar, 200)
  })
}

const norm = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const MIN = 60 * 1000

function duracion(desde, hasta) {
  const m = Math.max(0, Math.round(((hasta || Date.now()) - (desde || Date.now())) / MIN))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }

  const pct = Math.floor(datos.context_window?.used_percentage ?? 0)
  const modelo = datos.model?.display_name || 'Claude'
  const dir = datos.workspace?.current_dir || datos.cwd || ''
  const partes = [`🧠 ${modelo} ${pct}%`, `📁 ${path.basename(dir || '.')}`]

  try {
    const oc = crearOpenCode({ systemDir: __dirname })
    const jobs = oc.leerJobsRecientes(60 * MIN, 40).filter((j) => norm(j.directory) === norm(dir))
    const activos = jobs.filter((j) => ['running', 'accepted', 'input_required'].includes(j.status) && Date.now() - (j.updatedAt || 0) < 60 * MIN)
    // Prioriza el que más información da: espera respuesta > en marcha > aceptado; y el más reciente.
    const peso = { input_required: 0, running: 1, accepted: 2 }
    activos.sort((a, b) => (peso[a.status] ?? 3) - (peso[b.status] ?? 3) || (b.updatedAt || 0) - (a.updatedAt || 0))
    const cerrado = jobs.find((j) => ['completed', 'failed'].includes(j.status) && Date.now() - (j.updatedAt || 0) < 5 * MIN)
    if (activos.length) {
      const j = activos[0]
      const extra = activos.length > 1 ? ` (+${activos.length - 1})` : ''
      const esfuerzo = j.variant ? ` (${j.variant})` : ''
      if (j.status === 'input_required') {
        partes.push(`🤖 ${j.agent || '?'}${esfuerzo} ⏳ pregunta · ${duracion(j.createdAt, j.updatedAt)}${extra}`)
      } else {
        partes.push(`🤖 ${j.agent || '?'}${esfuerzo} · ${duracion(j.createdAt, j.updatedAt)}${typeof j.cost === 'number' ? ` · $${j.cost.toFixed(2)}` : ''}${extra}`)
      }
    } else if (cerrado) {
      partes.push(`${cerrado.status === 'completed' ? '✅' : '❌'} ${cerrado.agent || '?'} ${cerrado.status === 'completed' ? 'terminó' : 'falló'} hace ${duracion(cerrado.updatedAt, Date.now())}`)
    }
  } catch { /* sin trabajos legibles: se enseña solo la parte de Claude */ }

  console.log(partes.join(' · '))
} catch {
  console.log('')
}
