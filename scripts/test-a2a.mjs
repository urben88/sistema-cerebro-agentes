#!/usr/bin/env node
/**
 * Pruebas del mediador A2A-lite del hub (spec 14 · `docs/specs/14-comunicacion-entre-agentes-y-reparto.md`).
 *
 * Sin dependencias (solo `node:assert`) y SIN jobs ni servidores reales: el `lanzador` va
 * simulado y todos los datos viven en `os.tmpdir()`. Comprueba:
 *   · C1 · Agent Card ligera (frontmatter + reglas + salud).
 *   · C2 · consulta mediada: validaciones, profundidad 1, concurrencia, recorte a ≤1200,
 *          coste/ms, job en el ledger y evento `a2a` en métricas (sin texto), tope de coste.
 *   · C3 · buzón: TTL, límite de pendientes, respuestas que no generan preguntas, persistencia.
 *   · C4 · triaje en el camino (una decisión por encargo y ventana).
 *   · C5 · reparto medido (por agente, por capa, % con triaje previo y consultas A2A).
 *
 * Uso: node scripts/test-a2a.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearA2A, recortar, leerFrontmatter, RESPUESTA_MAX, CUERPO_MAX, MAX_PENDIENTES, TTL_MENSAJE } from '../config/hub/lib/a2a.mjs'
import { crearMetricas } from '../config/hub/lib/metricas.mjs'
import { crearLedger } from '../config/hub/lib/ledger.mjs'

let fallos = 0
async function prueba(nombre, fn) {
  try {
    await fn()
    console.log(`PASA  ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-a2a-'))
const DIR = path.join(raiz, 'proyecto')
fs.mkdirSync(DIR, { recursive: true })
const leerLineas = (dir, f = 'metricas.jsonl') => {
  try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()) } catch { return [] }
}

/** Lanzador simulado: no toca el servidor ni crea jobs reales. */
function lanzadorSim({ respuesta = 'ok', coste = 0.01, costeReal = null, gate = null } = {}) {
  const calls = { lanzar: [], esperar: 0, coste: 0, abortar: 0 }
  return {
    calls,
    async lanzarJob(job) { calls.lanzar.push(job); return { ok: true, sessionId: 'ses_' + calls.lanzar.length, messageId: 'msg_1' } },
    async esperarJob() { calls.esperar++; if (gate) await gate; return { ok: true, estado: 'completado', texto: respuesta, coste } },
    async costeSesion() { calls.coste++; return { ok: true, coste: costeReal ?? coste, completado: false, texto: '' } },
    async abortarSesion() { calls.abortar++; return { ok: true } },
  }
}

const baseDirs = () => {
  const oc = path.join(raiz, 'agentes-oc')
  const cl = path.join(raiz, 'agentes-claude')
  fs.mkdirSync(oc, { recursive: true }); fs.mkdirSync(cl, { recursive: true })
  return { oc, cl }
}
const REGLAS = {
  presupuestos: { 'explorador-ds': 0.2, revisor: 0.5, testeador: 0.3, 'redactor-ds': 0.2 },
  reglas: [{ agente: 'explorador-ds', esfuerzo: 'low', capa: 'opencode' }],
}

console.log('=== Pruebas del mediador A2A-lite ===')
console.log(`Temporal: ${raiz}\n`)

// 1 · C1 · Agent Card ligera.
await prueba('C1: directorio() lista los agentes con capa, modelo, esfuerzo, skills, coste y salud', () => {
  const { oc, cl } = baseDirs()
  fs.writeFileSync(path.join(oc, 'explorador-ds.md'), '---\ndescription: Explora el repo\nmode: all\nmodel: deepseek/deepseek-flash\nvariant: low\n---\n\ncuerpo\n')
  fs.writeFileSync(path.join(oc, 'implementador.md'), '---\ndescription: Implementa\nmodel: deepseek/deepseek-flash\nvariant: high\n---\n\ncuerpo\n')
  fs.writeFileSync(path.join(cl, 'cerebro.md'), '---\ndescription: Cerebro\nmodel: sonnet\neffort: medium\nskills:\n  - delegar-a-opencode\n---\n\ncuerpo\n')
  const a2a = crearA2A({
    dirDatos: path.join(raiz, 't1'), agentesDir: oc, claudeAgentesDir: cl, version: '0.8.0', reglas: REGLAS,
    salud: { estado: (a) => ({ agente: a, degradado: false, muestras: 0 }) },
  })
  const { status, body } = a2a.directorio()
  assert.equal(status, 200)
  const porNombre = new Map(body.agentes.map((a) => [a.name, a]))
  const exp = porNombre.get('explorador-ds')
  assert.equal(exp.capa, 'opencode')
  assert.equal(exp.modelo, 'deepseek/deepseek-flash')
  assert.equal(exp.esfuerzo, 'low')
  assert.equal(exp.solo_lectura, true)
  assert.equal(exp.coste_estimado, 0.2)
  assert.equal(exp.version, '0.8.0')
  assert.ok(exp.salud && exp.salud.degradado === false)
  assert.equal(porNombre.get('implementador').solo_lectura, false)
  const cer = porNombre.get('cerebro')
  assert.equal(cer.capa, 'claude')
  assert.deepEqual(cer.skills.map((s) => s.id), ['delegar-a-opencode'])
  assert.equal(cer.modelo, 'sonnet')
  assert.equal(cer.esfuerzo, 'medium')
})

