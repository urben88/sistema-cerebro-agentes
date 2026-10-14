#!/usr/bin/env node
/**
 * Pruebas del ledger de trabajos (R3 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Sin dependencias: solo `node:assert`. Monta directorios temporales (nunca toca el
 * `hub-data` real ni los ficheros de job del MCP) e INYECTA reloj y umbrales cortos.
 * Comprueba:
 *   · transiciones de estado (pendiente/en_curso/completado/fallido/cancelado/desconocido);
 *   · reconciliación con `leerJobs()` simulado: job vivo → `en_curso` y re-enganchado,
 *     desaparecido → `desconocido` con nota, `unknown` → `desconocido`;
 *   · inmutabilidad de lo terminal: `unknown`/activo no degradan un `completado`;
 *     un job vivo fuera del top-N (sondeo `existeJob`) no pasa a `desconocido`;
 *   · atasco por progreso: sin progreso → `atascado` y aviso; con progreso → no;
 *     y «dentro de una herramienta» usa su propio umbral; nunca cancela;
 *     `atascado` + progreso nuevo vuelve a `en_curso` vía `reconciliar()`;
 *   · el ledger no toca los ficheros del MCP (solo escribe bajo `dirDatos`);
 *   · `trabajos.json` corrupto se tolera y se reescribe válido;
 *   · retención: 7 días y tope de 50 completados;
 *   · merge por relectura (dos escritores secuenciales; ninguno pierde su entrada);
 *   · medición de concurrencia/profundidad (aviso, sin imposición).
 *
 * Uso: node scripts/test-ledger.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearLedger, estadoDeJob, ESTADOS } from '../config/hub/lib/ledger.mjs'

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

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ledger-'))
const MIN = 60 * 1000
const DIA = 24 * 60 * MIN

console.log(`=== Pruebas del ledger de trabajos ===`)
console.log(`Temporal: ${raiz}\n`)

/** Job simulado con la forma que devuelve `oc.leerJobs()`. */
function job(jobId, status, updatedAt, extra = {}) {
  return { jobId, status, updatedAt, createdAt: updatedAt - 5 * MIN, directory: extra.directory || 'C:/repo/demo', agent: extra.agent || 'implementador', title: extra.title || null, ...extra }
}

// 1 · Transiciones de estado al registrar jobs observados.
prueba('registrar() traduce los estados del MCP a los del ledger', () => {
  const dir = path.join(raiz, 't1')
  const T = 1_000_000_000_000
  const l = crearLedger({ dirDatos: dir, ahora: () => T })
  const casos = [['pending', 'pendiente'], ['running', 'en_curso'], ['input_required', 'en_curso'], ['completed', 'completado'], ['failed', 'fallido'], ['cancelled', 'cancelado'], ['unknown', 'desconocido']]
  casos.forEach(([crudo, esperado], i) => {
    const e = l.registrar(job(`j${i}`, crudo, T))
    assert.equal(e.estado, esperado, `${crudo} → ${e.estado} (esperaba ${esperado})`)
  })
  assert.deepEqual([...new Set(l.leer().map((e) => e.estado))].sort(), [...new Set(casos.map(([, e]) => e))].sort())
  assert.equal(estadoDeJob('loquesea'), 'desconocido')
  assert.ok(ESTADOS.includes('atascado'))
  // El deadline se calcula a partir de `createdAt` + horasMaxJob.
  const e = l.registrar(job('jd', 'running', T))
  assert.equal(e.deadline, T - 5 * MIN + 24 * 60 * MIN)
})

