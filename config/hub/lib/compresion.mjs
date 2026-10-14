/**
 * Resumen propio de contexto (R7 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado. NO sustituye
 * la compactación de Claude Code: cubre las **notas del hub** (bitácoras largas).
 *
 * Cuando `BITACORA.md` supera `bitacora_max_chars` (reglas.json; por defecto 60 000):
 *   1. Trocea por las cabeceras `## YYYY-MM-DD HH:MM — título`, **ignorando** las que
 *      caen dentro de bloques de código cercados (``` … ```): un apunte nunca se parte.
 *   2. Protege los **3 primeros** y los **20 últimos** apuntes (nunca se archivan).
 *   3. Archiva lo intermedio (íntegro, verbatim) en `BITACORA-archivo/<YYYY-MM-DD>-<n>.md`
 *      (carpeta nueva, `tmp`+`rename`). Fail-closed: el archivo se escribe y se VERIFICA
 *      releyéndolo antes de tocar `BITACORA.md`.
 *   4. Poda determinista previa (volcados/código > 1500 chars → `[volcado de N chars
 *      omitido]`, solo para el prompt; el archivo conserva el original).
 *   5. Resumen por `redactor-ds` lanzado con el lanzador (R0: `lanzarJob` + `esperarJob`,
 *      timeout 3 min). El prompt y el resumen que devuelve pasan por `redactarSecretos`.
 *      Si el resumidor falla o no hay OpenCode, **fallback determinista** (anclas locales,
 *      máx. 8000 chars, con secretos redactados).
 *   6. Protocolo anti-carrera: tras obtener el resumen (puede tardar) se RELEE
 *      `BITACORA.md` del disco y se sustituye **solo el tramo exacto archivado** por el
 *      bloque `## Resumen (comprimido <fecha>)`, conservando todo lo demás (apuntes nuevos
 *      añadidos durante la espera incluidos). Si el tramo ya no aparece literal y contiguo
 *      → `{ok:false, motivo:'bitacora_cambio'}` sin modificar nada. La secuencia
 *      relectura→reemplazo→escritura `tmp`+`rename` es **síncrona** (sin `await`).
 *   7. Se conserva VERBATIM lo escrito por el usuario (`Usuario:` / `> `) y las decisiones
 *      marcadas (`**Decisión**` / `DECISIÓN:`); se anexan en una sección «Verbatim».
 *   8. Episódica: máximo UNA compresión por proyecto y por día **LOCAL** (`memoria/
 *      proyectos/<p>/.compresion.json`, `tmp`+`rename` y merge). Si ya se hizo hoy →
 *      `{ok:true, omitido:'ya_comprimido_hoy'}`. `ultima` solo se graba si todo salió bien.
 *   9. Lock en proceso por proyecto: dos compresiones concurrentes del mismo proyecto no
 *      se pisan; la segunda devuelve `{ok:true, omitido:'en_curso'}`.
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import { crearMemoria } from './memoria.mjs'

/** Umbral de volcado/código (chars) que se poda antes de resumir (R7.2). */
export const UMBRAL_VOLCADO = 1500
/** Tope del resumen determinista de respaldo (R7.4). */
export const MAX_FALLBACK = 8000
/** Umbral por defecto de la bitácora (chars) si `reglas.json` no lo trae. */
export const UMBRAL_DEFECTO = 60000
/** Apuntes protegidos (nunca se archivan): los N primeros y los M últimos. */
export const PROTEGIDOS_INICIO = 3
export const PROTEGIDOS_FIN = 20
/** Cabecera de apunte de bitácora (`## YYYY-MM-DD HH:MM — título`). */
const RE_CABECERA = /^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*[—–-]\s*(.*)$/
/** Slug seguro: sin traversal ni separadores (el nombre de carpeta lo usa tal cual). */
const RE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// ------------------------------------------------------------------ utilidades

/**
 * Escritura atómica `tmp`+`rename` con verificación por relectura. **Fail-closed**: si
 * no puede escribir y verificar el contenido exacto, LANZA (nunca deja un archivo a
 * medias silenciosamente). En caso de fallo el original queda intacto (rename atómico).
 */
