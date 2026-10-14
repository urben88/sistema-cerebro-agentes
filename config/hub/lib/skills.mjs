/**
 * Skills autogenerados y mejora con el uso (R5 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Un skill se **propone** (queda como pendiente en `pendientes/skills/`, R4.5) y no
 * existe hasta que el usuario lo **aprueba**. Reglas:
 *
 *   · `proponer()` valida el contenido con el linter+guard (`config/hooks/skill-lint.mjs`)
 *     sobre una carpeta temporal y encola el pendiente con el contenido en el `payload`.
 *     Rechaza lo `peligroso` y avisa `duplicado` (R5.6 «una lección = una regla») en
 *     lugar de apilar. **Nunca** escribe en `skillsDir`.
 *   · `aprobar()` relee el pendiente, vuelve a lintar+guardar, escribe
 *     `skillsDir/<nombre>/SKILL.md` (+ `references/`) con `tmp`+`rename` y resuelve el
 *     pendiente; rechaza si el skill ya existe (para eso está `parchear()`).
 *   · Contador de uso `dataDir/skills.usage.json`
 *     `{<nombre>:{uso,visto,parcheado,ultimo_uso}}`, escrito con `tmp`+`rename` y
 *     *read-merge-write*: se RELEE el disco justo antes de escribir para no perder
 *     cambios hechos a mano (misma trampa que el allowlist, R4).
 *   · `contarUsoDeTranscript()` detecta menciones de skills existentes (invocación Skill
 *     tool, `/<nombre>` o `skills/<nombre>`). Limitación: no cuenta usos fuera de Claude
 *     Code (OpenCode, ejecución directa).
 *   · `candidatosArchivo(dias=60)` PROPONE archivar lo sin uso; **nunca borra**.
 *
 * Telemetría fuera de los ficheros del usuario: el contador vive en un sidecar
 * (`skills.usage.json`), nunca en el frontmatter del skill.
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lintSkill, NOMBRE_RE } from '../../hooks/skill-lint.mjs'

const TIPOS_USO = ['uso', 'visto', 'parcheado']

/** Escapa un nombre de skill para usarlo como literal de regex. */
const escaparRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Normaliza texto para el fallback de duplicados: minúsculas y sin acentos. */
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Palabras significativas (≥ 4 letras, sin palabras vacías obvias). */
const VACIAS = new Set(['para', 'como', 'este', 'esta', 'esto', 'con', 'los', 'las', 'una', 'unos', 'unas', 'del', 'que', 'por', 'en', 'de', 'la', 'el', 'y', 'o', 'al', 'se', 'su', 'sus', 'the', 'and', 'with', 'from'])
function palabras(texto) {
  return new Set(normalizar(texto).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VACIAS.has(w)))
}

/** Compone el contenido de `SKILL.md` (frontmatter + cuerpo). */
function componerSKILL(nombre, descripcion, cuerpo) {
  const desc = String(descripcion ?? '').replace(/\r?\n/g, ' ').trim()
  return `---\nname: ${nombre}\ndescription: ${desc}\n---\n\n${String(cuerpo ?? '').replace(/^\s+/, '')}\n`
}

/** Normaliza el mapa de `references/` a `[{ruta, contenido}]` (acepta objeto o lista). */
function normalizarReferencias(referencias) {
  if (!referencias) return []
  if (Array.isArray(referencias)) {
    return referencias
      .filter((r) => r && typeof r.ruta === 'string' && r.ruta.trim() && typeof r.contenido === 'string')
      .map((r) => ({ ruta: r.ruta, contenido: r.contenido }))
  }
  if (typeof referencias === 'object') {
    return Object.entries(referencias)
      .filter(([ruta, contenido]) => typeof ruta === 'string' && ruta.trim() && typeof contenido === 'string')
      .map(([ruta, contenido]) => ({ ruta, contenido }))
  }
  return []
}

/**
 * Valida las rutas de `references/`: solo relativas, sin `..`, sin unidades ni rutas
 * absolutas, y deben quedar bajo `references/`. Devuelve un mensaje de error o null.
 */
