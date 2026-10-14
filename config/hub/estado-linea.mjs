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
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

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
const nombreEsfuerzo = (v) => ({ low: 'bajo', medium: 'medio', high: 'alto', max: 'máximo', default: 'def' })[String(v || '').toLowerCase()] || String(v || '')
const recortar = (t, n) => { const s = String(t || ''); return s.length > n ? `${s.slice(0, n)}…` : s }

function duracion(desde, hasta) {
  const m = Math.max(0, Math.round(((hasta || Date.now()) - (desde || Date.now())) / MIN))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(String(bruto || '{}').replace(/^﻿/, '')) } catch { /* payload no JSON */ }

  const pct = Math.floor(datos.context_window?.used_percentage ?? 0)
  const modelo = datos.model?.display_name || 'Claude'
  const dir = datos.workspace?.current_dir || datos.cwd || ''

  // Latidos del hub (una sola lectura): sirven para el modo y para los subagentes.
  let latidos = []
  let usoModelos = {}
  try {
    const rl0 = await fetch(`${HUB}/api/latidos`, { signal: AbortSignal.timeout(500) }).then((r) => r.json())
    latidos = rl0.latidos || []
    usoModelos = rl0.usoModelos || {}
  } catch { /* hub apagado */ }

  // Modo: cerebro solo si la sesión se arrancó con `--agent cerebro` (campo agent del
  // JSON de la barra, o el agente de los latidos de esta misma sesión). Si no, normal.
  // Solo cuenta lo que el hook declaró (`agenteDeclarado`): el campo `agente` de los latidos
  // cae a «cerebro» por defecto en el hub y marcaba como cerebro cualquier sesión normal.
  const modoCerebro = String(datos.agent?.name || '').toLowerCase() === 'cerebro' ||
    latidos.some((l) => l.sesion && l.sesion === datos.session_id && String(l.agenteDeclarado || '').toLowerCase() === 'cerebro')
  const esfuerzo0 = datos.effort?.level ? nombreEsfuerzo(datos.effort.level) : ''
  const partes = [
    modoCerebro ? '🧠 CEREBRO' : '💬 normal',
    `${modelo}${esfuerzo0 ? `·${esfuerzo0}` : ''} ${pct}%`,
    `📁 ${path.basename(dir || '.')}`,
  ]
  const lim = datos.rate_limits || {}
  const p5 = lim.five_hour?.used_percentage
  const p7 = lim.seven_day?.used_percentage
  if (typeof p5 === 'number' || typeof p7 === 'number') {
    partes.push(`⏱ ${typeof p5 === 'number' ? `5h ${Math.round(p5)}%` : ''}${typeof p5 === 'number' && typeof p7 === 'number' ? ' · ' : ''}${typeof p7 === 'number' ? `7d ${Math.round(p7)}%` : ''}`)
  }

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

  // Subagentes de Claude en marcha (latidos vivos del hub, solo de este proyecto):
  // hasta 3 con modelo · esfuerzo y tiempo de cada uno; con terminal ancha, la tarea.
  try {
    const subs = latidos
      .filter((l) => l.agente && l.agente !== 'cerebro' && l.evento !== 'SubagentStop' && norm(l.cwd) === norm(dir))
      // Primero los que tienen modelo conocido (explorador, planificador…), luego el resto.
      .sort((a, b) => Number(!!b.modelo) - Number(!!a.modelo) || (b.ts || 0) - (a.ts || 0))
    if (subs.length) {
      const visibles = subs.slice(0, 3)
      const trozos = visibles.map((l) => {
        const etiqueta = [l.modelo, l.esfuerzo ? nombreEsfuerzo(l.esfuerzo) : null].filter(Boolean).join('·')
        return `${l.agente}${etiqueta ? ` (${etiqueta})` : ''} ${duracion(l.desde || l.ts, Date.now())}`
      })
      let seg = `👥 ${trozos.join(' · ')}`
      if (subs.length > visibles.length) seg += ` (+${subs.length - visibles.length})`
      const cols = parseInt(process.env.COLUMNS || '0', 10)
      const conTarea = visibles.find((l) => l.tarea)
      if (cols >= 115 && conTarea) seg += ` · «${recortar(conTarea.tarea, 52)}»`
      partes.push(seg)
    }
  } catch { /* hub apagado: sin subagentes */ }

  // Consumo de la sesión por modelo: subagentes lanzados (Haiku / Sonnet). Es un conteo de
  // lanzamientos, no de tokens.
  try {
    const u = usoModelos[datos.session_id] || null
    if (u) {
      const trozos = [["haiku", u.haiku], ["sonnet", u.sonnet], ["opus", u.opus]].filter(([, n]) => n > 0).map(([m, n]) => `${m}×${n}`)
      if (trozos.length) partes.push(`Σ ${trozos.join(" ")}`)
    }
  } catch { /* sin conteo */ }

  // Estado real para el panel: contexto, ventanas de 5 h/7 d y coste que da Claude
  // en vivo. Best effort y corto: si el hub no está, la barra no se bloquea.
  try {
    const rl = datos.rate_limits || {}
    await fetch(`${HUB}/api/claude/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd: dir || null,
        sesion: datos.session_id || null,
        nombre: datos.session_name || null,
        modelo: datos.model?.display_name || null,
        contextoPct: typeof datos.context_window?.used_percentage === 'number' ? datos.context_window.used_percentage : null,
        cincoPct: typeof rl.five_hour?.used_percentage === 'number' ? rl.five_hour.used_percentage : null,
        sietePct: typeof rl.seven_day?.used_percentage === 'number' ? rl.seven_day.used_percentage : null,
        coste: typeof datos.cost?.total_cost_usd === 'number' ? datos.cost.total_cost_usd : null,
        cincoReset: rl.five_hour?.resets_at || null,
        sieteReset: rl.seven_day?.resets_at || null,
      }),
      signal: AbortSignal.timeout(600),
    })
  } catch { /* hub apagado o lento */ }

  console.log(partes.join(' · '))
} catch {
  console.log('')
}
