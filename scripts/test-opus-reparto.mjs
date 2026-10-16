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
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-opus-'))
process.env.HUB_DATA_DIR = tmp

// 1 · Reparto del modo normal
const { aClaude } = await import(new URL('../config/hub/lib/reparto-claude.mjs', import.meta.url).href)
assert.deepEqual([aClaude({ agente: 'implementador' }).subagente, aClaude({ agente: 'implementador' }).modelo], ['resolutor', 'sonnet'])
assert.equal(aClaude({ agente: 'debugger' }).esfuerzo, 'high')
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
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante']) assert.match(fm(n), /^model: haiku$/m, n)
for (const n of ['explorador', 'redactor', 'analista', 'planificador', 'subdirector', 'ayudante', 'resolutor', 'arquitecto']) assert.match(fm(n), /^disallowedTools: Agent$/m, n)

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
assert.equal(widget, '🧠 cerebro', 'el widget lee el JSON del entorno (claude-hud no le pasa stdin)')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK  spec 15: reparto Opus/Sonnet/Haiku, aviso de contexto en consola, nota de última sesión, agentes y barra claude-hud')
