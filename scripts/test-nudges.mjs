#!/usr/bin/env node
/**
 * Pruebas de los nudges de memoria y sus límites (R2 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Sin dependencias: solo `node:assert` y `node:child_process`. Monta un directorio
 * temporal (nunca toca el `hub-data` real) y ejercita el hook `latido.mjs` con
 * eventos simulados —el hub apunta a un puerto muerto, así que el POST se ignora—
 * y la memoria directamente. Comprueba:
 *   · 10 turnos sin escritura → un nudge; no se repite hasta otros N turnos;
 *   · el contador es por sesión y proyecto: dos sesiones cuentan por separado y una
 *     sesión nueva no recibe nudge en su primer turno;
 *   · una escritura de ESTADO.md (mtime) reinicia el contador;
 *   · solo UserPromptSubmit emite JSON (nada en Stop/SubagentStart/SubagentStop);
 *   · `estado-nudges.json` corrupto no rompe el hook; se podan las entradas viejas
 *     (más de 14 días), se limita a 200 y no se pierden las claves ajenas;
 *   · el exceso de cuerpo se rechaza (`{excede,limite,actuales}`) y dentro del
 *     límite sigue funcionando; un checkpoint largo NO se rechaza;
 *   · HTTP real: el hub temporal rechaza con 422 al exceder y el CLI `estado.mjs
 *     --escribir` sale con código 1 y mensaje claro.
 *
 * Uso: node scripts/test-nudges.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { crearMemoria, LIMITES, medirCuerpo } from '../config/hub/lib/memoria.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'config', 'hooks', 'latido.mjs')
const ESTADO_CLI = path.join(__dirname, '..', 'config', 'hooks', 'estado.mjs')
const HUB = path.join(__dirname, '..', 'config', 'hub', 'hub.mjs')
const INTERVALO = 10

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
async function pruebaAsync(nombre, fn) {
  try {
    await fn()
    console.log(`PASA  ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

// ------------------------------------------------------------ directorio temporal
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nudges-'))
const sistema = path.join(raiz, 'sistema')
const dataDir = path.join(sistema, 'hub-data')
const memoriaDir = path.join(dataDir, 'memoria')
const limitesDir = path.join(raiz, 'limites')
const proyecto = path.join(raiz, 'proyecto-demo')
const slug = 'demo-abc'
const CONTADOR = path.join(dataDir, 'estado-nudges.json')
const ARCHIVO_ESTADO = path.join(memoriaDir, 'proyectos', slug, 'ESTADO.md')

fs.mkdirSync(proyecto, { recursive: true })
fs.mkdirSync(path.join(memoriaDir, 'proyectos', slug), { recursive: true })
fs.writeFileSync(path.join(memoriaDir, 'proyectos.json'), JSON.stringify({
  [slug]: { ruta: proyecto, nombre: 'demo', creado: Date.now(), actualizado: Date.now(), ultimoUso: Date.now() },
}, null, 2) + '\n')
// Intervalo bajo control del test (override de `hub-data/reglas.json`).
fs.writeFileSync(path.join(dataDir, 'reglas.json'), JSON.stringify({ nudge_intervalo: INTERVALO }) + '\n')
console.log(`Temporal: ${raiz} · intervalo N=${INTERVALO}\n`)

/** Ejecuta el hook como lo haría Claude Code, con el hub apuntando a un puerto muerto. */
function latir(evento, extra = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: evento, cwd: proyecto, session_id: 's1', ...extra }),
    env: {
      ...process.env,
      SISTEMA_CEREBRO_DIR: sistema,
      HUB_DATA_DIR: dataDir,
      HUB_MEMORIA_DIR: memoriaDir,
      HUB_URL: 'http://127.0.0.1:1',
    },
    encoding: 'utf8',
  })
  return { code: r.status, salida: (r.stdout || '').trim() }
}

/** additionalContext del stdout (o null si no hay JSON). */
function nudgeDe(salida) {
  if (!salida) return null
  try { return JSON.parse(salida)?.hookSpecificOutput?.additionalContext || null } catch { return null }
}

