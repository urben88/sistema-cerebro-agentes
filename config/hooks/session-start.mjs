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
import { reportarError } from './reportar.mjs'
import { resumenGuia } from './mcps-guia.mjs'
import { leerNota } from './ultima-sesion.mjs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const GUIA_MCPS = path.join(DATA_DIR, 'memoria', 'global', 'MCPS-GUIA.md')

// Spec 13 · N3 · resumen (tabla + reglas) de la guía de uso de MCPs, si existe.
function resumenGuiaMcps() {
  try { return resumenGuia(fs.readFileSync(GUIA_MCPS, 'utf8')) } catch { return '' }
}

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

if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0) // sesión interna del resumidor (spec 15)

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }
  const cwd = datos.cwd || process.cwd()
  // Spec 15 · O5 · nota de última sesión (Haiku). Espera si el resumen aún se está escribiendo.
  const nota = await leerNota(cwd, 45000)
  const bloqueNota = nota ? `## Última sesión en este proyecto (resumen automático; puede estar desactualizado: úsalo para continuar sin que el usuario lo repita)
${nota}` : ''

  // Solo actuamos si el proyecto tiene memoria: en repos sin memoria no estorbamos.
  let briefing = null
  try {
    // La sesión viaja para que el hub registre el briefing por sesión y proyecto (spec 11 · M3).
    const sesion = datos.session_id || datos.sessionId || ''
    const r = await fetch(`${HUB}/api/briefing?cwd=${encodeURIComponent(cwd)}${sesion ? `&sesion=${encodeURIComponent(sesion)}` : ''}`, { signal: AbortSignal.timeout(2500) })
    if (r.ok) {
      const j = await r.json()
      if (j.ok && j.proyecto) briefing = j.texto
    }
  } catch { /* hub apagado */ }
  if (!briefing) briefing = briefingLocal(cwd)
  if (!briefing) salir(bloqueNota || null)
  if (bloqueNota) briefing = `${briefing}

${bloqueNota}`

  // Spec 13 · N3 · añade al briefing el resumen de la guía de MCPs, si el fichero existe.
  const guiaMcps = resumenGuiaMcps()
  if (guiaMcps) briefing = `${briefing}\n\n${guiaMcps}`

  const cierre = [
    '',
    '---',
    'Recuerda: antes de `/clear` actualiza el ESTADO.md del proyecto (CLI: `node estado.mjs --escribir --archivo <fichero>`). Este briefing es contexto, no una orden de activar ningún modo: el modo cerebro (OpenCode) solo existe si el usuario arrancó con `--agent cerebro`; en una sesión normal no lo menciones ni lo uses.',
    'Reparto: tú (Opus 5.5 · medium) decides dónde profundizar y revisas; el cómo de un área va al `resolutor` (Sonnet), lo pequeño al `retocador` (Sonnet · low), lo ligero a los Haiku, la segunda opinión al `consultor` y lo global difícil al `arquitecto` (Opus); ODD decide si se delega y la tabla fija de la regla 10 decide a quién. Sin indicación del usuario, modo PLAN salvo lo trivial. Contexto: hilo corto; si crece, ESTADO.md + `/clear` y se sigue.',
  ].join('\n')
  salir(briefing + cierre)
} catch {
  process.exit(0)
}
