/**
 * Métricas de uso del sistema (spec 11) — logs JSONL locales para analizar con una IA.
 *
 * Alcance v1: **hub + OpenCode** (no tokens de Claude). Solo métricas: **nunca** se
 * guarda el texto de prompts, respuestas, comandos ni consultas literales. No hay
 * informe agregado (fuera de alcance): solo el log crudo.
 *
 * `crearMetricas({dirLogs})` devuelve `{registrar, leer, tamano, …}` y escribe en
 * `hub-data/logs/metricas.jsonl`, una línea JSON por evento
 * `{ts (ISO), tipo, proyecto?, ...campos numéricos/etiquetas}`.
 *
 * Reglas de oro:
 *   · **Nunca lanza**: un fallo de escritura se ignora (o va a `logErrores` con
 *     severidad `aviso`).
 *   · **Saneo**: se descartan las claves `prompt`, `texto`, `respuesta`, `contenido`
 *     (y, por defensa, `comando`, `command`, `consulta`) y cualquier campo string de
 *     más de 200 caracteres, en cualquier nivel del objeto.
 *   · **Rotación**: al pasar de `maxBytes` (8 MB por defecto) el fichero se renombra a
 *     `metricas.1.jsonl` (se conserva una sola copia).
 *   · **Idempotencia de `job`**: no se escribe un segundo evento `job` con el mismo
 *     `jobId` (índice rehidratado del disco al arrancar), de modo que un reinicio del
 *     hub no duplica el evento de un job que ya terminó.
 *   · **Poda por retención** (`podar`, 90 días por defecto) al arrancar el hub.
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'

/** Tope de rotación por defecto (8 MB). */
export const MAX_BYTES_DEFECTO = 8 * 1024 * 1024
/** Retención por defecto (días). */
export const RETENCION_DIAS_DEFECTO = 90
/** Longitud máxima de un campo string; por encima, el campo se descarta. */
export const MAX_CARACTERES = 200
/** Claves que NUNCA se guardan (texto libre potencialmente sensible). */
export const CLAVES_PROHIBIDAS = new Set(['prompt', 'texto', 'respuesta', 'contenido', 'comando', 'command', 'consulta'])
/** Tope de eventos devueltos por `leer`. */
export const MAX_LECTURA = 1000
/** Límite por defecto de `leer`. */
const LIMITE_DEFECTO = 200

/** Sanea un valor: strings ≤ 200 chars, números finitos, booleanos, null y objetos. */
function sanearCampo(v) {
  if (v === null) return null
  if (typeof v === 'string') return v.length > MAX_CARACTERES ? undefined : v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    const arr = v.map(sanearCampo).filter((x) => x !== undefined)
    return arr.length ? arr : undefined
  }
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) {
      if (CLAVES_PROHIBIDAS.has(k)) continue
      const l = sanearCampo(x)
      if (l !== undefined) o[k] = l
    }
    return Object.keys(o).length ? o : undefined
  }
  return undefined
}

/** Sanea un evento completo: descarta claves prohibidas y campos demasiado largos. */
function sanearEvento(evento) {
  const salida = {}
  for (const [k, v] of Object.entries(evento)) {
    if (CLAVES_PROHIBIDAS.has(k)) continue
    const limpio = sanearCampo(v)
    if (limpio !== undefined) salida[k] = limpio
  }
  return salida
}

const limiteSano = (limite) => {
  const n = parseInt(limite, 10)
  if (!Number.isFinite(n) || n <= 0) return LIMITE_DEFECTO
  return Math.min(n, MAX_LECTURA)
}

/** Interpreta `desde` como instante (ms) o `null`; acepta número o ISO. */
function instanteDe(desde) {
  if (desde == null || desde === '') return null
  if (typeof desde === 'number') return Number.isFinite(desde) ? desde : null
  const t = Date.parse(String(desde))
  return Number.isFinite(t) ? t : null
}

/**
 * Crea el registro de métricas sobre `dirLogs` (`hub-data/logs/`).
 *
 *   activas       · si es `false`, `registrar` no hace nada (M6).
 *   retencionDias · retención usada por `podar` (90 por defecto).
 *   maxBytes      · umbral de rotación (8 MB por defecto; inyectable en pruebas).
 *   ahora         · reloj inyectable (ms).
 *   logErrores    · registro central (opcional) para el fallo de escritura.
 */
