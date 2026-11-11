#!/usr/bin/env node
/**
 * Pruebas de los perfiles de modelos (spec perfiles-modelos · S1-S5).
 * Todo corre sobre copias en un directorio temporal: no toca ~/.claude, OpenCode ni config/ del repo
 * (de config/ solo se LEE para copiarlo). El panel se arranca en un puerto libre con HOME falso.
 */
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-perfiles-'))
const imp = (...p) => import(pathToFileURL(path.join(raiz, ...p)).href)

process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch (e) { console.log(`AVISO no se pudo borrar ${tmp}: ${e.message}`) } })
let fallos = 0
let limpiarTrasPrueba = null // deja los ficheros como estaban, pase o falle la prueba
const prueba = async (n, fn) => { try { await fn(); console.log(`PASA  ${n}`) } catch (e) { fallos++; console.log(`FALLA ${n}\n      ${String(e.message).split('\n').slice(0, 3).join(' | ')}`) } finally { if (limpiarTrasPrueba) limpiarTrasPrueba() } }

// ---------------------------------------------------------------- entorno falso
const T = { repo: path.join(tmp, 'repo'), casa: path.join(tmp, 'casa'), sistema: path.join(tmp, 'sistema') }
const rutas = {
  repo: { claude: path.join(T.repo, 'config', 'claude', 'agents'), opencode: path.join(T.repo, 'config', 'opencode', 'agents') },
  instalado: { claude: path.join(T.casa, '.claude', 'agents'), opencode: path.join(T.casa, '.config', 'opencode', 'agents') },
}
const dirPerfiles = path.join(T.repo, 'config', 'perfiles')
const registroRuta = path.join(T.sistema, 'instalado.json')
const ORDEN_CLAUDE = ['cerebro', 'subdirector', 'explorador', 'redactor', 'analista', 'arquitecto', 'adaptador-mcps', 'planificador', 'resolutor', 'ayudante', 'retocador', 'consultor']

fs.mkdirSync(path.join(T.repo, 'config'), { recursive: true })
fs.cpSync(path.join(raiz, 'config', 'claude', 'agents'), rutas.repo.claude, { recursive: true })
fs.cpSync(path.join(raiz, 'config', 'opencode', 'agents'), rutas.repo.opencode, { recursive: true })
fs.cpSync(path.join(raiz, 'config', 'perfiles'), dirPerfiles, { recursive: true })
fs.cpSync(rutas.repo.claude, rutas.instalado.claude, { recursive: true })
fs.cpSync(rutas.repo.opencode, rutas.instalado.opencode, { recursive: true })
fs.mkdirSync(path.join(T.repo, 'scripts'), { recursive: true })
fs.copyFileSync(path.join(raiz, 'scripts', 'instalado.mjs'), path.join(T.repo, 'scripts', 'instalado.mjs'))
fs.writeFileSync(path.join(T.repo, 'VERSION'), '0.0.0-test\n')
// Un agente con finales de línea CRLF en las dos copias.
for (const d of [rutas.repo.claude, rutas.instalado.claude]) {
  const f = path.join(d, 'consultor.md'); fs.writeFileSync(f, fs.readFileSync(f, 'latin1').replace(/\r?\n/g, '\r\n'), 'latin1')
}

const inst = await imp('scripts', 'instalado.mjs')
const P = await imp('config', 'hub', 'lib', 'perfiles.mjs')

const paresClaude = ORDEN_CLAUDE.flatMap((n) => [path.join(rutas.repo.claude, `${n}.md`), path.join(rutas.instalado.claude, `${n}.md`)])
const nombresOc = fs.readdirSync(rutas.repo.opencode).filter((n) => n.endsWith('.md')).sort()
const paresOc = nombresOc.flatMap((n) => [path.join(rutas.repo.opencode, n), path.join(rutas.instalado.opencode, n)])
const aPares = (l) => l.reduce((a, _, i) => (i % 2 ? a : [...a, { origen: path.resolve(l[i]), destino: path.resolve(l[i + 1]) }]), [])
const registrarTodo = () => { inst.registrar(registroRuta, 'agentes-claude', aPares(paresClaude)); inst.registrar(registroRuta, 'agentes-opencode', aPares(paresOc)) }
const estadoComp = (n) => inst.estado(registroRuta, n, aPares(n === 'agentes-claude' ? paresClaude : paresOc))
const opciones = { registro: { ruta: registroRuta, api: inst } }

