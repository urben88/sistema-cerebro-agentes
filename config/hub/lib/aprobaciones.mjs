/**
 * Aprobaciones por niveles (R4 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * El hub **clasifica** comandos/peticiones en tres niveles y mantiene su propio
 * allowlist; **no aprueba nada** (resuelve el cerebro, vía MCP). Reglas:
 *
 *   · Niveles (`hardline | peligroso | seguro`) desde `reglas-peligro.json` (regex).
 *     Se evalúa hardline primero; lo que no casa nada es `peligroso` por prudencia
 *     (motivo «sin regla»).
 *   · Modos (`config.aprobaciones.modo`): `manual` (defecto), `inteligente` (hoy ≡
 *     manual) y `abierto` (solo bloquea hardline, por decisión explícita del usuario).
 *   · Allowlist propio en `hub-data/aprobaciones.json`
 *     `{siempre:[…], sesion:{<sessionId>:[…]}}`, escrito con `tmp`+`rename` y
 *     *read-merge-write*: se RELEE el disco justo antes de escribir y solo se añade la
 *     entrada nueva, de modo que lo revocado/añadido a mano no se pierde (trampa de
 *     Hermes: escribir el set en memoria borra lo añadido en disco desde el arranque).
 *   · El allowlist **nunca** salva un `hardline`.
 *   · Cola de pendientes `hub-data/pendientes/{memoria,skills}/<id>.json` con
 *     `{id, resumen, origen, creado, payload}` (la usa R5); tipo e id validados
 *     (sin recorrido de rutas).
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TIPOS_PENDIENTE = ['memoria', 'skills']
const MODOS = ['manual', 'inteligente', 'abierto']
const ALCANCES = ['una_vez', 'sesion', 'siempre']
const ID_SEGURO = /^[A-Za-z0-9_-]+$/

/** Compila una lista de reglas `{patron, motivo}`; un regex inválido queda inerte. */
function compilarLista(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((r) => r && typeof r.patron === 'string' && r.patron)
    .map((r) => {
      let regex = null
      try { regex = new RegExp(r.patron, 'i') } catch { regex = null }
      return { patron: r.patron, motivo: String(r.motivo || ''), regex }
    })
}

/** Carga y compila `reglas-peligro.json`; tolera ausencia o corrupción. */
function cargarReglas(ruta) {
  let j = {}
  try { j = JSON.parse(fs.readFileSync(ruta, 'utf8')) } catch { j = {} }
  return {
    hardline: compilarLista(j.hardline),
    peligroso: compilarLista(j.peligroso),
    seguro: compilarLista(j.seguro),
  }
}

/**
 * Crea el gestor de aprobaciones sobre `dataDir` (`hub-data/`).
 *
 *   config · objeto ya cargado por el hub; `config.aprobaciones.modo` fija el modo.
 *   reglasPath · ruta al JSON de reglas (por defecto, el del propio módulo).
 */