function errorReferencias(referencias) {
  const lista = normalizarReferencias(referencias)
  for (const { ruta } of lista) {
    const r = String(ruta).replace(/\\/g, '/')
    if (/^([a-zA-Z]:|\/)/.test(r) || r.split('/').some((seg) => seg === '..' || seg === '')) {
      return `referencia con ruta inválida: ${ruta}`
    }
    if (!r.startsWith('references/')) return `la referencia debe estar bajo references/: ${ruta}`
  }
  return null
}

/**
 * Crea el gestor de skills sobre `dataDir` (`hub-data/`) y `skillsDir`
 * (`CLAUDE_DIR/skills`). `aprobaciones` es la cola de pendientes de R4; `buscar` es
 * opcional (R1, `tipo=skill`) para detectar duplicados.
 */
export function crearSkills({ dataDir, skillsDir, aprobaciones = null, buscar = null } = {}) {
  if (!dataDir) throw new Error('crearSkills: falta dataDir')
  if (!skillsDir) throw new Error('crearSkills: falta skillsDir')
  const archivoUso = path.join(dataDir, 'skills.usage.json')
  const dirPendientesSkills = path.join(dataDir, 'pendientes', 'skills')

  // ------------------------------------------------------------- uso (sidecar)

  /** Lee el contador del disco (tolerante a ausencia o corrupción). */
  function leerUso() {
    let j = {}
    try { j = JSON.parse(fs.readFileSync(archivoUso, 'utf8')) } catch { j = {} }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
    const out = {}
    for (const [nombre, v] of Object.entries(j)) {
      if (!v || typeof v !== 'object') continue
      out[nombre] = {
        uso: Number(v.uso) || 0,
        visto: Number(v.visto) || 0,
        parcheado: Number(v.parcheado) || 0,
        ultimo_uso: typeof v.ultimo_uso === 'string' ? v.ultimo_uso : null,
      }
    }
    return out
  }

  /** Escritura atómica tmp+rename con reintento y relectura de control (bind mounts). */
  function escribirJson(archivo, obj) {
    const texto = JSON.stringify(obj, null, 2) + '\n'
    const escribir = () => {
      const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}`
      try {
        fs.mkdirSync(path.dirname(archivo), { recursive: true })
        fs.writeFileSync(tmp, texto, 'utf8')
        fs.renameSync(tmp, archivo)
      } catch {
        try { fs.writeFileSync(archivo, texto, 'utf8') } catch { /* sin disco */ }
        try { fs.unlinkSync(tmp) } catch { /* nada */ }
      }
    }
    escribir()
    try { if (fs.readFileSync(archivo, 'utf8') !== texto) escribir() } catch { escribir() }
  }

  /**
   * Registra uso de un skill (`uso | visto | parcheado`). Relee el disco antes de
   * escribir y solo modifica la entrada del skill: lo editado a mano no se pierde.
   */
  function registrarUso(nombre, tipo = 'uso', veces = 1) {
    if (typeof nombre !== 'string' || !NOMBRE_RE.test(nombre)) return { ok: false, error: 'nombre inválido' }
    if (!TIPOS_USO.includes(tipo)) return { ok: false, error: `tipo inválido; válidos: ${TIPOS_USO.join(', ')}` }
    const n = Math.max(1, parseInt(veces, 10) || 1)
    const todos = leerUso() // relectura del disco: no pisar cambios manuales
    const previo = todos[nombre] || { uso: 0, visto: 0, parcheado: 0, ultimo_uso: null }
    previo[tipo] = (Number(previo[tipo]) || 0) + n
    previo.ultimo_uso = new Date().toISOString()
    todos[nombre] = previo
    escribirJson(archivoUso, todos)
    return { ok: true, entrada: { ...previo } }
  }

  // ------------------------------------------------------------- skills en disco

  /** Nombres de los skills instalados (subcarpetas de `skillsDir`). */
  function listarSkills() {
    try {
      return fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && NOMBRE_RE.test(e.name))
        .map((e) => e.name)
        .sort()
    } catch { return [] }
  }

  /**
   * Menciones de skills existentes en un transcript: invocación Skill tool
   * (`"skill":"<nombre>"`), comando `/<nombre>` o ruta `skills/<nombre>`.
   * Devuelve `{<nombre>: conteo}`.
   */
  function contarUsoDeTranscript(texto) {
    const t = String(texto ?? '')
    const conteos = {}
    for (const nombre of listarSkills()) {
      const esc = escaparRe(nombre)
      const re = new RegExp(`skills/${esc}(?![a-z0-9_-])|"skill"\\s*:\\s*"${esc}"(?![a-z0-9_-])|/${esc}(?![a-z0-9_-])`, 'gi')
      const m = t.match(re)
      if (m && m.length) conteos[nombre] = m.length
    }
    return conteos
  }

  /** Skills sin uso en `dias` (propone, NUNCA borra). */
  function candidatosArchivo(dias = 60) {
    const d = Math.max(1, parseInt(dias, 10) || 60)
    const limite = Date.now() - d * 24 * 60 * 60 * 1000
    const uso = leerUso()
    const out = []
    for (const nombre of listarSkills()) {
      const u = uso[nombre]
      const ultimo = u?.ultimo_uso ? Date.parse(u.ultimo_uso) : null
      const tieneUso = u && (u.uso + u.visto + u.parcheado) > 0
      if (!tieneUso || !ultimo || Number.isNaN(ultimo) || ultimo < limite) {
        out.push({ nombre, ultimo_uso: u?.ultimo_uso || null, uso: u?.uso || 0 })
      }
    }
    return out
  }

  // ------------------------------------------------------------- duplicados

  /** Candidato por similitud de palabras contra nombre+descripción de los skills. */
  function duplicadoPorPalabras(texto) {
    const tokens = palabras(texto)
    if (tokens.size === 0) return null
    let mejor = null
    for (const nombre of listarSkills()) {
      let contenido = ''
      try { contenido = fs.readFileSync(path.join(skillsDir, nombre, 'SKILL.md'), 'utf8') } catch { continue }
      const tokensSkill = palabras(`${nombre} ${contenido}`)
      let compartidas = 0
      for (const w of tokens) if (tokensSkill.has(w)) compartidas++
      const base = Math.min(tokens.size, tokensSkill.size) || 1
      const similitud = compartidas / base
      if (compartidas >= 3 && similitud >= 0.5 && (!mejor || similitud > mejor.similitud)) {
        mejor = { nombre, similitud: Number(similitud.toFixed(2)), motivo: 'similitud de palabras' }
      }
    }
    return mejor
  }

  /**
   * Busca un skill duplicado de `texto`: usa R1 (`buscar` con `tipo=skill`) si está
   * disponible; si no, cae al fallback por similitud de palabras. Devuelve el candidato
   * `{nombre, …}` o `null`.
   */
  function duplicado(texto) {
    const t = String(texto ?? '').trim()
    if (!t) return null
    if (buscar && typeof buscar.buscar === 'function') {
      try {
        const r = buscar.buscar(t, { tipo: 'skill', limite: 3 })
        const resultados = (r && r.resultados) || []
        if (resultados.length) {
          const primero = resultados[0]
          return { nombre: primero.titulo || null, id: primero.id || null, snippet: primero.snippet || '', fuente: 'buscar' }
        }
        return null
      } catch { /* cae al fallback */ }
    }
    return duplicadoPorPalabras(t)
  }

  // ------------------------------------------------------------- pendientes

  /** Pendientes de tipo `skills` (los gestiona la cola de R4). */
  function pendientes() {
    if (!aprobaciones) return []
    try { return aprobaciones.listarPendientes().filter((p) => p.tipo === 'skills') } catch { return [] }
  }

  /** Lee un pendiente concreto de skills por id. */
  function leerPendiente(id) {
    return pendientes().find((p) => p.id === id) || null
  }

  // ------------------------------------------------------------- validación

  /** Escribe el skill propuesto en una carpeta temporal y lo linta+guarda. */
  function escribirTemporal(payload) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-prop-'))
    const dir = path.join(raiz, payload.nombre)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), componerSKILL(payload.nombre, payload.descripcion, payload.cuerpo), 'utf8')
    for (const { ruta, contenido } of normalizarReferencias(payload.referencias)) {
      const destino = path.join(dir, ruta)
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, contenido, 'utf8')
    }
    return { raiz, dir }
  }

  function limpiarTemporal(raiz) {
    try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
  }

  // ------------------------------------------------------------- API pública

  /**
   * Propone un skill: valida con lint+guard sobre una carpeta temporal (nunca escribe
   * en `skillsDir`) y lo encola en `pendientes/skills`. Rechaza lo peligroso; si detecta
   * un duplicado, devuelve `aviso: 'duplicado'` con el nombre en lugar de apilar.
   */
  function proponer({ nombre, descripcion, cuerpo, origen = 'cerebro', referencias = null } = {}) {
    if (typeof nombre !== 'string' || !NOMBRE_RE.test(nombre)) return { ok: false, error: `nombre inválido: usa ${NOMBRE_RE}` }
    if (typeof descripcion !== 'string' || !descripcion.trim()) return { ok: false, error: 'falta descripcion' }
    if (typeof cuerpo !== 'string' || !cuerpo.trim()) return { ok: false, error: 'falta cuerpo' }
    const payload = { nombre, descripcion: descripcion.trim(), cuerpo, referencias: referencias || null }
    const errRef = errorReferencias(payload.referencias)
    if (errRef) return { ok: false, error: errRef }

    const { raiz, dir } = escribirTemporal(payload)
    let lint
    try { lint = lintSkill(dir) } finally { limpiarTemporal(raiz) }
    if (!lint.ok) {
      return { ok: false, error: 'no pasa el linter', problemas: lint.problemas, guard: lint.guard }
    }

    const dup = duplicado(`${nombre} ${payload.descripcion} ${cuerpo}`)
    if (dup && dup.nombre) return { ok: true, aviso: 'duplicado', duplicado: dup.nombre }

    if (!aprobaciones) return { ok: false, error: 'sin cola de aprobaciones' }
    const r = aprobaciones.encolar('skills', {
      resumen: `Skill propuesto: ${nombre}`,
      origen,
      payload,
    })
    if (!r.ok) return r
    return { ok: true, aviso: null, pendiente: r.pendiente }
  }

  /**
   * Aprueba un skill propuesto: relee el pendiente, vuelve a lintar+guardar, escribe
   * `skillsDir/<nombre>/SKILL.md` (+ `references/`) con tmp+rename y resuelve el pendiente.
   * Rechaza si el skill ya existe (usa `parchear`).
   */
  function aprobar(id) {
    if (!aprobaciones) return { ok: false, error: 'sin cola de aprobaciones' }
    const pend = leerPendiente(id)
    if (!pend) return { ok: false, error: 'pendiente no encontrado' }
    const p = pend.payload || {}
    if (typeof p.nombre !== 'string' || !NOMBRE_RE.test(p.nombre)) return { ok: false, error: 'payload inválido: nombre' }
    if (typeof p.cuerpo !== 'string' || !p.cuerpo.trim()) return { ok: false, error: 'payload inválido: cuerpo' }

    const destino = path.join(skillsDir, p.nombre)
    if (fs.existsSync(destino)) return { ok: false, error: `el skill «${p.nombre}» ya existe; usa parchear` }

    const payload = { nombre: p.nombre, descripcion: String(p.descripcion || ''), cuerpo: p.cuerpo, referencias: p.referencias || null }
    const errRef = errorReferencias(payload.referencias)
    if (errRef) return { ok: false, error: errRef }
    const { raiz, dir } = escribirTemporal(payload)
    let lint
    try { lint = lintSkill(dir) } finally { limpiarTemporal(raiz) }
    if (!lint.ok) {
      return { ok: false, error: 'no pasa el linter al aprobar', problemas: lint.problemas, guard: lint.guard }
    }

    try { fs.mkdirSync(destino, { recursive: true }) } catch { /* best effort */ }

    // SKILL.md y references con tmp+rename (texto plano, no JSON).
    const escribirTexto = (archivo, contenido) => {
      const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}`
      fs.mkdirSync(path.dirname(archivo), { recursive: true })
      fs.writeFileSync(tmp, contenido, 'utf8')
      try { fs.renameSync(tmp, archivo) } catch { fs.writeFileSync(archivo, contenido, 'utf8'); try { fs.unlinkSync(tmp) } catch { /* nada */ } }
    }
    escribirTexto(path.join(destino, 'SKILL.md'), componerSKILL(p.nombre, payload.descripcion, payload.cuerpo))
    for (const { ruta, contenido } of normalizarReferencias(payload.referencias)) {
      escribirTexto(path.join(destino, ruta), contenido)
    }

    aprobaciones.resolverPendiente('skills', id)
    return { ok: true, skill: { nombre: p.nombre, ruta: path.join(destino, 'SKILL.md') } }
  }

  /** Rechaza (descarta) un skill propuesto. */
  function rechazar(id) {
    if (!aprobaciones) return { ok: false, error: 'sin cola de aprobaciones' }
    return aprobaciones.resolverPendiente('skills', id)
  }

  /**
   * Parchea un skill existente (lo usa `aprobar` cuando ya existe): vuelve a validar y
   * reescribe `SKILL.md` (+ `references/`) con tmp+rename, y anota `parcheado`.
   */
  function parchear(nombre, { descripcion, cuerpo, referencias = null } = {}) {
    if (typeof nombre !== 'string' || !NOMBRE_RE.test(nombre)) return { ok: false, error: 'nombre inválido' }
    if (typeof descripcion !== 'string' || !descripcion.trim()) return { ok: false, error: 'falta descripcion' }
    if (typeof cuerpo !== 'string' || !cuerpo.trim()) return { ok: false, error: 'falta cuerpo' }
    const destino = path.join(skillsDir, nombre)
    if (!fs.existsSync(path.join(destino, 'SKILL.md'))) return { ok: false, error: 'el skill no existe' }

    const payload = { nombre, descripcion: descripcion.trim(), cuerpo, referencias: referencias || null }
    const errRef = errorReferencias(payload.referencias)
    if (errRef) return { ok: false, error: errRef }
    const { raiz, dir } = escribirTemporal(payload)
    let lint
    try { lint = lintSkill(dir) } finally { limpiarTemporal(raiz) }
    if (!lint.ok) return { ok: false, error: 'no pasa el linter', problemas: lint.problemas, guard: lint.guard }

    const escribirTexto = (archivo, contenido) => {
      const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}`
      fs.mkdirSync(path.dirname(archivo), { recursive: true })
      fs.writeFileSync(tmp, contenido, 'utf8')
      try { fs.renameSync(tmp, archivo) } catch { fs.writeFileSync(archivo, contenido, 'utf8'); try { fs.unlinkSync(tmp) } catch { /* nada */ } }
    }
    escribirTexto(path.join(destino, 'SKILL.md'), componerSKILL(nombre, payload.descripcion, payload.cuerpo))
    for (const { ruta, contenido } of normalizarReferencias(payload.referencias)) {
      escribirTexto(path.join(destino, ruta), contenido)
    }
    registrarUso(nombre, 'parcheado')
    return { ok: true, skill: { nombre, ruta: path.join(destino, 'SKILL.md') } }
  }

  return {
    archivoUso,
    dirPendientesSkills,
    proponer,
    aprobar,
    rechazar,
    parchear,
    registrarUso,
    leerUso,
    listarSkills,
    contarUsoDeTranscript,
    candidatosArchivo,
    duplicado,
    pendientes,
  }
}
