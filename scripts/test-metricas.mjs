#!/usr/bin/env node
/**
 * Pruebas de métricas de uso (spec 11 · `docs/specs/11-metricas-de-uso.md`, M1–M8).
 *
 * Sin dependencias: solo `node:assert`. Monta directorios temporales (nunca toca el
 * `hub-data` real) e INYECTA reloj y umbrales cortos. Comprueba:
 *   · M1 · escritura JSONL (una línea por evento, `ts` ISO) y saneo: se descartan
 *     `prompt`/`texto`/`respuesta`/`contenido`/`comando` y los strings de más de 200
 *     caracteres, en cualquier nivel;
 *   · M1 · rotación a `metricas.1.jsonl` y poda por retención (reloj inyectado);
 *   · M1/M2 · idempotencia del evento `job` por `jobId`, incluso tras «reiniciar»
 *     (segunda instancia sobre el mismo directorio);
 *   · M1 · un fallo de escritura no lanza y avisa a `logErrores` con severidad `aviso`;
 *   · M5 · `leer` (filtros y tope de 1000), `exportar` (rotado + actual; cada línea es
 *     JSON válido) y `resumen` (conteos, rango, bytes, porTipo);
 *   · M6 · con `activas:false` el fichero no crece.
 *
 * Uso: node scripts/test-metricas.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearMetricas, MAX_CARACTERES } from '../config/hub/lib/metricas.mjs'

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

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-metricas-'))
const DIA = 24 * 60 * 60 * 1000
const leerLineas = (dir, f = 'metricas.jsonl') => {
  try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()) } catch { return [] }
}

console.log(`=== Pruebas de métricas de uso ===`)
console.log(`Temporal: ${raiz}\n`)

// 1 · Escritura básica y forma del evento.
prueba('registrar() escribe una línea JSON con ts ISO y campos numéricos/etiquetas', () => {
  const dir = path.join(raiz, 't1')
  const T = Date.parse('2026-10-14T10:00:00.000Z')
  const m = crearMetricas({ dirLogs: dir, ahora: () => T })
  const e = m.registrar({ tipo: 'briefing', proyecto: 'demo', chars: 1234 })
  assert.equal(e.tipo, 'briefing')
  assert.equal(new Date(e.ts).toISOString(), '2026-10-14T10:00:00.000Z')
  const lineas = leerLineas(dir)
  assert.equal(lineas.length, 1)
  const parseado = JSON.parse(lineas[0])
  assert.deepEqual(parseado, { ts: '2026-10-14T10:00:00.000Z', tipo: 'briefing', proyecto: 'demo', chars: 1234 })
  // Sin `tipo` no se escribe nada.
  assert.equal(m.registrar({ proyecto: 'x' }), null)
  assert.equal(leerLineas(dir).length, 1)
})

// 2 · Saneo: claves prohibidas y strings largos, también anidados.
prueba('saneo: descarta prompt/texto/respuesta/contenido/comando y strings > 200', () => {
  const dir = path.join(raiz, 't2')
  const m = crearMetricas({ dirLogs: dir })
  const largo = 'x'.repeat(MAX_CARACTERES + 1)
  m.registrar({
    tipo: 'job',
    jobId: 'j1',
    prompt: 'secreto que no debe guardarse',
    texto: 'tampoco',
    respuesta: 'ni esto',
    contenido: 'ni esto otro',
    comando: 'rm -rf /',
    etiqueta: 'ok',
    largo,
    corto: 'x'.repeat(MAX_CARACTERES),
    tokens: { entrada: 10, salida: 20, razonamiento: null, cache: 5 },
  })
  const e = JSON.parse(leerLineas(dir)[0])
  for (const prohibida of ['prompt', 'texto', 'respuesta', 'contenido', 'comando']) {
    assert.ok(!(prohibida in e), `no debía guardar «${prohibida}»`)
  }
  assert.ok(!('largo' in e), 'un string > 200 debía descartarse')
  assert.equal(e.corto.length, MAX_CARACTERES)
  assert.equal(e.etiqueta, 'ok')
  assert.deepEqual(e.tokens, { entrada: 10, salida: 20, razonamiento: null, cache: 5 })
  // El JSON en disco no contiene la cadena sensible.
  assert.ok(!fs.readFileSync(path.join(dir, 'metricas.jsonl'), 'utf8').includes('secreto'))
})

// 3 · Con activas:false no crece el fichero (M6).
prueba('con activas:false registrar() no escribe nada y el fichero no crece', () => {
  const dir = path.join(raiz, 't3')
  const m = crearMetricas({ dirLogs: dir, activas: false })
  assert.equal(m.registrar({ tipo: 'nudge', estado: 'disparado' }), null)
  assert.equal(leerLineas(dir).length, 0)
  assert.equal(fs.existsSync(path.join(dir, 'metricas.jsonl')), false)
  // Se puede activar en caliente (M7).
  m.activar(true)
  m.registrar({ tipo: 'nudge', estado: 'disparado' })
  assert.equal(leerLineas(dir).length, 1)
})

// 4 · Rotación a metricas.1.jsonl (una sola vez, sin perder eventos).
prueba('rotación: al pasar de maxBytes mueve a metricas.1.jsonl', () => {
  const dir = path.join(raiz, 't4')
  const m = crearMetricas({ dirLogs: dir, maxBytes: 1000 })
  for (let i = 0; i < 12; i++) m.registrar({ tipo: 'busqueda', n: i, relleno: 'z'.repeat(80) })
  assert.ok(fs.existsSync(path.join(dir, 'metricas.1.jsonl')), 'debía existir el rotado')
  const actual = leerLineas(dir).length
  const rotado = leerLineas(dir, 'metricas.1.jsonl').length
  assert.equal(actual + rotado, 12, 'no se debía perder ningún evento con una sola rotación')
  assert.ok(fs.statSync(path.join(dir, 'metricas.jsonl')).size <= 1000, 'el actual debía quedar por debajo del tope')
})

// 5 · Poda por retención (reloj inyectado).
prueba('podar() descarta las líneas más viejas que la retención (90 días)', () => {
  const dir = path.join(raiz, 't5')
  let T = Date.parse('2026-01-01T00:00:00.000Z')
  const m = crearMetricas({ dirLogs: dir, ahora: () => T, retencionDias: 90 })
  m.registrar({ tipo: 'briefing', chars: 10 }) // antiguo
  T = Date.parse('2026-06-01T00:00:00.000Z')
  m.registrar({ tipo: 'briefing', chars: 20 }) // reciente
  assert.equal(leerLineas(dir).length, 2)
  const r = m.podar()
  assert.equal(r.quitados, 1)
  assert.equal(r.quedan, 1)
  const quedan = leerLineas(dir).map((l) => JSON.parse(l))
  assert.equal(quedan[0].chars, 20, 'debía conservar el evento reciente')
})

// 6 · Idempotencia del evento `job` (incluso tras reiniciar).
prueba('job: un solo evento por jobId; no se duplica al recrear la instancia (reinicio)', () => {
  const dir = path.join(raiz, 't6')
  const m1 = crearMetricas({ dirLogs: dir })
  const e = m1.registrar({ tipo: 'job', jobId: 'job_abc', agente: 'implementador', estado: 'completado', coste: 0.02, duracionMs: 1234 })
  assert.ok(e, 'el primer evento debía escribirse')
  assert.equal(m1.registrar({ tipo: 'job', jobId: 'job_abc', estado: 'completado' }), null)
  assert.equal(leerLineas(dir).length, 1)
  // «Reinicio»: otra instancia sobre el mismo directorio rehidrata el índice del disco.
  const m2 = crearMetricas({ dirLogs: dir })
  assert.equal(m2.registrar({ tipo: 'job', jobId: 'job_abc', estado: 'completado' }), null, 'no debía duplicar tras el reinicio')
  assert.equal(leerLineas(dir).length, 1)
  // Otro job sí se registra.
  m2.registrar({ tipo: 'job', jobId: 'job_def', estado: 'fallido' })
  assert.equal(leerLineas(dir).length, 2)
})

// 7 · leer(): filtros por tipo y desde, más reciente primero, tope 1000.
prueba('leer() filtra por tipo/desde, ordena (reciente primero) y tope máximo 1000', () => {
  const dir = path.join(raiz, 't7')
  let T = Date.parse('2026-03-01T00:00:00.000Z')
  const m = crearMetricas({ dirLogs: dir, ahora: () => T })
  m.registrar({ tipo: 'briefing', chars: 1 })
  T += 1000
  m.registrar({ tipo: 'busqueda', ms: 5 })
  T += 1000
  m.registrar({ tipo: 'briefing', chars: 2 })
  const briefings = m.leer({ tipo: 'briefing' })
  assert.equal(briefings.length, 2)
  assert.equal(briefings[0].chars, 2, 'el más reciente va primero')
  const desde = new Date(Date.parse('2026-03-01T00:00:01.000Z')).toISOString()
  assert.equal(m.leer({ desde }).length, 2)
  for (let i = 0; i < 1100; i++) m.registrar({ tipo: 'relleno', i })
  assert.equal(m.leer({ tipo: 'relleno', limite: 5000 }).length, 1000, 'el tope es 1000')
})

// 8 · exportar(): rotado + actual, cada línea JSON válido.
prueba('exportar() devuelve rotado + actual y cada línea parsea como JSON', () => {
  const dir = path.join(raiz, 't8')
  const m = crearMetricas({ dirLogs: dir, maxBytes: 1000 })
  for (let i = 0; i < 12; i++) m.registrar({ tipo: 'cron', id: `c${i}`, relleno: 'z'.repeat(60) })
  assert.ok(fs.existsSync(path.join(dir, 'metricas.1.jsonl')), 'debía haber rotado')
  const texto = m.exportar()
  const lineas = texto.split('\n').filter((l) => l.trim())
  assert.equal(lineas.length, 12, 'el export debía traer rotado + actual')
  for (const l of lineas) JSON.parse(l)
})

// 9 · resumen() y tamano().
prueba('resumen() y tamano() dan conteos, rango, bytes y porTipo', () => {
  const dir = path.join(raiz, 't9')
  let T = Date.parse('2026-05-01T00:00:00.000Z')
  const m = crearMetricas({ dirLogs: dir, ahora: () => T })
  m.registrar({ tipo: 'job', jobId: 'a' })
  T += 1000
  m.registrar({ tipo: 'job', jobId: 'b' })
  T += 1000
  m.registrar({ tipo: 'nudge', estado: 'disparado' })
  const r = m.resumen()
  assert.equal(r.eventos, 3)
  assert.equal(r.porTipo.job, 2)
  assert.equal(r.porTipo.nudge, 1)
  assert.equal(r.desde, '2026-05-01T00:00:00.000Z')
  assert.equal(r.hasta, '2026-05-01T00:00:02.000Z')
  assert.equal(r.bytes, m.tamano())
  assert.ok(r.bytes > 0)
})

// 10 · Un fallo de escritura no lanza y avisa con severidad aviso.
prueba('un fallo de escritura no lanza y reporta un aviso a logErrores', () => {
  const base = path.join(raiz, 't10')
  fs.mkdirSync(base, { recursive: true })
  // `bloqueo` es un FICHERO: crear un subdirectorio dentro falla (ENOTDIR).
  fs.writeFileSync(path.join(base, 'bloqueo'), 'no soy un directorio')
  const avisos = []
  const m = crearMetricas({ dirLogs: path.join(base, 'bloqueo', 'logs'), logErrores: (d) => avisos.push(d) })
  let salida
  assert.doesNotThrow(() => { salida = m.registrar({ tipo: 'briefing', chars: 1 }) })
  assert.equal(salida, null)
  assert.equal(avisos.length, 1)
  assert.equal(avisos[0].severidad, 'aviso')
  assert.equal(avisos[0].origen, 'metricas')
  // Leer/tamaño tampoco lanzan sobre un directorio inexistente.
  assert.deepEqual(m.leer({}), [])
  assert.equal(m.tamano(), 0)
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
