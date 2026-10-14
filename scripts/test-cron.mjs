#!/usr/bin/env node
/**
 * Pruebas del cron y las tareas programadas (R6 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Sin dependencias: solo `node:assert`. Monta directorios temporales (nunca toca el
 * `hub-data` real), INYECTA un reloj y un lanzador FALSOS (jamás lanza jobs reales) y
 * comprueba:
 *   · `parsearSchedule`: «cada 30m» / «every 30m» → interval, «laborables 9:00» → cron
 *     `0 9 * * 1-5`, «cada lunes a las 9» → cron, «en 2h» / ISO → once, cron de 5 campos,
 *     fecha en el pasado rechazada y frase absurda rechazada con ejemplo;
 *   · `siguiente()` de cron (en hora local) e interval;
 *   · `tick()` ejecuta un vencido una sola vez aunque se llame dos veces seguidas o exista
 *     otra instancia sobre el mismo `dataDir` (claim);
 *   · un claim caducado se recupera y vuelve a ejecutarse;
 *   · un `once` se completa y no se repite tras un reinicio;
 *   · preflight: agente inexistente → no lanza (fail-closed); OpenCode caído → avisa y sigue
 *     (fail-open);
 *   · reintentos por `servidor_inalcanzable` a 5/15/30 min y luego `fallido` con aviso;
 *   · la salida se escribe en `cron/salida/<id>/`;
 *   · la consigna R6.7: los agentes que escriben exigen `aprobado_usuario`.
 *
 * Uso: node scripts/test-cron.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearCron, parsearSchedule, siguiente, validarCron, RETRASOS_MIN, AGENTES_ESCRITURA } from '../config/hub/lib/cron.mjs'

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

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cron-'))
const MIN = 60 * 1000

console.log(`=== Pruebas de cron y tareas programadas ===`)
console.log(`Temporal: ${raiz}\n`)

/**
 * Lanzador falso: nunca lanza jobs reales. `agentesFalla` simula OpenCode caído.
 * Si se pasa `costeSesion`, expone además `costeSesion`/`abortarSesion` (R6.4) y
 * registra los abortos en `abortes`.
 */
function lanzadorFalso({ agentes = ['explorador-ds', 'revisor'], agentesFalla = false, lanzarFalla = false, costeSesion = null } = {}) {
  const launches = []
  const abortes = []
  const api = {
    launches,
    abortes,
    puerto: () => 1234,
    async agentes() {
      if (agentesFalla) return { ok: false, codigo: 'servidor_inalcanzable', error: 'servidor V1 no arrancado' }
      return { ok: true, agentes }
    },
    async lanzarJob(job) {
      launches.push(job)
      if (lanzarFalla) return { ok: false, codigo: 'servidor_inalcanzable', error: 'servidor V1 no arrancado' }
      return { ok: true, sessionId: `s_${launches.length}`, messageId: `m_${launches.length}` }
    },
  }
  if (costeSesion) {
    api.costeSesion = (op) => costeSesion(op)
    api.abortarSesion = async (op) => { abortes.push(op); return { ok: true } }
  }
  return api
}

/**
 * Busca en `year` un par de instantes consecutivos con la MISMA hora local y fecha
 * (transición de otoño / DST fall-back); devuelve `[antesMs, despuesMs]` o null si la
 * zona horaria no observa DST.
 */
function parFallback(year) {
  const paso = 30 * 60 * 1000
  const ini = new Date(year, 9, 1).getTime()
  const fin = new Date(year, 11, 15).getTime()
  let prevOff = null
  for (let t = ini; t <= fin; t += paso) {
    const off = new Date(t).getTimezoneOffset()
    if (prevOff != null && off > prevOff) {
      const objetivo = new Date(t)
      for (let u = t - paso; u >= t - 3 * 60 * 60 * 1000; u -= paso) {
        const d = new Date(u)
        if (d.getDate() === objetivo.getDate() && d.getHours() === objetivo.getHours() && d.getMinutes() === objetivo.getMinutes()) {
          return [u, t]
        }
      }
    }
    prevOff = off
  }
  return null
}

/** Job de prueba (interval) con `siguiente` ya vencido. */
function crearJobVencido(cron, { agente = 'explorador-ds', schedule = { kind: 'interval', minutos: 30 } } = {}) {
  const r = cron.crear({ nombre: 'job de prueba', schedule, destino: { agente, directory: 'C:/repo/demo' }, prompt: 'haz algo' })
  assert.equal(r.ok, true, r.error)
  return r.job
}

