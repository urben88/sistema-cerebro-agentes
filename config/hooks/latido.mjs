#!/usr/bin/env node
/**
 * Hook de latido de Claude Code.
 *
 * Avisa al Cerebro Hub de que Claude (o uno de sus subagentes) está trabajando en
 * esta carpeta, para que el panel «La oficina» muestre el personaje en vivo. Se
 * registra en los eventos UserPromptSubmit, Stop, SubagentStart y SubagentStop.
 *
 * Silencioso y a prueba de fallos: tope de ~0,8 s, nunca bloquea a Claude y sale
 * siempre con código 0, aunque el hub esté apagado o tardando.
 *
 * R2 · informa del modelo si puede: primero del payload del hook (`model`/`model.id`/
 * `display_name`); si no, lo deduce de la cola del transcript (último mensaje
 * `assistant`), leyendo solo el final del archivo y con tope de 1 s.
 */
import fs from 'node:fs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const EVENTOS = new Set(['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop'])
const TAM_COLA_TRANSCRIPT = 64 * 1024
const TOPE_MODELO_MS = 1000

/** Modelo declarado directamente en el payload del hook (string u objeto). */
function modeloDelPayload(d) {
  const limpio = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (d?.model) {
    if (typeof d.model === 'string') return limpio(d.model)
    const m = limpio(d.model.id) || limpio(d.model.display_name) || limpio(d.model.model)
    if (m) return m
  }
  return limpio(d?.model_id) || limpio(d?.modelId) || limpio(d?.display_name) || null
}

/** Modelo del último mensaje `assistant` de la cola del transcript (JSONL). */
function modeloDelTranscript(ruta) {
  if (!ruta) return null
  try {
    const fd = fs.openSync(ruta, 'r')
    try {
      const tam = fs.fstatSync(fd).size
      const bytes = Math.min(tam, TAM_COLA_TRANSCRIPT)
      if (bytes <= 0) return null
      const buf = Buffer.alloc(bytes)
      fs.readSync(fd, buf, 0, bytes, tam - bytes)
      const lineas = buf.toString('utf8').split('\n')
      for (let i = lineas.length - 1; i >= 0; i--) {
        const l = lineas[i].trim()
        if (!l) continue
        let e
        try { e = JSON.parse(l) } catch { continue } // la primera línea puede venir cortada
        if (e?.type !== 'assistant' && e?.message?.role !== 'assistant') continue
        const m = e?.message?.model || e?.model
        if (typeof m === 'string' && m.trim()) return m.trim()
      }
    } finally { fs.closeSync(fd) }
  } catch { /* sin transcript legible */ }
  return null
}

/** Modelo del latido: payload primero, transcript después; nunca espera más de 1 s. */
function modeloDe(datos, inicio) {
  const directo = modeloDelPayload(datos)
  if (directo) return directo
  if (Date.now() - inicio > TOPE_MODELO_MS) return null
  return modeloDelTranscript(datos.transcript_path || datos.transcriptPath)
}

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

try {
  const inicio = Date.now()
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }

  const evento = datos.hook_event_name || process.argv[2] || ''
  if (EVENTOS.has(evento)) {
    const modelo = modeloDe(datos, inicio)
    const cuerpo = {
      cwd: datos.cwd || process.cwd(),
      sesion: datos.session_id || datos.sessionId || null,
      evento,
      agente: datos.agent_type || datos.agent || datos.subagent_type || null,
      tarea: (datos.prompt || datos.task || datos.description || '').slice(0, 200) || null,
      modelo: modelo ? modelo.slice(0, 80) : null,
      // Ruta del transcript de la sesión: la usa el hub para la vista viva (solo
      // actividad: herramientas, textos y subtareas; el pensamiento no es legible).
      transcript: datos.transcript_path || datos.transcriptPath || null,
    }
    try {
      await fetch(`${HUB}/api/latido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(600),
      })
    } catch { /* hub apagado o lento: se ignora */ }
  }
  process.exit(0)
} catch {
  process.exit(0)
}