// 2 · C2 · consulta válida: recorte, coste/ms, ledger y métrica sin texto.
await prueba('C2: consulta válida deja job en el ledger y evento a2a (≤1200, sin texto)', async () => {
  const { oc, cl } = baseDirs()
  const dir = path.join(raiz, 't2')
  const logs = path.join(dir, 'logs')
  const metricas = crearMetricas({ dirLogs: logs })
  const ledger = crearLedger({ dirDatos: dir, ahora: () => Date.now() })
  const lanzador = lanzadorSim({ respuesta: 'x'.repeat(3000), coste: 0.03 })
  const a2a = crearA2A({ dirDatos: dir, agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador, ledger, metricas, ahora: () => Date.now() })
  const r = await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: '¿dónde está el hub?', directory: DIR })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.ok(r.body.jobId, 'debía devolver jobId')
  assert.ok(r.body.respuesta.length <= RESPUESTA_MAX, 'la respuesta debía recortarse a <=1200')
  assert.ok(r.body.respuesta.endsWith('…'), 'el recorte debía marcar con «…»')
  assert.equal(typeof r.body.coste, 'number')
  assert.equal(typeof r.body.ms, 'number')
  // Prompt con la instrucción fija antepuesta.
  assert.ok(lanzador.calls.lanzar[0].prompt.includes('≤ 10 líneas'), 'faltó la instrucción fija')
  // Job en el ledger con agente.
  const job = ledger.leer().find((e) => e.jobId === r.body.jobId)
  assert.ok(job, 'el job debía quedar en el ledger')
  assert.equal(job.agente, 'explorador-ds')
  assert.equal(job.estado, 'completado')
  // Evento a2a sin texto: no aparece la respuesta ni la pregunta.
  const ev = metricas.leer({ tipo: 'a2a' })
  assert.equal(ev.length, 1)
  assert.equal(ev[0].subtipo, 'consulta')
  assert.equal(ev[0].de, 'cerebro')
  assert.equal(ev[0].para, 'explorador-ds')
  assert.equal(typeof ev[0].chars, 'number')
  const crudo = fs.readFileSync(path.join(logs, 'metricas.jsonl'), 'utf8')
  assert.ok(!crudo.includes('xxx'), 'el log no debía contener la respuesta')
  assert.ok(!crudo.includes('dónde está'), 'el log no debía contener la pregunta')
})

// 3 · C2 · validaciones (agente no de lectura, pregunta larga, directory).
await prueba('C2: rechaza agente no de lectura, pregunta > 2000 y directory inválido', async () => {
  const { oc, cl } = baseDirs()
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't3'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: lanzadorSim() })
  assert.equal((await a2a.consultar({ de: 'cerebro', para: 'implementador', pregunta: 'x', directory: DIR })).status, 400)
  assert.equal((await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x'.repeat(2001), directory: DIR })).status, 400)
  assert.equal((await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: 'relativa' })).status, 400)
  assert.equal((await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: path.join(raiz, 'no-existe-zzz') })).status, 400)
  assert.equal((await a2a.consultar({ de: '', para: 'explorador-ds', pregunta: 'x', directory: DIR })).status, 400)
})

// 4 · C2 · profundidad 1: un agente que ya consulta no puede originar otra consulta.
await prueba('C2: profundidad 1 — «de» que ya está consultando es rechazado (409)', async () => {
  const { oc, cl } = baseDirs()
  let liberar
  const gate = new Promise((r) => { liberar = r })
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't4'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: lanzadorSim({ gate }) })
  const p1 = a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'primera', directory: DIR })
  await new Promise((r) => setTimeout(r, 20))
  const r2 = await a2a.consultar({ de: 'cerebro', para: 'revisor', pregunta: 'segunda', directory: DIR })
  assert.equal(r2.status, 409)
  liberar()
  const r1 = await p1
  assert.equal(r1.status, 200, 'la primera consulta debía terminar bien')
  // Ya libre: una nueva consulta del mismo `de` vuelve a aceptarse.
  const r3 = await a2a.consultar({ de: 'cerebro', para: 'revisor', pregunta: 'tercera', directory: DIR })
  assert.equal(r3.status, 200)
})