function escribirAtomico(archivo, texto) {
  const escribir = () => {
    const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    fs.writeFileSync(tmp, texto, 'utf8')
    try { fs.renameSync(tmp, archivo) } catch (e) {
      try { fs.unlinkSync(tmp) } catch { /* nada */ }
      throw e
    }
  }
  escribir()
  if (fs.readFileSync(archivo, 'utf8') !== texto) {
    escribir()
    if (fs.readFileSync(archivo, 'utf8') !== texto) throw new Error('escritura_atomica_no_verificada')
  }
}

/** Fecha **LOCAL** (no UTC) `YYYY-MM-DD` de un instante en ms. */
const fechaDe = (ms) => {
  const d = new Date(ms)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** Lee un JSON tolerando ausencia o corrupción. */
function leerJson(archivo, defecto) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')) } catch { return defecto }
}

/** Redacta secretos habituales (tokens, Bearer, claves api/password=…). */
export function redactarSecretos(texto) {
  return String(texto ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/g, 'sk-***')
    .replace(/\bghp_[A-Za-z0-9]{4,}/g, 'ghp_***')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{4,}/g, 'github_pat_***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/((?:api[_-]?key|apikey|password|passwd|contrase[nñ]a|secret|token)\s*[:=]\s*)\S+/gi, '$1***')
}

/**
 * Poda determinista (R7.2): los bloques de código cercados y los bloques separados
 * por línea en blanco que superen `limite` chars se cortan a un placeholder
 * `[volcado de N chars omitido]`. Se aplica SOLO al texto que va al resumidor; el
 * archivo conserva el original íntegro.
 */
export function podarVolcados(texto, limite = UMBRAL_VOLCADO) {
  let t = String(texto ?? '')
  const poda = (m) => (m.length > limite ? `[volcado de ${m.length} chars omitido]` : m)
  // 1) bloques de código cercados (``` o ~~~).
  t = t.replace(/```[\s\S]*?```/g, poda)
  t = t.replace(/~~~[\s\S]*?~~~/g, poda)
  // 2) bloques (párrafos) separados por línea en blanco.
  t = t.split(/\n{2,}/).map(poda).join('\n\n')
  return t
}

/**
 * Trocea la bitácora conservando el texto exacto. Cada parte empieza en una cabecera
 * `## ` **fuera** de bloque cercado; las cabeceras dentro de ``` … ``` (o ~~~ … ~~~)
 * NO cortan, de modo que ningún apunte queda partido. La concatenación de las partes
 * con `\n` reproduce el texto original exacto.
 */