/** Reescribe `cron/jobs.json` (para simular estados externos/claims). */
function escribirJobs(dataDir, jobs) {
  fs.mkdirSync(path.join(dataDir, 'cron'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'cron', 'jobs.json'), JSON.stringify({ actualizado: Date.now(), jobs }, null, 2) + '\n')
}

// 1 · Parser de frases.
await prueba('parsearSchedule: «cada 30m» y «every 30m» → interval 30', () => {
  for (const frase of ['cada 30m', 'every 30m', 'cada 30 min']) {
    const r = parsearSchedule(frase)
    assert.equal(r.ok, true, frase)
    assert.deepEqual(r.schedule, { kind: 'interval', minutos: 30 }, frase)
  }
  assert.deepEqual(parsearSchedule('cada 2h').schedule, { kind: 'interval', minutos: 120 })
})

await prueba('parsearSchedule: «laborables 9:00» → cron 0 9 * * 1-5 y «cada lunes a las 9»', () => {
  assert.deepEqual(parsearSchedule('laborables 9:00').schedule, { kind: 'cron', expr: '0 9 * * 1-5' })
  assert.deepEqual(parsearSchedule('weekdays 9:00').schedule, { kind: 'cron', expr: '0 9 * * 1-5' })
  assert.deepEqual(parsearSchedule('cada lunes a las 9').schedule, { kind: 'cron', expr: '0 9 * * 1' })
  assert.deepEqual(parsearSchedule('cada lunes a las 9:30').schedule, { kind: 'cron', expr: '30 9 * * 1' })
  assert.deepEqual(parsearSchedule('cada domingo a las 0').schedule, { kind: 'cron', expr: '0 0 * * 0' })
})

await prueba('parsearSchedule: «en 2h» / «in 30m» / ISO → once', () => {
  const T = Date.parse('2026-06-01T10:00:00')
  const r1 = parsearSchedule('en 2h', { ahora: () => T })
  assert.equal(r1.ok, true)
  assert.equal(r1.schedule.kind, 'once')
  assert.equal(Date.parse(r1.schedule.ejecutar_en), T + 2 * 60 * MIN)
  const r2 = parsearSchedule('in 30m', { ahora: () => T })
  assert.equal(Date.parse(r2.schedule.ejecutar_en), T + 30 * MIN)
  const iso = parsearSchedule('2026-06-02T09:30:00', { ahora: () => T })
  assert.equal(iso.ok, true)
  assert.equal(iso.schedule.kind, 'once')
  assert.equal(Date.parse(iso.schedule.ejecutar_en), Date.parse('2026-06-02T09:30:00'))
})

await prueba('parsearSchedule: cron de 5 campos tal cual y errores', () => {
  assert.deepEqual(parsearSchedule('0 9 * * 1-5').schedule, { kind: 'cron', expr: '0 9 * * 1-5' })
  assert.deepEqual(parsearSchedule('*/15 8-18 * * 1,2,3').schedule, { kind: 'cron', expr: '*/15 8-18 * * 1,2,3' })
  // Frase absurda: rechazada con ejemplo válido.
  const abs = parsearSchedule('hazme un café cada vez que llueva')
  assert.equal(abs.ok, false)
  assert.ok(typeof abs.error === 'string' && abs.error.length > 0)
  assert.ok(typeof abs.ejemplo === 'string' && /cada|laborables|ISO|\*/.test(abs.ejemplo))
  // Fecha once en el pasado: rechazada.
  assert.equal(parsearSchedule('2020-01-01', { ahora: () => Date.parse('2026-01-01') }).ok, false)
  // Cron inválido (minuto 99).
  assert.equal(parsearSchedule('99 9 * * 1').ok, false)
})

// 2 · siguiente() de cron e interval.
await prueba('siguiente(): cron en hora local e interval', () => {
  // Lunes 5-ene-2026 08:00 → siguiente laborable 9:00 ese mismo día.
  const lunes = new Date(2026, 0, 5, 8, 0, 0).getTime()
  assert.equal(siguiente({ kind: 'cron', expr: '0 9 * * 1-5' }, lunes), new Date(2026, 0, 5, 9, 0, 0).getTime())
  // Viernes 9-ene-2026 10:00 → el siguiente laborable es el lunes 12 a las 9:00.
  const viernes = new Date(2026, 0, 9, 10, 0, 0).getTime()
  assert.equal(siguiente({ kind: 'cron', expr: '0 9 * * 1-5' }, viernes), new Date(2026, 0, 12, 9, 0, 0).getTime())
  // Interval: suma exacta.
  assert.equal(siguiente({ kind: 'interval', minutos: 30 }, 1_000_000), 1_000_000 + 30 * MIN)
  // Once pasado → null.
  assert.equal(siguiente({ kind: 'once', ejecutar_en: new Date(0).toISOString() }, Date.now()), null)
})

