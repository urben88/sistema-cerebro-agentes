#!/usr/bin/env node
/**
 * Hook `SessionEnd` de Claude Code.
 *
 * Cuando la sesión termina por `/clear` (o se cierra), guarda un checkpoint de
 * seguridad en la memoria del hub para que la siguiente sesión lo tenga todo.
 * Silencioso y sin efectos si el hub está apagado.
 */
import path from 'node:path'
import os from 'node:os'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 600)
  })
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const reason = datos.reason || 'other'
  if (reason !== 'clear') process.exit(0)
  const cwd = datos.cwd || process.cwd()
  try {
    await fetch(`${HUB}/api/memoria/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, motivo: 'session-end (clear)', nota: '' }),
      signal: AbortSignal.timeout(2500),
    })
  } catch { /* hub apagado */ }
  process.exit(0)
} catch {
  process.exit(0)
}
