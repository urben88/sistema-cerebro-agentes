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
 *   · Modos (`config.aprobaciones.modo`): `manual` (defecto), `inteligente` y `abierto`
 *     (solo bloquea hardline, por decisión explícita del usuario). En `inteligente` un
 *     `peligroso` no se pregunta al usuario: `decision()` devuelve `accion:'guardian'` y el
 *     **cerebro** invoca al guardián (R8, subagente barato) y reporta su veredicto. El hub
 *     no invoca al guardián: solo aplica reglas duras y lleva el circuit-breaker.
 *   · R8 · Circuit-breaker de veredictos (`registrarVeredicto`): `hardline` se rechaza con
 *     cualquier veredicto; `DENEGAR` rechaza y suma una denegación seguida; 3 seguidas abren
 *     el circuito (modo efectivo `manual` hasta que el usuario lo reinicie con
 *     `reiniciarCircuito`); un `APROBAR`/`ESCALAR` reinicia la racha. Cada veredicto se anota
 *     en `hub-data/guardian.jsonl` (últimas 500 líneas, secretos redactados).
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
// R8 · guardián: veredictos admitidos y umbral del circuit-breaker.
const VEREDICTOS = ['APROBAR', 'DENEGAR', 'ESCALAR']
const MAX_DENEGACIONES_SEGUIDAS = 3
const MAX_GUARDIAN_LINEAS = 500

