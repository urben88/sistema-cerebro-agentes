#!/usr/bin/env node
/**
 * Pruebas de `config/hub/lib/buscar.mjs` (R1 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Sin dependencias: solo `node:assert`. Monta un directorio temporal con datos de
 * ejemplo (memoria, bitácora, checkpoint, decisiones, hallazgos y un skill), indexa
 * con FTS5, comprueba búsqueda con acentos y guiones, snippet, reindexado repetido
 * sin corromper el índice, borrado por reindexado, modo fallback y consultas con
 * operadores raros. Nunca escribe en el `hub-data` real.
 *
 * Uso: node scripts/test-buscar.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearBuscar } from '../config/hub/lib/buscar.mjs'

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

/** Saltos en modo fallback: las pruebas que dependen del índice FTS5 no aplican. */
function omitir(nombre) {
  console.log(`OMITE (fallback) ${nombre}`)
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-buscar-'))
const dataDir = path.join(raiz, 'data')
const memoriaDir = path.join(raiz, 'memoria')
const skillsDir = path.join(raiz, 'skills')
const logsDir = path.join(raiz, 'logs')
const slug = 'demo-abc'
const dirProyecto = path.join(memoriaDir, 'proyectos', slug)

function escribir(archivo, texto) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(archivo, String(texto), 'utf8')
}

const bitacoraA = `# BITÁCORA

## 2026-01-01 09:00 — Configuración inicial
Se ajustó la configuración del proyecto y el token foo-bar del script.

## 2026-01-02 10:30 — Bug del índice
El índice FTS5 troceado por cabeceras funciona correctamente.
`

escribir(path.join(dirProyecto, 'BITACORA.md'), bitacoraA)
escribir(path.join(dirProyecto, 'ESTADO.md'), '# ESTADO\n\nTarea activa: implementar búsqueda con acentos (configuración).\n')
escribir(path.join(dirProyecto, 'CONTEXTO-REPO.md'), '# Contexto\n\nConvención: usar foo-bar en los scripts.\n')
escribir(path.join(dirProyecto, 'checkpoints', '2026-01-02T11-00-00-000Z.md'), '# Checkpoint — demo\n\nNota singular de checkpoint.\n')
escribir(path.join(logsDir, 'decisiones.jsonl'), JSON.stringify({ tarea: 'diseñar índice FTS5', capa: 'opencode', agente: 'implementador', motivo: 'mejor ranking', fecha: '2026-01-02T10:00:00Z' }) + '\n')
escribir(path.join(dataDir, 'hallazgos.jsonl'), JSON.stringify({ id: 'h_x', nombre: 'NousResearch/hermes-agent', url: 'https://github.com/NousResearch/hermes-agent', nota: 'inspiración', estado: 'validado', fecha: '2026-01-02T11:00:00Z' }) + '\n')
escribir(path.join(skillsDir, 'delegar-demo', 'SKILL.md'), '---\nname: delegar-demo\ndescription: demo\n---\n\nBusca hallazgos antes de crear.\n')

const opciones = { dataDir, memoriaDir, skillsDir, logsDir }
const buscar = crearBuscar(opciones)
const enFallback = buscar.modo === 'fallback'

console.log(`=== Pruebas de búsqueda (modo ${buscar.modo}${buscar.motivo ? `: ${buscar.motivo}` : ''}) ===`)
console.log(`Temporal: ${raiz}\n`)

// 1 · Indexado básico.
prueba('reindexar() indexa documentos', () => {
  if (enFallback) return omitir('reindexar() indexa documentos')
  const r = buscar.reindexar()
  assert.equal(r.ok, true)
  assert.ok(r.documentos >= 6, `esperaba >= 6 documentos, obtuve ${r.documentos}`)
})

prueba('busca un término y devuelve el formato esperado', () => {
  const r = buscar.buscar('configuración')
  assert.equal(r.ok, true)
  assert.ok(r.resultados.length >= 1, 'sin resultados para «configuración»')
  const x = r.resultados[0]
  for (const k of ['id', 'proyecto', 'tipo', 'fecha', 'titulo', 'snippet']) assert.ok(k in x, `falta ${k}`)
  assert.equal(x.proyecto, slug)
})

// 2 · Acentos y guiones.
prueba('tolera acentos (sin acento encuentra lo acentuado)', () => {
  const r = buscar.buscar('configuracion')
  assert.ok(r.resultados.length >= 1, 'sin resultados para «configuracion»')
})

prueba('tolera guiones en los términos', () => {
  const r = buscar.buscar('foo-bar')
  assert.ok(r.resultados.length >= 1, 'sin resultados para «foo-bar»')
})

// 3 · Snippet con marcadores.
prueba('devuelve snippet con marcadores >>> <<<', () => {
  const r = buscar.buscar('configuración')
  const x = r.resultados.find((y) => (y.snippet || '').includes('>>>'))
  assert.ok(x, 'ningún resultado trae marcador >>> en el snippet')
  assert.ok(x.snippet.includes('<<<'), 'falta el cierre <<<')
})

