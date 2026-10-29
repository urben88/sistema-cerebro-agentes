#!/usr/bin/env node
/**
 * Hook `SessionEnd` de Claude Code.
 *
 * · Siempre (cierre o `/clear`): lanza en segundo plano la nota de última sesión
 *   resumida por Haiku (spec 15 · O5); la siguiente sesión la carga sola.
 *   Con Engram activo no se lanza: Engram ya guarda las sesiones (spec 23 · S3).
 * · Solo en `/clear`: guarda un checkpoint de seguridad en la memoria del hub.
 * Silencioso: sin hub o sin `claude` en el PATH, no pasa nada.
 */
import path from 'node:path'
import os from 'node:os'
import { reportarError } from './reportar.mjs'
import { lanzarResumen } from './ultima-sesion.mjs'
import { engramDisponible } from './engram.mjs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 600)
  })
}

if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0) // sesión interna del resumidor

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const reason = datos.reason || 'other'
  const cwd = datos.cwd || process.cwd()
  // Spec 23 · S3 · con Engram el resumen de sesión ya lo guarda Engram: no se gasta Haiku en repetirlo.
  if (!engramDisponible()) {
    try { lanzarResumen(datos.transcript_path, cwd) } catch { /* sin nota */ }
  }
  if (reason !== 'clear') process.exit(0)
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