// 2b · `N/step` = desde N hasta el máximo del campo con ese paso.
await prueba('cron N/step: 5/15 en minutos → 5, 20, 35, 50', () => {
  const sig = siguiente({ kind: 'cron', expr: '5/15 * * * *' }, new Date(2026, 5, 1, 0, 4, 0).getTime())
  assert.equal(sig, new Date(2026, 5, 1, 0, 5, 0).getTime())
  const sig2 = siguiente({ kind: 'cron', expr: '5/15 * * * *' }, sig)
  assert.equal(sig2, new Date(2026, 5, 1, 0, 20, 0).getTime())
  const sig3 = siguiente({ kind: 'cron', expr: '5/15 * * * *' }, new Date(2026, 5, 1, 0, 50, 0).getTime())
  assert.equal(sig3, new Date(2026, 5, 1, 1, 5, 0).getTime())
  // 0/30 → 0 y 30.
  const sig4 = siguiente({ kind: 'cron', expr: '0/30 * * * *' }, new Date(2026, 5, 1, 0, 10, 0).getTime())
  assert.equal(sig4, new Date(2026, 5, 1, 0, 30, 0).getTime())
  const sig5 = siguiente({ kind: 'cron', expr: '0/30 * * * *' }, new Date(2026, 5, 1, 0, 30, 0).getTime())
  assert.equal(sig5, new Date(2026, 5, 1, 1, 0, 0).getTime())
})

// 3 · tick(): un vencido se ejecuta una sola vez.
await prueba('tick() ejecuta un vencido una sola vez (dos ticks seguidos)', async () => {
  const dir = path.join(raiz, 't3')
  let T = 10_000_000_000_000
  const lan = lanzadorFalso()
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(cron)
  T += 30 * MIN // vence
  await cron.tick()
  assert.equal(lan.launches.length, 1, 'debía ejecutarse una vez')
  await cron.tick() // mismo reloj: ya no está vencido
  assert.equal(lan.launches.length, 1, 'no debía duplicar la ejecución')
  assert.equal(cron.obtener(job.id).reintentos, 0)
  assert.ok(cron.obtener(job.id).ultimo != null)
})

// 3b · Claim de verdad: con el lanzamiento AÚN EN VUELO, la segunda instancia no lanza.
await prueba('T3b: dos instancias solapadas; el claim en vuelo evita duplicar', async () => {
  const dir = path.join(raiz, 't3b')
  let T = 11_000_000_000_000
  const launches = []
  let resolverLanzamiento = null
  const lan = {
    launches,
    puerto: () => 1234,
    async agentes() { return { ok: true, agentes: ['explorador-ds', 'revisor'] } },
    lanzarJob(job) {
      launches.push(job)
      return new Promise((res) => { resolverLanzamiento = () => res({ ok: true, sessionId: `s_${launches.length}`, messageId: `m_${launches.length}` }) })
    },
  }
  const A = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(A)
  const B = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  T += 30 * MIN
  const tickA = A.tick() // reclama y deja el lanzamiento en vuelo (promesa pendiente)
  await new Promise((r) => setImmediate(r)) // deja que A persista el claim
  await B.tick() // B ve el claim vivo → no lanza
  resolverLanzamiento() // completa el lanzamiento de A
  await tickA
  assert.equal(launches.length, 1, 'solo una instancia debía lanzar')
  assert.ok(A.obtener(job.id).siguiente > T, 'el job debía quedar reprogramado')
})

// 4 · Claim caducado se recupera.
await prueba('claim caducado se recupera y vuelve a ejecutarse', async () => {
  const dir = path.join(raiz, 't4')
  let T = 12_000_000_000_000
  const lan = lanzadorFalso()
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(cron)
  T += 30 * MIN
  // Claim vivo (aún en el futuro): el job vencido NO debe ejecutarse.
  cron.obtener(job.id)
  escribirJobs(dir, [{ ...cron.obtener(job.id), claim: { id: 'cl_externo', hasta: T + 100 * MIN } }])
  await cron.tick()
  assert.equal(lan.launches.length, 0, 'con claim vivo no debía ejecutarse')
  assert.deepEqual(cron.recuperar(), { liberados: 0 })
  // El claim caduca: se recupera y ejecuta.
  T += 200 * MIN
  await cron.tick()
  assert.equal(lan.launches.length, 1, 'tras caducar el claim debía ejecutarse')
  assert.ok(cron.obtener(job.id).claim == null)
})