function trocear(texto) {
  const lineas = String(texto ?? '').split('\n')
  const cortes = [0]
  let enFence = false
  for (let i = 0; i < lineas.length; i++) {
    const limpio = lineas[i].replace(/^\s+/, '')
    if (/^(```|~~~)/.test(limpio)) { enFence = !enFence; continue }
    if (!enFence && i > 0 && /^## /.test(lineas[i])) cortes.push(i)
  }
  const partes = []
  for (let k = 0; k < cortes.length; k++) {
    const hasta = k + 1 < cortes.length ? cortes[k + 1] : lineas.length
    partes.push(lineas.slice(cortes[k], hasta).join('\n'))
  }
  let idx = 0
  return partes.map((texto) => {
    const m = RE_CABECERA.exec(texto.split('\n', 1)[0] || '')
    const esApunte = Boolean(m)
    return { texto, esApunte, apunteIdx: esApunte ? idx++ : -1, fecha: m ? m[1] : null }
  })
}

/** ¿La línea/bloque es VERBATIM del usuario o una decisión marcada? (R7.3) */
function esVerbatim(linea) {
  const l = linea.replace(/^\s+/, '')
  return l.startsWith('Usuario:') || l.startsWith('> ') || /^\*\*Decisi[oó]n\*\*/.test(l) || /^DECISI[OÓ]N:/i.test(l)
}

/** Recolecta las líneas verbatim de un conjunto de bloques, en orden. */
function verbatimDe(bloques) {
  const lineas = []
  for (const b of bloques) {
    for (const linea of String(b).split('\n')) {
      if (esVerbatim(linea)) lineas.push(linea.replace(/\s+$/, ''))
    }
  }
  return lineas.join('\n')
}

/** Resumen determinista de respaldo (R7.4): anclas locales, recortado a 8000 chars. */
export function resumenDeterminista(texto) {
  const lineas = String(texto ?? '').split('\n')
  const usuario = []
  const acciones = []
  const errores = []
  const archivos = new Set()
  const RE_ARCHIVO = /[\w./\\-]+\.(?:mjs|js|json|md|sh|ps1|ts|tsx|py|css|html|yml|yaml|toml)\b/g
  for (const linea of lineas) {
    const l = linea.replace(/\s+$/, '')
    const limpio = l.replace(/^\s+/, '')
    if (!limpio) continue
    if (limpio.startsWith('Usuario:')) usuario.push(l)
    else if (/^[-*]\s+/.test(limpio)) acciones.push(l)
    if (/(error|fallo|falló|excepci[oó]n|traceback|no funciona)/i.test(l)) errores.push(l)
    for (const m of l.matchAll(RE_ARCHIVO)) archivos.add(m[0])
  }
  const secciones = []
  if (usuario.length) secciones.push('## Objetivo', ...usuario.slice(0, 20))
  if (acciones.length) secciones.push('', '## Hecho', ...acciones.slice(0, 40))
  if (errores.length) secciones.push('', '## Bloqueos', ...errores.slice(0, 20))
  if (archivos.size) secciones.push('', '## Archivos relevantes', ...[...archivos].slice(0, 40).map((a) => `- ${a}`))
  const cuerpo = secciones.length ? secciones.join('\n') : '(sin anclas locales)'
  return redactarSecretos(cuerpo).slice(0, MAX_FALLBACK)
}

/** Limpia un posible cercado ```markdown … ``` del texto devuelto por el resumidor. */
function limpiarMarkdown(t) {
  let s = String(t ?? '').trim()
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(s)
  if (m) s = m[1].trim()
  return s
}

// -------------------------------------------------------------------- creación

/**
 * @param {{memoria?:object, memoriaDir?:string, lanzador?:object|null, reglas?:object,
 *   ahora?:()=>number, buscar?:object|null}} opciones
 */
export function crearCompresion({
  memoria = null,
  memoriaDir = null,
  lanzador = null,
  reglas = {},
  ahora = () => Date.now(),
  buscar = null,
} = {}) {
  const mem = memoria || (memoriaDir ? crearMemoria(memoriaDir) : null)
  if (!mem) throw new Error('crearCompresion: falta memoria o memoriaDir')
  const umbral = Number(reglas?.bitacora_max_chars) > 0 ? Number(reglas.bitacora_max_chars) : UMBRAL_DEFECTO
  /** Proyectos con una compresión en curso (lock en proceso). */
  const enCurso = new Set()

  /** Resuelve un slug: acepta un slug existente o un cwd registrado. Rechaza traversal. */
  function resolverSlug(proyecto) {
    const s = String(proyecto ?? '').trim()
    if (!s) return null
    if (/[\\/]/.test(s)) { const p = mem.buscarProyecto(s); return p ? p.slug : null }
    if (!RE_SLUG.test(s) || s.includes('..')) return null
    try { if (fs.existsSync(mem.rutaProyecto(s))) return s } catch { /* nada */ }
    return null
  }

  const rutaBitacora = (slug) => path.join(mem.rutaProyecto(slug), 'BITACORA.md')
  const rutaEstado = (slug) => path.join(mem.rutaProyecto(slug), '.compresion.json')
  const leerBitacora = (slug) => { try { return fs.readFileSync(rutaBitacora(slug), 'utf8') } catch { return '' } }

  /** ¿La bitácora del proyecto supera el umbral? */
  function necesitaComprimir(proyecto) {
    const slug = resolverSlug(proyecto)
    if (!slug) return false
    return leerBitacora(slug).length > umbral
  }

  function estadoCompresion(slug) {
    const estado = leerJson(rutaEstado(slug), {}) || {}
    const chars = leerBitacora(slug).length
    return {
      ok: true, proyecto: slug, chars, umbral,
      necesita: chars > umbral,
      ultima: estado.ultima || null,
      archivado: estado.archivado ?? null,
      modo: estado.modo || null,
    }
  }

  function estado(proyecto) {
    const slug = resolverSlug(proyecto)
    if (!slug) return { ok: false, error: 'proyecto inválido o no registrado' }
    return estadoCompresion(slug)
  }

  /** Construye el prompt para `redactor-ds` (solo markdown, sin escribir ficheros). */
  function promptResumen(textoPodado) {
    return [
      'Eres `redactor-ds`. Resume la bitácora antigua que va al final.',
      'Devuelve **SOLO el markdown** del resumen, sin prólogo ni epílogo, y **no escribas ningún fichero**.',
      'Usa exactamente estas secciones (nivel 2):',
      '## Objetivo',
      '## Restricciones y preferencias',
      '## Hecho',
      '## Estado activo',
      '## Bloqueos',
      '## Decisiones clave',
      '## Archivos relevantes',
      'Omite una sección solo si no hay nada que decir. Sé conciso y fiel a los hechos.',
      '',
      '---',
      redactarSecretos(textoPodado),
    ].join('\n')
  }

  /** Intenta el resumen con `redactor-ds`. Devuelve el markdown (con secretos redactados) o null. */
  async function resumirConRedactor(textoPodado, directory) {
    if (!lanzador || typeof lanzador.lanzarJob !== 'function' || typeof lanzador.esperarJob !== 'function') return null
    try {
      const r = await lanzador.lanzarJob({ agente: 'redactor-ds', directory, prompt: promptResumen(textoPodado), titulo: 'compresion:bitacora' })
      if (!r || r.ok === false || !r.sessionId) return null
      const fin = await lanzador.esperarJob({ sessionId: r.sessionId, directory, timeoutMs: 3 * 60 * 1000 })
      if (!fin || fin.ok === false) return null
      const texto = limpiarMarkdown(fin.texto)
      return texto ? redactarSecretos(texto) : null
    } catch {
      return null
    }
  }

  /** Directorio real del proyecto (registro) para el job; null si no consta. */
  function directorioDe(slug) {
    try {
      const p = mem.proyectos().find((x) => x.slug === slug)
      return p ? p.ruta : null
    } catch { return null }
  }

  /** Escribe el estado episódico (tmp+rename + merge contra el disco). Devuelve éxito. */
  function guardarEstado(slug, datos) {
    try {
      const actual = leerJson(rutaEstado(slug), {}) || {}
      escribirAtomico(rutaEstado(slug), JSON.stringify({ ...actual, ...datos }, null, 2) + '\n')
      return true
    } catch {
      return false
    }
  }

  /** Nombre de archivo libre `BITACORA-archivo/<fecha>-<n>.md`. */
  function rutaArchivoLibre(slug, fecha) {
    const dir = path.join(mem.rutaProyecto(slug), 'BITACORA-archivo')
    let n = 1
    while (fs.existsSync(path.join(dir, `${fecha}-${n}.md`))) n++
    return path.join(dir, `${fecha}-${n}.md`)
  }

  /**
   * Comprime la bitácora de un proyecto.
   * @returns {Promise<{ok:boolean, modo?:'redactor-ds'|'determinista', archivado?:number,
   *   antes?:number, despues?:number, omitido?:string, motivo?:string, error?:string}>}
   */
  async function comprimir(proyecto, { forzar = false } = {}) {
    const slug = resolverSlug(proyecto)
    if (!slug) return { ok: false, error: 'proyecto inválido o no registrado' }
    // Lock en proceso: dos compresiones concurrentes del mismo proyecto no se pisan.
    if (enCurso.has(slug)) return { ok: true, omitido: 'en_curso' }
    enCurso.add(slug)
    try {
      const textoOriginal = leerBitacora(slug)
      const antes = textoOriginal.length
      const t = ahora()
      const fecha = fechaDe(t)

      // Episódica: máximo una compresión por proyecto y día (salvo `forzar`).
      const estadoPrevio = leerJson(rutaEstado(slug), {}) || {}
      if (!forzar && estadoPrevio.ultima === fecha) {
        return { ok: true, omitido: 'ya_comprimido_hoy', antes, despues: antes, archivado: 0 }
      }
      if (!forzar && antes <= umbral) {
        return { ok: true, omitido: 'bajo_umbral', antes, despues: antes, archivado: 0 }
      }

      const items = trocear(textoOriginal)
      const totalApuntes = items.filter((i) => i.esApunte).length
      const archivable = (idx) => totalApuntes > PROTEGIDOS_INICIO + PROTEGIDOS_FIN &&
        idx >= PROTEGIDOS_INICIO && idx < totalApuntes - PROTEGIDOS_FIN
      // Tramo archivado = región CONTIGUA en `items` entre el primer y el último apunte
      // archivable (así el archivo y el texto a sustituir son idénticos y localizables).
      let primero = -1
      let ultimo = -1
      items.forEach((it, i) => {
        if (it.esApunte && archivable(it.apunteIdx)) { if (primero < 0) primero = i; ultimo = i }
      })
      if (primero < 0) return { ok: true, omitido: 'nada_archivable', antes, despues: antes, archivado: 0 }
      const tramoItems = items.slice(primero, ultimo + 1)
      const tramo = tramoItems.map((i) => i.texto).join('\n')
      const nArchivados = tramoItems.filter((i) => i.esApunte).length

      // 1) Archivo con el original ÍNTEGRO del tramo, escrito y VERIFICADO (fail-closed).
      const archivo = rutaArchivoLibre(slug, fecha)
      const contenidoArchivo = tramo.endsWith('\n') ? tramo : tramo + '\n'
      try {
        escribirAtomico(archivo, contenidoArchivo)
        if (fs.readFileSync(archivo, 'utf8') !== contenidoArchivo) throw new Error('archivo_no_coincide')
      } catch {
        return { ok: false, motivo: 'archivo_no_verificado', error: 'no se pudo escribir/verificar BITACORA-archivo', antes, despues: antes, archivado: 0 }
      }

      // 2) Poda determinista y resumen (redactor-ds o fallback). Puede tardar minutos.
      const textoPodado = podarVolcados(tramo)
      let modo = 'redactor-ds'
      let resumen = await resumirConRedactor(textoPodado, directorioDe(slug))
      if (!resumen) { modo = 'determinista'; resumen = resumenDeterminista(textoPodado) }

      const verbatim = redactarSecretos(verbatimDe(tramoItems.map((i) => i.texto)))
      let cuerpo = resumen
      if (verbatim) cuerpo += `\n\n## Verbatim\n\n${verbatim}`
      const bloqueResumen = `## Resumen (comprimido ${fecha})\n${cuerpo}`

      // 3) Protocolo anti-carrera: RELEER el disco y sustituir SOLO el tramo exacto,
      // conservando todo lo demás (apuntes nuevos añadidos durante la espera incluidos).
      // Secuencia síncrona: relectura → reemplazo → escritura tmp+rename (sin await).
      const textoActual = leerBitacora(slug)
      const idx = textoActual.indexOf(tramo)
      if (idx < 0) {
        return { ok: false, motivo: 'bitacora_cambio', error: 'el tramo archivado ya no aparece literal y contiguo en la bitácora', antes, despues: antes, archivado: 0, archivo }
      }
      const nueva = textoActual.slice(0, idx) + bloqueResumen + textoActual.slice(idx + tramo.length)
      try {
        escribirAtomico(rutaBitacora(slug), nueva.endsWith('\n') ? nueva : nueva + '\n')
      } catch {
        return { ok: false, motivo: 'bitacora_no_escrita', error: 'no se pudo escribir BITACORA.md', antes, despues: antes, archivado: 0, archivo }
      }

      // 4) Estado episódico: `ultima` solo si todo salió bien.
      const despues = leerBitacora(slug).length
      guardarEstado(slug, {
        ultima: fecha, ts: t, modo, archivado: nArchivados,
        antes, despues, archivo: path.basename(archivo),
      })

      // 5) Reindexado best-effort (R1) si está disponible.
      try { if (buscar && typeof buscar.indexarProyecto === 'function') buscar.indexarProyecto(slug) } catch { /* nada */ }

      return { ok: true, modo, archivado: nArchivados, antes, despues, archivo }
    } finally {
      enCurso.delete(slug)
    }
  }

  return { umbral, necesitaComprimir, comprimir, estado, resolverSlug, podarVolcados, redactarSecretos }
}