// 5 · C2 · límite de concurrencia (más de 3 consultas en curso → 409).
await prueba('C2: más de 3 consultas en curso → 409', async () => {
  const { oc, cl } = baseDirs()
  let liberar
  const gate = new Promise((r) => { liberar = r })
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't5'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: lanzadorSim({ gate }) })
  const ps = ['a', 'b', 'c'].map((de) => a2a.consultar({ de, para: 'explorador-ds', pregunta: 'q', directory: DIR }))
  await new Promise((r) => setTimeout(r, 20))
  const r4 = await a2a.consultar({ de: 'd', para: 'explorador-ds', pregunta: 'q', directory: DIR })
  assert.equal(r4.status, 409)
  liberar()
  const rs = await Promise.all(ps)
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200])
})

// 6 · C2 · tope de coste: se aborta la sesión al pasarlo.
await prueba('C2: si el coste supera el presupuesto, aborta la sesión', async () => {
  const { oc, cl } = baseDirs()
  const lanzador = lanzadorSim({ respuesta: 'algo', coste: 5, costeReal: 5 })
  // `gate` real corto para que el vigilante tenga tiempo de disparar.
  lanzador.esperarJob = async () => { await new Promise((r) => setTimeout(r, 90)); return { ok: true, estado: 'completado', texto: 'algo', coste: 5 } }
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't6'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador, intervaloVigilanciaMs: 5 })
  const r = await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: DIR })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error, 'coste_excedido')
  assert.ok(lanzador.calls.abortar >= 1, 'debía abortar la sesión')
})

// 6b · C2 · tope: comprobación FINAL (job corto, más rápido que el vigilante) y abortar tras timeout.
await prueba('C2: un job corto que pasa el tope se detecta al terminar; tras un timeout se aborta la sesión', async () => {
  const { oc, cl } = baseDirs()
  const lanzador = lanzadorSim({ respuesta: 'algo', coste: 5, costeReal: 5 })
  lanzador.esperarJob = async () => ({ ok: true, estado: 'completado', texto: 'algo', coste: 0.001 })
  // Vigilante muy lento: nunca llega a mirar. La comprobación final debe cazarlo igualmente.
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't6b'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador, intervaloVigilanciaMs: 60000 })
  const r = await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: DIR })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error, 'coste_excedido')
  assert.ok(lanzador.calls.abortar >= 1)

  const l2 = lanzadorSim({ respuesta: 'algo', coste: 0, costeReal: 0 })
  l2.esperarJob = async () => ({ ok: false, codigo: 'timeout', error: 'timeout', coste: 0 })
  const b = crearA2A({ dirDatos: path.join(raiz, 't6c'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: l2, intervaloVigilanciaMs: 60000 })
  const r2 = await b.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: DIR })
  assert.equal(r2.status, 504)
  assert.ok(l2.calls.abortar >= 1, 'tras el timeout debía abortar la sesión')
})

// 6c · C2 · directory: un fichero no es un directorio.
await prueba('C2: un fichero como directory se rechaza con 400', async () => {
  const { oc, cl } = baseDirs()
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't6d'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: lanzadorSim({ respuesta: 'x' }) })
  const fichero = path.join(raiz, 'no-dir.txt')
  fs.writeFileSync(fichero, 'x')
  const r = await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'x', directory: fichero })
  assert.equal(r.status, 400)
})

// 7 · C3 · buzón: crear, listar, responder; responder no crea preguntas.
await prueba('C3: buzón crear/listar/responder y una respuesta no genera nuevos mensajes', () => {
  const { oc, cl } = baseDirs()
  const dir = path.join(raiz, 't7')
  const a2a = crearA2A({ dirDatos: dir, agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS })
  const c = a2a.crearMensaje({ de: 'implementador', para: 'revisor', tipo: 'pregunta', ref: 'job_1', cuerpo: '¿pasa la revisión?' })
  assert.equal(c.status, 200)
  const id = c.body.mensaje.id
  const l = a2a.listarMensajes({ para: 'revisor' })
  assert.equal(l.body.mensajes.length, 1)
  assert.equal(l.body.mensajes[0].estado, 'pendiente')
  const antes = a2a.listarMensajes().body.mensajes.length
  const r = a2a.responder({ id, cuerpo: 'sí' })
  assert.equal(r.status, 200)
  assert.equal(r.body.mensaje.estado, 'respondido')
  assert.equal(r.body.mensaje.respuesta.cuerpo, 'sí')
  // La respuesta no crea otro mensaje (ni de tipo pregunta).
  assert.equal(a2a.listarMensajes().body.mensajes.length, antes)
  assert.equal(a2a.responder({ id, cuerpo: 'otra vez' }).status, 409)
  assert.equal(a2a.crearMensaje({ de: 'x', para: 'y', tipo: 'otro', ref: 'r', cuerpo: 'c' }).status, 400)
})