// 5 · once se completa y no repite tras un reinicio.
await prueba('once se completa y no se repite tras un reinicio', async () => {
  const dir = path.join(raiz, 't5')
  let T = 13_000_000_000_000
  const lan = lanzadorFalso()
  const A = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const r = A.crear({ nombre: 'una vez', schedule: { kind: 'once', ejecutar_en: new Date(T + 10 * MIN).toISOString() }, destino: { agente: 'revisor', directory: 'C:/repo/x' }, prompt: 'una vez' })
  assert.equal(r.ok, true, r.error)
  T += 11 * MIN
  await A.tick()
  assert.equal(lan.launches.length, 1)
  assert.equal(A.obtener(r.job.id).estado, 'completado')
  assert.equal(A.obtener(r.job.id).siguiente, null)
  // Reinicio: nueva instancia sobre el mismo dataDir.
  T += 60 * MIN
  const B = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  await B.tick()
  assert.equal(lan.launches.length, 1, 'un once completado no debe repetirse')
})

// 6 · Preflight.
await prueba('preflight: agente inexistente → no lanza (fail-closed)', async () => {
  const dir = path.join(raiz, 't6')
  let T = 14_000_000_000_000
  const lan = lanzadorFalso({ agentes: ['explorador-ds'] }) // no incluye 'revisor'
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(cron, { agente: 'revisor' })
  T += 30 * MIN
  await cron.tick()
  assert.equal(lan.launches.length, 0, 'no debía lanzar con agente inexistente')
  assert.equal(cron.obtener(job.id).estado, 'fallido')
  assert.ok(/revisor/.test(cron.obtener(job.id).motivo || ''))
  assert.ok(cron.avisos().some((a) => a.tipo === 'fail_closed' && a.jobId === job.id))
})

await prueba('preflight: OpenCode caído → avisa y sigue (fail-open)', async () => {
  const dir = path.join(raiz, 't6b')
  let T = 15_000_000_000_000
  const lan = lanzadorFalso({ agentesFalla: true }) // agentes() falla, pero lanzarJob funciona
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(cron)
  T += 30 * MIN
  await cron.tick()
  assert.equal(lan.launches.length, 1, 'fail-open: debía lanzar igualmente')
  assert.ok(cron.avisos().some((a) => a.tipo === 'fail_open'))
  assert.equal(cron.obtener(job.id).estado, 'activo')
})

// 7 · Reintentos 5/15/30 y luego fallido.
await prueba('reintentos por servidor_inalcanzable: 5, 15, 30 min y luego fallido', async () => {
  const dir = path.join(raiz, 't7')
  let T = 16_000_000_000_000
  const lan = lanzadorFalso({ lanzarFalla: true })
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const job = crearJobVencido(cron)
  T += 30 * MIN
  await cron.tick() // fallo 1 → reintento 1 en 5 min
  assert.equal(cron.obtener(job.id).reintentos, 1)
  assert.equal(cron.obtener(job.id).siguiente, T + RETRASOS_MIN[0] * MIN)
  T = cron.obtener(job.id).siguiente
  await cron.tick() // fallo 2 → reintento 2 en 15 min
  assert.equal(cron.obtener(job.id).reintentos, 2)
  assert.equal(cron.obtener(job.id).siguiente, T + RETRASOS_MIN[1] * MIN)
  T = cron.obtener(job.id).siguiente
  await cron.tick() // fallo 3 → reintento 3 en 30 min
  assert.equal(cron.obtener(job.id).reintentos, 3)
  assert.equal(cron.obtener(job.id).siguiente, T + RETRASOS_MIN[2] * MIN)
  T = cron.obtener(job.id).siguiente
  await cron.tick() // fallo 4 → fallido
  assert.equal(lan.launches.length, 4)
  assert.equal(cron.obtener(job.id).estado, 'fallido')
  assert.ok(cron.avisos().some((a) => a.tipo === 'fallido' && a.jobId === job.id))
  assert.ok(cron.avisos().filter((a) => a.tipo === 'reintento').length >= 3)
})