/** Redacta secretos evidentes antes de anotarlos en `guardian.jsonl`. */
const SECRETOS = [
  [/sk-[A-Za-z0-9_-]{6,}/g, 'sk-REDACTADO'],
  [/ghp_[A-Za-z0-9_-]{6,}/g, 'ghp_REDACTADO'],
  [/(Bearer\s+)\S+/gi, '$1REDACTADO'],
  [/(password\s*[=:]\s*)\S+/gi, '$1REDACTADO'],
]
function redactar(texto) {
  let t = String(texto ?? '')
  for (const [re, rep] of SECRETOS) t = t.replace(re, rep)
  return t
}

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
  const archivoGuardian = path.join(dataDir, 'guardian.jsonl')
  const dirPendientes = path.join(dataDir, 'pendientes')

  const reglas = cargarReglas(rutaReglas)

  /** Modo configurado (validado). */
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

  /** Lee el objeto crudo del disco (tolerante); conserva claves ajenas (p. ej. `guardian`). */
  function leerCrudo() {
    let j = {}
    try { j = JSON.parse(fs.readFileSync(archivoAllowlist, 'utf8')) } catch { j = {} }
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  }

  /** Lee el allowlist del disco (tolerante a ausencia o corrupción). */
  function leerAllowlist() {
    const j = leerCrudo()
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
      const cfg = leerCrudo() // objeto completo: conserva `guardian` y ediciones a mano
      const al = leerAllowlist()
      const lista = new Set(al.sesion[sessionId] || [])
      lista.add(p)
      cfg.sesion = {
        ...(cfg.sesion && typeof cfg.sesion === 'object' && !Array.isArray(cfg.sesion) ? cfg.sesion : {}),
        [sessionId]: [...lista],
      }
      escribirAllowlist(cfg)
      return { ok: true, alcance, sessionId, persistido: true }
    }

    const cfg = leerCrudo()
    const al = leerAllowlist()
    const lista = new Set(al.siempre)
    lista.add(p)
    cfg.siempre = [...lista]
    escribirAllowlist(cfg)
    return { ok: true, alcance: 'siempre', persistido: true }
  }

  // -------------------------------------------------------------- R8 · guardián y circuit-breaker

  /** Estado del circuit-breaker, persistido en `aprobaciones.json` → `guardian`. */
  function leerCircuito() {
    const g = leerCrudo()?.guardian
    const src = g && typeof g === 'object' && !Array.isArray(g) ? g : {}
    return {
      denegacionesSeguidas: Number.isInteger(src.denegacionesSeguidas) && src.denegacionesSeguidas >= 0 ? src.denegacionesSeguidas : 0,
      abierto: src.abierto === true,
      desde: typeof src.desde === 'string' ? src.desde : null,
    }
  }

  /** Persiste el circuito con read-merge-write (no pisa el allowlist ni el resto del fichero). */
  function guardarCircuito(circuito) {
    const bruto = leerCrudo()
    bruto.guardian = {
      denegacionesSeguidas: circuito.denegacionesSeguidas,
      abierto: circuito.abierto === true,
      desde: circuito.desde ?? null,
    }
    escribirAllowlist(bruto)
  }

  /** Modo efectivo: en `inteligente` con el circuito abierto, se degrada a `manual`. */
  function modoEfectivo() {
    return modo() === 'inteligente' && leerCircuito().abierto ? 'manual' : modo()
  }

  /** Añade una línea a `guardian.jsonl`, conservando las últimas 500 y redactando secretos. */
  function anotarGuardian(entrada) {
    let lineas = []
    try { lineas = fs.readFileSync(archivoGuardian, 'utf8').split('\n').filter((l) => l.trim()) } catch { lineas = [] }
    let linea = JSON.stringify(entrada)
    if (linea.length > 2000) linea = JSON.stringify({ ...entrada, comando: String(entrada?.comando ?? '').slice(0, 500) + '…[recortado]', motivo: String(entrada?.motivo ?? '').slice(0, 300) })
    lineas.push(linea)
    if (lineas.length > MAX_GUARDIAN_LINEAS) lineas = lineas.slice(-MAX_GUARDIAN_LINEAS)
    const texto = lineas.join('\n') + '\n'
    try {
      fs.mkdirSync(dataDir, { recursive: true })
      const tmp = `${archivoGuardian}.tmp-${process.pid}-${Date.now()}`
      fs.writeFileSync(tmp, texto, 'utf8')
      try { fs.renameSync(tmp, archivoGuardian) } catch { fs.writeFileSync(archivoGuardian, texto, 'utf8'); try { fs.unlinkSync(tmp) } catch { /* nada */ } }
    } catch { /* sin disco */ }
  }

  /** Últimos veredictos anotados en `guardian.jsonl` (más reciente al final). */
  function leerVeredictos(limite = 20) {
    let lineas = []
    try { lineas = fs.readFileSync(archivoGuardian, 'utf8').split('\n').filter((l) => l.trim()) } catch { return [] }
    return lineas.slice(-limite)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  }

  /**
   * R8 · Registra el veredicto del guardián y aplica las reglas duras del hub.
   *   hardline → `rechazar` SIEMPRE (cualquier veredicto, no toca la racha);
   *   `DENEGAR` → `rechazar` y suma una denegación seguida (3 ⇒ circuito abierto);
   *   `ESCALAR` (o veredicto desconocido/ausente) → `preguntar` al usuario y reinicia la racha;
   *   `APROBAR` → solo aprueba si el nivel es `peligroso` y el modo es `inteligente` con el
   *   circuito cerrado; en cualquier otro caso, `preguntar`. Reinicia la racha.
   * Devuelve `{ok, accionFinal, circuito, nivel, veredicto}`.
   */
  function registrarVeredicto({ comando, veredicto, sessionId = null, motivo = '' } = {}) {
    const texto = String(comando ?? '')
    let circuito = leerCircuito()
    if (!texto.trim()) return { ok: false, error: 'falta comando', accionFinal: 'preguntar', circuito }
    const { nivel, motivo: motivoNivel } = clasificar(texto)
    const pedido = String(veredicto ?? '').toUpperCase()
    const v = VEREDICTOS.includes(pedido) ? pedido : 'ESCALAR'
    let accionFinal
    if (nivel === 'hardline') {
      accionFinal = 'rechazar' // el guardián nunca puede aprobar hardline; no altera la racha
    } else if (v === 'DENEGAR') {
      const n = circuito.denegacionesSeguidas + 1
      const abierto = n >= MAX_DENEGACIONES_SEGUIDAS ? true : circuito.abierto
      circuito = { denegacionesSeguidas: n, abierto, desde: abierto && !circuito.abierto ? new Date().toISOString() : (circuito.desde ?? null) }
      guardarCircuito(circuito)
      accionFinal = 'rechazar'
    } else {
      // APROBAR y ESCALAR reinician la racha; solo un APROBAR válido aprueba.
      circuito = { denegacionesSeguidas: 0, abierto: circuito.abierto, desde: circuito.desde ?? null }
      guardarCircuito(circuito)
      const valido = v === 'APROBAR' && nivel === 'peligroso' && modo() === 'inteligente' && !circuito.abierto
      accionFinal = valido ? 'aprobar' : 'preguntar'
    }
    anotarGuardian({
      ts: new Date().toISOString(),
      sessionId: sessionId ? String(sessionId) : null,
      nivel,
      veredicto: v,
      accionFinal,
      motivo: redactar(String(motivo || motivoNivel || '')),
      comando: redactar(texto),
    })
    return { ok: true, accionFinal, circuito, nivel, veredicto: v }
  }

  /** Cierra el circuito (solo el usuario): racha a 0 y `abierto:false`. */
  function reiniciarCircuito() {
    const circuito = { denegacionesSeguidas: 0, abierto: false, desde: null }
    guardarCircuito(circuito)
    return { ok: true, circuito }
  }

  /** ¿La entrada del allowlist cubre el texto? (igualdad, subcadena o regex). */
  function coincidePatron(patron, texto) {
    const t = String(texto ?? '')
    if (!patron) return false
    if (t === patron || t.includes(patron)) return true
    try { return new RegExp(patron, 'i').test(t) } catch { return false }
  }

  /**
   * Decisión completa: `{nivel, motivo, accion, permitidoPorAllowlist, modoEfectivo}`.
   *   hardline → `rechazar` (el allowlist nunca lo salva);
   *   allowlist o `seguro` o modo `abierto` → `aprobar`;
   *   `inteligente` con circuito cerrado y peligroso → `guardian` (lo evalúa el cerebro, R8);
   *   en el resto (manual, o inteligente con circuito abierto) → `preguntar`.
   */
  function decision(texto, { sessionId = null } = {}) {
    const { nivel, motivo } = clasificar(texto)
    const circuito = leerCircuito()
    const efectivo = modo() === 'inteligente' && circuito.abierto ? 'manual' : modo()
    if (nivel === 'hardline') return { nivel, motivo, accion: 'rechazar', permitidoPorAllowlist: false, modoEfectivo: efectivo }
    const al = leerAllowlist()
    const lista = [...al.siempre]
    if (sessionId && Array.isArray(al.sesion[sessionId])) lista.push(...al.sesion[sessionId])
    if (lista.some((p) => coincidePatron(p, texto))) {
      return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: true, modoEfectivo: efectivo }
    }
    if (nivel === 'seguro') return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: false, modoEfectivo: efectivo }
    if (modo() === 'abierto') return { nivel, motivo, accion: 'aprobar', permitidoPorAllowlist: false, modoEfectivo: efectivo }
    if (efectivo === 'manual') {
      return {
        nivel, motivo, accion: 'preguntar', permitidoPorAllowlist: false, modoEfectivo: 'manual',
        ...(modo() === 'inteligente' ? { motivoModo: 'circuito abierto (3 denegaciones seguidas)' } : {}),
      }
    }
    // `inteligente` con circuito cerrado: el cerebro invoca al guardián (R8).
    return { nivel, motivo, accion: 'guardian', permitidoPorAllowlist: false, modoEfectivo: 'inteligente', comando: String(texto ?? ''), circuito }
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

  /** Vista resumida para `GET /api/aprobaciones`: modo + reglas + allowlist + pendientes + guardián. */
  function estado() {
    const resumir = (lista) => lista.map((r) => ({ patron: r.patron, motivo: r.motivo }))
    return {
      modo: modo(),
      modoEfectivo: modoEfectivo(),
      reglas: {
        hardline: resumir(reglas.hardline),
        peligroso: resumir(reglas.peligroso),
        seguro: resumir(reglas.seguro),
        conteos: { hardline: reglas.hardline.length, peligroso: reglas.peligroso.length, seguro: reglas.seguro.length },
      },
      allowlist: leerAllowlist(),
      pendientes: listarPendientes(),
      // R8 · estado del circuit-breaker y últimos veredictos del guardián.
      guardian: { circuito: leerCircuito(), veredictos: leerVeredictos(20) },
    }
  }

  return {
    archivo: archivoAllowlist,
    archivoGuardian,
    reglasPath: rutaReglas,
    clasificar,
    decision,
    registrar,
    modo,
    modoEfectivo,
    leerAllowlist,
    leerCircuito,
    leerVeredictos,
    registrarVeredicto,
    reiniciarCircuito,
    estado,
    encolar,
    listarPendientes,
    resolverPendiente,
  }
}