// 8 · C3 · TTL: un pendiente caduca a los 30 min.
await prueba('C3: TTL — un mensaje pendiente pasa a expirado a los 30 min', () => {
  const { oc, cl } = baseDirs()
  let T = Date.parse('2026-10-14T10:00:00.000Z')
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't8'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, ahora: () => T })
  const c = a2a.crearMensaje({ de: 'a', para: 'b', tipo: 'aviso', ref: 'job_1', cuerpo: 'hola' })
  assert.equal(c.body.mensaje.estado, 'pendiente')
  T += TTL_MENSAJE + 1000
  const l = a2a.listarMensajes({ para: 'b' })
  assert.equal(l.body.mensajes[0].estado, 'expirado')
  assert.equal(a2a.responder({ id: c.body.mensaje.id, cuerpo: 'tarde' }).status, 409)
})

// 9 · C3 · límite de 20 pendientes por destinatario.
await prueba('C3: 20 pendientes por destinatario → el 21.º da 429', () => {
  const { oc, cl } = baseDirs()
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't9'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS })
  for (let i = 0; i < MAX_PENDIENTES; i++) {
    assert.equal(a2a.crearMensaje({ de: 'origen', para: 'destino', tipo: 'aviso', ref: `job_${i}`, cuerpo: 'c' }).status, 200)
  }
  const extra = a2a.crearMensaje({ de: 'origen', para: 'destino', tipo: 'aviso', ref: 'job_x', cuerpo: 'c' })
  assert.equal(extra.status, 429)
  // Otro destinatario no está afectado.
  assert.equal(a2a.crearMensaje({ de: 'origen', para: 'otro', tipo: 'aviso', ref: 'job_x', cuerpo: 'c' }).status, 200)
  // Un cuerpo demasiado largo se rechaza.
  assert.equal(a2a.crearMensaje({ de: 'x', para: 'y', tipo: 'resultado', ref: 'r', cuerpo: 'z'.repeat(CUERPO_MAX + 1) }).status, 400)
})

// 10 · C3 · persistencia read-merge-write.
await prueba('C3: el buzón persiste en a2a.json y se recupera en otra instancia', () => {
  const { oc, cl } = baseDirs()
  const dir = path.join(raiz, 't10')
  const a1 = crearA2A({ dirDatos: dir, agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS })
  a1.crearMensaje({ de: 'a', para: 'b', tipo: 'resultado', ref: 'job_1', cuerpo: 'listo' })
  assert.ok(fs.existsSync(path.join(dir, 'a2a.json')), 'debía escribir a2a.json')
  const a2 = crearA2A({ dirDatos: dir, agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS })
  assert.equal(a2.listarMensajes({ para: 'b' }).body.mensajes.length, 1)
  // Filtro por ref y estado.
  assert.equal(a2.listarMensajes({ ref: 'job_1' }).body.mensajes.length, 1)
  assert.equal(a2.listarMensajes({ estado: 'respondido' }).body.mensajes.length, 0)
})

// 11 · C4 · triaje en el camino (una decisión por encargo y ventana).
await prueba('C4: la consulta registra el triaje una sola vez por encargo/ventana', async () => {
  const { oc, cl } = baseDirs()
  let T = Date.parse('2026-10-14T12:00:00.000Z')
  const decisiones = []
  const triaje = {
    llamadas: 0,
    async decidir({ tarea }) { this.llamadas++; decisiones.push({ tarea, agente: 'explorador-ds', fecha: new Date(T).toISOString() }); return { agente: 'explorador-ds', capa: 'opencode', esfuerzo: 'low', fuente: 'reglas', motivo: 'test' } },
  }
  const a2a = crearA2A({ dirDatos: path.join(raiz, 't11'), agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, lanzador: lanzadorSim(), triaje, leerDecisiones: () => decisiones, ahora: () => T })
  await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'misma pregunta', directory: DIR })
  assert.equal(triaje.llamadas, 1)
  await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'misma pregunta', directory: DIR })
  assert.equal(triaje.llamadas, 1, 'no debía repetir la decisión dentro de la ventana')
  T += 20 * 60 * 1000 // fuera de la ventana de 10 min
  await a2a.consultar({ de: 'cerebro', para: 'explorador-ds', pregunta: 'misma pregunta', directory: DIR })
  assert.equal(triaje.llamadas, 2)
})