// 8 · Salida escrita.
await prueba('la salida se escribe en cron/salida/<id>/', async () => {
  const dir = path.join(raiz, 't8')
  let T = 17_000_000_000_000
  const cron = crearCron({ dataDir: dir, lanzador: lanzadorFalso(), ahora: () => T })
  const job = crearJobVencido(cron)
  T += 30 * MIN
  await cron.tick()
  const carpeta = path.join(dir, 'cron', 'salida', job.id)
  assert.ok(fs.existsSync(carpeta), 'debía existir la carpeta de salida del job')
  const ficheros = fs.readdirSync(carpeta).filter((n) => n.endsWith('.md'))
  assert.ok(ficheros.length >= 1, 'debía escribirse un .md de salida')
  const texto = fs.readFileSync(path.join(carpeta, ficheros[0]), 'utf8')
  assert.ok(/agente: explorador-ds/.test(texto))
})

// 9 · Consigna R6.7 (agentes que escriben exigen aprobación).
await prueba('R6.7: agentes que escriben exigen aprobado_usuario al crear', () => {
  const dir = path.join(raiz, 't9')
  const cron = crearCron({ dataDir: dir, lanzador: lanzadorFalso(), ahora: () => Date.now() })
  assert.ok(AGENTES_ESCRITURA.includes('implementador'))
  const sin = cron.crear({ nombre: 'escribe', schedule: { kind: 'interval', minutos: 60 }, destino: { agente: 'implementador', directory: 'C:/repo/x' }, prompt: 'código' })
  assert.equal(sin.ok, false)
  assert.equal(sin.codigo, 'requiere_aprobacion')
  const con = cron.crear({ nombre: 'escribe', schedule: { kind: 'interval', minutos: 60 }, destino: { agente: 'implementador', directory: 'C:/repo/x' }, prompt: 'código', aprobado_usuario: true })
  assert.equal(con.ok, true)
  // Un agente de lectura no exige nada.
  const lectura = cron.crear({ nombre: 'lee', schedule: { kind: 'interval', minutos: 60 }, destino: { agente: 'explorador-ds', directory: 'C:/repo/x' }, prompt: 'lee' })
  assert.equal(lectura.ok, true)
})

// 10 · Tombsones entre instancias (bajas persistentes).
await prueba('tombstones: A borra y B no lo resucita; el alta de B no se pierde', async () => {
  const dir = path.join(raiz, 't10')
  const T = 19_000_000_000_000
  const lan = lanzadorFalso()
  const A = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  const jobA = crearJobVencido(A)
  const B = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T }) // B carga jobA en memoria
  assert.ok(B.obtener(jobA.id), 'B debía tener el job en memoria')
  const del = A.borrar(jobA.id) // A persiste la baja
  assert.equal(del.ok, true)
  // B crea un job (no refresca antes): guardar() no debe resucitar jobA ni perder el alta.
  const alta = B.crear({ nombre: 'alta de B', schedule: { kind: 'interval', minutos: 60 }, destino: { agente: 'revisor', directory: 'C:/repo/x' }, prompt: 'x' })
  assert.equal(alta.ok, true, alta.error)
  const C = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  assert.equal(C.obtener(jobA.id), null, 'el job borrado no debe resucitar')
  assert.ok(C.obtener(alta.job.id), 'el alta de B no debe perderse')
})

// 11 · R6.4 · tope de coste real (vigilancia con lanzador falso).
await prueba('R6.4: el tope de coste aborta la sesión una sola vez', async () => {
  const dir = path.join(raiz, 't11')
  let T = 20_000_000_000_000
  let coste = 0
  const lan = lanzadorFalso({ costeSesion: () => ({ ok: true, coste, completado: false }) })
  const cron = crearCron({ dataDir: dir, lanzador: lan, reglas: { presupuestos: { 'explorador-ds': 1 } }, ahora: () => T })
  const job = crearJobVencido(cron, { schedule: { kind: 'interval', minutos: 1440 } })
  T += 1440 * MIN
  await cron.tick() // lanza y deja vigilancia
  assert.equal(lan.launches.length, 1)
  assert.ok(cron.obtener(job.id).vigilancia, 'debía quedar vigilancia tras el lanzamiento')
  coste = 0.4
  T += 30 * MIN
  await cron.tick()
  assert.equal(lan.abortes.length, 0, 'no debía abortar por debajo del tope')
  coste = 1.2
  T += 30 * MIN
  await cron.tick()
  assert.equal(lan.abortes.length, 1, 'debía abortar al alcanzar el tope')
  assert.equal(cron.obtener(job.id).vigilancia, null, 'debía limpiar la vigilancia')
  assert.ok(cron.avisos().some((a) => a.tipo === 'tope_coste' && a.jobId === job.id))
  T += 30 * MIN
  await cron.tick()
  assert.equal(lan.abortes.length, 1, 'no debía abortar dos veces')
})

