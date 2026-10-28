#!/usr/bin/env node
/**
 * Pruebas del sonido al terminar (S6 de `docs/specs/22-mecanicas-de-gentle-shell.md`).
 * No reproduce audio: el hook, con SONIDO_DRY=1, imprime el plan (archivo y comando).
 * Datos temporales fuera del repo. Uso: node scripts/test-sonido.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'config', 'hooks', 'sonido-fin.mjs')
const MERGE = path.join(__dirname, '..', 'config', 'hub', 'settings-merge.mjs')
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-sonido-'))
const sistema = path.join(raiz, 'sistema')
const dataDir = path.join(sistema, 'hub-data')
const sonidos = path.join(sistema, 'sonidos')
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(sonidos, { recursive: true })
console.log(`Temporal: ${raiz}\n`)

let fallos = 0
function prueba(nombre, fn) {
  try { fn(); console.log(`PASA  ${nombre}`) } catch (e) {
    fallos++; console.log(`FALLA ${nombre}`); console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}
function correr(plataforma, evento = 'Stop', extraEnv = {}) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: evento, cwd: raiz }),
    env: { ...process.env, SISTEMA_CEREBRO_DIR: sistema, HUB_DATA_DIR: dataDir, SONIDO_DRY: '1', SONIDO_PLATFORM: plataforma, ...extraEnv },
    encoding: 'utf8',
  })
  let plan = null
  try { plan = JSON.parse((r.stdout || '').trim()) } catch { /* sin plan */ }
  return { code: r.status, plan, ms: Date.now() - t0, salida: (r.stdout || '').trim() }
}
const limpiar = () => { for (const f of fs.readdirSync(sonidos)) fs.rmSync(path.join(sonidos, f), { force: true }) }
const reglas = (o) => fs.writeFileSync(path.join(dataDir, 'reglas.json'), JSON.stringify(o) + '\n')

prueba('sin archivo: sonido del sistema en Windows (Asterisk)', () => {
  limpiar(); reglas({})
  const { code, plan } = correr('win32')
  assert.equal(code, 0)
  assert.equal(plan.archivo, null)
  assert.match(plan.cmd, /powershell/i)
  assert.ok(plan.args.includes('-NoProfile'))
  assert.ok(plan.args.join(' ').includes('Asterisk'))
})

prueba('elige el primer archivo existente: mp3 antes que wav antes que ogg', () => {
  limpiar()
  fs.writeFileSync(path.join(sonidos, 'fin.ogg'), 'x')
  fs.writeFileSync(path.join(sonidos, 'fin.wav'), 'x')
  assert.equal(path.basename(correr('win32').plan.archivo), 'fin.wav')
  fs.writeFileSync(path.join(sonidos, 'fin.mp3'), 'x')
  assert.equal(path.basename(correr('win32').plan.archivo), 'fin.mp3')
})

prueba('Windows: mp3 usa MediaPlayer y wav usa SoundPlayer; la ruta va por entorno', () => {
  limpiar()
  fs.writeFileSync(path.join(sonidos, 'fin.mp3'), 'x')
  let p = correr('win32').plan
  assert.ok(p.args.join(' ').includes('System.Windows.Media.MediaPlayer'))
  assert.equal(p.env.SONIDO_ARCHIVO, path.join(sonidos, 'fin.mp3'))
  limpiar()
  fs.writeFileSync(path.join(sonidos, 'fin.wav'), 'x')
  p = correr('win32').plan
  assert.ok(p.args.join(' ').includes('System.Media.SoundPlayer'))
})

prueba('macOS usa afplay y Linux usa paplay/aplay', () => {
  limpiar()
  fs.writeFileSync(path.join(sonidos, 'fin.wav'), 'x')
  const m = correr('darwin').plan
  assert.equal(m.cmd, 'afplay')
  assert.equal(m.args[0], path.join(sonidos, 'fin.wav'))
  const l = correr('linux').plan
  assert.ok(`${l.cmd} ${l.args.join(' ')}`.includes('paplay'))
  assert.ok(`${l.cmd} ${l.args.join(' ')}`.includes('aplay'))
})

prueba('interruptor: sonido_fin=false no reproduce nada', () => {
  reglas({ sonido_fin: false })
  const { code, plan, salida } = correr('win32')
  assert.equal(code, 0)
  assert.equal(plan, null, `no debía haber plan: ${salida}`)
})

prueba('solo suena en Stop, no en SubagentStop', () => {
  reglas({})
  assert.equal(correr('win32', 'SubagentStop').plan, null)
  assert.ok(correr('win32', 'Stop').plan)
})

prueba('vuelve en menos de 1 s y sale 0 con stdin vacío o basura', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: '{basura', env: { ...process.env, SISTEMA_CEREBRO_DIR: sistema, HUB_DATA_DIR: dataDir, SONIDO_DRY: '1' }, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.ok(correr('win32').ms < 1000, 'tardó más de 1 s')
})

prueba('settings-merge registra Stop una sola vez (async) y conserva hooks ajenos', () => {
  const home = path.join(raiz, 'home')
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gentle-ai review stop-hook' }] }] },
  }))
  const hooksDir = path.join(raiz, 'hooks')
  fs.mkdirSync(hooksDir, { recursive: true })
  for (const f of ['sonido-fin.mjs', 'latido.mjs']) fs.writeFileSync(path.join(hooksDir, f), '')
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(process.execPath, [MERGE, hooksDir], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
  const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
  const cmds = s.hooks.Stop.flatMap((g) => g.hooks)
  assert.equal(cmds.filter((h) => h.command.includes('sonido-fin.mjs')).length, 1)
  assert.equal(cmds.filter((h) => h.command.includes('latido.mjs')).length, 1)
  assert.ok(cmds.some((h) => h.command.includes('gentle-ai review stop-hook')), 'se perdió el hook ajeno')
  const h = cmds.find((x) => x.command.includes('sonido-fin.mjs'))
  assert.ok(h.async === true || h.timeout <= 5, 'debe ser async o tener timeout corto')
})

try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
