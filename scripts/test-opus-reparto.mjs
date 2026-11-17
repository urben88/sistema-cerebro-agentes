#!/usr/bin/env node
/**
 * Prueba de la spec 15 (Opus dirige y lo mejor de configurar-claude):
 *   · aviso de contexto por tokens reales: systemMessage + additionalContext, una vez por nivel;
 *   · nota de última sesión: slug estable, lectura y espera de la marca «pendiente»;
 *   · frontmatter de los agentes: modelos y sin delegación.
 * Sin dependencias ni red: datos en una carpeta temporal.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-opus-'))
process.env.HUB_DATA_DIR = tmp

// 1 · Aviso de contexto en consola
const transcript = path.join(tmp, 't.jsonl')
const respuesta = (input) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
const hook = (sesion) => spawnSync(process.execPath, [path.join(raiz, 'config/hooks/aviso-contexto.mjs')], {
  input: JSON.stringify({ transcript_path: transcript, session_id: sesion }),
  encoding: 'utf8',
  env: { ...process.env, HUB_DATA_DIR: tmp, CONTEXTO_AVISO: '100000', CONTEXTO_PASO: '50000' },
}).stdout.trim()

// The threshold counts growth over the session's first answer (fixed load: CLAUDE.md, tools, skills…).
const subagente = JSON.stringify({ type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 500000 } } })
const sesion = (...tokens) => `${subagente}\n${tokens.map(respuesta).join('\n')}\n{"type":"user"}\n`
fs.writeFileSync(transcript, sesion(85000))
assert.equal(hook('s1'), '', 'una sola respuesta: sin crecimiento, no avisa')
fs.writeFileSync(transcript, sesion(85000, 120000))
assert.equal(hook('s1'), '', 'base 85k + 35k de trabajo: no avisa aunque pase de 100k')
fs.writeFileSync(transcript, sesion(85000, 120000, 190000))
const aviso = JSON.parse(hook('s1'))
assert.match(aviso.systemMessage, /~190k tokens/)
assert.match(aviso.systemMessage, /~105k de trabajo/)
assert.match(aviso.hookSpecificOutput.additionalContext, /ESTADO\.md/)
assert.equal(hook('s1'), '', 'mismo nivel: no repite')
fs.writeFileSync(transcript, sesion(85000, 240000))
assert.match(JSON.parse(hook('s1')).systemMessage, /~240k/, 'nivel nuevo: avisa otra vez')
assert.match(JSON.parse(hook('s2')).systemMessage, /~240k/, 'otra sesión: avisa')
fs.writeFileSync(transcript, sesion(85000, 240000, 60000))
assert.equal(hook('s3'), '', 'tras compactar por debajo de la base: no avisa')

// 2 · Nota de última sesión
const { slugProyecto, leerNota, dirUltimaSesion } = await import(new URL('../config/hooks/ultima-sesion.mjs', import.meta.url).href)
assert.equal(slugProyecto('C:\\Users\\Ana\\Proyecto Uno\\'), slugProyecto('c:/users/ana/proyecto uno'))
assert.equal(await leerNota('C:/no/existe', 0), '')
fs.mkdirSync(dirUltimaSesion(), { recursive: true })
const slug = slugProyecto('C:/repo')
fs.writeFileSync(path.join(dirUltimaSesion(), `${slug}.md`), 'Última sesión\n- Tarea: x\n')
fs.writeFileSync(path.join(dirUltimaSesion(), `${slug}.pendiente`), '')
const t0 = Date.now()
assert.match(await leerNota('C:/repo', 1200), /Tarea: x/)
assert.ok(Date.now() - t0 >= 1000, 'espera mientras hay un resumen en curso')

// 3 · Agentes: modelos del reparto y la delegación cortada en los subagentes
const fm = (n) => fs.readFileSync(path.join(raiz, 'config/claude/agents', `${n}.md`), 'utf8').split(/\r?\n---/)[0]
assert.match(fm('cerebro'), /^model: opus$/m)
assert.match(fm('arquitecto'), /^model: opus$/m)
assert.match(fm('resolutor'), /^model: sonnet$/m)
assert.match(fm('resolutor'), /^effort: medium$/m)
assert.match(fm('retocador'), /^model: sonnet$/m)
assert.match(fm('retocador'), /^effort: low$/m)
assert.match(fm('consultor'), /^model: opus$/m)
assert.match(fm('consultor'), /^effort: low$/m)
const oc = (n) => fs.readFileSync(path.join(raiz, 'config/opencode/agents', `${n}.md`), 'utf8')
assert.match(oc('implementador'), /^variant: low$/m)
assert.match(oc('debugger'), /^variant: high$/m)
assert.match(oc('revisor'), /^variant: max$/m)
// Ningún `variant` de OpenCode se sale de la escalera de DeepSeek (low/high/max).
for (const n of ['cerebro-oc', 'implementador', 'debugger', 'revisor', 'testeador', 'explorador-ds', 'redactor-ds', 'planificador']) {
  const m = oc(n).match(/^variant:\s*(\S+)$/m)
  assert.ok(m, `${n}: sin variant`)
  assert.ok(['low', 'high', 'max'].includes(m[1]), `${n}: variant inválido (${m[1]})`)
}
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante']) assert.match(fm(n), /^model: haiku$/m, n)
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante', 'resolutor', 'arquitecto', 'retocador', 'consultor']) assert.match(fm(n), /^disallowedTools: Agent$/m, n)

// 4 · Barra claude-hud: config sin pisar la del usuario, statusLine reconocida y widget con datos del entorno
const barra = await import(new URL('../config/hub/barra-hud.mjs', import.meta.url).href)
const cfgHud = path.join(tmp, 'hud', 'config.json')
assert.equal(barra.escribirConfigHud(cfgHud), 'creada')
const hudCfg = JSON.parse(fs.readFileSync(cfgHud, 'utf8'))
assert.ok(hudCfg.display.showAgents && hudCfg.display.showTools && hudCfg.display.showTodos)
assert.equal(barra.escribirConfigHud(cfgHud), 'propia', 'no pisa lo configurado')
assert.ok(!barra.hudInstalado(path.join(tmp, 'sin-cache')))
const cacheFalsa = path.join(tmp, 'cache', 'claude-hud', 'claude-hud', '1.2.3', 'dist')
fs.mkdirSync(cacheFalsa, { recursive: true }); fs.writeFileSync(path.join(cacheFalsa, 'index.js'), '')
assert.ok(barra.hudInstalado(path.join(tmp, 'cache')))
assert.match(barra.comandoHud('/opt/s/hub', 'linux'), /node ".*hud.mjs"$/)
for (const c of ['ccstatusline', 'node "C:/x/hub/estado-linea.mjs"', 'exec "C:/x/hub/hud.cmd"', 'node "C:\\x\\hub\\hud.mjs"']) assert.ok(barra.statusLineEsNuestra({ command: c }), c)
assert.ok(!barra.statusLineEsNuestra({ command: 'mi-barra.sh' }))
const estadoLinea = path.join(raiz, 'config/hub/estado-linea.mjs')
const lanzarWidget = (extra) => spawnSync(process.execPath, [estadoLinea, '--widget'], { input: '', encoding: 'utf8', env: { ...process.env, HUB_URL: 'http://127.0.0.1:1', CEREBRO_BARRA_DATOS: JSON.stringify({ session_id: 'w', agent: { name: 'cerebro' }, workspace: { current_dir: tmp } }), ...extra } }).stdout.trim()
const widget = lanzarWidget({ CEREBRO_SERVIDOR_IP: '' })
assert.match(widget, /^🧠 cerebro · (🔥 DS punta|🌙 DS valle ½)/, 'el widget lee el JSON del entorno (claude-hud no le pasa stdin)')

// Servidor de la red local: activo solo si hay respuesta real al ping, con caché corta.
const lan = await import(pathToFileURL(path.join(raiz, 'config/hub/lib/servidor-lan.mjs')).href)
const cacheLan = path.join(tmp, 'lan.json')
let pingsLan = 0
const pingCon = (salida) => () => { pingsLan += 1; return salida }
const respuestaPing = 'Respuesta desde 192.168.0.100: bytes=32 tiempo=3ms TTL=64'
const estadoLan = (ping, ahora, ip = '192.168.0.100') => lan.estadoServidor({ ip, ahora, ping, cache: cacheLan })
assert.equal(estadoLan(pingCon(respuestaPing), 1000), true, 'responde al ping: activo')
assert.equal(estadoLan(pingCon(''), 2000), true, 'dentro de la caché no se repite el ping')
assert.equal(pingsLan, 1)
assert.equal(estadoLan(pingCon('Respuesta desde 192.168.0.220: Host de destino inaccesible.'), 1000 + lan.CACHE_MS), false, 'Windows sale con 0 en «host inaccesible»: no cuenta como activo')
assert.equal(pingsLan, 2, 'caducada la caché se vuelve a hacer ping')
assert.equal(estadoLan(pingCon(respuestaPing), 1000 + lan.CACHE_MS, '192.168.0.101'), true, 'otra IP no reutiliza la caché')
assert.equal(lan.estadoServidor({ ip: '', ping: pingCon(respuestaPing), cache: cacheLan }), null, 'IP vacía: sin comprobación')
assert.equal(lan.etiquetaServidor({ ip: '192.168.0.100', ping: pingCon(respuestaPing), cache: path.join(tmp, 'lan2.json') }), '🟢 .100')
assert.equal(lan.etiquetaServidor({ ip: '192.168.0.100', ping: pingCon(''), cache: path.join(tmp, 'lan3.json') }), '🔴 .100')
assert.equal(lan.etiquetaServidor({ ip: '', cache: cacheLan }), '')

// En el widget va justo tras el modo y cabe entero en los 50 caracteres de claude-hud.
const tmpLan = path.join(tmp, 'tmp-lan')
fs.mkdirSync(tmpLan)
fs.writeFileSync(path.join(tmpLan, lan.NOMBRE_CACHE), JSON.stringify({ ip: '192.168.0.100', ts: Date.now(), activo: false }))
const conServidor = lanzarWidget({ CEREBRO_SERVIDOR_IP: '192.168.0.100', TEMP: tmpLan, TMP: tmpLan, TMPDIR: tmpLan })
assert.match(conServidor, /^🧠 cerebro · 🔴 \.100 · (🔥 DS punta|🌙 DS valle ½)/, 'el estado del servidor sale en el widget')
assert.ok(conServidor.length <= 50, `el widget no debe cortarse: ${conServidor}`)
assert.match(conServidor, /\((valle|punta) en \d/, 'se conserva la cuenta atrás de DeepSeek')

// Tramo de DeepSeek: punta L–V 01–04 y 06–10 UTC; el resto, valle.
const { tramoDeepseek } = await import(pathToFileURL(path.join(raiz, 'config/hub/lib/tarifa-deepseek.mjs')).href)
assert.deepEqual(tramoDeepseek(new Date('2026-10-16T02:00:00Z')), { punta: true, cambiaEnMin: 120 })
assert.deepEqual(tramoDeepseek(new Date('2026-10-16T04:10:00Z')), { punta: false, cambiaEnMin: 110 })
assert.equal(tramoDeepseek(new Date('2026-10-17T07:00:00Z')).punta, false, 'sábado: valle')
assert.deepEqual(tramoDeepseek(new Date('2026-10-19T00:59:00Z')), { punta: false, cambiaEnMin: 1 })

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK  spec 15: aviso de contexto en consola, nota de última sesión, agentes y barra claude-hud')
