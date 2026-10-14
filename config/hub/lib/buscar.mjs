/**
 * Búsqueda de sesiones y bitácoras (R1 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Índice SQLite FTS5 (`node:sqlite`) en `<dataDir>/indice.db`, con la tabla de
 * contenido `docs(id, proyecto, tipo, fecha, titulo, texto)` y la tabla
 * `docs_fts` external-content mantenida por triggers INSERT/DELETE/UPDATE.
 * Alta y baja operan siempre sobre el mismo conjunto de filas (`docs`): borrar
 * un rowid que nunca se indexó corrompería el índice FTS5 external-content.
 *
 * Si `node:sqlite` no existe (Node < 22.13), existe sin FTS5 (`PRAGMA
 * compile_options`) o se fuerza con `HUB_BUSCAR_FALLBACK=1`, la búsqueda se hace
 * con un recorrido lineal sobre los `.md` (sin ranking) y el hub arranca igual.
 *
 * Fuentes (R1.2): memoria de proyectos (BITACORA.md troceada por cabeceras,
 * ESTADO.md, CONTEXTO-REPO.md y `checkpoints/`), `logs/decisiones.jsonl`,
 * `hallazgos.jsonl` (ruta REAL: `<dataDir>/hallazgos.jsonl`, no `logs/`) y
 * `config/claude/skills/<nombre>/SKILL.md`. El formato de rutas de la memoria se
 * reutiliza de `./memoria.mjs` (no se duplica).
 *
 * Sin dependencias (solo Node >= 22; FTS5 sin flags desde 22.13).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { crearMemoria } from './memoria.mjs'

const require = createRequire(import.meta.url)

/** Tipos válidos de documento (R1.1). */
export const TIPOS = ['bitacora', 'estado', 'contexto', 'checkpoint', 'decision', 'hallazgo', 'skill', 'sesion']

const MAX_CONSULTA = 2048
const LIMITE_DEFECTO = 10
const LIMITE_MAX = 100
const NOMBRES_MEMORIA = { 'BITACORA.md': 'bitacora', 'ESTADO.md': 'estado', 'CONTEXTO-REPO.md': 'contexto' }

// ------------------------------------------------------------------ utilidades

const idDe = (tipo, clave) => `${tipo}:${crypto.createHash('sha1').update(String(clave)).digest('hex').slice(0, 16)}`

const leer = (archivo, max = 200 * 1024) => {
  try { return fs.readFileSync(archivo, 'utf8').slice(0, max) } catch { return null }
}

const mtimeISO = (archivo) => {
  try { return new Date(fs.statSync(archivo).mtimeMs).toISOString() } catch { return '' }
}

const listarMd = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => path.join(dir, e.name))
      .sort()
  } catch { return [] }
}

const listarDirs = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort() }
  catch { return [] }
}