export function crearMetricas({
  dirLogs,
  activas = true,
  retencionDias = RETENCION_DIAS_DEFECTO,
  maxBytes = MAX_BYTES_DEFECTO,
  ahora = () => Date.now(),
  logErrores = null,
} = {}) {
  if (!dirLogs) throw new Error('crearMetricas: falta dirLogs')
  const archivo = path.join(dirLogs, 'metricas.jsonl')
  const rotado = path.join(dirLogs, 'metricas.1.jsonl')
  const topeBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_BYTES_DEFECTO
  let encendidas = activas !== false
  const jobIds = new Set()

  /** Líneas crudas de un fichero (tolerante a ausencia). */
  function lineasDe(f) {
    try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()) } catch { return [] }
  }

  /** Eventos parseados de rotado + actual, en orden de escritura. */
  function eventosCrudos() {
    const out = []
    for (const f of [rotado, archivo]) {
      for (const l of lineasDe(f)) {
        try { const e = JSON.parse(l); if (e && typeof e === 'object') out.push(e) } catch { /* línea rota */ }
      }
    }
    return out
  }

  /** Rehidrata el índice de `job` ya registrados (idempotencia entre reinicios). */
  function hidratarJobs() {
    for (const e of eventosCrudos()) {
      if (e.tipo === 'job' && e.jobId != null) jobIds.add(String(e.jobId))
    }
  }

  /** Escritura atómica tmp+rename (poda); tolera fallos. */
  function escribirAtomico(texto) {
    const escribir = () => {
      const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}`
      try {
        fs.mkdirSync(dirLogs, { recursive: true })
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

  /** Rota el fichero actual a `metricas.1.jsonl` si supera el tope. */
  function rotar() {
    try {
      if (fs.statSync(archivo).size > topeBytes) {
        try { fs.rmSync(rotado, { force: true }) } catch { /* nada */ }
        fs.renameSync(archivo, rotado)
      }
    } catch { /* sin fichero todavía */ }
  }

  /**
   * Registra un evento `{tipo, ...campos}`. Añade `ts` (ISO). Saneado y, para
   * `tipo:'job'`, idempotente por `jobId`. Nunca lanza; devuelve la entrada
   * guardada o `null` (desactivado, evento sin `tipo` o duplicado).
   */
  function registrar(evento = {}) {
    if (!encendidas) return null
    try {
      const tipo = typeof evento?.tipo === 'string' && evento.tipo.trim() ? evento.tipo.trim().slice(0, 60) : null
      if (!tipo) return null
      if (tipo === 'job' && evento.jobId != null && jobIds.has(String(evento.jobId))) return null
      const campos = sanearEvento(evento)
      delete campos.tipo
      delete campos.ts
      const entrada = { ts: new Date(ahora()).toISOString(), tipo, ...campos }
      fs.mkdirSync(dirLogs, { recursive: true })
      rotar()
      fs.appendFileSync(archivo, JSON.stringify(entrada) + '\n')
      if (tipo === 'job' && evento.jobId != null) jobIds.add(String(evento.jobId))
      return entrada
    } catch (e) {
      try { logErrores?.({ origen: 'metricas', severidad: 'aviso', mensaje: `No se pudo escribir una métrica: ${e?.message || e}` }) } catch { /* nada */ }
      return null
    }
  }

  /** Lee los eventos (más recientes primero), filtrando por `tipo` y `desde`. */
  function leer({ desde = null, tipo = null, limite = LIMITE_DEFECTO } = {}) {
    let out = eventosCrudos()
    if (tipo) out = out.filter((e) => e.tipo === tipo)
    const corte = instanteDe(desde)
    if (corte != null) out = out.filter((e) => Number.isFinite(Date.parse(e.ts)) && Date.parse(e.ts) >= corte)
    return out.reverse().slice(0, limiteSano(limite))
  }

  /** Tamaño total (bytes) de `metricas.jsonl` + `metricas.1.jsonl`. */
  function tamano() {
    let bytes = 0
    for (const f of [archivo, rotado]) {
      try { bytes += fs.statSync(f).size } catch { /* no existe */ }
    }
    return bytes
  }

  /** Resumen sin análisis: conteos, rango y tamaño (para `/api/metricas/resumen`). */
  function resumen() {
    const eventos = eventosCrudos()
    const porTipo = {}
    for (const e of eventos) porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1
    const fechas = eventos.map((e) => e.ts).filter((t) => typeof t === 'string').sort()
    return {
      eventos: eventos.length,
      desde: fechas[0] || null,
      hasta: fechas[fechas.length - 1] || null,
      bytes: tamano(),
      porTipo,
    }
  }

  /** Contenido completo del log (rotado + actual) para exportar tal cual. */
  function exportar() {
    return lineasDe(rotado).concat(lineasDe(archivo)).join('\n') + (lineasDe(rotado).length + lineasDe(archivo).length ? '\n' : '')
  }

  /** Poda las líneas más viejas que `retencionDias` (al arrancar el hub, M6). */
  function podar({ retencionDias: dias } = {}) {
    const d = Number.isFinite(Number(dias)) && Number(dias) >= 0 ? Number(dias) : retencionDias
    const corte = ahora() - d * 24 * 60 * 60 * 1000
    let quitados = 0
    let quedan = 0
    for (const f of [archivo, rotado]) {
      const lineas = lineasDe(f)
      if (!lineas.length) continue
      const conservadas = []
      let quitadasFichero = 0
      for (const l of lineas) {
        let e = null
        try { e = JSON.parse(l) } catch { /* línea rota */ }
        const t = e && Number.isFinite(Date.parse(e.ts)) ? Date.parse(e.ts) : NaN
        if (!e || !Number.isFinite(t) || t < corte) { quitadasFichero++; continue }
        conservadas.push(l)
      }
      if (quitadasFichero > 0) {
        quitados += quitadasFichero
        try {
          if (f === archivo) escribirAtomico(conservadas.length ? conservadas.join('\n') + '\n' : '')
          else {
            const texto = conservadas.length ? conservadas.join('\n') + '\n' : ''
            if (texto) fs.writeFileSync(f, texto, 'utf8')
            else fs.rmSync(f, { force: true })
          }
        } catch { /* sin disco */ }
      }
      quedan += conservadas.length
    }
    return { quitados, quedan }
  }

  /** Activa/desactiva el registro en caliente (M7). */
  function activar(v) {
    encendidas = v !== false
    return { activas: encendidas }
  }

  hidratarJobs()

  return { archivo, rotado, registrar, leer, tamano, resumen, exportar, podar, activar, activas: () => encendidas, maxBytes: topeBytes, retencionDias }
}