// 4 · Reindexado repetido (borrado/alta sin corromper el índice).
prueba('reindexar dos veces no corrompe el índice', () => {
  const antes = buscar.buscar('configuración').resultados.length
  const r = buscar.reindexar()
  assert.equal(r.ok, true)
  const despues = buscar.buscar('configuración').resultados.length
  assert.equal(antes, despues, `antes ${antes} ≠ después ${despues}`)
})

// 5 · Alta/baja sobre el mismo conjunto de filas: quitar una sección de la bitácora.
prueba('indexarProyecto() elimina del índice lo que ya no está', () => {
  escribir(path.join(dirProyecto, 'BITACORA.md'), bitacoraA.split('## 2026-01-02 10:30')[0])
  const r = buscar.indexarProyecto(slug)
  assert.equal(r.ok, true)
  const sobra = buscar.buscar('troceado')
  assert.equal(sobra.resultados.length, 0, `quedaron ${sobra.resultados.length} resultados de la sección borrada`)
  const queda = buscar.buscar('foo-bar')
  assert.ok(queda.resultados.length >= 1, 'la bitácora restante desapareció del índice')
})

// 6 · Filtros.
prueba('filtra por tipo', () => {
  if (enFallback) return omitir('filtra por tipo')
  const r = buscar.buscar('FTS5', { tipo: 'decision' })
  assert.ok(r.resultados.length >= 1, 'sin resultados tipo decision')
  assert.ok(r.resultados.every((x) => x.tipo === 'decision'), 'se colaron tipos distintos')
})

prueba('filtra por proyecto', () => {
  const r = buscar.buscar('configuración', { proyecto: slug })
  assert.ok(r.resultados.every((x) => x.proyecto === slug))
  const vacio = buscar.buscar('configuración', { proyecto: 'otro-proyecto' })
  assert.equal(vacio.resultados.length, 0)
})

// 7 · indexarTodo (reindexado incremental al arrancar).
prueba('indexarTodo() reconstruye sin fallar', () => {
  if (enFallback) return omitir('indexarTodo() reconstruye sin fallar')
  const r = buscar.indexarTodo()
  assert.equal(r.ok, true)
  assert.ok(buscar.buscar('hermes-agent').resultados.length >= 1, 'no encuentra el hallazgo')
})

// 7b · indexarTodo purga lo que ya no existe (por proyecto y en las fuentes globales).
prueba('indexarTodo() purga documentos obsoletos', () => {
  if (enFallback) return omitir('indexarTodo() purga documentos obsoletos')
  // Alta de un checkpoint nuevo → el índice lo ve.
  const cpObsoleto = path.join(dirProyecto, 'checkpoints', 'obsoleto.md')
  escribir(cpObsoleto, '# Checkpoint obsoleto\n\npalabra-unicornio-xyz\n')
  let r = buscar.indexarTodo()
  assert.equal(r.ok, true)
  assert.ok(buscar.buscar('palabra-unicornio-xyz').resultados.length >= 1, 'no indexó el checkpoint nuevo')
  // Baja de la fuente: el fichero desaparece del proyecto y de las fuentes globales.
  fs.rmSync(cpObsoleto)
  fs.rmSync(path.join(dataDir, 'hallazgos.jsonl'))
  r = buscar.indexarTodo()
  assert.equal(r.ok, true)
  assert.equal(buscar.buscar('palabra-unicornio-xyz').resultados.length, 0, 'el checkpoint borrado sigue indexado')
  assert.equal(buscar.buscar('hermes-agent').resultados.length, 0, 'el hallazgo borrado sigue indexado')
})

// 8 · Consultas con operadores raros: nunca deben lanzar excepción.
prueba('consulta con operadores raros no lanza', () => {
  for (const q of ['AND', '"', '*', 'a "b', '-', 'NOT foo OR bar', '""', 'foo*', '(((', 'a AND b NEAR/2 c']) {
    const r = buscar.buscar(q)
    assert.ok(Array.isArray(r.resultados), `«${q}» no devolvió array`)
  }
  const vacia = buscar.buscar('')
  assert.ok(Array.isArray(vacia.resultados))
})

// 9 · Fallback lineal forzado.
prueba('HUB_BUSCAR_FALLBACK=1 usa el recorrido lineal', () => {
  const previo = process.env.HUB_BUSCAR_FALLBACK
  process.env.HUB_BUSCAR_FALLBACK = '1'
  try {
    const fb = crearBuscar(opciones)
    assert.equal(fb.modo, 'fallback')
    const r = fb.buscar('configuracion')
    assert.equal(r.modo, 'fallback')
    assert.ok(r.resultados.length >= 1, 'el fallback no encontró «configuracion»')
    assert.ok(r.resultados.every((x) => x.tipo !== 'decision'), 'el fallback lineal no debe indexar jsonl')
  } finally {
    if (previo === undefined) delete process.env.HUB_BUSCAR_FALLBACK
    else process.env.HUB_BUSCAR_FALLBACK = previo
  }
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