// 2 · Reconciliación con leerJobs simulado.
prueba('reconciliar() re-engancha lo vivo, marca desconocido lo desaparecido y el unknown', () => {
  const dir = path.join(raiz, 't2')
  const T = 2_000_000_000_000
  const notas = []
  const l = crearLedger({ dirDatos: dir, ahora: () => T, anotarBitacora: (d, tit, txt) => notas.push({ d, tit, txt }) })
  l.registrar(job('A', 'running', T, { directory: 'C:/repo/alfa' }))
  l.registrar(job('B', 'running', T, { directory: 'C:/repo/beta' }))
  // A sigue vivo; B desapareció; C aparece como unknown.
  const informe = l.reconciliar([job('A', 'running', T + 30 * MIN, { directory: 'C:/repo/alfa' }), job('C', 'unknown', T, { directory: 'C:/repo/gamma' })])
  assert.ok(informe.reEnganchados.includes('A'), 'A debía re-engancharse')
  assert.ok(informe.desconocidos.some((x) => x.jobId === 'B'), 'B debía pasar a desconocido')
  assert.ok(informe.desconocidos.some((x) => x.jobId === 'C'), 'C (unknown) debía pasar a desconocido')
  const porId = new Map(l.leer().map((e) => [e.jobId, e]))
  assert.equal(porId.get('A').estado, 'en_curso')
  assert.equal(porId.get('B').estado, 'desconocido')
  assert.equal(porId.get('C').estado, 'desconocido')
  assert.ok(notas.some((n) => n.d === 'C:/repo/beta'), 'faltó la nota de bitácora del desaparecido')
  assert.ok(notas.some((n) => n.d === 'C:/repo/gamma'), 'faltó la nota de bitácora del unknown')
  // Un segundo reconciliar no vuelve a anotar lo que ya era desconocido.
  const antes = notas.length
  l.reconciliar([job('A', 'running', T + 40 * MIN, { directory: 'C:/repo/alfa' })])
  assert.equal(notas.length, antes, 'no debía repetir la nota en cada reconciliación')
  // Un job vivo sin directorio no intenta anotar (anotarBitacora exige `directorio`).
  l.registrar(job('D', 'running', T, { directory: null }))
  l.reconciliar([])
  assert.equal(l.leer().find((e) => e.jobId === 'D').estado, 'desconocido')
  assert.equal(notas.filter((n) => !n.d).length, 0, 'un job sin directorio no debía anotar')
})

// 3 · Atasco por progreso (reloj y umbrales cortos inyectados).
prueba('revisarAtascos(): sin progreso → atascado + aviso; con progreso → no', () => {
  const dir = path.join(raiz, 't3')
  let T = 3_000_000_000_000
  const avisos = []
  const l = crearLedger({ dirDatos: dir, ahora: () => T, minutosAtasco: 1, minutosAtascoHerramienta: 10, minutosGraciaAtasco: 0, avisar: (a) => avisos.push(a) })
  l.registrar(job('progresa', 'running', T))
  l.registrar(job('parado', 'running', T - 5 * MIN))
  l.registrar(job('enTool', 'running', T - 5 * MIN))
  // Solo «parado» lleva 5 min sin progreso (> 1 min).
  T += 0
  const r1 = l.revisarAtascos({ jobs: [job('progresa', 'running', T), job('parado', 'running', T - 5 * MIN), job('enTool', 'running', T - 5 * MIN)], eventos: { enTool: [{ id: 'e1', ts: T - 5 * MIN, tipo: 'herramienta', estado: 'running' }] } })
  const porId = new Map(l.leer().map((e) => [e.jobId, e]))
  assert.equal(porId.get('progresa').estado, 'en_curso', 'con progreso reciente no debe marcar atasco')
  assert.equal(porId.get('parado').estado, 'atascado', 'sin progreso debía marcar atasco')
  assert.equal(porId.get('enTool').estado, 'en_curso', 'dentro de una herramienta usa su propio umbral (10 min)')
  assert.deepEqual(r1.atascados.map((a) => a.jobId), ['parado'])
  assert.ok(avisos.some((a) => a.jobId === 'parado' && a.tipo === 'atascado' && a.origen === 'ledger'), 'faltó el aviso de atasco')
  // Con progreso reciente la medición no vuelve a avisar.
  const avisosAntes = avisos.length
  l.revisarAtascos({ jobs: [job('parado', 'running', T), job('enTool', 'running', T)], eventos: { enTool: [{ id: 'e2', ts: T, tipo: 'herramienta', estado: 'completed' }] } })
  assert.equal(avisos.length, avisosAntes, 'con progreso reciente no debe volver a avisar')
})

