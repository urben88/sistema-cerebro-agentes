#!/usr/bin/env node
/**
 * Pruebas de coste por agente (spec 22 · S1) y de `/odd:stats` (spec 22 · S2).
 *
 * Sin dependencias: solo `node:assert`. Monta un `~/.claude/projects` falso en un
 * directorio temporal (nunca toca el real) con transcripts de sesión y de subagentes.
 *   · S1 · por subagente: tokens (entrada, salida, caché), coste, modelo y duración;
 *     el precio sale de una tabla (`precios.json`), no del código.
 *   · S2 · stats: tokens y coste por modelo, por día y por proyecto, y racha de días.
 *
 * Uso: node scripts/test-coste-agentes.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { crearMetricas } from '../config/hub/lib/metricas.mjs'
import { crearUso, cargarPrecios, costeDe } from '../config/hub/lib/uso.mjs'

let fallos = 0
function prueba(nombre, fn) {
  try { fn(); console.log(`PASA  ${nombre}`) } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coste-'))
console.log('=== Pruebas de coste por agente y stats ===')
console.log(`Temporal: ${raiz}\n`)

const PRECIOS = { modelos: { opus: { entrada: 10, salida: 50, cacheLectura: 1, cacheEscritura: 12 }, sonnet: { entrada: 3, salida: 15, cacheLectura: 0.3, cacheEscritura: 3.75 } } }
const msg = (ts, modelo, u, id, cwd = 'C:\\proj\\demo') => JSON.stringify({
  type: 'assistant', timestamp: ts, cwd,
  message: { id, role: 'assistant', model: modelo, usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } },
})
const escribir = (f, lineas) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lineas.join('\n') + '\n') }

// Fixture: dos proyectos, dos sesiones, dos subagentes.
const dir = path.join(raiz, 'projects')
const A = path.join(dir, 'C--proj-demo')
const B = path.join(dir, 'C--proj-otro')
escribir(path.join(A, 'ses1.jsonl'), [
  msg('2026-10-25T12:00:00.000Z', 'claude-opus-5-5', [100, 200, 1000, 0], 'm1'),
  msg('2026-10-26T12:00:00.000Z', 'claude-opus-5-5', [50, 50, 0, 0], 'm2'),
  msg('2026-10-26T12:00:01.000Z', 'claude-opus-5-5', [50, 50, 0, 0], 'm2'), // duplicado: no cuenta
  JSON.stringify({ type: 'user', timestamp: '2026-10-26T11:59:00.000Z', message: { role: 'user', content: 'hola' } }),
])
escribir(path.join(A, 'ses1', 'subagents', 'agent-aaa.jsonl'), [
  msg('2026-10-26T12:10:00.000Z', 'claude-sonnet-5-5', [10, 100, 2000, 500], 's1'),
  msg('2026-10-26T12:12:30.000Z', 'claude-sonnet-5-5', [20, 300, 3000, 0], 's2'),
])
fs.writeFileSync(path.join(A, 'ses1', 'subagents', 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'resolutor', description: 'Hace cosas', model: 'sonnet', effort: 'medium' }))
escribir(path.join(B, 'ses2.jsonl'), [msg('2026-10-27T12:00:00.000Z', 'claude-sonnet-5-5', [1000, 1000, 0, 0], 'o1', 'C:\\proj\\otro')])
escribir(path.join(B, 'ses2', 'subagents', 'agent-bbb.jsonl'), [msg('2026-10-27T12:05:00.000Z', 'claude-sonnet-5-5', [5, 5, 0, 0], 'b1', 'C:\\proj\\otro')])
fs.writeFileSync(path.join(B, 'ses2', 'subagents', 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'explorador', description: 'Busca', model: 'haiku' }))

const AHORA = Date.parse('2026-10-27T18:00:00.000Z')
const uso = crearUso({ dirProyectos: dir, precios: PRECIOS, ahora: () => AHORA })

// S1
prueba('S1 · cada subagente trae tokens (entrada/salida/caché), coste, modelo y duración', () => {
  const r = uso.agentes({ dias: 30 })
  assert.equal(r.agentes.length, 2)
  const a = r.agentes.find((x) => x.agente === 'resolutor')
  assert.deepEqual(a.tokens, { entrada: 30, salida: 400, cacheLectura: 5000, cacheEscritura: 500 })
  assert.equal(a.modelo, 'claude-sonnet-5-5')
  assert.equal(a.duracionMs, 150000)
  assert.equal(a.sesion, 'ses1')
  assert.equal(a.descripcion, 'Hace cosas')
  // 30*3 + 400*15 + 5000*0.3 + 500*3.75 = 90 + 6000 + 1500 + 1875 = 9465 -> por millón
  assert.ok(Math.abs(a.coste - 9465 / 1e6) < 1e-12)
})

prueba('S1 · el precio sale de la tabla: cambiarla cambia el coste (sin tocar código)', () => {
  const u2 = crearUso({ dirProyectos: dir, precios: { modelos: { sonnet: { entrada: 0, salida: 100, cacheLectura: 0, cacheEscritura: 0 } } }, ahora: () => AHORA })
  const a = u2.agentes({ dias: 30 }).agentes.find((x) => x.agente === 'resolutor')
  assert.ok(Math.abs(a.coste - 40000 / 1e6) < 1e-12)
})

prueba('S1 · cargarPrecios lee precios.json y el override manda; modelo sin precio = coste null', () => {
  const base = path.join(raiz, 'p1.json'); const over = path.join(raiz, 'p2.json')
  fs.writeFileSync(base, JSON.stringify({ modelos: { sonnet: { entrada: 3, salida: 15, cacheLectura: 0, cacheEscritura: 0 } } }))
  fs.writeFileSync(over, JSON.stringify({ modelos: { sonnet: { entrada: 1, salida: 1, cacheLectura: 0, cacheEscritura: 0 } } }))
  const t = cargarPrecios([base, over])
  assert.equal(costeDe({ entrada: 1e6, salida: 0, cacheLectura: 0, cacheEscritura: 0 }, 'claude-sonnet-5-5', t), 1)
  assert.equal(costeDe({ entrada: 1, salida: 0, cacheLectura: 0, cacheEscritura: 0 }, 'modelo-raro', t), null)
  assert.ok(cargarPrecios([path.join(raiz, 'no-existe.json')]).modelos)
})

prueba('S1 · filtra por sesión y respeta el límite; el repo trae config/hub/precios.json válido', () => {
  assert.equal(uso.agentes({ sesion: 'ses2' }).agentes.length, 1)
  assert.equal(uso.agentes({ limite: 1 }).agentes.length, 1)
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  const t = cargarPrecios([path.join(aqui, '..', 'config', 'hub', 'precios.json')])
  for (const k of ['opus', 'sonnet', 'haiku']) assert.ok(t.modelos[k] && t.modelos[k].salida > 0, k)
})

// S2
prueba('S2 · stats agrupa tokens y coste por modelo, por día y por proyecto (sin duplicar mensajes)', () => {
  const s = uso.stats({ dias: 30 })
  const opus = s.porModelo.find((x) => x.modelo === 'claude-opus-5-5')
  assert.deepEqual(opus.tokens, { entrada: 150, salida: 250, cacheLectura: 1000, cacheEscritura: 0 })
  assert.ok(Math.abs(opus.coste - (1500 + 12500 + 1000) / 1e6) < 1e-12)
  const dias = Object.fromEntries(s.porDia.map((d) => [d.dia, d]))
  assert.deepEqual(Object.keys(dias).sort(), ['2026-10-25', '2026-10-26', '2026-10-27'])
  assert.equal(dias['2026-10-27'].tokens.entrada, 1005)
  const pr = Object.fromEntries(s.porProyecto.map((p) => [p.proyecto, p]))
  assert.ok(pr['C:\\proj\\otro'] && pr['C:\\proj\\demo'])
  assert.equal(pr['C:\\proj\\otro'].tokens.salida, 1005)
  assert.ok(Math.abs(s.total.coste - s.porModelo.reduce((a, m) => a + m.coste, 0)) < 1e-12)
})

prueba('S2 · racha de días: consecutivos hasta hoy; un hueco la corta', () => {
  const s = uso.stats({ dias: 30 })
  assert.equal(s.racha.actual, 3)
  assert.equal(s.racha.mejor, 3)
  // «Hoy» sin uso pero ayer sí: la racha sigue viva; con un día de hueco, se corta.
  const u1 = crearUso({ dirProyectos: dir, precios: PRECIOS, ahora: () => Date.parse('2026-10-28T12:00:00.000Z') })
  assert.equal(u1.stats({ dias: 30 }).racha.actual, 3)
  const u2 = crearUso({ dirProyectos: dir, precios: PRECIOS, ahora: () => Date.parse('2026-10-30T12:00:00.000Z') })
  assert.equal(u2.stats({ dias: 30 }).racha.actual, 0)
  assert.equal(u2.stats({ dias: 30 }).racha.mejor, 3)
})

prueba('S2 · sin directorio de transcripts no lanza y devuelve vacío', () => {
  const u = crearUso({ dirProyectos: path.join(raiz, 'nada'), precios: PRECIOS, ahora: () => AHORA })
  assert.deepEqual(u.agentes({}).agentes, [])
  const s = u.stats({})
  assert.equal(s.total.coste, 0)
  assert.equal(s.racha.actual, 0)
})

prueba('S2 · el límite de días recorta el resumen', () => {
  const s = uso.stats({ dias: 1 })
  assert.deepEqual(s.porDia.map((d) => d.dia), ['2026-10-27'])
})

prueba('S2 · reutiliza las métricas del hub: los eventos job de OpenCode suman en stats.opencode', () => {
  const m = crearMetricas({ dirLogs: path.join(raiz, 'logs'), ahora: () => Date.parse('2026-10-27T10:00:00.000Z') })
  m.registrar({ tipo: 'job', jobId: 'j1', agente: 'implementador', modelo: 'deepseek-v3.2', coste: 0.5, estado: 'completado' })
  m.registrar({ tipo: 'job', jobId: 'j2', agente: 'debugger', modelo: 'deepseek-v3.2', coste: 0.25, estado: 'completado' })
  m.registrar({ tipo: 'nudge', estado: 'disparado' })
  const u = crearUso({ dirProyectos: dir, precios: PRECIOS, ahora: () => AHORA, jobs: () => m.leer({ tipo: 'job', limite: 1000 }) })
  const oc = u.stats({ dias: 30 }).opencode
  assert.equal(oc.jobs, 2)
  assert.ok(Math.abs(oc.coste - 0.75) < 1e-12)
  assert.equal(oc.porModelo[0].modelo, 'deepseek-v3.2')
  assert.equal(oc.porDia.length, 1)
})

try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