await prueba('R6.4: si la sesión terminó, anota el coste final y limpia', async () => {
  const dir = path.join(raiz, 't11b')
  let T = 21_000_000_000_000
  const lan = lanzadorFalso({ costeSesion: () => ({ ok: true, coste: 0.25, completado: true }) })
  const cron = crearCron({ dataDir: dir, lanzador: lan, reglas: { presupuestos: { 'explorador-ds': 5 } }, ahora: () => T })
  const job = crearJobVencido(cron, { schedule: { kind: 'interval', minutos: 1440 } })
  T += 1440 * MIN
  await cron.tick()
  assert.ok(cron.obtener(job.id).vigilancia)
  T += 30 * MIN
  await cron.tick()
  assert.equal(cron.obtener(job.id).vigilancia, null, 'al terminar la sesión se limpia la vigilancia')
  const carpeta = path.join(dir, 'cron', 'salida', job.id)
  const eventos = fs.readdirSync(carpeta).filter((n) => n.includes('.vigilancia-'))
  assert.ok(eventos.length >= 1, 'debía anotarse el evento en la salida')
})

// 12 · Saneo del id al escribir salida (job con id no seguro se descarta al cargar).
await prueba('escribirSalida: un id no seguro no se escribe ni se ejecuta', async () => {
  const dir = path.join(raiz, 't12')
  const T = 22_000_000_000_000
  const lan = lanzadorFalso()
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  escribirJobs(dir, [{
    id: '../escape', nombre: 'malo', schedule: { kind: 'interval', minutos: 30 },
    destino: { agente: 'explorador-ds', directory: 'C:/repo/demo' }, prompt: 'x',
    siguiente: T, estado: 'activo', ultimo: null, reintentos: 0, claim: null,
  }])
  await cron.tick()
  assert.equal(lan.launches.length, 0, 'no debía ejecutar un job con id no seguro')
  assert.ok(!fs.existsSync(path.join(dir, 'cron', 'salida')), 'no debía crear carpeta de salida')
})

// 13 · Cron imposible: se rechaza con error claro.
await prueba('cron imposible: se rechaza con error claro', () => {
  const dir = path.join(raiz, 't13')
  const cron = crearCron({ dataDir: dir, lanzador: lanzadorFalso(), ahora: () => Date.parse('2026-06-01T10:00:00') })
  assert.equal(validarCron('0 0 30 2 *'), false) // 30-feb no existe nunca
  assert.equal(validarCron('0 9 * * 1-5'), true)
  const r = cron.crear({ nombre: 'imposible', schedule: { kind: 'cron', expr: '0 0 30 2 *' }, destino: { agente: 'explorador-ds', directory: 'C:/x' }, prompt: 'x' })
  assert.equal(r.ok, false)
  assert.ok(/imposible|nunca/.test(r.error || ''), r.error)
  assert.equal(cron.listar().length, 0)
})

// 14 · DST fall-back: la misma hora local no se ejecuta dos veces.
await prueba('DST fall-back: no se repite la misma hora local', async () => {
  const par = parFallback(2026)
  if (!par) { console.log('      (zona sin DST: prueba omitida)'); return }
  const [a, b] = par
  const dir = path.join(raiz, 't14')
  const T = b
  const lan = lanzadorFalso()
  const cron = crearCron({ dataDir: dir, lanzador: lan, ahora: () => T })
  escribirJobs(dir, [{
    id: 'cron_dst', nombre: 'dst', schedule: { kind: 'cron', expr: '0 2 * * *' },
    destino: { agente: 'explorador-ds', directory: 'C:/repo/demo' }, prompt: 'x',
    siguiente: b, estado: 'activo', ultimo: a, reintentos: 0, claim: null,
  }])
  await cron.tick()
  assert.equal(lan.launches.length, 0, 'no debía repetir la misma hora local')
  assert.ok(cron.obtener('cron_dst').siguiente > T, 'debía adelantar la siguiente ejecución')
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
