#!/usr/bin/env node
/**
 * Pruebas de Engram junto al hub (`docs/specs/23-engram-como-memoria.md`).
 * Usa un Engram falso (ENGRAM_BIN) y un hub falso o apagado: nunca toca la memoria
 * real. Datos en un temporal fuera del repo.
 * Uso: node scripts/test-engram.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOKS = path.join(__dirname, '..', 'config', 'hooks')
const { parsearBusqueda } = await import(pathToFileURL(path.join(HOOKS, 'engram.mjs')).href)
const { crearMemoria } = await import(pathToFileURL(path.join(__dirname, '..', 'config', 'hub', 'lib', 'memoria.mjs')).href)

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-engram-'))
console.log(`Temporal: ${raiz}\n`)

const SALIDA_BUSQUEDA = `Found 1 memories:

[1] #2 (decision) — Quitar Laya
    El usuario decide quitar Laya del sistema.
    2026-10-28 20:01:58 | project: demo | scope: project
`
const FALSO = path.join(raiz, 'engram-falso.mjs')
// `save` deja sus argumentos y su carpeta en GUARDADO; ENGRAM_FALLA_SAVE=1 lo hace fallar.
const GUARDADO = path.join(raiz, 'engram-guardado.json')
fs.writeFileSync(FALSO, `import fs from 'node:fs'
const a = process.argv.slice(2)
if (a[0] === 'version') console.log('engram 3.6.0')
else if (a[0] === 'search') process.stdout.write(${JSON.stringify(SALIDA_BUSQUEDA)})
else if (a[0] === 'save' && process.env.ENGRAM_FALLA_SAVE !== '1') fs.writeFileSync(${JSON.stringify(GUARDADO)}, JSON.stringify({ args: a, cwd: process.cwd() }))
else process.exit(1)
`)
const HUB_APAGADO = 'http://127.0.0.1:9'

let fallos = 0
async function prueba(nombre, fn) {
  try { await fn(); console.log(`PASA  ${nombre}`) } catch (e) {
    fallos++; console.log(`FALLA ${nombre}`); console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}
function correr(script, args, env, entrada = '') {
  return new Promise((res) => {
    const limpio = { ...process.env }
    delete limpio.ENGRAM_DESACTIVADO
    delete limpio.ULTIMA_SESION_RESUMIENDO
    const h = spawn(process.execPath, [path.join(HOOKS, script), ...args], { env: { ...limpio, ...env }, windowsHide: true })
    let out = ''; let err = ''
    h.stdout.on('data', (c) => { out += c }); h.stderr.on('data', (c) => { err += c })
    h.on('close', (code) => res({ code, out, err }))
    h.stdin.end(entrada)
  })
}
const PLUGIN_ON = path.join(raiz, 'settings-on.json')
const PLUGIN_OFF = path.join(raiz, 'settings-off.json')
fs.writeFileSync(PLUGIN_ON, JSON.stringify({ enabledPlugins: { 'engram@engram': true } }))
fs.writeFileSync(PLUGIN_OFF, JSON.stringify({ enabledPlugins: { 'engram@engram': false } }))
const conEngram = { ENGRAM_BIN: FALSO, ENGRAM_SETTINGS: PLUGIN_ON }
const soloBinario = { ENGRAM_BIN: FALSO, ENGRAM_SETTINGS: PLUGIN_OFF }
const sinEngram = { ENGRAM_DESACTIVADO: '1' }
// Espía del resumen Haiku: deja una marca en vez de llamar a Claude.
const ESPIA = path.join(raiz, 'espia.mjs')
const MARCA = path.join(raiz, 'resumen-lanzado')
fs.writeFileSync(ESPIA, `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(MARCA)}, 'si')\n`)

// Proyecto con memoria del hub y nota de última sesión, para el briefing local.
const datos = path.join(raiz, 'hub-data')
const cwd = path.join(raiz, 'proyecto-demo')
fs.mkdirSync(cwd, { recursive: true })
const memoria = crearMemoria(path.join(datos, 'memoria'))
memoria.inicializar()
memoria.escribirEstado(cwd, '# ESTADO\n\n## Ahora\nTarea de prueba en curso')
memoria.agregarBitacora(cwd, 'Movimiento de prueba')
const slugNota = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
fs.mkdirSync(path.join(datos, 'memoria', 'ultima-sesion'), { recursive: true })
fs.writeFileSync(path.join(datos, 'memoria', 'ultima-sesion', `${slugNota}.md`), 'Nota Haiku de la sesión anterior')
const entradaSesion = JSON.stringify({ cwd, session_id: 's1' })
const baseSesion = { HUB_URL: HUB_APAGADO, HUB_DATA_DIR: datos, SISTEMA_CEREBRO_DIR: raiz }

await prueba('S1 · parsea la salida de engram search', () => {
  const r = parsearBusqueda(SALIDA_BUSQUEDA)
  assert.equal(r.length, 1)
  assert.deepEqual(r[0], { tipo: 'engram:decision', id: 2, titulo: 'Quitar Laya', snippet: 'El usuario decide quitar Laya del sistema.', fecha: '2026-10-28 20:01:58', proyecto: 'demo' })
  assert.deepEqual(parsearBusqueda('No memories found'), [])
})

await prueba('S4 · buscar con hub apagado y Engram: muestra Engram y sale 0', async () => {
  const r = await correr('buscar.mjs', ['Laya'], { ...conEngram, HUB_URL: HUB_APAGADO })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\[engram:decision\] · demo · 2026-10-28 20:01:58/)
  assert.match(r.out, /Quitar Laya/)
})

await prueba('S4 · hub apagado y Engram sin coincidencias: error del hub y sale 1 (como antes)', async () => {
  const vacio = path.join(raiz, 'engram-vacio.mjs')
  fs.writeFileSync(vacio, "const a = process.argv.slice(2)\nconsole.log(a[0] === 'version' ? 'engram 3.6.0' : 'No memories found')\n")
  const r = await correr('buscar.mjs', ['nada'], { ENGRAM_BIN: vacio, ENGRAM_SETTINGS: PLUGIN_ON, HUB_URL: HUB_APAGADO })
  assert.equal(r.code, 1)
  assert.match(r.err, /No se pudo hablar con el hub/)
})

await prueba('S4 · buscar sin Engram y hub apagado: igual que antes (sale 1)', async () => {
  const r = await correr('buscar.mjs', ['Laya'], { ...sinEngram, HUB_URL: HUB_APAGADO })
  assert.equal(r.code, 1)
  assert.match(r.err, /No se pudo hablar con el hub/)
  assert.doesNotMatch(r.out, /engram/)
})

await prueba('S4 · --tipo engram sin Engram: avisa y sale 1', async () => {
  const r = await correr('buscar.mjs', ['Laya', '--tipo', 'engram'], { ...soloBinario, HUB_URL: HUB_APAGADO })
  assert.equal(r.code, 1)
  assert.match(r.err, /Engram no responde/)
})

await prueba('S4 · buscar une hub y Engram; --tipo engram solo Engram', async () => {
  const pedidas = []
  const srv = http.createServer((req, res) => {
    pedidas.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, modo: 'fts', resultados: [{ tipo: 'bitacora', titulo: 'Del hub', snippet: 'x', proyecto: 'p', fecha: 'f' }] }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}`
  try {
    const ambos = await correr('buscar.mjs', ['Laya'], { ...conEngram, HUB_URL: url })
    assert.equal(ambos.code, 0, ambos.err)
    assert.match(ambos.out, /2 resultado\(s\)/)
    assert.match(ambos.out, /\[bitacora\][\s\S]*\[engram:decision\]/)
    const solo = await correr('buscar.mjs', ['Laya', '--tipo', 'engram'], { ...conEngram, HUB_URL: url })
    assert.equal(solo.code, 0, solo.err)
    assert.doesNotMatch(solo.out, /Del hub/)
    assert.match(solo.out, /\[engram:decision\]/)
    assert.equal(pedidas.length, 1, 'con --tipo engram no se consulta el hub')
    const tope = await correr('buscar.mjs', ['Laya', '--limite', '1'], { ...conEngram, HUB_URL: url })
    assert.match(tope.out, /^1 resultado\(s\)/m, '--limite es el tope de lo que se muestra')
    const proyecto = await correr('buscar.mjs', ['Laya', '--proyecto', 'p'], { ...conEngram, HUB_URL: url })
    assert.doesNotMatch(proyecto.out, /engram:/, 'con --proyecto Engram no entra')
    assert.match(proyecto.out, /Del hub/)
    const filtro = await correr('buscar.mjs', ['Laya', '--tipo', 'bitacora'], { ...conEngram, HUB_URL: HUB_APAGADO })
    assert.equal(filtro.code, 1, 'hub apagado con --tipo del hub sigue saliendo 1')
  } finally { srv.close() }
})

await prueba('S2/S3 · briefing local con Engram: sin bitácora ni nota de última sesión', async () => {
  const r = await correr('session-start.mjs', [], { ...baseSesion, ...conEngram }, entradaSesion)
  const texto = JSON.parse(r.out).hookSpecificOutput.additionalContext
  assert.match(texto, /Tarea de prueba en curso/)
  assert.doesNotMatch(texto, /Nota Haiku/)
  assert.match(texto, /Engram/)
})

await prueba('S2 · briefing local sin Engram: con la nota de última sesión (como antes)', async () => {
  const r = await correr('session-start.mjs', [], { ...baseSesion, ...sinEngram }, entradaSesion)
  const texto = JSON.parse(r.out).hookSpecificOutput.additionalContext
  assert.match(texto, /Tarea de prueba en curso/)
  assert.match(texto, /Nota Haiku/)
})

await prueba('S2 · binario sin plugin activo: briefing como antes (con nota)', async () => {
  const r = await correr('session-start.mjs', [], { ...baseSesion, ...soloBinario }, entradaSesion)
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /Nota Haiku/)
})

await prueba('S2 · el hook pide al hub el briefing sin bitácora solo con Engram', async () => {
  const pedidas = []
  const srv = http.createServer((req, res) => {
    pedidas.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, proyecto: { slug: 'x' }, texto: '# Briefing del hub' }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}`
  try {
    await correr('session-start.mjs', [], { ...baseSesion, ...conEngram, HUB_URL: url }, entradaSesion)
    await correr('session-start.mjs', [], { ...baseSesion, ...sinEngram, HUB_URL: url }, entradaSesion)
    assert.match(pedidas[0], /[?&]engram=1/)
    assert.doesNotMatch(pedidas[1], /engram=/)
  } finally { srv.close() }
})

await prueba('S2 · memoria.briefing omite la bitácora con sinBitacora', () => {
  assert.match(memoria.briefing(cwd), /Últimos movimientos/)
  const corto = memoria.briefing(cwd, { sinBitacora: true })
  assert.doesNotMatch(corto, /Últimos movimientos/)
  assert.match(corto, /Tarea de prueba en curso/)
})

await prueba('S3 · session-end lanza el resumen Haiku solo sin Engram activo', async () => {
  const transcript = path.join(raiz, 't.jsonl')
  fs.writeFileSync(transcript, '{}\n')
  const entrada = JSON.stringify({ cwd, reason: 'other', transcript_path: transcript })
  const lanzado = async (env) => {
    fs.rmSync(MARCA, { force: true })
    const r = await correr('session-end.mjs', [], { ...baseSesion, RESUMIR_SCRIPT: ESPIA, ...env }, entrada)
    assert.equal(r.code, 0)
    for (let i = 0; i < 50 && !fs.existsSync(MARCA); i++) await new Promise((ok) => setTimeout(ok, 100))
    return fs.existsSync(MARCA)
  }
  assert.equal(await lanzado(conEngram), false, 'con Engram activo no se lanza')
  assert.equal(await lanzado(soloBinario), true, 'con el plugin apagado se lanza, como antes')
  assert.equal(await lanzado(sinEngram), true, 'sin Engram se lanza, como antes')
})

await prueba('S5 · doctor: punto engram verde / amarillo / rojo', async () => {
  const settings = path.join(raiz, 'settings.json')
  const doctor = async (contenido, env) => {
    fs.writeFileSync(settings, JSON.stringify(contenido))
    const r = await correr('doctor.mjs', ['--json'], { DOCTOR_SETTINGS: settings, DOCTOR_OMITIR: 'verificar,gentle-ai,opencode', ...env })
    return JSON.parse(r.out).find((p) => p.id === 'engram')?.estado
  }
  assert.equal(await doctor({ enabledPlugins: { 'engram@engram': true } }, conEngram), 'verde')
  assert.equal(await doctor({}, conEngram), 'amarillo')
  assert.equal(await doctor({ enabledPlugins: { 'engram@engram': true } }, { ENGRAM_BIN: path.join(raiz, 'no-existe') }), 'rojo')
})

await prueba('Spec 24 · S1/S2 · estado --bitacora: con Engram, a Engram; si falla o sin Engram, al hub', async () => {
  const recibidas = []
  const srv = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      recibidas.push({ url: req.url, cuerpo: JSON.parse(cuerpo || '{}') })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}`
  const bitacora = (env) => correr('estado.mjs', ['--bitacora', 'Título de prueba', '--texto', 'Detalle', '--cwd', cwd], { HUB_URL: url, ...env })
  try {
    fs.rmSync(GUARDADO, { force: true })
    let r = await bitacora(conEngram)
    assert.equal(r.code, 0)
    assert.match(r.out, /Entrada guardada en Engram\./)
    const g = JSON.parse(fs.readFileSync(GUARDADO, 'utf8'))
    assert.deepEqual(g.args, ['save', 'Título de prueba', 'Detalle', '--type', 'manual'])
    assert.equal(path.resolve(g.cwd), path.resolve(cwd))
    assert.equal(recibidas.length, 0, 'con Engram no se escribe en el hub')

    r = await bitacora({ ...conEngram, ENGRAM_FALLA_SAVE: '1' })
    assert.equal(r.code, 0)
    assert.match(r.out, /Entrada añadida a la bitácora\./)
    assert.equal(recibidas.length, 1, 'si Engram falla, va al hub')

    fs.rmSync(GUARDADO, { force: true })
    r = await bitacora(sinEngram)
    assert.equal(r.code, 0)
    assert.match(r.out, /Entrada añadida a la bitácora\./)
    assert.equal(recibidas.length, 2)
    assert.equal(recibidas[1].url, '/api/memoria/bitacora')
    assert.deepEqual(recibidas[1].cuerpo, { cwd, titulo: 'Título de prueba', texto: 'Detalle' })
    assert.equal(fs.existsSync(GUARDADO), false, 'sin Engram no se llama a engram save')
  } finally { srv.close() }
})

await prueba('Spec 24 · S2 · estado --bitacora sin texto guarda el título como contenido', async () => {
  fs.rmSync(GUARDADO, { force: true })
  const r = await correr('estado.mjs', ['--bitacora', 'Solo título', '--cwd', cwd], { HUB_URL: HUB_APAGADO, ...conEngram })
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(fs.readFileSync(GUARDADO, 'utf8')).args, ['save', 'Solo título', 'Solo título', '--type', 'manual'])
})

try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