export function crearAprobaciones({ dataDir, reglasPath = null, config = {} } = {}) {
  if (!dataDir) throw new Error('crearAprobaciones: falta dataDir')
  const rutaReglas = reglasPath || path.join(__dirname, 'reglas-peligro.json')
  const archivoAllowlist = path.join(dataDir, 'aprobaciones.json')
  const dirPendientes = path.join(dataDir, 'pendientes')

  const reglas = cargarReglas(rutaReglas)

  /** Modo configurado (validado); `inteligente` se trata como `manual` al decidir. */
  function modo() {
    const m = config?.aprobaciones?.modo
    return MODOS.includes(m) ? m : 'manual'
  }

  /** Clasificación pura: hardline → peligroso → seguro → peligroso («sin regla»). */
  function clasificar(entrada) {
    const t = String(entrada ?? '')
    const hard = reglas.hardline.find((r) => r.regex && r.regex.test(t))
    if (hard) return { nivel: 'hardline', motivo: hard.motivo || hard.patron }
    const peli = reglas.peligroso.find((r) => r.regex && r.regex.test(t))
    if (peli) return { nivel: 'peligroso', motivo: peli.motivo || peli.patron }
    const seg = reglas.seguro.find((r) => r.regex && r.regex.test(t))
    if (seg) return { nivel: 'seguro', motivo: seg.motivo || seg.patron }
    return { nivel: 'peligroso', motivo: 'sin regla' }
  }

  /** Lee el allowlist del disco (tolerante a ausencia o corrupción). */
  function leerAllowlist() {
    let j = {}
    try { j = JSON.parse(fs.readFileSync(archivoAllowlist, 'utf8')) } catch { j = {} }
    const siempre = Array.isArray(j?.siempre) ? j.siempre.filter((x) => typeof x === 'string') : []
    const sesion = {}
    if (j?.sesion && typeof j.sesion === 'object' && !Array.isArray(j.sesion)) {
      for (const [k, v] of Object.entries(j.sesion)) {
        if (Array.isArray(v)) sesion[k] = v.filter((x) => typeof x === 'string')
      }
    }
    return { siempre, sesion }
  }

  /** Escritura atómica tmp+rename, con reintento y relectura de control (bind mounts). */
  function escribirAllowlist(obj) {
    const texto = JSON.stringify(obj, null, 2) + '\n'
    const escribir = () => {
      const tmp = `${archivoAllowlist}.tmp-${process.pid}-${Date.now()}`
      try {
        fs.mkdirSync(dataDir, { recursive: true })
        fs.writeFileSync(tmp, texto, 'utf8')
        fs.renameSync(tmp, archivoAllowlist)
      } catch {
        try { fs.writeFileSync(archivoAllowlist, texto, 'utf8') } catch { /* sin disco */ }
        try { fs.unlinkSync(tmp) } catch { /* nada */ }
      }
    }
    escribir()
    try { if (fs.readFileSync(archivoAllowlist, 'utf8') !== texto) escribir() } catch { escribir() }
  }

  /**
   * Registra un comando/patrón en el allowlist con alcance `una_vez | sesion | siempre`.
   * `una_vez` NO persiste. Relee el disco antes de escribir y solo añade la entrada
   * nueva: lo añadido o revocado a mano en disco no se pierde.
   */
  function registrar(patronOComando, alcance, sessionId = null) {
    const p = String(patronOComando || '').trim()
    if (!p) return { ok: false, error: 'falta comando' }
    if (!ALCANCES.includes(alcance)) return { ok: false, error: 'alcance inválido' }
    if (alcance === 'una_vez') return { ok: true, alcance, persistido: false }

    if (alcance === 'sesion') {
      if (!sessionId) return { ok: false, error: 'falta sessionId' }
      const cfg = leerAllowlist() // relectura del disco: no pisar cambios manuales
      const lista = new Set(cfg.sesion[sessionId] || [])
      lista.add(p)
      cfg.sesion[sessionId] = [...lista]
      escribirAllowlist(cfg)
      return { ok: true, alcance, sessionId, persistido: true }
    }

    const cfg = leerAllowlist()
    const lista = new Set(cfg.siempre)
    lista.add(p)
    cfg.siempre = [...lista]
    escribirAllowlist(cfg)
    return { ok: true, alcance: 'siempre', persistido: true }
  }

  /** ¿La entrada del allowlist cubre el texto? (igualdad, subcadena o regex). */
  function coincidePatron(patron, texto) {
    const t = String(texto ?? '')
    if (!patron) return false
    if (t === patron || t.includes(patron)) return true
    try { return new RegExp(patron, 'i').test(t) } catch { return false }
  }

  /**
   * Decisión completa: `{nivel, motivo, accion, permitidoPorAllowlist}`.
   *   hardline → `rechazar` (el allowlist nunca lo salva);
   *   allowlist o `seguro` o modo `abierto` → `aprobar`;
   *   peligroso en manual/inteligente → `preguntar`.
   */
  function decision(texto, { sessionId = null } = {}) {
    const { nivel, motivo } = clasificar(texto)
    if (nivel === 'hardline') return { nivel, motivo, accion: 'rechazar', permitidoPorAllowlist: false }
    const al = leerAllowlist()
    const lista = [...al.siempre]
    if (sessionId && Array.isArray(al.sesion[sessionId])) lista.push(...al.sesion[sessionId])
    if (lista.some((p) => coincidePatron(p, texto))) {
      return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: true }
    }
    if (nivel === 'seguro') return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: false }
    if (modo() === 'abierto') return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: false }
    return { nivel, motivo, accion: 'preguntar', permitidoPorAllowlist: false }
  }

  const tipoValido = (tipo) => TIPOS_PENDIENTE.includes(tipo)
  const idValido = (id) => typeof id === 'string' && ID_SEGURO.test(id)

  /** Encola un pendiente en `dataDir/pendientes/<tipo>/<id>.json`. */
  function encolar(tipo, { resumen = '', origen = '', payload = null } = {}) {
    if (!tipoValido(tipo)) return { ok: false, error: 'tipo inválido' }
    const textoResumen = String(resumen || '').trim()
    if (!textoResumen) return { ok: false, error: 'falta resumen' }
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const entrada = {
      id,
      resumen: textoResumen.slice(0, 500),
      origen: String(origen || '').slice(0, 200),
      creado: new Date().toISOString(),
      payload: payload ?? null,
    }
    const dir = path.join(dirPendientes, tipo)
    const destino = path.join(dir, `${id}.json`)
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${destino}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify(entrada, null, 2) + '\n', 'utf8')
      try { fs.renameSync(tmp, destino) } catch { fs.writeFileSync(destino, JSON.stringify(entrada, null, 2) + '\n', 'utf8'); try { fs.unlinkSync(tmp) } catch { /* nada */ } }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
    return { ok: true, pendiente: { tipo, ...entrada } }
  }

  /** Lista todos los pendientes (de ambos tipos), más recientes primero. */
  function listarPendientes() {
    const out = []
    for (const tipo of TIPOS_PENDIENTE) {
      let nombres = []
      try { nombres = fs.readdirSync(path.join(dirPendientes, tipo)) } catch { nombres = [] }
      for (const n of nombres) {
        if (!n.endsWith('.json')) continue
        const id = n.slice(0, -5)
        if (!idValido(id)) continue
        try {
          const e = JSON.parse(fs.readFileSync(path.join(dirPendientes, tipo, n), 'utf8'))
          out.push({ tipo, id: typeof e?.id === 'string' ? e.id : id, resumen: e?.resumen || '', origen: e?.origen || '', creado: e?.creado || null, payload: e?.payload ?? null })
        } catch { /* corrupto: se ignora */ }
      }
    }
    return out.sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')))
  }

  /** Resuelve (borra) un pendiente; valida tipo e id (sin recorrido de rutas). */
  function resolverPendiente(tipo, id) {
    if (!tipoValido(tipo)) return { ok: false, error: 'tipo inválido' }
    if (!idValido(id)) return { ok: false, error: 'id inválido' }
    try {
      fs.unlinkSync(path.join(dirPendientes, tipo, `${id}.json`))
      return { ok: true, tipo, id }
    } catch { return { ok: false, error: 'pendiente no encontrado' } }
  }

  /** Vista resumida para `GET /api/aprobaciones`: modo + reglas + allowlist + pendientes. */
  function estado() {
    const resumir = (lista) => lista.map((r) => ({ patron: r.patron, motivo: r.motivo }))
    return {
      modo: modo(),
      reglas: {
        hardline: resumir(reglas.hardline),
        peligroso: resumir(reglas.peligroso),
        seguro: resumir(reglas.seguro),
        conteos: { hardline: reglas.hardline.length, peligroso: reglas.peligroso.length, seguro: reglas.seguro.length },
      },
      allowlist: leerAllowlist(),
      pendientes: listarPendientes(),
    }
  }

  return {
    archivo: archivoAllowlist,
    reglasPath: rutaReglas,
    clasificar,
    decision,
    registrar,
    modo,
    leerAllowlist,
    estado,
    encolar,
    listarPendientes,
    resolverPendiente,
  }
}