const todos = () => [rutas.repo.claude, rutas.repo.opencode, rutas.instalado.claude, rutas.instalado.opencode]
  .flatMap((d) => fs.readdirSync(d).filter((n) => n.endsWith('.md')).map((n) => path.join(d, n)))
const foto = () => new Map(todos().map((f) => [f, fs.readFileSync(f)]))
const igualesA = (antes) => { const ahora = foto(); assert.equal(ahora.size, antes.size); for (const [f, b] of antes) assert.ok(b.equals(ahora.get(f)), `cambió ${path.basename(f)}`) }
const perfil = (id) => JSON.parse(fs.readFileSync(path.join(dirPerfiles, `${id}.json`), 'utf8'))
const clon = (o) => JSON.parse(JSON.stringify(o))

const original = foto()
registrarTodo()
const restaurar = () => { for (const [f, b] of original) fs.writeFileSync(f, b); registrarTodo() }
limpiarTrasPrueba = restaurar

// ---------------------------------------------------------------- S1 · S2 perfiles
await prueba('S1 los perfiles se leen de config/perfiles/<id>.json y son válidos', () => {
  const l = P.leerPerfiles(dirPerfiles)
  assert.deepEqual(l.map((p) => p.id), ['actual', 'propuesta'])
  for (const p of l) { assert.ok(!p.error, p.error); assert.deepEqual(P.validarPerfil(p.perfil), []); assert.ok(p.perfil.nombre) }
})
await prueba('S1 un JSON roto se muestra como error y no tumba al resto', () => {
  const d = path.join(tmp, 'perf-roto'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'malo.json'), '{ no es json'); fs.writeFileSync(path.join(d, 'bien.json'), JSON.stringify(perfil('actual')))
  const l = P.leerPerfiles(d)
  assert.ok(l.find((p) => p.id === 'malo').error); assert.ok(!l.find((p) => p.id === 'bien').error)
})
await prueba('S2 actual coincide con los ficheros de agentes del repo (todos los agentes)', () => {
  const real = { repo: { claude: path.join(raiz, 'config', 'claude', 'agents'), opencode: path.join(raiz, 'config', 'opencode', 'agents') } }
  const a = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'perfiles', 'actual.json'), 'utf8'))
  const r = P.comparar(a, real)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.deepEqual(r.cambios, [])
  const nombres = (d) => fs.readdirSync(d).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).sort()
  assert.deepEqual(Object.keys(a.claude).sort(), nombres(real.repo.claude))
  assert.deepEqual(Object.keys(a.opencode).sort(), nombres(real.repo.opencode))
  assert.equal(a.opencode.local.variant, undefined, 'un agente sin variant no la lleva en actual')
})
await prueba('S2 propuesta = actual salvo consultor → fable·low y arquitecto → fable·high', () => {
  const a = perfil('actual'); const p = perfil('propuesta')
  assert.deepEqual(p.claude.consultor, { model: 'fable', effort: 'low' })
  assert.deepEqual(p.claude.arquitecto, { model: 'fable', effort: 'high' })
  const sin = clon(p); sin.claude.consultor = a.claude.consultor; sin.claude.arquitecto = a.claude.arquitecto
  assert.deepEqual({ ...sin, nombre: 0, descripcion: 0 }, { ...a, nombre: 0, descripcion: 0 })
  assert.ok(!p.permitirMasDeHigh)
})

