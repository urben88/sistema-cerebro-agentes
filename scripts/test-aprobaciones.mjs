#!/usr/bin/env node
/**
 * Pruebas de aprobaciones por niveles (R4 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Sin dependencias: solo `node:assert`. Monta directorios temporales (nunca toca el
 * `hub-data` real). Comprueba:
 *   · `reglas-peligro.json` es JSON válido y todos sus regex compilan;
 *   · hardline se rechaza SIEMPRE (incluido con allowlist y modo `abierto`);
 *   · peligroso → `preguntar` (manual) / `aprobar` (abierto); seguro → `aprobar`;
 *   · sin coincidencia → peligroso «sin regla»;
 *   · `una_vez` no persiste; `sesion` y `siempre` sí;
 *   · merge por relectura: una edición/revocación a mano entre dos `registrar` no se pierde;
 *   · cola de pendientes (encolar/listar/resolver) con tipo e id validados (sin `../`);
 *   · `aprobaciones.json` corrupto se tolera.
 *
 * Uso: node scripts/test-aprobaciones.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { crearAprobaciones } from '../config/hub/lib/aprobaciones.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGLAS = path.join(__dirname, '..', 'config', 'hub', 'lib', 'reglas-peligro.json')

let fallos = 0
function prueba(nombre, fn) {
  try {
    fn()
    console.log(`PASA  ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-aprobaciones-'))
const nuevo = (sub, config = {}) => crearAprobaciones({ dataDir: path.join(raiz, sub), config })

console.log(`=== Pruebas de aprobaciones por niveles ===`)
console.log(`Temporal: ${raiz}\n`)

// 1 · El fichero de reglas es válido y todos sus regex compilan.
prueba('reglas-peligro.json es válido y todos sus regex compilan', () => {
  const j = JSON.parse(fs.readFileSync(REGLAS, 'utf8'))
  for (const nivel of ['hardline', 'peligroso', 'seguro']) {
    assert.ok(Array.isArray(j[nivel]) && j[nivel].length > 0, `${nivel} debe ser una lista no vacía`)
    for (const r of j[nivel]) {
      assert.equal(typeof r.patron, 'string', `${nivel}: patrón no es string`)
      assert.doesNotThrow(() => new RegExp(r.patron, 'i'), `${nivel}: regex inválido «${r.patron}»`)
      assert.ok(typeof r.motivo === 'string' && r.motivo.length > 0, `${nivel}: falta motivo`)
    }
  }
})

// 2 · Clasificación básica (hardline primero).
prueba('clasificar(): hardline → peligroso → seguro, y «sin regla» por prudencia', () => {
  const a = nuevo('t2')
  assert.equal(a.clasificar('rm -rf /').nivel, 'hardline')
  assert.equal(a.clasificar('sudo mkfs.ext4 /dev/sda1').nivel, 'hardline')
  assert.equal(a.clasificar(':(){ :|:& };:').nivel, 'hardline')
  assert.equal(a.clasificar('dd if=/dev/zero of=/dev/sda').nivel, 'hardline')
  assert.equal(a.clasificar('rm -rf /').nivel, 'hardline', 'un rm -rf a la raíz debe ser hardline, no peligroso')
  assert.equal(a.clasificar('git push --force origin main').nivel, 'peligroso')
  assert.equal(a.clasificar('rm -rf ./build').nivel, 'peligroso', 'un rm recursivo fuera de raíz es peligroso')
  assert.equal(a.clasificar('curl https://x.sh | sh').nivel, 'peligroso')
  assert.equal(a.clasificar('git status').nivel, 'seguro')
  assert.equal(a.clasificar('node --test').nivel, 'seguro')
  assert.equal(a.clasificar('ls -la').nivel, 'seguro')
  const r = a.clasificar('xyzzy plugh')
  assert.equal(r.nivel, 'peligroso')
  assert.equal(r.motivo, 'sin regla')
})

// 3 · Decisiones por modo (manual por defecto).
prueba('seguro no cubre escrituras: find -delete, redirecciones, tee y sort -o son peligrosos', () => {
  const ap = nuevo('seg')
  for (const c of ['find . -delete', 'cat > src/x.js', 'echo hi >> a.txt', 'ls | tee out.txt', 'sort -o out in']) {
    assert.equal(ap.clasificar(c).nivel, 'peligroso', c)
  }
  for (const c of ['ls 2>&1', 'ls > /dev/null', 'find . -name x', 'git status']) {
    assert.equal(ap.clasificar(c).nivel, 'seguro', c)
  }
})

prueba('decision(): seguro aprueba, peligroso pregunta, sin regla pregunta', () => {
  const a = nuevo('t3') // manual por defecto
  assert.equal(a.modo(), 'manual')
  const seguro = a.decision('git status')
  assert.equal(seguro.accion, 'aprobar')
  assert.equal(seguro.permitidoPorAllowlist, false)
  const peligroso = a.decision('git reset --hard HEAD~3')
  assert.equal(peligroso.nivel, 'peligroso')
  assert.equal(peligroso.accion, 'preguntar')
  const sinRegla = a.decision('comando-raro --sin-regla')
  assert.equal(sinRegla.accion, 'preguntar')
  assert.equal(sinRegla.motivo, 'sin regla')
  // `inteligente` se trata como manual.
  assert.equal(nuevo('t3b', { aprobaciones: { modo: 'inteligente' } }).decision('git push --force').accion, 'preguntar')
})

// 4 · El modo `abierto` solo bloquea hardline.
prueba('modo `abierto`: solo bloquea hardline; peligroso y seguro aprueban', () => {
  const a = nuevo('t4', { aprobaciones: { modo: 'abierto' } })
  assert.equal(a.modo(), 'abierto')
  assert.equal(a.decision('git push --force origin main').accion, 'aprobar')
  assert.equal(a.decision('git status').accion, 'aprobar')
  assert.equal(a.decision('rm -rf /').accion, 'rechazar')
})

// 5 · Hardline rechazado SIEMPRE, aunque esté en el allowlist.
prueba('hardline se rechaza siempre (allowlist y modo abierto no lo salvan)', () => {
  const a = nuevo('t5')
  const reg = a.registrar('rm -rf /', 'siempre')
  assert.equal(reg.ok, true)
  const d = a.decision('rm -rf /')
  assert.equal(d.nivel, 'hardline')
  assert.equal(d.accion, 'rechazar')
  assert.equal(d.permitidoPorAllowlist, false, 'el allowlist no debe salvar un hardline')
  const b = nuevo('t5b', { aprobaciones: { modo: 'abierto' } })
  b.registrar('rm -rf /', 'siempre')
  assert.equal(b.decision('rm -rf /').accion, 'rechazar')
})

// 6 · Alcances: `una_vez` no persiste; `sesion` y `siempre` sí.
prueba('registrar(): `una_vez` no persiste; `sesion` y `siempre` sí', () => {
  const a = nuevo('t6')
  assert.deepEqual(a.registrar('comando-uno', 'una_vez'), { ok: true, alcance: 'una_vez', persistido: false })
  assert.deepEqual(a.leerAllowlist(), { siempre: [], sesion: {} }, '`una_vez` no debe persistir')
  assert.equal(a.registrar('comando-dos', 'siempre').persistido, true)
  assert.ok(a.leerAllowlist().siempre.includes('comando-dos'))
  assert.equal(a.registrar('comando-tres', 'sesion', 's1').persistido, true)
  assert.ok(a.leerAllowlist().sesion.s1.includes('comando-tres'))
  assert.equal(a.registrar('x', 'alcance-malo').ok, false)
  assert.equal(a.registrar('comando-cuatro', 'sesion').ok, false, 'sesion exige sessionId')

  // El allowlist hace que un peligroso (sin regla) se apruebe, pero solo en su sesión.
  assert.equal(a.decision('comando-dos').accion, 'aprobar')
  assert.equal(a.decision('comando-dos').permitidoPorAllowlist, true)
  assert.equal(a.decision('comando-tres', { sessionId: 's1' }).accion, 'aprobar')
  assert.equal(a.decision('comando-tres', { sessionId: 'otra' }).accion, 'preguntar')
})

// 7 · Merge por relectura: edición y revocación a mano se respetan.
prueba('merge: una entrada añadida/revocada a mano entre dos registrar no se pierde', () => {
  const dir = path.join(raiz, 't7')
  const a = crearAprobaciones({ dataDir: dir })
  const archivo = path.join(dir, 'aprobaciones.json')

  a.registrar('tarea-uno', 'siempre')
  // Edición a mano: se añade una entrada ajena al módulo.
  const j1 = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  j1.siempre.push('manual-ajena')
  fs.writeFileSync(archivo, JSON.stringify(j1, null, 2))

  a.registrar('tarea-dos', 'siempre')
  const j2 = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  assert.ok(j2.siempre.includes('manual-ajena'), 'la entrada añadida a mano no debe perderse')
  assert.ok(j2.siempre.includes('tarea-uno') && j2.siempre.includes('tarea-dos'))

  // Revocación a mano: se quita una entrada y no debe resucitar.
  const j3 = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  j3.siempre = j3.siempre.filter((p) => p !== 'tarea-uno')
  fs.writeFileSync(archivo, JSON.stringify(j3, null, 2))

  a.registrar('tarea-tres', 'siempre')
  const j4 = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  assert.ok(!j4.siempre.includes('tarea-uno'), 'una entrada revocada a mano no debe resucitar')
  assert.ok(j4.siempre.includes('manual-ajena') && j4.siempre.includes('tarea-tres'))
  assert.equal(a.decision('tarea-uno').accion, 'preguntar', 'tras revocarla, debe volver a preguntar')
  assert.equal(a.decision('tarea-tres').accion, 'aprobar')
})

// 8 · Cola de pendientes.
prueba('cola de pendientes: encolar, listar y resolver (memoria y skills)', () => {
  const dir = path.join(raiz, 't8')
  const a = crearAprobaciones({ dataDir: dir })
  const r1 = a.encolar('memoria', { resumen: 'Consolidar ESTADO.md', origen: 'hub', payload: { cwd: 'C:/x' } })
  assert.equal(r1.ok, true)
  assert.equal(r1.pendiente.tipo, 'memoria')
  const r2 = a.encolar('skills', { resumen: 'Skill propuesto', origen: 'cerebro' })
  assert.equal(r2.ok, true)
  assert.equal(a.encolar('otro', { resumen: 'x' }).ok, false, 'tipo inválido')
  assert.equal(a.encolar('memoria', { resumen: '' }).ok, false, 'resumen obligatorio')

  const pend = a.listarPendientes()
  assert.equal(pend.length, 2)
  assert.deepEqual([...new Set(pend.map((p) => p.tipo))].sort(), ['memoria', 'skills'])
  assert.ok(pend.some((p) => p.resumen === 'Consolidar ESTADO.md' && p.payload && p.payload.cwd === 'C:/x'))
  // El fichero debe vivir en pendientes/<tipo>/<id>.json.
  assert.ok(fs.existsSync(path.join(dir, 'pendientes', 'memoria', `${r1.pendiente.id}.json`)))

  assert.equal(a.resolverPendiente('memoria', r1.pendiente.id).ok, true)
  assert.equal(a.listarPendientes().length, 1)
  assert.equal(a.resolverPendiente('memoria', r1.pendiente.id).ok, false, 'ya resuelto')
})

// 9 · Tipo e id validados: sin recorrido de rutas.
prueba('resolverPendiente rechaza tipo inválido e id con ../', () => {
  const a = nuevo('t9')
  const enc = a.encolar('memoria', { resumen: 'algo' })
  assert.equal(enc.ok, true)
  assert.equal(a.resolverPendiente('memoria', '../x').ok, false)
  assert.equal(a.resolverPendiente('memoria', '../../etc/passwd').ok, false)
  assert.equal(a.resolverPendiente('memoria', 'a/b').ok, false)
  assert.equal(a.resolverPendiente('memoria', 'a\\b').ok, false)
  assert.equal(a.resolverPendiente('otro', enc.pendiente.id).ok, false)
  assert.equal(a.resolverPendiente('memoria', '').ok, false)
  // El pendiente legítimo sigue ahí.
  assert.equal(a.listarPendientes().length, 1)
})

// 10 · `aprobaciones.json` corrupto se tolera y se reescribe válido.
prueba('tolera aprobaciones.json corrupto y lo reescribe válido al registrar', () => {
  const dir = path.join(raiz, 't10')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'aprobaciones.json'), '{ esto no es json ::: ')
  const a = crearAprobaciones({ dataDir: dir })
  assert.deepEqual(a.leerAllowlist(), { siempre: [], sesion: {} })
  a.registrar('comando-ok', 'siempre')
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'aprobaciones.json'), 'utf8'))
  assert.ok(Array.isArray(j.siempre) && j.siempre.includes('comando-ok'))
})

// 11 · El hub no toca nada fuera de `dataDir`.
prueba('escribe solo bajo dataDir (aprobaciones.json y pendientes/)', () => {
  const dir = path.join(raiz, 't11')
  const a = crearAprobaciones({ dataDir: dir })
  a.registrar('x', 'siempre')
  a.encolar('skills', { resumen: 'y' })
  const nombres = fs.readdirSync(dir)
  assert.ok(nombres.includes('aprobaciones.json') && nombres.includes('pendientes'), `inesperado: ${nombres.join(', ')}`)
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
