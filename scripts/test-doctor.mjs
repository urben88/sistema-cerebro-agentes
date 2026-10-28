#!/usr/bin/env node
/**
 * Pruebas de `/odd:doctor` (S5 de `docs/specs/22-mecanicas-de-gentle-shell.md`).
 * Solo lectura. Se omiten los comandos externos (DOCTOR_OMITIR) y se apunta a un
 * settings.json temporal (DOCTOR_SETTINGS); datos fuera del repo.
 * Uso: node scripts/test-doctor.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCTOR = path.join(__dirname, '..', 'config', 'hooks', 'doctor.mjs')
const COMANDO = path.join(__dirname, '..', 'config', 'claude', 'commands', 'odd', 'doctor.md')
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-doctor-'))
console.log(`Temporal: ${raiz}\n`)

let fallos = 0
function prueba(nombre, fn) {
  try { fn(); console.log(`PASA  ${nombre}`) } catch (e) {
    fallos++; console.log(`FALLA ${nombre}`); console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}
function doctor(settings, omitir = 'verificar,gentle-ai,opencode') {
  const f = path.join(raiz, 'settings.json')
  if (settings === null) fs.rmSync(f, { force: true })
  else fs.writeFileSync(f, JSON.stringify(settings))
  const r = spawnSync(process.execPath, [DOCTOR, '--json'], { env: { ...process.env, DOCTOR_SETTINGS: f, DOCTOR_OMITIR: omitir }, encoding: 'utf8' })
  let puntos = null
  try { puntos = JSON.parse(r.stdout) } catch { /* no JSON */ }
  return { code: r.status, puntos, texto: r.stdout }
}
const estado = (puntos, id) => puntos.find((p) => p.id === id)?.estado

prueba('defaultMode bypassPermissions → rojo; normal → verde', () => {
  assert.equal(estado(doctor({ permissions: { defaultMode: 'bypassPermissions' } }).puntos, 'permisos'), 'rojo')
  assert.equal(estado(doctor({ permissions: { defaultMode: 'default' } }).puntos, 'permisos'), 'verde')
  assert.equal(estado(doctor({}).puntos, 'permisos'), 'verde')
})

prueba('hook gentle-ai review stop-hook: presente → verde; ausente → rojo', () => {
  const con = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gentle-ai review stop-hook' }] }] } }
  assert.equal(estado(doctor(con).puntos, 'stop-hook'), 'verde')
  assert.equal(estado(doctor({ hooks: {} }).puntos, 'stop-hook'), 'rojo')
  assert.equal(estado(doctor(null).puntos, 'stop-hook'), 'rojo')
})

prueba('un punto por comprobación y los omitidos salen en amarillo; sale 0 y no escribe', () => {
  const r = doctor({})
  assert.equal(r.code, 0)
  assert.deepEqual(r.puntos.map((p) => p.id).sort(), ['gentle-ai', 'opencode', 'permisos', 'stop-hook', 'verificar'])
  for (const id of ['verificar', 'gentle-ai', 'opencode']) assert.equal(estado(r.puntos, id), 'amarillo')
  assert.equal(fs.readFileSync(path.join(raiz, 'settings.json'), 'utf8'), '{}')
})

prueba('el comando /odd:doctor existe, llama al script y es de solo lectura', () => {
  const t = fs.readFileSync(COMANDO, 'utf8')
  assert.ok(t.includes('doctor.mjs'))
  assert.ok(/solo lectura/i.test(t))
})

try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
