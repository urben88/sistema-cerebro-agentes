#!/usr/bin/env node
/**
 * Prueba de la barra de estado: el modo «cerebro» solo aparece si el hook DECLARÓ el agente
 * (`agenteDeclarado`) o Claude lo indica en `agent.name`. El hub rellena `agente:'cerebro'` por
 * defecto en los latidos del hilo principal; eso NO debe convertir una sesión normal en cerebro.
 * Sin dependencias: levanta un hub falso en un puerto libre.
 */
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let latidos = []
const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(req.url.startsWith('/api/latidos') ? JSON.stringify({ ok: true, latidos, usoModelos: {} }) : '{}')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const HUB_URL = `http://127.0.0.1:${srv.address().port}`
// Asíncrono: spawnSync bloquearía el bucle de eventos y el hub falso no podría responder.
const barra = (extra = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(raiz, 'config/hub/estado-linea.mjs')], { env: { ...process.env, HUB_URL } })
  let out = ''
  p.stdout.on('data', (c) => { out += c })
  p.on('close', () => resolve(out))
  p.stdin.end(JSON.stringify({ session_id: 's1', model: { display_name: 'Sonnet' }, workspace: { current_dir: raiz }, ...extra }))
})

let fallos = 0
const prueba = async (n, fn) => { try { await fn(); console.log(`PASA  ${n}`) } catch (e) { fallos++; console.log(`FALLA ${n}\n      ${String(e.message).split('\n')[0]}`) } }

latidos = [{ cwd: raiz, sesion: 's1', evento: 'UserPromptSubmit', agente: 'cerebro', ts: Date.now() }]
await prueba('sesión normal con latido por defecto «cerebro» sigue en modo normal', async () => assert.match(await barra(), /💬 normal/))
latidos = [{ cwd: raiz, sesion: 's1', evento: 'UserPromptSubmit', agente: 'cerebro', agenteDeclarado: 'cerebro', ts: Date.now() }]
await prueba('latido con agente declarado «cerebro» → modo cerebro', async () => assert.match(await barra(), /🧠 CEREBRO/))
latidos = []
await prueba('agent.name = cerebro de Claude → modo cerebro', async () => assert.match(await barra({ agent: { name: 'cerebro' } }), /🧠 CEREBRO/))
latidos = [{ cwd: raiz, sesion: 's1', evento: 'SubagentStart', agente: 'explorador', agenteDeclarado: 'explorador', ts: Date.now() }]
await prueba('un subagente en la sesión no la vuelve cerebro', async () => assert.match(await barra(), /💬 normal/))

srv.close()
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
