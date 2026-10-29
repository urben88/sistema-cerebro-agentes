#!/usr/bin/env node
/**
 * Pruebas del instalador con control (spec 25). Todo en un HOME falso dentro de un directorio
 * temporal: no toca la instalación real.
 *  - instalado.mjs: registro, huellas y estados (nuevo, igual, actualizar, tocado).
 *  - install -Check (--check en bash): dice qué haría con cada componente según el registro.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helper = path.join(raiz, 'scripts', 'instalado.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-instalador-'))
const win = process.platform === 'win32'

let fallos = 0
const prueba = (n, fn) => { try { fn(); console.log(`PASA  ${n}`) } catch (e) { fallos++; console.log(`FALLA ${n}\n      ${String(e.message).split('\n')[0]}`) } }
const h = (...args) => {
  const r = spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' })
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status }
}
const escribir = (p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt) }
const copiar = (o, d) => fs.cpSync(o, d, { recursive: true })

try {
  const reg = path.join(tmp, 'reg', 'instalado.json')
  const src = path.join(tmp, 'repo', 'hooks'); const dst = path.join(tmp, 'casa', 'hooks')
  const fsrc = path.join(tmp, 'repo', 'a.md'); const fdst = path.join(tmp, 'casa', 'a.md')
  escribir(path.join(src, 'uno.mjs'), 'uno'); escribir(path.join(src, 'sub', 'dos.mjs'), 'dos'); escribir(fsrc, 'agente')
  const pares = [src, dst, fsrc, fdst]
  const estado = () => h('estado', reg, 'hooks', ...pares).out

  prueba('sin registro → nuevo', () => assert.equal(estado(), 'nuevo'))
  copiar(src, dst); copiar(fsrc, fdst)
  prueba('registrado tras la copia → igual', () => { assert.equal(h('registrar', reg, 'hooks', ...pares).code, 0); assert.equal(estado(), 'igual') })
  prueba('el registro guarda huellas sha256 y la lista de archivos', () => {
    const c = JSON.parse(fs.readFileSync(reg, 'utf8')).componentes.hooks
    assert.match(c.origen, /^[0-9a-f]{64}$/); assert.match(c.destino, /^[0-9a-f]{64}$/)
    assert.deepEqual(c.archivos, [['sub/dos.mjs', 'uno.mjs'], ['']])
  })
  prueba('archivos que otras herramientas añaden dentro no cuentan → igual', () => { escribir(path.join(dst, 'tsconfig.json'), '{}'); assert.equal(estado(), 'igual') })
  prueba('cambio en el repo → actualizar', () => { escribir(path.join(src, 'uno.mjs'), 'uno v2'); assert.equal(estado(), 'actualizar') })
  prueba('tras actualizar y registrar → igual', () => { copiar(src, dst); h('registrar', reg, 'hooks', ...pares); assert.equal(estado(), 'igual') })
  prueba('cambio a mano en lo instalado → tocado', () => { escribir(fdst, 'agente editado'); assert.equal(estado(), 'tocado') })
  prueba('tocado gana aunque el repo también cambie', () => { escribir(fsrc, 'agente v2'); assert.equal(estado(), 'tocado') })
  prueba('archivo instalado borrado → tocado', () => { copiar(fsrc, fdst); h('registrar', reg, 'hooks', ...pares); fs.rmSync(path.join(dst, 'sub', 'dos.mjs')); assert.equal(estado(), 'tocado') })
  prueba('diferencias enseña lo que cambió', () => {
    const d = h('diferencias', reg, 'hooks', ...pares)
    assert.equal(d.code, 0); assert.match(d.out, /dos\.mjs/); assert.match(d.out, /falta en lo instalado/); assert.doesNotMatch(d.out, /uno\.mjs/)
  })
  prueba('nada instalado → nuevo (se instala sin preguntar)', () => { fs.rmSync(dst, { recursive: true }); fs.rmSync(fdst); assert.equal(estado(), 'nuevo') })
  prueba('añadir un par al componente (agente nuevo) → actualizar, no tocado', () => {
    copiar(src, dst); copiar(fsrc, fdst); h('registrar', reg, 'hooks', ...pares)
    const nsrc = path.join(tmp, 'repo', 'b.md'); escribir(nsrc, 'agente nuevo')
    assert.equal(h('estado', reg, 'hooks', ...pares, nsrc, path.join(tmp, 'casa', 'b.md')).out, 'actualizar')
  })
  prueba('quitar un par del componente → actualizar, no tocado', () => assert.equal(h('estado', reg, 'hooks', src, dst).out, 'actualizar'))
  fs.rmSync(dst, { recursive: true }); fs.rmSync(fdst)
  prueba('valor guarda y lee la configuración de gentle-ai', () => {
    assert.equal(h('valor', reg, 'gentle-ai').out, '')
    h('valor', reg, 'gentle-ai', 'version=4.3.1 install --persona neutral')
    assert.equal(h('valor', reg, 'gentle-ai').out, 'version=4.3.1 install --persona neutral')
    assert.equal(estado(), 'nuevo', 'valor no pisa los otros componentes')
  })
  prueba('cerrar escribe la versión del sistema', () => { h('cerrar', reg, '0.11.0'); assert.equal(JSON.parse(fs.readFileSync(reg, 'utf8')).version, '0.11.0') })
  prueba('registro corrupto → nuevo, sin romper', () => { fs.writeFileSync(reg, '{roto'); assert.equal(estado(), 'nuevo') })
  prueba('pares impares → error con código 2', () => { const r = h('estado', reg, 'hooks', src); assert.equal(r.code, 2); assert.match(r.err, /pares/) })

  // install -Check con HOME falso: solo lee; dice qué haría con cada componente.
  const casa = path.join(tmp, 'home'); fs.mkdirSync(casa)
  const regCasa = path.join(casa, '.sistema-cerebro-agentes', 'instalado.json')
  const check = () => {
    const env = { ...process.env, HOME: casa, USERPROFILE: casa, SIN_GENTLE_AI: '1' }
    const r = win
      ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(raiz, 'install.ps1'), '-Check'], { encoding: 'utf8', env, timeout: 180000 })
      : spawnSync('bash', [path.join(raiz, 'install.sh'), '--check'], { encoding: 'utf8', env, timeout: 180000 })
    return { out: `${r.stdout || ''}${r.stderr || ''}`, code: r.status }
  }
  const r1 = check()
  if (/Faltan prerrequisitos/.test(r1.out)) console.log('OMITE install -Check (faltan prerrequisitos en esta máquina)')
  else {
    prueba('-Check sin registro: todo se instalaría y no escribe nada', () => {
      assert.equal(r1.code, 0); assert.match(r1.out, /hooks: se instalar[ií]a/); assert.match(r1.out, /agentes-opencode: se instalar[ií]a/)
      assert.equal(fs.existsSync(path.join(casa, '.sistema-cerebro-agentes')), false)
    })
    prueba('-Check explica las opciones nuevas', () => { assert.match(r1.out, win ? /-Reinstalar/ : /--reinstalar/); assert.match(r1.out, win ? /-SinVerificar/ : /--sin-verificar/) })
    const hooksDst = path.join(casa, '.sistema-cerebro-agentes', 'hooks')
    copiar(path.join(raiz, 'config', 'hooks'), hooksDst)
    h('registrar', regCasa, 'hooks', path.join(raiz, 'config', 'hooks'), hooksDst)
    prueba('-Check con hooks registrados: hooks sin cambios', () => assert.match(check().out, /hooks: sin cambios/))
    const primero = fs.readdirSync(hooksDst).find((f) => fs.statSync(path.join(hooksDst, f)).isFile())
    fs.appendFileSync(path.join(hooksDst, primero), '\n// tocado a mano\n')
    prueba('-Check con hooks tocados a mano: avisa que preguntaría', () => assert.match(check().out, /hooks: cambiado a mano/))
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