// 3b · El desatasco es de `reconciliar()`: un `atascado` con job vivo vuelve a `en_curso`.
prueba('reconciliar() desatasca: `atascado` + job vivo → `en_curso`', () => {
  const dir = path.join(raiz, 't3b')
  const T = 3_500_000_000_000
  const l = crearLedger({ dirDatos: dir, ahora: () => T, minutosAtasco: 1, minutosGraciaAtasco: 0 })
  l.registrar(job('trab', 'running', T - 5 * MIN, { directory: 'C:/repo/trab' }))
  // Sin progreso durante 5 min (> 1 min) → `atascado` en el ledger.
  l.revisarAtascos({ jobs: [job('trab', 'running', T - 5 * MIN)], eventos: {} })
  assert.equal(l.leer().find((e) => e.jobId === 'trab').estado, 'atascado', 'debía atascarse primero')
  // El job reaparece vivo con progreso nuevo: reconciliar lo devuelve a `en_curso`.
  const informe = l.reconciliar([job('trab', 'running', T, { directory: 'C:/repo/trab' })])
  assert.equal(l.leer().find((e) => e.jobId === 'trab').estado, 'en_curso', 'con progreso nuevo debía desatascarse')
  assert.ok(informe.reEnganchados.includes('trab'), 'debía re-engancharse al desatascar')
})

// 3c · Inmutabilidad de lo terminal: `unknown` y activo no degradan un completado.
prueba('un `unknown` del MCP no degrada un terminal (completado) y no anota', () => {
  const dir = path.join(raiz, 't3c')
  const T = 3_700_000_000_000
  const notas = []
  const l = crearLedger({ dirDatos: dir, ahora: () => T, anotarBitacora: (d, tit, txt) => notas.push({ d, tit, txt }) })
  l.registrar(job('ok', 'completed', T, { directory: 'C:/repo/ok' }))
  const antes = notas.length
  l.reconciliar([job('ok', 'unknown', T + MIN, { directory: 'C:/repo/ok' })])
  assert.equal(l.leer().find((e) => e.jobId === 'ok').estado, 'completado', 'unknown no debe degradar un completado')
  assert.equal(notas.length, antes, 'un terminal inmutable no debía generar nota de bitácora')
})

// 3d · Un status activo tampoco revive lo terminal a `en_curso`.
prueba('un status activo no revive un terminal (completado) a `en_curso`', () => {
  const dir = path.join(raiz, 't3d')
  const T = 3_800_000_000_000
  const l = crearLedger({ dirDatos: dir, ahora: () => T })
  l.registrar(job('ok2', 'completed', T, { directory: 'C:/repo/ok2' }))
  const informe = l.reconciliar([job('ok2', 'running', T + MIN, { directory: 'C:/repo/ok2' })])
  assert.equal(l.leer().find((e) => e.jobId === 'ok2').estado, 'completado', 'lo terminal no retrocede')
  assert.ok(!informe.reEnganchados.includes('ok2') && !informe.desconocidos.some((x) => x.jobId === 'ok2'))
})

// 3e · Un job vivo fuera del top-N de `leerJobs()` no es «desaparecido».
prueba('un job vivo fuera del top-N no pasa a `desconocido` (sondeo `existeJob`)', () => {
  const T = 3_900_000_000_000
  const l = crearLedger({ dirDatos: path.join(raiz, 't3e'), ahora: () => T, existeJob: () => true })
  l.registrar(job('vivo', 'running', T - 10 * DIA, { directory: 'C:/repo/vivo' }))
  const informe = l.reconciliar([]) // leerJobs() no lo devuelve (updatedAt viejo, fuera del top-N)
  assert.equal(l.leer().find((e) => e.jobId === 'vivo').estado, 'en_curso', 'su fichero existe: no es desaparecido')
  assert.ok(!informe.desconocidos.some((x) => x.jobId === 'vivo'))
  // Sin embargo, si el fichero del job ya no está, sí pasa a `desconocido`.
  const l2 = crearLedger({ dirDatos: path.join(raiz, 't3e2'), ahora: () => T, existeJob: () => false })
  l2.registrar(job('muerto', 'running', T - 2 * MIN, { directory: 'C:/repo/muerto' }))
  l2.reconciliar([])
  assert.equal(l2.leer().find((e) => e.jobId === 'muerto').estado, 'desconocido', 'sin fichero de job sí desaparece')
})