const leerContador = () => { try { return JSON.parse(fs.readFileSync(CONTADOR, 'utf8')) } catch { return {} } }
/** Clave del contador por sesión y proyecto. */
const clave = (sesion) => `${slug}:${sesion}`

// 1 · Al llegar al turno N aparece un nudge y solo uno.
prueba(`10 turnos sin escritura → un nudge al llegar al turno ${INTERVALO}`, () => {
  let avisos = 0
  for (let i = 1; i <= INTERVALO; i++) {
    const { code, salida } = latir('UserPromptSubmit')
    assert.equal(code, 0, `el hook salió con ${code}`)
    if (nudgeDe(salida)) {
      avisos++
      const j = JSON.parse(salida)
      assert.equal(j.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
      assert.ok(j.hookSpecificOutput.additionalContext.includes('ESTADO.md'), 'el nudge no enruta a ESTADO.md')
    } else {
      assert.equal(salida, '', `salida inesperada en el turno ${i}: ${salida}`)
    }
  }
  assert.equal(avisos, 1, `esperaba 1 nudge en ${INTERVALO} turnos, hubo ${avisos}`)
})

// 2 · No se repite hasta otros N turnos sin escritura.
prueba(`no repite el nudge hasta otros ${INTERVALO} turnos sin escritura`, () => {
  for (let i = INTERVALO + 1; i <= 2 * INTERVALO - 1; i++) {
    const { salida } = latir('UserPromptSubmit')
    assert.equal(salida, '', `no debía haber nudge en el turno ${i}: ${salida}`)
  }
  const { salida } = latir('UserPromptSubmit')
  assert.ok(nudgeDe(salida), `faltó el nudge en el turno ${2 * INTERVALO}`)
})

// 3 · Una escritura de ESTADO.md (cambia el mtime) reinicia el contador.
prueba('una escritura de ESTADO.md reinicia el contador', () => {
  fs.writeFileSync(ARCHIVO_ESTADO, '# ESTADO\n\n## Tarea\nnueva\n')
  const primero = latir('UserPromptSubmit')
  assert.equal(nudgeDe(primero.salida), null, 'no debía avisar en el primer turno tras escribir')
  assert.equal(leerContador()[clave('s1')].turnos, 1, 'el contador no se reinició')
  for (let i = 2; i < INTERVALO; i++) {
    const { salida } = latir('UserPromptSubmit')
    assert.equal(nudgeDe(salida), null, `no debía avisar en el turno ${i} tras el reset`)
  }
  const { salida } = latir('UserPromptSubmit')
  assert.ok(nudgeDe(salida), `faltó el nudge en el turno ${INTERVALO} tras el reset`)
})

// 4 · Solo UserPromptSubmit emite JSON.
prueba('solo UserPromptSubmit emite JSON (nada en Stop/SubagentStart/SubagentStop)', () => {
  for (const ev of ['Stop', 'SubagentStart', 'SubagentStop']) {
    const { code, salida } = latir(ev)
    assert.equal(code, 0, `${ev} salió con ${code}`)
    assert.equal(salida, '', `${ev} emitió salida: ${salida}`)
  }
})

// 5 · Contador corrupto: el hook no rompe y reescribe un JSON válido.
prueba('tolera estado-nudges.json corrupto', () => {
  fs.writeFileSync(CONTADOR, '{ corrupto::: no es json')
  const { code, salida } = latir('UserPromptSubmit')
  assert.equal(code, 0, `el hook salió con ${code} con el contador corrupto`)
  assert.equal(nudgeDe(salida), null)
  const c = leerContador()
  assert.equal(c[clave('s1')].turnos, 1, 'el contador no se reinició desde un JSON válido')
})

// 5b · Contador POR SESIÓN Y PROYECTO: dos sesiones del mismo proyecto no se pisan.
prueba('dos sesiones del mismo proyecto cuentan sus turnos por separado', () => {
  fs.rmSync(CONTADOR, { force: true })
  // sB llega al turno N-1 sin nudge.
  for (let i = 1; i < INTERVALO; i++) {
    const { salida } = latir('UserPromptSubmit', { session_id: 'sB' })
    assert.equal(nudgeDe(salida), null, `sB no debía avisar en su turno ${i}`)
  }
  let c = leerContador()
  assert.equal(c[clave('sB')].turnos, INTERVALO - 1)
  // sA entra por primera vez: contador propio → sin nudge en su primer turno.
  const a1 = latir('UserPromptSubmit', { session_id: 'sA' })
  assert.equal(nudgeDe(a1.salida), null, 'una sesión nueva no recibe nudge en su primer turno')
  c = leerContador()
  assert.equal(c[clave('sA')].turnos, 1)
  assert.equal(c[clave('sB')].turnos, INTERVALO - 1, 'el contador de la otra sesión se alteró')
  // sB llega a su turno N → nudge.
  assert.ok(nudgeDe(latir('UserPromptSubmit', { session_id: 'sB' }).salida), 'sB debía avisar en su turno N')
  // sA llega a su propio turno N → nudge, sin la ayuda de sB.
  for (let i = 2; i < INTERVALO; i++) {
    const { salida } = latir('UserPromptSubmit', { session_id: 'sA' })
    assert.equal(nudgeDe(salida), null, `sA no debía avisar en su turno ${i}`)
  }
  assert.ok(nudgeDe(latir('UserPromptSubmit', { session_id: 'sA' }).salida), 'sA debía avisar en su propio turno N')
})

// 5c · Poda por inactividad y conservación de claves ajenas.
prueba('poda las entradas con más de 14 días sin actividad y conserva las ajenas recientes', () => {
  const ahora = Date.now()
  const vieja = ahora - 15 * 24 * 60 * 60 * 1000
  fs.writeFileSync(CONTADOR, JSON.stringify({
    [`${slug}:vieja`]: { turnos: 5, ultimoAviso: 0, mtime: 0, visto: vieja },
    'otro-proyecto:ajena': { turnos: 3, ultimoAviso: 0, mtime: 0, visto: ahora },
  }, null, 2) + '\n')
  const { code, salida } = latir('UserPromptSubmit', { session_id: 'sP' })
  assert.equal(code, 0)
  assert.equal(nudgeDe(salida), null)
  const c = leerContador()
  assert.ok(!(`${slug}:vieja` in c), 'la entrada de 15 días debía podarse')
  assert.ok(clave('sP') in c, 'falta la entrada propia tras la poda')
  assert.ok('otro-proyecto:ajena' in c, 'una clave ajena reciente no debe perderse')
})

// 5d · Límite de 200 entradas.
prueba('limita el contador a 200 entradas', () => {
  const ahora = Date.now()
  const muchas = {}
  for (let i = 0; i < 260; i++) muchas[`proy-${i}:s`] = { turnos: 1, ultimoAviso: 0, mtime: 0, visto: ahora - i * 1000 }
  fs.writeFileSync(CONTADOR, JSON.stringify(muchas) + '\n')
  const { code } = latir('UserPromptSubmit', { session_id: 'sL' })
  assert.equal(code, 0)
  const c = leerContador()
  assert.ok(Object.keys(c).length <= 200, `quedaron ${Object.keys(c).length} entradas (máx. 200)`)
  assert.ok(clave('sL') in c, 'falta la entrada propia tras recortar')
})

// 5e · Read-merge-write: escribir la propia clave no borra una clave ajena.
prueba('al escribir su clave conserva las claves ajenas', () => {
  const ahora = Date.now()
  const ajena = { turnos: 7, ultimoAviso: 7, mtime: 0, visto: ahora }
  fs.writeFileSync(CONTADOR, JSON.stringify({ 'ajeno:j1': ajena }, null, 2) + '\n')
  latir('UserPromptSubmit', { session_id: 'sM' })
  const c = leerContador()
  assert.deepEqual(c['ajeno:j1'], ajena, 'la clave ajena se alteró o se perdió')
  assert.ok(clave('sM') in c, 'falta la entrada propia')
})

// 6 · Límites de memoria (función directa, sin hub).
const memoria = crearMemoria(limitesDir, {})
const cuerpoOk = '# ESTADO\n\n## Tarea\n' + 'y'.repeat(100) + '\n'

prueba('medirCuerpo() mide desde la primera línea «## » (o todo el texto)', () => {
  assert.equal(medirCuerpo('# Título\n## Sección\ntexto\n'), '## Sección\ntexto'.length)
  assert.equal(medirCuerpo('# Título\nsin secciones\n'), '# Título\nsin secciones'.length)
  assert.equal(medirCuerpo(null), 0)
})

prueba('escribirEstado rechaza por exceso: {excede,limite,actuales} y no escribe', () => {
  const grande = '# ESTADO\n\n## Tarea\n' + 'x'.repeat(LIMITES.estado + 10) + '\n'
  const r = memoria.escribirEstado(proyecto, grande)
  assert.equal(r.excede, true)
  assert.equal(r.limite, LIMITES.estado)
  assert.equal(r.actuales, 0)
  assert.equal(memoria.buscarProyecto(proyecto), null, 'no debía crear proyecto al rechazar')
})

prueba('dentro del límite escribe y luego informa de los actuales', () => {
  const ok = memoria.escribirEstado(proyecto, cuerpoOk)
  assert.ok(ok.slug, 'esperaba proyecto tras una escritura válida')
  const r = memoria.escribirEstado(proyecto, '# ESTADO\n\n## Tarea\n' + 'z'.repeat(LIMITES.estado + 50) + '\n')
  assert.equal(r.excede, true)
  assert.equal(r.actuales, medirCuerpo(cuerpoOk))
  assert.equal(memoria.leerEstado(ok.slug), cuerpoOk, 'el contenido guardado no debe cambiar al rechazar')
})

prueba('escribirContexto usa su propio límite', () => {
  const r = memoria.escribirContexto(proyecto, '# Contexto\n\n## Convenciones\n' + 'x'.repeat(LIMITES.contexto + 1) + '\n')
  assert.equal(r.excede, true)
  assert.equal(r.limite, LIMITES.contexto)
})

prueba('un checkpoint largo NO se rechaza', () => {
  const r = memoria.checkpoint(proyecto, 'prueba', 'x'.repeat(9000))
  assert.ok(r.archivo && fs.existsSync(r.archivo), 'el checkpoint no se guardó')
})

prueba('la bitácora larga NO se rechaza', () => {
  const p = memoria.agregarBitacora(proyecto, 'entrada grande', 'x'.repeat(9000))
  assert.ok(p.slug, 'la bitácora no se escribió')
})

// ------------------------------------------------------------------- HTTP real
// Levanta el hub de verdad (HUB_DATA_DIR temporal, puerto libre) para los contratos
// de R2.4: 422 con {ok:false,motivo:'excede',limite,actuales,contenidoActual} al
// exceder y 200 dentro del límite; y el CLI `estado.mjs --escribir` ante el 422.

/** Puerto libre en 127.0.0.1 (se cierra antes de usarlo). */
function puertoLibre() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

const puerto = await puertoLibre()
const hubUrl = `http://127.0.0.1:${puerto}`
const sistemaHttp = path.join(raiz, 'sistema-http')
const hubDataHttp = path.join(sistemaHttp, 'hub-data')
const cwdHttp = path.join(raiz, 'proyecto-http')
fs.mkdirSync(cwdHttp, { recursive: true })

const hijo = spawn(process.execPath, [HUB, '--port', String(puerto)], {
  env: {
    ...process.env,
    HUB_DATA_DIR: hubDataHttp,
    HUB_HOST: '127.0.0.1',
    SISTEMA_CEREBRO_DIR: sistemaHttp,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let salidaHub = ''
hijo.stdout.on('data', (d) => { salidaHub += d })
hijo.stderr.on('data', (d) => { salidaHub += d })

async function esperarHub(ms = 20000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${hubUrl}/api/proyectos`, { signal: AbortSignal.timeout(1000) })
      if (r.ok) return true
    } catch { /* todavía no escucha */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const listo = await esperarHub()
if (!listo) console.log(`      (el hub no arrancó; salida: ${salidaHub.slice(-400)})`)

async function post(ruta, cuerpo) {
  const r = await fetch(`${hubUrl}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000),
  })
  return { status: r.status, json: await r.json() }
}

await pruebaAsync('HTTP: /api/memoria/estado 422 al exceder y 200 dentro del límite', async () => {
  assert.ok(listo, 'el hub temporal no arrancó')
  const dentro = '# ESTADO\n\n## Tarea\n' + 'y'.repeat(100) + '\n'
  const ok = await post('/api/memoria/estado', { cwd: cwdHttp, contenido: dentro })
  assert.equal(ok.status, 200, `dentro del límite: ${ok.status} ${JSON.stringify(ok.json)}`)
  assert.equal(ok.json.ok, true)
  const fuera = '# ESTADO\n\n## Tarea\n' + 'x'.repeat(LIMITES.estado + 10) + '\n'
  const r = await post('/api/memoria/estado', { cwd: cwdHttp, contenido: fuera })
  assert.equal(r.status, 422, `al exceder: ${r.status} ${JSON.stringify(r.json)}`)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.motivo, 'excede')
  assert.equal(r.json.limite, LIMITES.estado)
  assert.equal(r.json.actuales, medirCuerpo(dentro))
  assert.equal(r.json.contenidoActual, dentro)
})

