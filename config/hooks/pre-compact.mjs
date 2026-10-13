#!/usr/bin/env node
/**
 * Hook `PreCompact` de Claude Code.
 *
 * Antes de comprimir el contexto: guarda un checkpoint del estado del proyecto
 * en la memoria del hub y recuerda al agente que complete su ESTADO.md.
 * Nunca bloquea la compactación: falla en silencio (código 0).
 */
import path from 'node:path'
import os from 'node:os'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 800)
  })
}

function salir(texto) {
  if (texto) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: texto },
    }))
  }
  process.exit(0)
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const cwd = datos.cwd || process.cwd()
  const trigger = datos.trigger || 'auto'

  let guardado = null
  try {
    const r = await fetch(`${HUB}/api/memoria/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, motivo: `pre-compact (${trigger})`, nota: String(datos.custom_instructions || '') }),
      signal: AbortSignal.timeout(4000),
    })
    const j = await r.json()
    if (j.ok) guardado = j.archivo
  } catch { /* hub apagado: la compactación sigue */ }

  salir([
    guardado ? `Checkpoint guardado antes de comprimir el contexto: ${guardado}` : 'El Cerebro Hub no está disponible; no se pudo guardar checkpoint previo.',
    'Antes de que el contexto se comprima: si hay algo importante (tarea activa, quién la tiene, siguiente paso, decisiones) que no esté en el ESTADO.md del proyecto, escríbelo AHORA.',
  ].join('\n'))
} catch {
  process.exit(0)
}
