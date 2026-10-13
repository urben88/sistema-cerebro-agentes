#!/usr/bin/env node
/**
 * Hook `SessionStart` de Claude Code.
 *
 * Inyecta el briefing del proyecto (Cerebro Hub) en cada sesión nueva,
 * reanudada, tras `/clear` o tras una compactación. Si el hub está apagado,
 * lee la memoria directamente del disco (fallback), y si tampoco hay memoria,
 * no dice nada y la sesión sigue con normalidad.
 *
 * Nunca falla: cualquier error se silencia y se sale con código 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')

const normalizar = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

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
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto },
    }))
  }
  process.exit(0)
}

// Fallback sin hub: lectura directa de la memoria en disco
function briefingLocal(cwd) {
  const raiz = path.join(DATA_DIR, 'memoria')
  let registro = {}
  try { registro = JSON.parse(fs.readFileSync(path.join(raiz, 'proyectos.json'), 'utf8')) } catch { return null }
  const n = normalizar(cwd)
  let proyecto = null
  let slug = null
  for (const [s, p] of Object.entries(registro)) {
    if (normalizar(p.ruta) === n) { proyecto = p; slug = s; break }
  }
  if (!proyecto) return null
  const leer = (f) => { try { return fs.readFileSync(path.join(raiz, 'proyectos', slug, f), 'utf8') } catch { return null } }
  const estado = leer('ESTADO.md')
  if (!estado) return null
  const partes = [`# Briefing · ${proyecto.nombre || slug} (memoria local; hub apagado)`, '', estado.trim()]
  const contexto = leer('CONTEXTO-REPO.md')
  if (contexto) partes.push('', '## Contexto del repositorio', contexto.trim())
  return partes.join('\n')
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const cwd = datos.cwd || process.cwd()

  // Solo actuamos si el proyecto tiene memoria: en repos sin memoria no estorbamos.
  let briefing = null
  try {
    const r = await fetch(`${HUB}/api/briefing?cwd=${encodeURIComponent(cwd)}`, { signal: AbortSignal.timeout(2500) })
    if (r.ok) {
      const j = await r.json()
      if (j.ok && j.proyecto) briefing = j.texto
    }
  } catch { /* hub apagado */ }
  if (!briefing) briefing = briefingLocal(cwd)
  if (!briefing) salir(null)

  const cierre = [
    '',
    '---',
    'Recuerda: se escribe aquí desde el Cerebro Hub. Mantén una sola cadena de delegación (preparación → ejecución → validación), no lances fanout, y antes de `/clear` actualiza el ESTADO.md del proyecto (CLI: `node estado.mjs --escribir --archivo <fichero>`).',
  ].join('\n')
  salir(briefing + cierre)
} catch {
  process.exit(0)
}