await pruebaAsync('HTTP: /api/memoria/contexto 422 al exceder y 200 dentro del límite', async () => {
  assert.ok(listo, 'el hub temporal no arrancó')
  const dentro = '# Contexto\n\n## Convenciones\n' + 'y'.repeat(100) + '\n'
  const ok = await post('/api/memoria/contexto', { cwd: cwdHttp, contenido: dentro })
  assert.equal(ok.status, 200, `dentro del límite: ${ok.status} ${JSON.stringify(ok.json)}`)
  assert.equal(ok.json.ok, true)
  const fuera = '# Contexto\n\n## Convenciones\n' + 'x'.repeat(LIMITES.contexto + 10) + '\n'
  const r = await post('/api/memoria/contexto', { cwd: cwdHttp, contenido: fuera })
  assert.equal(r.status, 422, `al exceder: ${r.status} ${JSON.stringify(r.json)}`)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.motivo, 'excede')
  assert.equal(r.json.limite, LIMITES.contexto)
  assert.equal(r.json.actuales, medirCuerpo(dentro))
  assert.equal(r.json.contenidoActual, dentro)
})

await pruebaAsync('estado.mjs --escribir sale con 1 y mensaje claro ante el 422', async () => {
  assert.ok(listo, 'el hub temporal no arrancó')
  const archivoGrande = path.join(raiz, 'estado-grande.md')
  fs.writeFileSync(archivoGrande, '# ESTADO\n\n## Tarea\n' + 'x'.repeat(LIMITES.estado + 50) + '\n')
  const r = spawnSync(process.execPath, [ESTADO_CLI, '--escribir', '--archivo', archivoGrande, '--cwd', cwdHttp], {
    env: { ...process.env, HUB_URL: hubUrl },
    encoding: 'utf8',
  })
  assert.equal(r.status, 1, `salió con ${r.status}: ${r.stdout}${r.stderr}`)
  assert.ok(/l[íi]mite/.test(r.stderr || ''), `el mensaje no explica el límite: ${r.stderr}`)
  assert.ok(String(r.stderr).includes(String(LIMITES.estado)), `el mensaje no cita el límite ${LIMITES.estado}: ${r.stderr}`)
})

// Cierra el hub temporal antes de limpiar.
try { hijo.kill() } catch { /* ya cerrado */ }

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