/** Normaliza para el fallback: minúsculas y sin acentos. */
const normalizarTexto = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Título legible de un SKILL.md (frontmatter `name` o primera cabecera). */
function nombreSkill(texto) {
  if (!texto) return null
  const m = /^---\s*[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(texto)
  if (m) return m[1].trim()
  const h = /^#\s+(.+)$/m.exec(texto)
  return h ? h[1].trim() : null
}

/** Trocea BITACORA.md por cabeceras `## YYYY-MM-DD HH:MM — título`. */
function trocearBitacora(texto) {
  const secciones = []
  for (const bloque of String(texto || '').split(/\n(?=## )/)) {
    if (!bloque.startsWith('## ')) continue
    const m = /^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*[—–-]\s*(.*)$/.exec(bloque.split('\n', 1)[0])
    if (!m) continue
    const cuerpo = bloque.split('\n').slice(1).join('\n').trim()
    secciones.push({ fecha: m[1], titulo: m[2].trim() || '(sin título)', texto: cuerpo })
  }
  return secciones
}

// --------------------------------------------------------------- saneado FTS5

/**
 * Sanea la consulta para FTS5: frases entre comillas, sin operadores crudos,
 * máximo 2048 caracteres, tolera guiones y puntos en los términos. Todo término
 * se entrecomilla (las comillas internas se escapan duplicándolas); los tokens
 * sin ninguna letra ni número (`*`, `-`, `"`) se descartan para no romper MATCH.
 */
export function sanearConsulta(q) {
  const texto = String(q ?? '').slice(0, MAX_CONSULTA)
  const tokens = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(texto)) !== null) {
    const bruto = String(m[1] !== undefined ? m[1] : (m[2] || '')).replace(/"/g, ' ').trim()
    if (!bruto) continue
    if (!/[\p{L}\p{N}]/u.test(bruto)) continue
    tokens.push('"' + bruto.replace(/"/g, '""') + '"')
  }
  return tokens.join(' ')
}

// ------------------------------------------------------------- detección sqlite

function detectarSqlite() {
  if (process.env.HUB_BUSCAR_FALLBACK === '1') return { ok: false, motivo: 'HUB_BUSCAR_FALLBACK=1 fuerza el fallback' }
  let DatabaseSync
  try { ({ DatabaseSync } = require('node:sqlite')) } catch (e) { return { ok: false, motivo: `node:sqlite no disponible: ${String(e?.message || e)}` } }
  if (typeof DatabaseSync !== 'function') return { ok: false, motivo: 'node:sqlite no expone DatabaseSync' }
  let db = null
  try {
    db = new DatabaseSync(':memory:')
    const opciones = db.prepare('PRAGMA compile_options').all()
    const tieneFts5 = opciones.some((fila) => Object.values(fila).some((v) => String(v).includes('FTS5')))
    if (!tieneFts5) return { ok: false, motivo: 'node:sqlite sin FTS5 (PRAGMA compile_options)' }
    db.exec('CREATE VIRTUAL TABLE prueba_fts USING fts5(x)')
    return { ok: true, DatabaseSync }
  } catch (e) {
    return { ok: false, motivo: `FTS5 no creable: ${String(e?.message || e)}` }
  } finally {
    try { db?.close() } catch { /* nada */ }
  }
}

// -------------------------------------------------------------------- creación

/**
 * @param {{dataDir:string, memoriaDir:string, skillsDir:string, logsDir:string}} opciones
 */
export function crearBuscar({ dataDir, memoriaDir, skillsDir, logsDir } = {}) {
  if (!dataDir || !memoriaDir) throw new Error('crearBuscar requiere dataDir y memoriaDir')
  const memoria = crearMemoria(memoriaDir)
  const indicePath = path.join(dataDir, 'indice.db')
  const deteccion = detectarSqlite()
  const disponible = deteccion.ok
  const modo = deteccion.ok ? 'fts' : 'fallback'
  let db = null

  // ------------------------------------------------------------------ esquema

  function abrirDb() {
    if (!disponible) return null
    if (db) return db
    fs.mkdirSync(dataDir, { recursive: true })
    db = new deteccion.DatabaseSync(indicePath)
    // Cinturón para escrituras concurrentes (hub y hooks) y WAL si el sistema de
    // ficheros lo permite; si WAL falla se sigue con el journal por defecto.
    try { db.exec('PRAGMA busy_timeout=3000') } catch { /* nada */ }
    try { db.exec('PRAGMA journal_mode=WAL') } catch { /* sigue sin WAL */ }
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        proyecto TEXT,
        tipo TEXT,
        fecha TEXT,
        titulo TEXT,
        texto TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        titulo, texto,
        content='docs', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts(rowid, titulo, texto) VALUES (new.rowid, new.titulo, new.texto);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts(docs_fts, rowid, titulo, texto) VALUES ('delete', old.rowid, old.titulo, old.texto);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
        INSERT INTO docs_fts(docs_fts, rowid, titulo, texto) VALUES ('delete', old.rowid, old.titulo, old.texto);
        INSERT INTO docs_fts(rowid, titulo, texto) VALUES (new.rowid, new.titulo, new.texto);
      END;
    `)
    return db
  }

  /** Alta/baja explícita sobre `docs` (los triggers mantienen `docs_fts`). Sin transacción propia. */
  function insertarDocsSinTx(d, lista) {
    if (!d || !lista.length) return 0
    const borrar = d.prepare('DELETE FROM docs WHERE id = ?')
    const insertar = d.prepare('INSERT INTO docs(id, proyecto, tipo, fecha, titulo, texto) VALUES (?,?,?,?,?,?)')
    for (const doc of lista) {
      borrar.run(doc.id)
      insertar.run(doc.id, doc.proyecto ?? '', doc.tipo ?? '', doc.fecha ?? '', doc.titulo ?? '', doc.texto ?? '')
    }
    return lista.length
  }

  /** Igual que `insertarDocsSinTx` pero envuelto en su propia transacción. */
  function insertarDocs(d, lista) {
    if (!d || !lista.length) return 0
    d.exec('BEGIN')
    try {
      const n = insertarDocsSinTx(d, lista)
      d.exec('COMMIT')
      return n
    } catch (e) {
      try { d.exec('ROLLBACK') } catch { /* nada */ }
      throw e
    }
  }

  // ------------------------------------------------------------- recolección

  function proyectosEnDisco() {
    return listarDirs(memoria.dirProyectos).map((d) => path.basename(d))
  }

  function filaDeArchivo(tipo, proyecto, archivo, titulo) {
    const texto = leer(archivo)
    if (texto === null) return null
    return { id: idDe(tipo, archivo), proyecto, tipo, fecha: mtimeISO(archivo), titulo, texto }
  }

  function recolectarProyecto(slug) {
    const docs = []
    const base = memoria.rutaProyecto(slug)
    const bitacora = memoria.leerBitacora(slug)
    for (const [i, s] of trocearBitacora(bitacora).entries()) {
      docs.push({ id: idDe('bitacora', `${slug}#${i}#${s.fecha}`), proyecto: slug, tipo: 'bitacora', fecha: s.fecha, titulo: s.titulo, texto: s.texto })
    }
    for (const nombre of ['ESTADO.md', 'CONTEXTO-REPO.md']) {
      const tipo = NOMBRES_MEMORIA[nombre]
      const fila = filaDeArchivo(tipo, slug, path.join(base, nombre), `${nombre.replace('.md', '')} — ${slug}`)
      if (fila) docs.push(fila)
    }
    for (const archivo of listarMd(path.join(base, 'checkpoints'))) {
      const fila = filaDeArchivo('checkpoint', slug, archivo, path.basename(archivo))
      if (fila) docs.push(fila)
    }
    return docs
  }

  function recolectarDecisiones() {
    const archivo = path.join(logsDir, 'decisiones.jsonl')
    const texto = leer(archivo)
    if (!texto) return []
    const docs = []
    for (const linea of texto.split('\n')) {
      if (!linea.trim()) continue
      let e
      try { e = JSON.parse(linea) } catch { continue }
      docs.push({
        id: idDe('decision', linea),
        proyecto: e.proyecto || '',
        tipo: 'decision',
        fecha: e.fecha || '',
        titulo: String(e.tarea || 'decisión').slice(0, 200),
        texto: [e.tarea, e.capa, e.agente, e.esfuerzo, e.motivo, e.fuente].filter(Boolean).join(' · '),
      })
    }
    return docs
  }

  function recolectarHallazgos() {
    // Ruta REAL del código (`hub.mjs`: DATA_DIR/hallazgos.jsonl), no `logs/`.
    const archivo = path.join(dataDir, 'hallazgos.jsonl')
    const texto = leer(archivo)
    if (!texto) return []
    const docs = []
    for (const linea of texto.split('\n')) {
      if (!linea.trim()) continue
      let e
      try { e = JSON.parse(linea) } catch { continue }
      docs.push({
        id: idDe('hallazgo', e.id || linea),
        proyecto: e.proyecto || '',
        tipo: 'hallazgo',
        fecha: e.fecha || '',
        titulo: String(e.nombre || 'hallazgo').slice(0, 200),
        texto: [e.nombre, e.url, e.nota, e.estado].filter(Boolean).join(' '),
      })
    }
    return docs
  }

  function recolectarSkills() {
    const docs = []
    for (const dir of listarDirs(skillsDir)) {
      const archivo = path.join(dir, 'SKILL.md')
      if (!fs.existsSync(archivo)) continue
      const texto = leer(archivo)
      if (texto === null) continue
      docs.push({ id: idDe('skill', archivo), proyecto: '', tipo: 'skill', fecha: mtimeISO(archivo), titulo: nombreSkill(texto) || path.basename(dir), texto })
    }
    return docs
  }

  const recolectarGlobales = () => [...recolectarDecisiones(), ...recolectarHallazgos(), ...recolectarSkills()]

  // ------------------------------------------------------------- indexación

  /** Reconstrucción completa del índice. */
  function reindexar() {
    if (!disponible) return { ok: true, modo, motivo: deteccion.motivo, documentos: 0 }
    const d = abrirDb()
    d.exec('DELETE FROM docs')
    const docs = [...proyectosEnDisco().flatMap((slug) => recolectarProyecto(slug)), ...recolectarGlobales()]
    return { ok: true, modo, documentos: insertarDocs(d, docs) }
  }

  /** Indexado incremental de un proyecto (memoria): borra y reinserta en UNA transacción. */
  function indexarProyecto(proyecto) {
    if (!disponible || !proyecto) return { ok: true, modo, documentos: 0 }
    const d = abrirDb()
    const docs = recolectarProyecto(proyecto)
    d.exec('BEGIN')
    try {
      d.prepare('DELETE FROM docs WHERE proyecto = ?').run(proyecto)
      const n = insertarDocsSinTx(d, docs)
      d.exec('COMMIT')
      return { ok: true, modo, documentos: n }
    } catch (e) {
      try { d.exec('ROLLBACK') } catch { /* nada */ }
      return { ok: false, modo, error: String(e?.message || e), documentos: 0 }
    }
  }

  /**
   * Indexado incremental de todas las fuentes (al arrancar el hub). Purga lo
   * obsoleto: por proyecto (memoria que ya no está, igual que `indexarProyecto`)
   * y en las fuentes globales (decisiones/hallazgos/skills que ya no existen).
   */
  function indexarTodo() {
    if (!disponible) return { ok: true, modo, motivo: deteccion.motivo, documentos: 0 }
    const d = abrirDb()
    let documentos = 0
    d.exec('BEGIN')
    try {
      for (const slug of proyectosEnDisco()) {
        d.prepare('DELETE FROM docs WHERE proyecto = ?').run(slug)
        documentos += insertarDocsSinTx(d, recolectarProyecto(slug))
      }
      d.prepare("DELETE FROM docs WHERE tipo IN ('decision','hallazgo','skill')").run()
      documentos += insertarDocsSinTx(d, recolectarGlobales())
      d.exec('COMMIT')
      return { ok: true, modo, documentos }
    } catch (e) {
      try { d.exec('ROLLBACK') } catch { /* nada */ }
      return { ok: false, modo, error: String(e?.message || e), documentos }
    }
  }

  // --------------------------------------------------------------- búsqueda

  const limiteSano = (limite) => Math.max(1, Math.min(LIMITE_MAX, parseInt(limite, 10) || LIMITE_DEFECTO))

  function buscarFts(consulta, { proyecto, limite, tipo }) {
    const match = sanearConsulta(consulta)
    if (!match) return { ok: true, modo: 'fts', resultados: [] }
    const d = abrirDb()
    const condiciones = ['docs_fts MATCH ?']
    const params = [match]
    if (proyecto) { condiciones.push('d.proyecto = ?'); params.push(proyecto) }
    if (tipo && TIPOS.includes(tipo)) { condiciones.push('d.tipo = ?'); params.push(tipo) }
    params.push(limite)
    const sql = `SELECT d.id, d.proyecto, d.tipo, d.fecha, d.titulo,
        snippet(docs_fts, 1, '>>>', '<<<', '…', 40) AS snippet
      FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
      WHERE ${condiciones.join(' AND ')}
      ORDER BY CASE WHEN d.tipo = 'sesion' THEN 1 ELSE 0 END, rank
      LIMIT ?`
    try {
      const filas = d.prepare(sql).all(...params)
      return { ok: true, modo: 'fts', resultados: filas.map((f) => ({ id: f.id, proyecto: f.proyecto, tipo: f.tipo, fecha: f.fecha, titulo: f.titulo, snippet: f.snippet ?? '' })) }
    } catch (e) {
      // No se traga la excepción: se registra el motivo y se cae al fallback lineal.
      const motivo = String(e?.message || e)
      try { console.error(`[buscar] FTS falló; se usa el fallback lineal: ${motivo}`) } catch { /* nada */ }
      return { ...buscarFallback(consulta, { proyecto, limite, tipo }), aviso: motivo }
    }
  }

  function enumerarMd() {
    const out = []
    for (const slug of proyectosEnDisco()) {
      const base = memoria.rutaProyecto(slug)
      for (const nombre of Object.keys(NOMBRES_MEMORIA)) {
        const archivo = path.join(base, nombre)
        if (fs.existsSync(archivo)) out.push({ archivo, proyecto: slug, tipo: NOMBRES_MEMORIA[nombre], titulo: `${nombre.replace('.md', '')} — ${slug}` })
      }
      for (const archivo of listarMd(path.join(base, 'checkpoints'))) out.push({ archivo, proyecto: slug, tipo: 'checkpoint', titulo: path.basename(archivo) })
    }
    for (const dir of listarDirs(skillsDir)) {
      const archivo = path.join(dir, 'SKILL.md')
      if (fs.existsSync(archivo)) out.push({ archivo, proyecto: '', tipo: 'skill', titulo: nombreSkill(leer(archivo)) || path.basename(dir) })
    }
    return out
  }

  function snippetLineal(texto, terminos) {
    const plano = String(texto || '').replace(/\s+/g, ' ').trim()
    const bajo = normalizarTexto(plano)
    let pos = -1
    for (const t of terminos) { const i = bajo.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i }
    if (pos < 0) return plano.slice(0, 160)
    const ini = Math.max(0, pos - 60)
    const fin = Math.min(plano.length, pos + 120)
    const trozo = plano.slice(ini, fin)
    return `${ini > 0 ? '…' : ''}${trozo.replace(/(\S+)/g, (w) => (normalizarTexto(w).includes(terminos[0]) ? `>>>${w}<<<` : w))}${fin < plano.length ? '…' : ''}`
  }

  function buscarFallback(consulta, { proyecto, limite, tipo }) {
    const terminos = normalizarTexto(consulta).split(/\s+/).filter(Boolean)
    const resultados = []
    for (const item of enumerarMd()) {
      if (proyecto && item.proyecto !== proyecto) continue
      if (tipo && TIPOS.includes(tipo) && item.tipo !== tipo) continue
      const texto = leer(item.archivo)
      if (texto === null) continue
      const hay = normalizarTexto(texto)
      if (terminos.length && !terminos.every((t) => hay.includes(t))) continue
      resultados.push({
        id: idDe(item.tipo, item.archivo),
        proyecto: item.proyecto,
        tipo: item.tipo,
        fecha: mtimeISO(item.archivo),
        titulo: item.titulo,
        snippet: terminos.length ? snippetLineal(texto, terminos) : String(texto).replace(/\s+/g, ' ').trim().slice(0, 160),
      })
      if (resultados.length >= limite) break
    }
    return { ok: true, modo: 'fallback', resultados }
  }

  /**
   * Busca en el índice. Devuelve `{ok, modo, resultados}` con resultados
   * `{id, proyecto, tipo, fecha, titulo, snippet}` ordenados por `rank` (FTS) o
   * sin ranking (fallback).
   * @param {string} q
   * @param {{proyecto?:string|null, limite?:number, tipo?:string|null}} opciones
   */
  function buscar(q, { proyecto = null, limite = LIMITE_DEFECTO, tipo = null } = {}) {
    const consulta = String(q ?? '')
    const opciones = { proyecto: proyecto || null, limite: limiteSano(limite), tipo: tipo || null }
    if (!disponible) return buscarFallback(consulta, opciones)
    try { return buscarFts(consulta, opciones) } catch (e) {
      const motivo = String(e?.message || e)
      try { console.error(`[buscar] error de SQLite; se usa el fallback lineal: ${motivo}`) } catch { /* nada */ }
      return { ...buscarFallback(consulta, opciones), aviso: motivo }
    }
  }

  return { buscar, reindexar, indexarProyecto, indexarTodo, modo, disponible, motivo: deteccion.motivo || null, indicePath, tipos: TIPOS }
}
