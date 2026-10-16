#!/usr/bin/env node
/**
 * Prueba de la spec 15 (Opus dirige y lo mejor de configurar-claude):
 *   · reparto del modo normal: implementar → resolutor (Sonnet), mecánico → ayudante (Haiku),
 *     delicado → arquitecto (Opus), global → hazlo tú (Opus);
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

// 1 · Reparto del modo normal
const { aClaude } = await import(new URL('../config/hub/lib/reparto-claude.mjs', import.meta.url).href)
assert.deepEqual([aClaude({ agente: 'implementador' }).subagente, aClaude({ agente: 'implementador' }).modelo], ['resolutor', 'sonnet'])
assert.equal(aClaude({ agente: 'implementador' }).esfuerzo, 'medium', 'resolutor: medium por defecto')
assert.equal(aClaude({ agente: 'implementador', escalar: true }).esfuerzo, 'high', 'resolutor: high si es delicado')
assert.deepEqual([aClaude({ agente: 'debugger' }).subagente, aClaude({ agente: 'debugger' }).esfuerzo], ['resolutor', 'high'])
assert.deepEqual([aClaude({ agente: 'retocador' }).modelo, aClaude({ agente: 'retocador' }).esfuerzo], ['sonnet', 'low'])
assert.deepEqual([aClaude({ agente: 'consultor' }).modelo, aClaude({ agente: 'consultor' }).esfuerzo], ['opus', 'low'])
// Reglas por palabras clave de los roles nuevos
const { crearTriaje, CATALOGO_AGENTES, AGENTES_CLAUDE } = await import(new URL('../config/hub/lib/triaje.mjs', import.meta.url).href)
const reglas = JSON.parse(fs.readFileSync(path.join(raiz, 'config/hub/reglas.json'), 'utf8'))
const tri = crearTriaje({ reglas })
assert.equal(tri.clasificarPorReglas('un cambio pequeño en el botón').agente, 'retocador')
assert.equal(tri.clasificarPorReglas('dale un retoque al logo').agente, 'retocador')
assert.equal(tri.clasificarPorReglas('necesito una segunda opinión').agente, 'consultor')
assert.equal(tri.clasificarPorReglas('qué opción elegimos').agente, 'consultor')
assert.equal(tri.clasificarPorReglas('implementa un endpoint').agente, 'implementador')
// «ajusta»/«retoca» sueltos no son del retocador (Sonnet · low): son palabras muy comunes
assert.notEqual(tri.clasificarPorReglas('ajusta los esfuerzos de los agentes').agente, 'retocador')
assert.notEqual(tri.clasificarPorReglas('retoca el README').agente, 'retocador')
assert.equal(tri.clasificarPorReglas('retoca este fallo').agente, 'debugger')
// lo de alto valor no va al consultor
assert.equal(tri.clasificarPorReglas('valida la decisión técnica del contrato').agente, 'arquitecto')
// el catálogo de Laya incluye los roles nuevos, en la capa Claude
assert.ok(CATALOGO_AGENTES.includes('retocador') && CATALOGO_AGENTES.includes('consultor'))
assert.ok(AGENTES_CLAUDE.has('retocador') && AGENTES_CLAUDE.has('consultor'))
assert.equal(reglas.reglas.find((r) => r.agente === 'implementador').esfuerzo, 'medium')
assert.equal(reglas.reglas.find((r) => r.agente === 'debugger').esfuerzo, 'high')
assert.equal(reglas.reglas.find((r) => r.agente === 'revisor').esfuerzo, 'max')
assert.deepEqual([aClaude({ agente: 'local' }).subagente, aClaude({ agente: 'local' }).modelo], ['ayudante', 'haiku'])
assert.equal(aClaude({ agente: 'explorador-ds' }).subagente, 'explorador')
assert.equal(aClaude({ agente: 'revisor' }).subagente, 'analista')
assert.deepEqual([aClaude({ agente: 'revisor', riesgo: true }).subagente, aClaude({ agente: 'revisor', riesgo: true }).modelo], ['arquitecto', 'opus'])
assert.equal(aClaude({ agente: 'cerebro' }).modelo, 'opus')
assert.match(aClaude({ agente: 'cerebro' }).subagente, /hazlo tú/)

// 2 · Aviso de contexto en consola
const transcript = path.join(tmp, 't.jsonl')
const respuesta = (input) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
const hook = (sesion) => spawnSync(process.execPath, [path.join(raiz, 'config/hooks/aviso-contexto.mjs')], {
  input: JSON.stringify({ transcript_path: transcript, session_id: sesion }),
  encoding: 'utf8',
  env: { ...process.env, HUB_DATA_DIR: tmp, CONTEXTO_AVISO: '100000', CONTEXTO_PASO: '50000' },
}).stdout.trim()

fs.writeFileSync(transcript, `${respuesta(90000)}\n`)
assert.equal(hook('s1'), '', 'por debajo del umbral no avisa')
fs.writeFileSync(transcript, `${respuesta(120000)}\n{"type":"user"}\n`)
const aviso = JSON.parse(hook('s1'))
assert.match(aviso.systemMessage, /~120k tokens/)
assert.match(aviso.hookSpecificOutput.additionalContext, /ESTADO\.md/)
assert.equal(hook('s1'), '', 'mismo nivel: no repite')
fs.writeFileSync(transcript, `${respuesta(160000)}\n`)
assert.match(JSON.parse(hook('s1')).systemMessage, /~160k/, 'nivel nuevo: avisa otra vez')
assert.match(JSON.parse(hook('s2')).systemMessage, /~160k/, 'otra sesión: avisa')

// 3 · Nota de última sesión
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

// 4 · Agentes: modelos del reparto y la delegación cortada en los subagentes
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
assert.match(oc('implementador'), /^variant: medium$/m)
assert.match(oc('debugger'), /^variant: high$/m)
assert.match(oc('revisor'), /^variant: max$/m)
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante']) assert.match(fm(n), /^model: haiku$/m, n)
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante', 'resolutor', 'arquitecto', 'retocador', 'consultor']) assert.match(fm(n), /^disallowedTools: Agent$/m, n)

// 5 · Barra claude-hud: config sin pisar la del usuario, statusLine reconocida y widget con datos del entorno
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
const widget = spawnSync(process.execPath, [estadoLinea, '--widget'], { input: '', encoding: 'utf8', env: { ...process.env, HUB_URL: 'http://127.0.0.1:1', CEREBRO_BARRA_DATOS: JSON.stringify({ session_id: 'w', agent: { name: 'cerebro' }, workspace: { current_dir: tmp } }) } }).stdout.trim()
assert.match(widget, /^🧠 cerebro · (🔥 DS punta|🌙 DS valle ½)/, 'el widget lee el JSON del entorno (claude-hud no le pasa stdin)')

// Tramo de DeepSeek: punta L–V 01–04 y 06–10 UTC; el resto, valle.
const { tramoDeepseek } = await import(pathToFileURL(path.join(raiz, 'config/hub/lib/tarifa-deepseek.mjs')).href)
assert.deepEqual(tramoDeepseek(new Date('2026-10-16T02:00:00Z')), { punta: true, cambiaEnMin: 120 })
assert.deepEqual(tramoDeepseek(new Date('2026-10-16T04:10:00Z')), { punta: false, cambiaEnMin: 110 })
assert.equal(tramoDeepseek(new Date('2026-10-17T07:00:00Z')).punta, false, 'sábado: valle')
assert.deepEqual(tramoDeepseek(new Date('2026-10-19T00:59:00Z')), { punta: false, cambiaEnMin: 1 })

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK  spec 15: reparto Opus/Sonnet/Haiku, aviso de contexto en consola, nota de última sesión, agentes y barra claude-hud')