// ---------------------------------------------------------------- S3 comparar y aplicar
await prueba('S3 comparar enseña agente: antes → después y no escribe nada', () => {
  const antes = foto()
  const r = P.comparar(perfil('propuesta'), rutas)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.deepEqual(r.cambios.map((c) => [c.origen, c.agente, c.campo, c.antes, c.despues]).sort(), [['claude', 'arquitecto', 'model', 'opus', 'fable'], ['claude', 'consultor', 'model', 'opus', 'fable']])
  igualesA(antes)
})
await prueba('S3 aplicar propuesta cambia solo las líneas model: en repo e instalado', () => {
  const r = P.aplicar(perfil('propuesta'), rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  const ahora = foto()
  for (const [f, b] of original) {
    const cambia = ['consultor.md', 'arquitecto.md'].includes(path.basename(f)) && [rutas.repo.claude, rutas.instalado.claude].includes(path.dirname(f))
    if (!cambia) { assert.ok(b.equals(ahora.get(f)), `no debía cambiar ${f}`); continue }
    const a = b.toString('latin1').split(/(\r?\n)/); const d = ahora.get(f).toString('latin1').split(/(\r?\n)/)
    assert.equal(a.length, d.length)
    const dif = a.map((l, i) => [l, d[i]]).filter(([x, y]) => x !== y)
    assert.equal(dif.length, 1, `${path.basename(f)}: ${dif.length} líneas distintas`)
    assert.equal(dif[0][0], 'model: opus'); assert.equal(dif[0][1], 'model: fable')
  }
})
await prueba('S3 aplicar actual después deja todos los ficheros idénticos al original (bytes, CRLF incluido)', () => {
  const r = P.aplicar(perfil('actual'), rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  igualesA(original)
  assert.match(fs.readFileSync(path.join(rutas.repo.claude, 'consultor.md'), 'latin1'), /\r\n/)
})
await prueba('S3 un agente que no aparece en el perfil no se toca', () => {
  const p = { nombre: 'solo uno', claude: { ayudante: { model: 'sonnet', effort: 'low' } } }
  const r = P.aplicar(p, rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  const ahora = foto()
  for (const [f, b] of original) if (path.basename(f) !== 'ayudante.md' || f.includes('opencode')) assert.ok(b.equals(ahora.get(f)), `tocó ${f}`)
  assert.match(fs.readFileSync(path.join(rutas.instalado.claude, 'ayudante.md'), 'utf8'), /\nmodel: sonnet\r?\neffort: low\r?\n/)
  restaurar()
})
await prueba('S3 effort y variant se reescriben; un agente sin variant no la recibe si el perfil no la lleva', () => {
  const p = { nombre: 'x', claude: { resolutor: { effort: 'high' } }, opencode: { implementador: { variant: 'high' }, local: { model: 'ollama/hf.co/bartowski/Qwen_Qwen3.5-9B-GGUF:IQ4_XS' } } }
  const r = P.aplicar(p, rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.match(fs.readFileSync(path.join(rutas.instalado.claude, 'resolutor.md'), 'utf8'), /\nmodel: sonnet\r?\neffort: high\r?\n/)
  assert.match(fs.readFileSync(path.join(rutas.repo.opencode, 'implementador.md'), 'utf8'), /\nvariant: high\r?\n/)
  assert.ok(!/variant:/.test(fs.readFileSync(path.join(rutas.repo.opencode, 'local.md'), 'utf8')))
  restaurar()
})
await prueba('S1 un agente del perfil cuyo fichero no existe es un error y no se aplica nada', () => {
  const antes = foto()
  const p = clon(perfil('propuesta')); p.claude.fantasma = { model: 'haiku', effort: 'low' }
  const r = P.aplicar(p, rutas, opciones)
  assert.equal(r.ok, false)
  assert.match(r.errores.join(' '), /fantasma/)
  assert.equal(P.comparar(p, rutas).ok, false)
  igualesA(antes)
})
await prueba('S1 un nombre de agente con ruta (../) se rechaza sin escribir', () => {
  const antes = foto()
  const r = P.aplicar({ nombre: 'x', claude: { '../repo/config/claude/agents/consultor': { model: 'haiku' } } }, rutas, opciones)
  assert.equal(r.ok, false); igualesA(antes)
})
await prueba('S3 validación primero: si falla un agente posterior no se escribe el anterior', () => {
  const antes = foto()
  const p = clon(perfil('propuesta')); p.opencode.fantasma = { model: 'deepseek/deepseek-flash' }
  assert.equal(P.aplicar(p, rutas, opciones).ok, false)
  igualesA(antes)
})
await prueba('S3 valores inválidos (modelo o esfuerzo desconocido) se rechazan sin escribir', () => {
  const antes = foto()
  for (const p of [{ nombre: 'x', claude: { consultor: { model: 'gpt', effort: 'low' } } }, { nombre: 'x', claude: { consultor: { model: 'opus', effort: 'ultra' } } }, { nombre: 'x', opencode: { revisor: { variant: 'max\nmodel: x' } } }]) {
    assert.equal(P.aplicar(p, rutas, opciones).ok, false)
  }
  igualesA(antes)
})
await prueba('S3 la detección del perfil: actual, propuesta o personalizado (null)', () => {
  const l = P.leerPerfiles(dirPerfiles)
  assert.equal(P.perfilActivo(l, rutas), 'actual')
  P.aplicar(perfil('propuesta'), rutas, opciones)
  assert.equal(P.perfilActivo(l, rutas), 'propuesta')
  fs.appendFileSync(path.join(rutas.instalado.claude, 'consultor.md'), '')
  const f = path.join(rutas.instalado.claude, 'redactor.md'); fs.writeFileSync(f, fs.readFileSync(f, 'latin1').replace('model: haiku', 'model: sonnet'), 'latin1')
  assert.equal(P.perfilActivo(l, rutas), null)
  restaurar()
})

// ---------------------------------------------------------------- S3 coherencia con la detección de cambios del instalador (spec 25)
await prueba('S3 tras aplicar, el instalador no da los agentes como editados a mano (igual)', () => {
  assert.equal(estadoComp('agentes-claude'), 'igual'); assert.equal(estadoComp('agentes-opencode'), 'igual')
  const r = P.aplicar(perfil('propuesta'), rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.equal(estadoComp('agentes-claude'), 'igual', 'agentes-claude')
  assert.equal(estadoComp('agentes-opencode'), 'igual', 'agentes-opencode')
  assert.equal(r.registro['agentes-claude'], 'registrado')
  restaurar()
})
await prueba('S3 si ya había una edición a mano, aplicar no la esconde: sigue «tocado»', () => {
  fs.appendFileSync(path.join(rutas.instalado.claude, 'ayudante.md'), '\nnota mía\n')
  assert.equal(estadoComp('agentes-claude'), 'tocado')
  const r = P.aplicar(perfil('propuesta'), rutas, opciones)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.equal(estadoComp('agentes-claude'), 'tocado')
  assert.match(r.registro['agentes-claude'], /^omitido/)
  restaurar()
})
await prueba('S3 sin registro previo se aplica igual y se dice que no se registró', () => {
  const sin = { registro: { ruta: path.join(tmp, 'no-existe', 'instalado.json'), api: inst } }
  const r = P.aplicar(perfil('propuesta'), rutas, sin)
  assert.ok(r.ok, r.errores?.join(' '))
  assert.match(r.registro['agentes-claude'], /^omitido/)
  assert.ok(!fs.existsSync(sin.registro.ruta), 'no debe crear un registro nuevo')
  restaurar()
})

// ---------------------------------------------------------------- S4 tope de esfuerzo
await prueba('S4 fable con xhigh o max se rechaza sin modificar ningún fichero', () => {
  const antes = foto()
  for (const [sec, campo, val] of [['claude', 'effort', 'xhigh'], ['claude', 'effort', 'max'], ['opencode', 'variant', 'max']]) {
    const p = clon(perfil('propuesta'))
    if (sec === 'claude') p.claude.arquitecto = { model: 'fable', effort: val }
    else p.opencode.revisor = { model: 'anthropic/fable', variant: val }
    const r = P.aplicar(p, rutas, opciones)
    assert.equal(r.ok, false, `${sec} ${campo} ${val}`)
    assert.match(r.errores.join(' '), /fable/i); assert.match(r.errores.join(' '), /permitirMasDeHigh/)
    assert.equal(P.comparar(p, rutas).ok, false)
  }
  igualesA(antes)
})
await prueba('S4 con "permitirMasDeHigh": true se acepta; fable·high no necesita permiso', () => {
  const p = clon(perfil('propuesta')); p.claude.arquitecto = { model: 'fable', effort: 'xhigh' }; p.permitirMasDeHigh = true
  assert.deepEqual(P.validarPerfil(p), [])
  const q = clon(perfil('propuesta')); assert.deepEqual(P.validarPerfil(q), [])
  const r = P.aplicar(p, rutas, opciones); assert.ok(r.ok, r.errores?.join(' '))
  assert.match(fs.readFileSync(path.join(rutas.repo.claude, 'arquitecto.md'), 'utf8'), /effort: xhigh/)
  restaurar()
})
await prueba('S4 los valores que ya existen hoy siguen siendo válidos (revisor deepseek · max, opus · xhigh)', () => {
  assert.equal(perfil('actual').opencode.revisor.variant, 'max')
  assert.deepEqual(P.validarPerfil(perfil('actual')), [])
  assert.deepEqual(P.validarPerfil({ nombre: 'x', claude: { cerebro: { model: 'opus', effort: 'xhigh' } } }), [])
  assert.deepEqual(P.validarPerfil({ nombre: 'x', claude: { cerebro: { model: 'opus', effort: 'max' } } }), [])
})

// ---------------------------------------------------------------- S3 web: guardas y endpoints
const guardas = await imp('config', 'web', 'guardas.mjs')
const falsa = (o = {}) => ({ method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4598', 'content-type': 'application/json' }, ...o })
await prueba('S3 guardas: solo POST, solo 127.0.0.1, application/json, sin Origin ajeno', () => {
  assert.equal(guardas.comprobarEscritura(falsa(), 4598), null)
  assert.equal(guardas.comprobarEscritura(falsa({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), 4598), null)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: '127.0.0.1:4598', 'content-type': 'application/json; charset=utf-8', origin: 'http://127.0.0.1:4598' } }), 4598), null)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: 'localhost:4598', 'content-type': 'application/json', origin: 'http://localhost:4598' } }), 4598), null)
  assert.equal(guardas.comprobarEscritura(falsa({ socket: { remoteAddress: '192.168.0.5' } }), 4598).status, 403)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: '127.0.0.1:4598', 'content-type': 'application/json', origin: 'http://evil.example' } }), 4598).status, 403)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: '127.0.0.1:4598', 'content-type': 'application/json', origin: 'http://127.0.0.1:9999' } }), 4598).status, 403)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: '127.0.0.1:4598', 'content-type': 'text/plain' } }), 4598).status, 415)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: '127.0.0.1:4598' } }), 4598).status, 415)
  assert.equal(guardas.comprobarEscritura(falsa({ method: 'GET' }), 4598).status, 405)
  assert.equal(guardas.comprobarEscritura(falsa({ headers: { host: 'evil.example', 'content-type': 'application/json' } }), 4598).status, 403)
})