// 4 · El ledger no toca los ficheros del MCP: solo escribe bajo dirDatos.
prueba('no toca los ficheros de job del MCP (solo escribe bajo dirDatos)', () => {
  const dir = path.join(raiz, 't4')
  const mcp = path.join(raiz, 'mcp-tasks', 'proyecto')
  fs.mkdirSync(mcp, { recursive: true })
  const ficheroMcp = path.join(mcp, 'job_abc.json')
  fs.writeFileSync(ficheroMcp, JSON.stringify({ jobId: 'abc', status: 'running' }))
  const antes = fs.readFileSync(ficheroMcp, 'utf8')
  const mtimeAntes = fs.statSync(ficheroMcp).mtimeMs
  const l = crearLedger({ dirDatos: dir })
  l.registrar(job('abc', 'running', Date.now()))
  l.reconciliar([])
  assert.equal(fs.readFileSync(ficheroMcp, 'utf8'), antes, 'el fichero del MCP cambió de contenido')
  assert.equal(fs.statSync(ficheroMcp).mtimeMs, mtimeAntes, 'el fichero del MCP se escribió')
  assert.equal(path.dirname(l.archivo), dir, 'el ledger debe vivir bajo dirDatos')
  const escritos = fs.readdirSync(dir)
  assert.ok(escritos.every((n) => n.startsWith('trabajos.json')), `archivos inesperados: ${escritos.join(', ')}`)
})

// 5 · Archivo corrupto.
prueba('tolera trabajos.json corrupto y lo reescribe válido', () => {
  const dir = path.join(raiz, 't5')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'trabajos.json'), '{ esto no es json ::: ')
  const T = 5_000_000_000_000
  const l = crearLedger({ dirDatos: dir, ahora: () => T })
  assert.deepEqual(l.leer(), [], 'con el archivo corrupto debe arrancar vacío')
  l.registrar(job('x', 'running', T))
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'trabajos.json'), 'utf8'))
  assert.ok(Array.isArray(j.trabajos) && j.trabajos[0].jobId === 'x', 'no reescribió un JSON válido')
})

// 6 · Retención (7 días) y tope de 50 completados.
prueba('retención: purga lo terminal de más de 7 días y limita los completados a 50', () => {
  const dir = path.join(raiz, 't6')
  fs.mkdirSync(dir, { recursive: true })
  const T = 6_000_000_000_000
  const lista = []
  lista.push({ jobId: 'viejo', estado: 'completado', actualizado: T - 8 * DIA })
  lista.push({ jobId: 'reciente', estado: 'completado', actualizado: T - DIA })
  lista.push({ jobId: 'activo', estado: 'en_curso', actualizado: T - 30 * DIA })
  lista.push({ jobId: 'desaparecido', estado: 'desconocido', actualizado: T - 10 * DIA })
  fs.writeFileSync(path.join(dir, 'trabajos.json'), JSON.stringify({ actualizado: T, trabajos: lista }))
  const l = crearLedger({ dirDatos: dir, ahora: () => T, retencionDias: 7, maxCompletados: 50 })
  l.podar()
  const ids = l.leer().map((e) => e.jobId)
  assert.ok(!ids.includes('viejo'), 'el completado de 8 días debía purgarse')
  assert.ok(!ids.includes('desaparecido'), 'el desconocido de 10 días debía purgarse')
  assert.ok(ids.includes('reciente') && ids.includes('activo'), 'lo reciente y lo activo deben conservarse')

  // 60 completados recientes → quedan 50.
  const dir2 = path.join(raiz, 't6b')
  fs.mkdirSync(dir2, { recursive: true })
  const muchos = []
  for (let i = 0; i < 60; i++) muchos.push({ jobId: `c${i}`, estado: 'completado', actualizado: T - i * MIN })
  fs.writeFileSync(path.join(dir2, 'trabajos.json'), JSON.stringify({ actualizado: T, trabajos: muchos }))
  const l2 = crearLedger({ dirDatos: dir2, ahora: () => T, maxCompletados: 50 })
  l2.podar()
  assert.equal(l2.listar({ estado: 'completado' }).length, 50, 'los completados deben limitarse a 50')
})

// 7 · Merge por relectura: dos escritores secuenciales sobre el mismo fichero.
prueba('merge por relectura (dos escritores secuenciales no se pisan)', () => {
  const dir = path.join(raiz, 't7')
  const T = Date.now()
  const l1 = crearLedger({ dirDatos: dir, ahora: () => T })
  const l2 = crearLedger({ dirDatos: dir, ahora: () => T })
  l1.registrar(job('deL1', 'running', T))
  l2.registrar(job('deL2', 'running', T))
  const ids = new Map(crearLedger({ dirDatos: dir, ahora: () => T }).leer().map((e) => [e.jobId, e]))
  assert.ok(ids.has('deL1') && ids.has('deL2'), 'el merge debía conservar las entradas de ambos')
  // Y actualizar una no borra la del otro.
  l1.registrar(job('deL1', 'completed', T + MIN))
  const ids2 = new Map(crearLedger({ dirDatos: dir, ahora: () => T }).leer().map((e) => [e.jobId, e]))
  assert.equal(ids2.get('deL1').estado, 'completado')
  assert.ok(ids2.has('deL2'), 'actualizar una entrada borró la del otro escritor')
})

