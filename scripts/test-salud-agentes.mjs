#!/usr/bin/env node
/**
 * Pruebas del agente `local-codigo` y su respaldo (spec 12 · `docs/specs/12-agente-local-codigo.md`, L1–L5).
 *
 * Sin dependencias: solo `node:assert`. Monta un ledger falso en memoria e INYECTA el reloj
 * (no toca `hub-data` real). Comprueba:
 *   · L1 · código acotado: «crea la función X en el archivo Y con test» → `local-codigo`,
 *     y depuración/revisión/arquitectura no cambian aunque el texto sea acotado;
 *   · L2/L3 · con 3 fallos seguidos `resolver` degrada a `implementador`; tras el
 *     enfriamiento permite una prueba (`prueba:true`); un acierto limpia y un fallo reabre;
 *   · L3 · sin historial devuelve el agente original; los `cancelado` no cuentan;
 *   · L4 · `decidir` aplica el respaldo, lo explica en `motivo` y lo registra en
 *     `decisiones.jsonl` con `degradado`.
 *
 * Uso: node scripts/test-salud-agentes.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearSaludAgentes } from '../config/hub/lib/salud-agentes.mjs'
import { crearTriaje } from '../config/hub/lib/triaje.mjs'

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

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-salud-'))
const reglas = JSON.parse(fs.readFileSync(new URL('../config/hub/reglas.json', import.meta.url), 'utf8'))
const MINUTO = 60 * 1000

console.log(`=== Pruebas de salud de agentes (spec 12) ===`)
console.log(`Temporal: ${raiz}\n`)

// 1 · L3 · sin historial no se degrada (criterio 1).
await prueba('resolver sin historial devuelve el agente original (`local-codigo`)', () => {
  let T = Date.parse('2026-10-14T10:00:00.000Z')
  const entradas = []
  const salud = crearSaludAgentes({ ledger: { leer: () => entradas }, reglas, ahora: () => T })
  const r = salud.resolver('local-codigo')
  assert.equal(r.agente, 'local-codigo')
  assert.equal(r.degradado, false)
  const e = salud.estado('local-codigo')
  assert.equal(e.muestras, 0)
  assert.equal(e.respaldo, true)
})

// 2 · L2/L3 · degradación, enfriamiento, prueba, acierto y reapertura (criterio 2).
await prueba('3 fallos → degrada; enfriamiento → prueba; éxito limpia; fallo reabre', () => {
  let T = Date.parse('2026-10-14T10:00:00.000Z')
  const entradas = []
  const push = (estado, t) => entradas.push({ agente: 'local-codigo', estado, actualizado: t })
  const salud = crearSaludAgentes({ ledger: { leer: () => entradas }, reglas, ahora: () => T })

  let e = salud.estado('local-codigo')
  assert.equal(e.muestras, 0)

  // 3 fallos seguidos.
  push('fallido', T - 3 * MINUTO)
  push('fallido', T - 2 * MINUTO)
  push('fallido', T - 1 * MINUTO)
  e = salud.estado('local-codigo')
  assert.equal(e.muestras, 3)
  assert.equal(e.tasaFallo, 1)
  assert.equal(e.fallosSeguidos, 3)
  assert.equal(e.degradado, true)
  let r = salud.resolver('local-codigo')
  assert.equal(r.agente, 'implementador')
  assert.equal(r.degradado, true)
  assert.match(r.motivo, /local-codigo degradado a implementador: 3 de 3/)

  // Enfriamiento cumplido → una prueba (sigue siendo local-codigo).
  T += 61 * MINUTO
  r = salud.resolver('local-codigo')
  assert.equal(r.agente, 'local-codigo')
  assert.equal(r.prueba, true)
  assert.equal(r.degradado, false)

  // La prueba acierta: el contador se limpia.
  push('completado', T)
  r = salud.resolver('local-codigo')
  assert.equal(r.agente, 'local-codigo')
  assert.ok(!r.prueba)
  assert.equal(salud.estado('local-codigo').fallosSeguidos, 0)

  // La prueba falla: nuevo enfriamiento (vuelve a degradar).
  push('fallido', T + 1 * MINUTO)
  r = salud.resolver('local-codigo')
  assert.equal(r.agente, 'implementador')
  assert.equal(r.degradado, true)
  assert.ok(r.proximaPrueba > T)
})

// 3 · L3 · los `cancelado` no cuentan como fallos (criterio 3).
await prueba('los trabajos `cancelado` no cuentan como fallos ni muestra', () => {
  const T = Date.parse('2026-10-14T10:00:00.000Z')
  const entradas = [
    { agente: 'local-codigo', estado: 'cancelado', actualizado: T - 3000 },
    { agente: 'local-codigo', estado: 'cancelado', actualizado: T - 2000 },
    { agente: 'local-codigo', estado: 'cancelado', actualizado: T - 1000 },
  ]
  const salud = crearSaludAgentes({ ledger: { leer: () => entradas }, reglas, ahora: () => T })
  const e = salud.estado('local-codigo')
  assert.equal(e.muestras, 0)
  assert.equal(e.degradado, false)
  assert.equal(salud.resolver('local-codigo').agente, 'local-codigo')
})

// 4 · L1 · reglas de reparto (criterio 4).
await prueba('el código acotado enruta a `local-codigo`; depuración/revisión/arquitectura no cambian', () => {
  const triaje = crearTriaje({ reglas, url: 'http://127.0.0.1:1' })
  assert.equal(triaje.clasificarPorReglas('crea la función X en el archivo Y con test').agente, 'local-codigo')
  assert.equal(triaje.clasificarPorReglas('implementa un endpoint nuevo en el servicio').agente, 'implementador')
  assert.equal(triaje.clasificarPorReglas('migración de arquitectura del backend').agente, 'arquitecto')
  assert.equal(triaje.clasificarPorReglas('arregla la función del archivo X').agente, 'debugger')
  assert.equal(triaje.clasificarPorReglas('revisa la función del archivo X').agente, 'revisor')
  // `local-codigo` está en el catálogo de Laya.
  assert.ok(reglas.presupuestos['local-codigo'] === 0)
})

// 5 · L4 · el triaje aplica el respaldo y lo registra (criterio 5).
await prueba('decidir aplica el respaldo: motivo y decisiones.jsonl incluyen `degradado`', async () => {
  const dir = path.join(raiz, 't5')
  const logDecisiones = path.join(dir, 'decisiones.jsonl')
  const resolver = (agente) => agente === 'local-codigo'
    ? { agente: 'implementador', degradado: true, motivo: 'local-codigo degradado a implementador: 3 de 5 fallaron' }
    : { agente, degradado: false }
  const triaje = crearTriaje({ reglas, url: 'http://127.0.0.1:1', logDecisiones, resolver })
  const d = await triaje.decidir({ tarea: 'crea la función X en el archivo Y con test' })
  assert.equal(d.agente, 'implementador')
  assert.equal(d.degradado, true)
  assert.equal(d.agenteOriginal, 'local-codigo')
  assert.match(d.motivo, /degradado a implementador/)
  const lineas = fs.readFileSync(logDecisiones, 'utf8').trim().split('\n').filter(Boolean)
  const ultimo = JSON.parse(lineas[lineas.length - 1])
  assert.equal(ultimo.agente, 'implementador')
  assert.equal(ultimo.degradado, true)
})

// L3 · la prueba tras el enfriamiento es UNA sola (no se concede a varios jobs ni en bucle).
await prueba('la prueba se concede una sola vez y caduca por TTL; los desconocidos no cuentan', () => {
  let T = Date.parse('2026-10-14T10:00:00.000Z')
  const entradas = []
  const push = (estado, t) => entradas.push({ agente: 'local-codigo', estado, actualizado: t })
  push('fallido', T); push('fallido', T + 1000); push('fallido', T + 2000)
  push('desconocido', T + 3000)
  const salud = crearSaludAgentes({ ledger: { leer: () => entradas }, reglas, ahora: () => T })
  T += 61 * MINUTO
  const a = salud.resolver('local-codigo')
  assert.equal(a.prueba, true)
  assert.equal(a.agente, 'local-codigo')
  const b = salud.resolver('local-codigo')
  assert.equal(b.degradado, true, 'segundo job durante la prueba va al respaldo')
  assert.equal(b.agente, 'implementador')
  assert.equal(salud.estado('local-codigo').enPrueba, true)
  T += 11 * MINUTO
  const c = salud.resolver('local-codigo')
  assert.equal(c.prueba, true, 'si la prueba nunca llegó al ledger, tras el TTL se concede otra')
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