const puertoLibre = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }); s.on('error', rej) })
const puerto = await puertoLibre()
fs.mkdirSync(T.sistema, { recursive: true })
fs.writeFileSync(path.join(T.sistema, 'panel-config.json'), JSON.stringify({ repoRoot: T.repo }))
// Las capturas y modelos.json van con el panel; el repo falso solo necesita config/perfiles, los agentes y scripts/instalado.mjs.
const hijo = spawn(process.execPath, [path.join(raiz, 'config', 'web', 'servidor-web.mjs'), '--port', String(puerto)], {
  env: { ...process.env, HOME: T.casa, USERPROFILE: T.casa, SISTEMA_CEREBRO_DIR: T.sistema, LOCALAPPDATA: path.join(tmp, 'local'), XDG_STATE_HOME: path.join(tmp, 'local') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let salidaHijo = ''; hijo.stdout.on('data', (d) => { salidaHijo += d }); hijo.stderr.on('data', (d) => { salidaHijo += d })
const base = `http://127.0.0.1:${puerto}`
const post = (ruta, cuerpo, cabeceras = { 'Content-Type': 'application/json' }) => fetch(base + ruta, { method: 'POST', headers: cabeceras, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) })
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/ping')).ok) break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  restaurar()

  await prueba('S3 el panel sirve las pestañas «Agentes» y «Modelos» y sus ficheros', async () => {
    const html = await (await fetch(base + '/')).text()
    assert.match(html, /data-pestana="agentes"[^>]*>\s*Agentes/); assert.match(html, /data-pestana="modelos"[^>]*>\s*Modelos/)
    assert.equal((await fetch(base + '/modelos.json')).status, 200)
    for (const n of fs.readdirSync(path.join(raiz, 'config', 'web', 'public', 'capturas'))) assert.equal((await fetch(`${base}/capturas/${n}`)).status, 200, n)
    assert.equal((await fetch(base + '/capturas/..%2fapp.js')).status, 404)
    assert.equal((await fetch(base + '/capturas/nada.png')).status, 404)
  })
  await prueba('S3 GET /api/perfiles lista los perfiles, el activo y los agentes', async () => {
    const r = await (await fetch(base + '/api/perfiles')).json()
    assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.perfiles.map((p) => p.id), ['actual', 'propuesta']); assert.equal(r.activo, 'actual')
    assert.equal(r.agentes.filter((a) => a.origen === 'claude').length, 12)
    const c = r.agentes.find((a) => a.origen === 'claude' && a.agente === 'consultor'); assert.equal(c.model, 'opus'); assert.equal(c.effort, 'low')
  })
  await prueba('S3 la previa muestra el antes → después sin escribir', async () => {
    const antes = foto()
    const r = await (await fetch(base + '/api/perfiles/previa?id=propuesta')).json()
    assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.cambios.length, 2)
    assert.equal((await (await fetch(base + '/api/perfiles/previa?id=nada')).json()).ok, false)
    assert.equal((await (await fetch(base + '/api/perfiles/previa?id=..%2f..%2fx')).json()).ok, false)
    igualesA(antes)
  })
  await prueba('S3 POST con Origin ajeno → 403 y no cambia nada (perfiles y bots)', async () => {
    const antes = foto()
    for (const ruta of ['/api/perfiles/aplicar', '/api/bot', '/api/bot/eliminar']) {
      const r = await post(ruta, { id: 'propuesta', nombre: 'x' }, { 'Content-Type': 'application/json', Origin: 'http://evil.example' })
      assert.equal(r.status, 403, ruta)
    }
    igualesA(antes)
  })
  await prueba('S3 POST sin Content-Type: application/json → 415 y no cambia nada', async () => {
    const antes = foto()
    assert.equal((await post('/api/perfiles/aplicar', JSON.stringify({ id: 'propuesta' }), { 'Content-Type': 'text/plain' })).status, 415)
    assert.equal((await post('/api/perfiles/aplicar', JSON.stringify({ id: 'propuesta' }), {})).status, 415)
    assert.equal((await post('/api/bot', JSON.stringify({ nombre: 'x' }), { 'Content-Type': 'text/plain' })).status, 415)
    assert.equal((await fetch(base + '/api/perfiles/aplicar')).status, 405)
    igualesA(antes)
  })
  await prueba('S3 POST válido aplica el perfil en el repo y en lo instalado, y el instalador lo da por igual', async () => {
    const r = await post('/api/perfiles/aplicar', { id: 'propuesta' }, { 'Content-Type': 'application/json', Origin: base })
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.ok(j.ok, JSON.stringify(j))
    for (const d of [rutas.repo.claude, rutas.instalado.claude]) assert.match(fs.readFileSync(path.join(d, 'consultor.md'), 'utf8'), /model: fable/)
    assert.equal(estadoComp('agentes-claude'), 'igual')
    assert.equal((await (await fetch(base + '/api/perfiles')).json()).activo, 'propuesta')
  })
  await prueba('S4 el panel rechaza un perfil fable·max sin modificar nada', async () => {
    restaurar()
    const p = clon(perfil('propuesta')); p.claude.arquitecto = { model: 'fable', effort: 'max' }
    fs.writeFileSync(path.join(dirPerfiles, 'riesgo.json'), JSON.stringify(p))
    const antes = foto()
    const r = await post('/api/perfiles/aplicar', { id: 'riesgo' }); const j = await r.json()
    assert.equal(j.ok, false); assert.match(j.errores.join(' '), /permitirMasDeHigh/)
    igualesA(antes)
  })
  await prueba('S1 un id de perfil inexistente o con ruta se rechaza', async () => {
    const antes = foto()
    for (const id of ['nada', '../../etc/x', '']) assert.equal((await (await post('/api/perfiles/aplicar', { id })).json()).ok, false, id)
    igualesA(antes)
  })
  await prueba('S5 modelos.json tiene las 18 filas de la spec con sus campos', () => {
    const m = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'web', 'public', 'modelos.json'), 'utf8'))
    assert.equal(m.modelos.length, 18); assert.ok(m.aproximado); assert.match(m.fuente, /Artificial Analysis/)
    for (const x of m.modelos) for (const k of ['modelo', 'proveedor', 'indice', 'dolares', 'minutos', 'engineering']) assert.ok(x[k] !== undefined, `${x.modelo} sin ${k}`)
  })
} finally {
  hijo.kill()
}

await new Promise((r) => setTimeout(r, 300))
if (fallos) { console.log(`\n${fallos} fallo(s)`); if (salidaHijo) console.log(salidaHijo.slice(-600)); process.exit(1) }
console.log('\nTodo bien')