// 7b · C6 (spec 14) · completar `agente`/`directorio` al reconciliar con el registro del job.
prueba('C6: reconciliar() completa el agente de entradas sin agente (terminales incluidas)', () => {
  const dir = path.join(raiz, 't7b')
  const T = 3_000_000_000_000
  const sinAgente = (jobId, status, updatedAt, extra = {}) => ({ jobId, status, updatedAt, createdAt: updatedAt - 5 * MIN, directory: extra.directory || null, agent: extra.agent ?? null, title: null, ...extra })
  const l = crearLedger({ dirDatos: dir, ahora: () => T })
  // Entrada ya terminal creada SIN agente (el fichero del job aún no lo exponía).
  l.registrar(sinAgente('t-completado', 'completed', T))
  assert.equal(l.leer().find((e) => e.jobId === 't-completado').agente, null)
  // Al reconciliar con el registro del job (ya con agente), se completa aunque sea terminal.
  l.reconciliar([sinAgente('t-completado', 'completed', T + MIN, { agent: 'revisor', directory: 'C:/repo/uno' })])
  const e1 = l.leer().find((e) => e.jobId === 't-completado')
  assert.equal(e1.estado, 'completado', 'lo terminal no debía cambiar de estado')
  assert.equal(e1.agente, 'revisor', 'el agente conocido debía completarse')
  assert.equal(e1.directorio, 'C:/repo/uno', 'el directorio conocido debía completarse')
  // Un job visto vivo sin agente y luego cancelado con agente también se completa.
  l.registrar(sinAgente('t-cancel', 'running', T))
  assert.equal(l.leer().find((e) => e.jobId === 't-cancel').agente, null)
  l.reconciliar([sinAgente('t-cancel', 'cancelled', T + MIN, { agent: 'testeador', directory: 'C:/repo/dos' })])
  const e2 = l.leer().find((e) => e.jobId === 't-cancel')
  assert.equal(e2.estado, 'cancelado')
  assert.equal(e2.agente, 'testeador')
  // Un `unknown` del MCP también completa el agente antes de marcarlo desconocido.
  l.registrar(sinAgente('t-desc', 'running', T))
  l.reconciliar([sinAgente('t-desc', 'unknown', T + MIN, { agent: 'debugger' })])
  const e3 = l.leer().find((e) => e.jobId === 't-desc')
  assert.equal(e3.estado, 'desconocido')
  assert.equal(e3.agente, 'debugger')
  // No pisa un agente ya conocido por uno distinto.
  l.registrar(sinAgente('t-fijo', 'completed', T, { agent: 'implementador' }))
  l.reconciliar([sinAgente('t-fijo', 'completed', T + MIN, { agent: 'otro' })])
  assert.equal(l.leer().find((e) => e.jobId === 't-fijo').agente, 'implementador')
})

// 8 · Medición de concurrencia y profundidad (mide y avisa, no impone).
prueba('medir(): concurrencia y profundidad con aviso, sin imponer', () => {
  const dir = path.join(raiz, 't8')
  const T = Date.now()
  const l = crearLedger({ dirDatos: dir, ahora: () => T, maxConcurrentes: 3 })
  for (let i = 0; i < 4; i++) l.registrar(job(`p${i}`, 'running', T, { directory: 'C:/repo/mismo' }))
  const m = l.medir()
  assert.equal(m.enCurso, 4)
  assert.equal(m.maxConcurrentes, 3)
  assert.equal(m.profundidad, 4, 'la profundidad es el máximo de jobs por directorio')
  assert.equal(m.aviso, true)
  assert.ok(m.mensaje && m.mensaje.includes('3'), 'el aviso debe citar el máximo recomendado')
  // Nada se canceló: los cuatro siguen en curso en el ledger.
  assert.equal(l.listar({ estado: 'en_curso' }).length, 4)
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
