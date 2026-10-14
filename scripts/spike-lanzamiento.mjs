#!/usr/bin/env node
/**
 * Spike R0 · lanzamiento de un job por la API HTTP V1 + comprobación de FTS5.
 *
 * Verifica el criterio CA0 de `docs/specs/10-patrones-de-hermes.md`:
 *   (a) el hub crea una sesión y envía un mensaje con `agente` y `directory`
 *       por la API V1 del servidor OpenCode;
 *   (b) la respuesta del job se lee y contiene «PONG»;
 *   (c) el Node local trae FTS5 (`PRAGMA compile_options` + CREATE VIRTUAL TABLE).
 *
 * Sale con código 0 solo si los tres puntos pasan. Sin dependencias.
 * Uso: node scripts/spike-lanzamiento.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lanzarJob, esperarJob } from '../config/hub/lib/lanzador.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AGENTE = 'explorador-ds'
const PROMPT = 'Responde solo con la palabra PONG'
const TIMEOUT_ESPERA_MS = 120000

const resultados = []
const punto = (etiqueta, ok, detalle) => {
  resultados.push(ok)
  console.log(`${ok ? 'PASA' : 'FALLA'}  ${etiqueta}`)
  if (detalle) console.log(`      ${detalle}`)
}

console.log('=== Spike R0 · lanzamiento por API V1 + FTS5 ===')
console.log(`Directorio: ${REPO}`)
console.log(`Agente: ${AGENTE}\n`)

// (a) Lanzar el job (crear sesión + enviar mensaje sin esperar).
let lanzado = null
try {
  lanzado = await lanzarJob({ agente: AGENTE, directory: REPO, prompt: PROMPT, titulo: 'R0 spike de lanzamiento' })
} catch (e) {
  // `lanzarJob` nunca debería lanzar; si lo hace, se documenta tal cual.
  lanzado = { ok: false, codigo: 'excepcion_no_capturada', error: String(e?.stack || e) }
}

if (lanzado.ok) {
  punto('(a) Lanzar job (crear sesión + enviar mensaje)', true, `sessionId=${lanzado.sessionId} messageId=${lanzado.messageId}`)
} else {
  punto('(a) Lanzar job (crear sesión + enviar mensaje)', false, `codigo=${lanzado.codigo} error=${lanzado.error}`)
}

// (b) Esperar y comprobar la respuesta.
if (lanzado.ok) {
  const esperado = await esperarJob({ sessionId: lanzado.sessionId, directory: REPO, timeoutMs: TIMEOUT_ESPERA_MS })
  if (!esperado.ok) {
    punto('(b) Respuesta contiene PONG', false, `codigo=${esperado.codigo} error=${esperado.error}`)
  } else {
    const tienePong = /\bPONG\b/.test(esperado.texto || '')
    punto('(b) Respuesta contiene PONG', tienePong, `estado=${esperado.estado} coste=${esperado.coste} texto=${JSON.stringify((esperado.texto || '').trim().slice(0, 120))}`)
  }
} else {
  punto('(b) Respuesta contiene PONG', false, 'no evaluable: el punto (a) falló')
}

// (c) FTS5 en el Node local.
try {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  const opciones = db.prepare('PRAGMA compile_options').all()
  const tieneFts5 = opciones.some((fila) => Object.values(fila).some((v) => String(v).includes('FTS5')))
  let creable = true
  let motivo = ''
  try {
    db.exec('CREATE VIRTUAL TABLE prueba USING fts5(texto)')
    db.exec("INSERT INTO prueba(texto) VALUES('hola mundo')")
    const r = db.prepare("SELECT texto FROM prueba WHERE prueba MATCH 'hola'").all()
    creable = r.length === 1
    if (!creable) motivo = 'la búsqueda MATCH no devolvió resultados'
  } catch (e) {
    creable = false
    motivo = `CREATE/MATCH fts5 falló: ${e.message}`
  }
  punto('(c) FTS5 en node:sqlite', tieneFts5 && creable,
    `PRAGMA compile_options FTS5=${tieneFts5} · CREATE VIRTUAL TABLE fts5=${creable}${motivo ? ' · ' + motivo : ''}`)
} catch (e) {
  punto('(c) FTS5 en node:sqlite', false, `node:sqlite no disponible: ${e.message}`)
}

const todoPasa = resultados.every(Boolean)
console.log(`\nResultado: ${todoPasa ? 'PASA' : 'FALLA'}`)
process.exit(todoPasa ? 0 : 1)
