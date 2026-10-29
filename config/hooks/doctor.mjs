#!/usr/bin/env node
/**
 * Diagnóstico de `/odd:doctor` (spec 22 · S5). SOLO LECTURA: no escribe nada.
 *
 * Puntos (semáforo verde/amarillo/rojo):
 *   · verificar (resumen de aprobadas/fallidas; solo si se encuentra scripts/verificar.*)
 *   · `gentle-ai doctor`
 *   · `opencode mcp list`
 *   · `defaultMode` de ~/.claude/settings.json distinto de bypassPermissions
 *   · hook `gentle-ai review stop-hook` presente
 *   · Engram responde y su plugin está activo (spec 23)
 *
 * Uso: node doctor.mjs [--json]
 * Pruebas: DOCTOR_SETTINGS (ruta de settings.json), DOCTOR_OMITIR (ids separados por coma),
 * DOCTOR_REPO (raíz del repo donde buscar scripts/verificar.*); ENGRAM_BIN (binario de Engram).
 * Sale siempre con 0: es un informe, no una puerta.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { engramResponde } from './engram.mjs'

const SETTINGS = process.env.DOCTOR_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
const OMITIR = new Set((process.env.DOCTOR_OMITIR || '').split(',').map((s) => s.trim()).filter(Boolean))
const esWin = process.platform === 'win32'
const puntos = []
const punto = (id, estado, texto) => puntos.push({ id, estado, texto })

function ejecutar(cmd, args, ms, shell = false) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: ms, shell, windowsHide: true })
  if (r.error) return { ok: false, noExiste: r.error.code === 'ENOENT', salida: String(r.error.message || r.error), code: null }
  return { ok: r.status === 0, noExiste: false, salida: `${r.stdout || ''}${r.stderr || ''}`.trim(), code: r.status }
}
const resumen = (t) => (t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '').slice(0, 120)

let settings = null
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) } catch { /* ausente o ilegible */ }

// 1 · verificar
if (OMITIR.has('verificar')) punto('verificar', 'amarillo', 'omitido')
else {
  const repo = process.env.DOCTOR_REPO || process.cwd()
  const ps1 = path.join(repo, 'scripts', 'verificar.ps1')
  const sh = path.join(repo, 'scripts', 'verificar.sh')
  let r = null
  if (esWin && fs.existsSync(ps1)) r = ejecutar('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], 300000)
  else if (!esWin && fs.existsSync(sh)) r = ejecutar('bash', [sh], 300000)
  if (!r) punto('verificar', 'amarillo', 'no se encuentra scripts/verificar.* (lanza Claude desde la raíz del repo del sistema)')
  else {
    const m = r.salida.match(/Aprobadas:\s*(\d+)\s+Fallidas:\s*(\d+)/i)
    if (m) punto('verificar', Number(m[2]) === 0 ? 'verde' : 'rojo', `${m[1]} aprobadas, ${m[2]} fallidas`)
    else punto('verificar', r.ok ? 'verde' : 'rojo', resumen(r.salida) || `código ${r.code}`)
  }
}

// 2 · gentle-ai doctor
if (OMITIR.has('gentle-ai')) punto('gentle-ai', 'amarillo', 'omitido')
else {
  const r = ejecutar('gentle-ai', ['doctor'], 60000)
  if (r.noExiste) punto('gentle-ai', 'amarillo', 'gentle-ai no está en el PATH')
  else punto('gentle-ai', r.ok ? 'verde' : 'rojo', r.ok ? 'gentle-ai doctor sin errores' : (resumen(r.salida) || `código ${r.code}`))
}

// 3 · opencode mcp list
if (OMITIR.has('opencode')) punto('opencode', 'amarillo', 'omitido')
else {
  const r = ejecutar('opencode', ['mcp', 'list'], 60000, esWin)
  if (r.noExiste || (!r.ok && /no se reconoce|not recognized|not found/i.test(r.salida))) punto('opencode', 'amarillo', 'opencode no está en el PATH')
  else punto('opencode', r.ok ? 'verde' : 'rojo', r.ok ? 'opencode mcp list responde' : (resumen(r.salida) || `código ${r.code}`))
}

// 4 · permisos
{
  const modo = settings?.permissions?.defaultMode ?? settings?.defaultMode
  if (modo === 'bypassPermissions') punto('permisos', 'rojo', 'defaultMode = bypassPermissions: Claude no pide permiso para nada')
  else punto('permisos', 'verde', `defaultMode = ${modo || 'por defecto'}`)
}

// 5 · hook de revisión de Gentle AI
{
  const hay = Object.values(settings?.hooks || {}).some((grupos) => Array.isArray(grupos) && grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('gentle-ai review stop-hook'))))
  punto('stop-hook', hay ? 'verde' : 'rojo', hay ? 'gentle-ai review stop-hook registrado' : 'falta `gentle-ai review stop-hook` (ejecuta install o gentle-ai sync)')
}

// 6 · Engram (spec 23 · S5): binario que responde y plugin activo en Claude Code
if (OMITIR.has('engram')) punto('engram', 'amarillo', 'omitido')
else {
  const plugin = settings?.enabledPlugins?.['engram@engram'] === true
  if (!engramResponde()) punto('engram', 'rojo', 'engram no responde (ejecuta install o gentle-ai install)')
  else punto('engram', plugin ? 'verde' : 'amarillo', plugin ? 'engram responde y su plugin está activo' : 'engram responde, pero el plugin engram@engram no está activo en settings.json')
}

if (process.argv.includes('--json')) console.log(JSON.stringify(puntos))
else {
  const marca = { verde: '[OK]    ', amarillo: '[AVISO] ', rojo: '[X]     ' }
  for (const p of puntos) console.log(`${marca[p.estado]}${p.id}: ${p.texto}`)
  const n = (e) => puntos.filter((p) => p.estado === e).length
  console.log(`\nResumen: ${n('verde')} verdes, ${n('amarillo')} avisos, ${n('rojo')} rojos`)
}
process.exit(0)