// 12 · C5 · reparto medido.
await prueba('C5: reparto() agrega por agente, por capa, % con triaje y consultas A2A', () => {
  const { oc, cl } = baseDirs()
  fs.writeFileSync(path.join(oc, 'explorador-ds.md'), '---\ndescription: E\nmodel: m\nvariant: low\n---\n')
  fs.writeFileSync(path.join(oc, 'implementador.md'), '---\ndescription: I\nmodel: m\nvariant: high\n---\n')
  const dir = path.join(raiz, 't12')
  const metricas = crearMetricas({ dirLogs: path.join(dir, 'logs') })
  const T = Date.parse('2026-10-14T12:00:00.000Z')
  const ledger = {
    leer: () => ([
      { jobId: 'j1', agente: 'explorador-ds', estado: 'completado', creado: T - 1000, actualizado: T },
      { jobId: 'j2', agente: 'explorador-ds', estado: 'fallido', creado: T - 500, actualizado: T - 100 },
      { jobId: 'j3', agente: 'implementador', estado: 'cancelado', creado: T - 300, actualizado: T - 200 },
    ]),
    medir: () => ({ maxConcurrentes: 3 }),
  }
  metricas.registrar({ tipo: 'job', jobId: 'j1', agente: 'explorador-ds', estado: 'completado', coste: 0.02 })
  metricas.registrar({ tipo: 'job', jobId: 'j2', agente: 'explorador-ds', estado: 'fallido', coste: 0.01 })
  metricas.registrar({ tipo: 'a2a', subtipo: 'consulta', de: 'cerebro', para: 'explorador-ds', estado: 'completado', chars: 100, coste: 0.03, ms: 500 })
  metricas.registrar({ tipo: 'a2a', subtipo: 'consulta', de: 'cerebro', para: 'revisor', estado: 'completado', chars: 300, coste: 0.05, ms: 700 })
  metricas.registrar({ tipo: 'a2a', subtipo: 'mensaje', de: 'a', para: 'b', estado: 'pendiente', chars: 10 })
  const decisiones = [{ tarea: 'algo', agente: 'explorador-ds', fecha: new Date(T - 60 * 1000).toISOString() }]
  const a2a = crearA2A({ dirDatos: dir, agentesDir: oc, claudeAgentesDir: cl, reglas: REGLAS, ledger, metricas, leerDecisiones: () => decisiones, ahora: () => T })
  const { status, body } = a2a.reparto({ dias: 7 })
  assert.equal(status, 200)
  const exp = body.agentes.find((a) => a.agente === 'explorador-ds')
  assert.equal(exp.trabajos, 2)
  assert.equal(exp.completados, 1)
  assert.equal(exp.fallidos, 1)
  assert.ok(Math.abs(exp.coste - 0.06) < 1e-9, `coste agregado inesperado (job 0.03 + consulta mediada 0.03): ${exp.coste}`)
  assert.ok(exp.mediaMs > 0)
  const imp = body.agentes.find((a) => a.agente === 'implementador')
  assert.equal(imp.cancelados, 1)
  // Por capa: explorador-ds e implementador son opencode.
  assert.ok(body.capas.some((c) => c.capa === 'opencode' && c.trabajos === 3))
  // % con triaje previo: j1 y j2 (explorador-ds, decisión dentro de 30 min) cuentan; j3 no.
  assert.equal(body.triaje.total, 3)
  assert.equal(body.triaje.conDecision, 2)
  assert.equal(body.triaje.pct, 67)
  assert.deepEqual(body.consultasA2A, { total: 2, coste: 0.08, mediaRespuestaChars: 200 })
})

// 13 · utilidades exportadas.
await prueba('recortar() y leerFrontmatter() cumplen su contrato', () => {
  assert.equal(recortar('abc', 10), 'abc')
  assert.equal(recortar('abcdef', 5).length, 5)
  assert.ok(recortar('abcdef', 5).endsWith('…'))
  const fm = leerFrontmatter('---\nmodel: x\ntags:\n  - uno\n  - dos\n---\n')
  assert.equal(fm.model, 'x')
  assert.deepEqual(fm.tags, ['uno', 'dos'])
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
