#!/usr/bin/env node
/**
 * Smoke test del MCP opencode-mcp para sistema-cerebro-agentes.
 *
 * Comprueba, sin depender de Claude Code:
 *   1. Arranque del MCP por stdio (npx -y opencode-mcp, con auto-serve).
 *   2. Handshake MCP y lista de herramientas (perfil essential).
 *   3. Llamada real: opencode_status.
 *   --ask        además: una pregunta trivial al modelo por defecto (inferencia real).
 *   --e2e <dir>  además: delega una mini-tarea al agente constructor, espera el
 *                resultado y muestra el diff (prueba de punta a punta con OpenCode).
 *
 * Uso:
 *   node scripts/smoke-mcp.mjs
 *   node scripts/smoke-mcp.mjs --ask
 *   node scripts/smoke-mcp.mjs --e2e "C:\ruta\proyecto-de-prueba"
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

const argv = process.argv.slice(2)
const wantAsk = argv.includes('--ask')
const e2eIdx = argv.indexOf('--e2e')
const e2eDir = e2eIdx >= 0 ? argv[e2eIdx + 1] : null
if (e2eIdx >= 0 && (!e2eDir || e2eDir.startsWith('--'))) {
  console.error('Falta el directorio después de --e2e')
  process.exit(2)
}

const isWin = process.platform === 'win32'
const cmd = isWin ? 'cmd' : 'npx'
const cmdArgs = isWin ? ['/c', 'npx', '-y', 'opencode-mcp'] : ['-y', 'opencode-mcp']

console.log('Arrancando MCP: npx -y opencode-mcp …')
const child = spawn(cmd, cmdArgs, {
  env: {
    ...process.env,
    OPENCODE_AUTO_SERVE: 'true',
    OPENCODE_TOOL_PROFILE: 'essential',
    OPENCODE_DEFAULT_PROVIDER: 'openrouter',
    OPENCODE_DEFAULT_MODEL: 'deepseek/deepseek-v4.1-flash',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderrBuf = ''
child.stderr.on('data', (d) => { stderrBuf += d.toString() })

const pending = new Map()
let nextId = 1
let stdoutBuf = ''

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk
  let idx
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx).trim()
    stdoutBuf = stdoutBuf.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`Error MCP ${msg.error.code}: ${msg.error.message}`))
      else p.resolve(msg.result)
    }
  }
})

child.on('error', (err) => {
  console.error(`No se pudo arrancar el MCP: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code) => {
  if (pending.size > 0) {
    console.error(`El MCP terminó inesperadamente (código ${code}).`)
    if (stderrBuf.trim()) console.error(stderrBuf.trim().split('\n').slice(-10).join('\n'))
    process.exit(1)
  }
})

function request(method, params = {}, timeoutMs = 120000) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timeout esperando ${method} (${Math.round(timeoutMs / 1000)}s)`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

function toolText(result) {
  if (result?.structuredContent?.text) return String(result.structuredContent.text)
  const texts = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)
  return texts.join('\n')
}

let failures = 0
function fail(msg) { failures++; console.error(`  FALLO: ${msg}`) }
function ok(msg) { console.log(`  OK: ${msg}`) }

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-mcp', version: '0.1.0' },
  }, 240000)
  notify('notifications/initialized')
  console.log(`1) MCP inicializado: ${init?.serverInfo?.name ?? '?'} v${init?.serverInfo?.version ?? '?'}`)

  const tools = await request('tools/list', {}, 120000)
  const names = new Set((tools?.tools ?? []).map((t) => t.name))
  console.log(`2) Herramientas disponibles: ${names.size}`)
  for (const required of ['opencode_status', 'opencode_fire', 'opencode_check', 'opencode_wait', 'opencode_review_changes', 'opencode_job_input']) {
    if (names.has(required)) ok(required)
    else fail(`falta la herramienta ${required}`)
  }

  const status = await request('tools/call', { name: 'opencode_status', arguments: {} }, 180000)
  const statusText = toolText(status)
  console.log('3) opencode_status:')
  console.log(statusText.split('\n').slice(0, 15).map((l) => `   ${l}`).join('\n'))
  if (status?.isError || status?.structuredContent?.isError) fail('opencode_status devolvió error')

  if (wantAsk) {
    console.log('4) opencode_ask (inferencia real, puede tardar)…')
    const ask = await request('tools/call', {
      name: 'opencode_ask',
      arguments: { prompt: 'Responde solo con: OK' },
    }, 360000)
    const askText = toolText(ask)
    console.log(`   respuesta: ${askText.trim().slice(0, 200)}`)
    if (/OK/i.test(askText)) ok('el modelo respondió')
    else fail('la respuesta no contiene OK')
  }

  if (e2eDir) {
    console.log(`5) E2E: delegando mini-tarea al constructor en ${e2eDir} …`)
    const fire = await request('tools/call', {
      name: 'opencode_fire',
      arguments: {
        directory: e2eDir,
        agent: 'constructor',
        title: 'smoke e2e',
        prompt: 'Crea el archivo saludo.mjs que exporte la función saludar(nombre) que devuelva "Hola, " + nombre, y el archivo prueba.mjs que usando node:test verifique que saludar("mundo") devuelve "Hola, mundo". Ejecuta "node --test prueba.mjs" y reporta el resultado.',
      },
    }, 180000)
    const sc = fire?.structuredContent ?? {}
    console.log(`   lanzado: status=${sc.status} jobId=${sc.jobId ?? '?'}`)
    let final = sc
    const startedAt = Date.now()
    while ((final.status === 'accepted' || final.status === 'running') && Date.now() - startedAt < 15 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 5000))
      const wait = await request('tools/call', { name: 'opencode_wait', arguments: { jobId: sc.jobId, timeoutSeconds: 60 } }, 120000)
      final = wait?.structuredContent ?? {}
      process.stdout.write(`\r   estado: ${final.status} (${Math.round((Date.now() - startedAt) / 1000)}s)    `)
    }
    console.log('')
    if (final.status === 'completed') {
      ok('la tarea del constructor terminó')
      const review = await request('tools/call', { name: 'opencode_review_changes', arguments: { sessionId: sc.sessionId } }, 120000)
      const reviewText = toolText(review)
      console.log('   diff (resumen):')
      console.log(reviewText.split('\n').slice(0, 40).map((l) => `   ${l}`).join('\n'))
    } else {
      fail(`la tarea terminó en estado ${final.status ?? 'desconocido'}`)
    }
  }

  console.log(failures === 0 ? '\nSMOKE TEST: TODO OK' : `\nSMOKE TEST: ${failures} fallo(s)`)
  process.exitCode = failures === 0 ? 0 : 1
} catch (err) {
  console.error(`\nSMOKE TEST: ERROR — ${err.message}`)
  if (stderrBuf.trim()) console.error(stderrBuf.trim().split('\n').slice(-10).join('\n'))
  process.exitCode = 1
} finally {
  try { child.stdin.end() } catch { /* ignorar */ }
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000)
}
