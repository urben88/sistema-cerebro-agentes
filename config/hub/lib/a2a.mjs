/**
 * Mediador A2A-lite del hub (spec 14 · `docs/specs/14-comunicacion-entre-agentes-y-reparto.md`).
 *
 * Los agentes NO se hablan entre sí: todo mensaje pasa por el hub, que impone límites,
 * deja rastro y evita cadenas. Se deja el formato compatible con A2A (Agent Card) por si
 * algún día se quiere interoperar, pero no hay servidores A2A reales.
 *
 *   · C1 · `directorio()`  → Agent Card ligera de cada agente del catálogo (frontmatter de
 *                            `config/opencode/agents/*.md` y `config/claude/agents/*.md` +
 *                            `reglas.json` + salud del ledger).
 *   · C2 · `consultar()`   → consulta síncrona mediada a un agente de LECTURA por el
 *                            `lanzador` (API V1): prompt acotado, tope de coste, timeout,
 *                            profundidad 1 y límite de concurrencia; deja job en el ledger
 *                            y evento `a2a` en métricas (sin texto).
 *   · C3 · buzón asíncrono por tarea en `hub-data/a2a.json` (read-merge-write): estados
 *          `pendiente|respondido|expirado`, TTL 30 min y máx. 20 pendientes por destinatario.
 *   · C4 · registra la decisión de triaje (`decisiones.jsonl`) cuando no hay una reciente
 *          para el mismo encargo.
 *   · C5 · `reparto()` agrega ledger + métricas (spec 11) + decisiones.
 *
 * Sin dependencias (Node >= 22). El lanzador, el ledger, las métricas y la salud se
 * inyectan para poder probar sin servidores ni jobs reales.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Respuesta máxima devuelta por una consulta (con «…» si se recorta). */
export const RESPUESTA_MAX = 1200
/** Longitud máxima de la pregunta de una consulta. */
export const PREGUNTA_MAX = 2000
/** Longitud máxima del cuerpo de un mensaje del buzón. */
export const CUERPO_MAX = 1200
/** Máximo de consultas en curso simultáneas (409 al superarlo). */
export const CONSULTAS_MAX = 3
/** Timeout por defecto de una consulta (120 s). */
export const TIMEOUT_DEFECTO = 120 * 1000
/** TTL del buzón: un mensaje pendiente caduca a los 30 min. */
export const TTL_MENSAJE = 30 * 60 * 1000
/** Máximo de mensajes pendientes por destinatario (429 al superarlo). */
export const MAX_PENDIENTES = 20
/** Ventana de frescura de la decisión de triaje (no se repite antes de 10 min). */
export const VENTANA_TRIAJE = 10 * 60 * 1000
/** Ventana para considerar que un job tuvo una decisión de triaje previa (C5). */
const VENTANA_TRIAJE_PREVIO = 30 * 60 * 1000

/** Agentes a los que SÍ se puede consultar (solo lectura; imposible que escriban código). */
export const SOLO_LECTURA = new Set(['explorador-ds', 'revisor', 'testeador', 'redactor-ds'])

/** Instrucción fija que se antepone a todo encargo mediado. */
const INSTRUCCION = 'Responde en ≤ 10 líneas, solo hechos y rutas, sin código largo.\n\n'

/** Tipos de mensaje válidos del buzón. */
export const TIPOS_MENSAJE = ['aviso', 'pregunta', 'resultado']

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number(v) || 0))
const textoCorto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Recorta a `max` caracteres añadiendo «…` si hace falta (garantiza ≤ max). */
export function recortar(texto, max = RESPUESTA_MAX) {
  const t = typeof texto === 'string' ? texto : ''
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)) + '…'
}

/** Extrae el frontmatter YAML mínimo de un `.md` (claves simples y listas `- valor`). */
export function leerFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(texto || ''))
  if (!m) return {}
  const out = {}
  let clave = null
  for (const linea of m[1].split(/\r?\n/)) {
    if (clave && /^\s+-\s+/.test(linea)) {
      const v = linea.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '')
      if (!Array.isArray(out[clave])) out[clave] = out[clave] ? [out[clave]] : []
      if (v) out[clave].push(v)
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(linea)
    if (!kv) continue
    clave = kv[1]
    const val = kv[2].trim().replace(/^["']|["']$/g, '')
    out[clave] = val || null
  }
  return out
}

/** Lista los `.md` de un directorio (tolerante a que no exista). */
function listarMd(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md'))
  } catch { return [] }
}

/**
 * Crea el mediador. Todo lo externo se inyecta (pruebas sin servidores):
 *
 *   dirDatos          · carpeta de datos del hub (buzón `a2a.json`).
 *   agentesDir        · carpeta de agentes de OpenCode (`config/opencode/agents`).
 *   claudeAgentesDir  · carpeta de agentes de Claude (`config/claude/agents`).
 *   skillsDir         · carpeta de skills de Claude (para la descripción; opcional).
 *   version           · versión del sistema para la Agent Card.
 *   reglas            · reglas de reparto (`presupuestos`, `reglas`, `respaldo`).
 *   lanzador          · `config/hub/lib/lanzador.mjs` (lanzarJob/esperarJob/costeSesion/abortarSesion).
 *   ledger            · `config/hub/lib/ledger.mjs` (opcional).
 *   metricas          · `config/hub/lib/metricas.mjs` (opcional).
 *   salud             · `config/hub/lib/salud-agentes.mjs` (opcional).
 *   triaje            · `config/hub/lib/triaje.mjs` (opcional; C4).
 *   leerDecisiones    · `() => []` con las decisiones de `decisiones.jsonl` (C5).
 *   ahora             · reloj inyectable (ms).
 *   intervaloVigilanciaMs · cada cuánto se revisa el coste de una consulta en curso.
 */
export function crearA2A({
  dirDatos,
  agentesDir = null,
  claudeAgentesDir = null,
  skillsDir = null,
  version = '0.0.0',
  reglas = {},
  lanzador = null,
  ledger = null,
  metricas = null,
  salud = null,
  triaje = null,
  leerDecisiones = () => [],
  ahora = () => Date.now(),
  intervaloVigilanciaMs = 3000,
} = {}) {
  const archivoBuzon = path.join(dirDatos || '.', 'a2a.json')
  const limiteConsultas = (() => {
    try { const m = ledger?.medir?.(); return m?.maxConcurrentes || CONSULTAS_MAX } catch { return CONSULTAS_MAX }
  })()
  const presupuestoDe = (agente) => {
    const p = reglas?.presupuestos?.[agente]
    return Number.isFinite(Number(p)) ? Number(p) : null
  }

  // ----- C2 · estado en memoria de las consultas en curso (profundidad 1 y concurrencia).
  const porOrigen = new Map() // `de` → nº de consultas en curso
  const sirviendo = new Map() // `para` → nº de consultas que está atendiendo
  let enCurso = 0

  const ok = (body, status = 200) => ({ status, body })
  const fallo = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } })

  // ----- C1 · Agent Card ligera.

  /** Mapa nombre→capa del catálogo (para C5). */
  function mapaCapas() {
    const out = new Map()
    for (const a of directorio().body.agentes) out.set(a.name, a.capa)
    return out
  }

  /** Descripción de un skill por su `SKILL.md` (best-effort). */
  function descripcionSkill(nombre) {
    if (!skillsDir) return ''
    try {
      const fm = leerFrontmatter(fs.readFileSync(path.join(skillsDir, nombre, 'SKILL.md'), 'utf8'))
      return typeof fm.description === 'string' ? fm.description : ''
    } catch { return '' }
  }

  /** Construye la Agent Card ligera de todos los agentes del catálogo. */
  function directorio() {
    const agentes = []
    const fuentes = [
      ['opencode', agentesDir],
      ['claude', claudeAgentesDir],
    ]
    for (const [capa, dir] of fuentes) {
      if (!dir) continue
      for (const archivo of listarMd(dir)) {
        const name = archivo.replace(/\.md$/i, '')
        let fm = {}
        try { fm = leerFrontmatter(fs.readFileSync(path.join(dir, archivo), 'utf8')) } catch { /* ilegible */ }
        const regla = (reglas?.reglas || []).find((r) => r && r.agente === name) || null
        const skills = (Array.isArray(fm.skills) ? fm.skills : []).map((s) => ({
          id: String(s), name: String(s), description: descripcionSkill(String(s)),
        }))
        let saludAgente = null
        try { if (salud) saludAgente = salud.estado(name) } catch { saludAgente = null }
        agentes.push({
          name,
          description: textoCorto(fm.description, 300),
          version,
          skills,
          modelo: fm.model || null,
          esfuerzo: fm.variant || fm.effort || regla?.esfuerzo || null,
          capa,
          solo_lectura: SOLO_LECTURA.has(name),
          coste_estimado: presupuestoDe(name),
          salud: saludAgente,
        })
      }
    }
    agentes.sort((a, b) => (a.capa === b.capa ? a.name.localeCompare(b.name) : (a.capa === 'claude' ? -1 : 1)))
    return ok({ ok: true, agentes, solo_lectura: [...SOLO_LECTURA] })
  }

  // ----- C4 · decisión de triaje en el camino.

  /**
   * Registra la decisión de triaje para `encargo` en `decisiones.jsonl` si no hay ya una
   * reciente (misma tarea, dentro de `VENTANA_TRIAJE`). Lo usa la consulta mediada y el
   * lanzamiento de trabajos del hub. No bloquea: un fallo del triaje no impide seguir.
   */
  async function registrarTriajeSiHaceFalta(encargo, { ref = null } = {}) {
    try {
      const tarea = textoCorto(encargo, PREGUNTA_MAX)
      if (!tarea.trim() || !triaje?.decidir) return { registrada: false }
      let decisiones = []
      try { decisiones = leerDecisiones() || [] } catch { decisiones = [] }
      const ahoraMs = ahora()
      const reciente = decisiones.some((d) => {
        if (!d || typeof d.tarea !== 'string' || d.tarea !== tarea) return false
        const t = Date.parse(d.fecha)
        return Number.isFinite(t) ? ahoraMs - t <= VENTANA_TRIAJE : false
      })
      if (reciente) return { registrada: false, motivo: 'decisión reciente para el mismo encargo' }
      const d = await triaje.decidir({ tarea, contexto: ref ? `origen: ${ref}` : '' })
      return { registrada: true, decision: d }
    } catch {
      return { registrada: false, motivo: 'el triaje falló' }
    }
  }

  // ----- C2 · consulta síncrona mediada.

  const statusDeErrorLanzador = (codigo) => (
    codigo === 'agente_inexistente' || codigo === 'entrada_invalida' ? 400 : 502
  )

  /**
   * Espera a que termine la sesión lanzada vigilando el tope de coste (aborta la sesión si
   * se pasa). Usa `esperarJob` para la espera y `costeSesion`/`abortarSesion` para el tope.
   */
  async function esperarConTope({ sessionId, directory, tope, timeoutMs }) {
    let costeExcedido = false
    let watchdog = null
    if (tope != null && lanzador?.costeSesion && lanzador?.abortarSesion) {
      watchdog = setInterval(async () => {
        if (costeExcedido) return
        try {
          const c = await lanzador.costeSesion({ sessionId, directory })
          if (c && c.ok && typeof c.coste === 'number' && c.coste > tope) {
            costeExcedido = true
            try { await lanzador.abortarSesion({ sessionId, directory }) } catch { /* nada */ }
          }
        } catch { /* se reintenta en el siguiente ciclo */ }
      }, intervaloVigilanciaMs)
      watchdog.unref?.()
    }
    let r = null
    try {
      r = await lanzador.esperarJob({ sessionId, directory, timeoutMs })
    } catch (e) {
      r = { ok: false, codigo: 'error_job', error: String(e?.message || e) }
    } finally {
      if (watchdog) clearInterval(watchdog)
    }
    // Comprobación final (el vigilante solo mira cada pocos segundos: un job corto, o el último
    // tramo, podría haber pasado el tope sin que nadie lo viera).
    if (!costeExcedido && tope != null) {
      let final = typeof r?.coste === 'number' ? r.coste : null
      try {
        const c = await lanzador?.costeSesion?.({ sessionId, directory })
        if (c && c.ok && typeof c.coste === 'number') final = Math.max(final ?? 0, c.coste)
      } catch { /* se usa el coste de la espera */ }
      if (final != null && final > tope) {
        costeExcedido = true
        if (r) r = { ...r, coste: final }
      }
    }
    if (costeExcedido) {
      try { await lanzador?.abortarSesion?.({ sessionId, directory }) } catch { /* nada */ }
      return { ok: false, costeExcedido: true, coste: r?.coste ?? null, texto: r?.texto || '' }
    }
    if (!r || r.ok !== true) {
      const timeout = r?.codigo === 'timeout'
      // Tras un timeout el hub deja de vigilar: la sesión se aborta para que no siga gastando.
      if (timeout) { try { await lanzador?.abortarSesion?.({ sessionId, directory }) } catch { /* nada */ } }
      return { ok: false, timeout, estado: 'fallido', coste: r?.coste ?? null, texto: r?.texto || '', error: r?.error || 'el job falló' }
    }
    return { ok: true, estado: 'completado', coste: typeof r.coste === 'number' ? r.coste : null, texto: r.texto || '' }
  }

  /** Registra el trabajo mediado en el ledger (terminal: no se reconcilia con el MCP). */
  function registrarEnLedger(jobId, para, directory, r, t0) {
    if (!ledger?.registrar) return
    try {
      const estado = r.ok ? 'completado' : (r.costeExcedido ? 'cancelado' : 'fallido')
      ledger.registrar({
        jobId,
        agent: para,
        directory,
        status: r.ok ? 'completed' : (r.costeExcedido ? 'cancelled' : 'failed'),
        createdAt: t0,
        updatedAt: ahora(),
        title: `a2a: consulta a ${para}`,
      }, { estado })
    } catch { /* el ledger nunca rompe la consulta */ }
  }

  async function consultar({ de, para, pregunta, directory, sessionId = null } = {}) {
    // Validaciones (C2).
    if (typeof de !== 'string' || !de.trim()) return fallo(400, 'falta `de`')
    if (typeof para !== 'string' || !para.trim()) return fallo(400, 'falta `para`')
    if (!SOLO_LECTURA.has(para)) return fallo(400, `«${para}» no es un agente de lectura`, { lectura: [...SOLO_LECTURA] })
    if (typeof pregunta !== 'string' || !pregunta.trim()) return fallo(400, 'falta `pregunta`')
    if (pregunta.length > PREGUNTA_MAX) return fallo(400, `la pregunta supera ${PREGUNTA_MAX} caracteres`)
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) return fallo(400, '`directory` debe ser una ruta absoluta')
    let esDir = false
    try { esDir = fs.statSync(directory).isDirectory() } catch { esDir = false }
    if (!esDir) return fallo(400, `el directorio no existe o no es un directorio: ${directory}`)
    if (!lanzador?.lanzarJob) return fallo(503, 'el hub no tiene lanzador de jobs')

    // Profundidad 1 y concurrencia.
    if (porOrigen.has(de)) return fallo(409, `profundidad 1: «${de}» ya está dentro de una consulta`)
    if (sirviendo.has(de)) return fallo(409, `profundidad 1: «${de}» está atendiendo una consulta y no puede originar otra`)
    if (enCurso >= limiteConsultas) return fallo(409, `demasiadas consultas en curso (${enCurso}/${limiteConsultas})`)

    porOrigen.set(de, (porOrigen.get(de) || 0) + 1)
    sirviendo.set(para, (sirviendo.get(para) || 0) + 1)
    enCurso++
    const t0 = ahora()
    try {
      // C4 · triaje del encargo (sin duplicar si ya hay decisión reciente).
      await registrarTriajeSiHaceFalta(pregunta, { ref: `a2a:${de}->${para}` })

      const l = await lanzador.lanzarJob({
        agente: para,
        directory,
        prompt: INSTRUCCION + pregunta,
        titulo: `a2a:${de}->${para}`,
      })
      if (!l || l.ok !== true) {
        if (l?.sessionId) registrarEnLedger(`a2a_${l.sessionId}`, para, directory, { ok: false }, t0)
        return fallo(statusDeErrorLanzador(l?.codigo), l?.error || 'no se pudo lanzar el job', { codigo: l?.codigo || null })
      }

      const r = await esperarConTope({ sessionId: l.sessionId, directory, tope: presupuestoDe(para), timeoutMs: TIMEOUT_DEFECTO })
      const ms = ahora() - t0
      const jobId = `a2a_${l.sessionId}`
      const respuesta = recortar(r.texto, RESPUESTA_MAX)
      registrarEnLedger(jobId, para, directory, r, t0)
      try {
        metricas?.registrar?.({
          tipo: 'a2a', subtipo: 'consulta', de, para,
          estado: r.ok ? 'completado' : (r.timeout ? 'timeout' : (r.costeExcedido ? 'coste_excedido' : 'fallido')),
          chars: respuesta.length,
          coste: typeof r.coste === 'number' ? r.coste : null,
          ms,
        })
      } catch { /* las métricas nunca rompen la consulta */ }

      if (r.timeout) return { status: 504, body: { ok: false, jobId, error: 'timeout', coste: r.coste, ms } }
      if (r.costeExcedido) return { status: 200, body: { ok: false, jobId, error: 'coste_excedido', coste: r.coste, ms } }
      if (!r.ok) return { status: 502, body: { ok: false, jobId, error: r.error || 'el job falló', coste: r.coste, ms } }
      return { status: 200, body: { ok: true, jobId, respuesta, coste: r.coste, ms } }
    } finally {
      const a = (porOrigen.get(de) || 1) - 1
      if (a <= 0) porOrigen.delete(de); else porOrigen.set(de, a)
      const b = (sirviendo.get(para) || 1) - 1
      if (b <= 0) sirviendo.delete(para); else sirviendo.set(para, b)
      enCurso--
    }
  }

  // ----- C3 · buzón asíncrono por tarea.

  let mensajes = []
  try {
    const j = JSON.parse(fs.readFileSync(archivoBuzon, 'utf8'))
    mensajes = Array.isArray(j?.mensajes) ? j.mensajes.filter((m) => m && m.id) : []
  } catch { mensajes = [] }

  /** Escritura atómica tmp+rename, tolerante a fallos. */
  function escribirAtomico(texto) {
    const escribir = () => {
      const tmp = `${archivoBuzon}.tmp-${process.pid}-${Date.now()}`
      try {
        fs.mkdirSync(path.dirname(archivoBuzon), { recursive: true })
        fs.writeFileSync(tmp, texto, 'utf8')
        fs.renameSync(tmp, archivoBuzon)
      } catch {
        try { fs.writeFileSync(archivoBuzon, texto, 'utf8') } catch { /* sin disco */ }
        try { fs.unlinkSync(tmp) } catch { /* nada */ }
      }
    }
    escribir()
    try { if (fs.readFileSync(archivoBuzon, 'utf8') !== texto) escribir() } catch { escribir() }
  }

  /** Read-merge-write por `id` (la memoria gana) y persistencia atómica. */
  function guardar() {
    const porId = new Map()
    try {
      const j = JSON.parse(fs.readFileSync(archivoBuzon, 'utf8'))
      for (const m of (Array.isArray(j?.mensajes) ? j.mensajes : [])) if (m && m.id) porId.set(m.id, m)
    } catch { /* sin fichero */ }
    for (const m of mensajes) porId.set(m.id, m)
    const lista = [...porId.values()].sort((a, b) => num(a.creado) - num(b.creado))
    mensajes = lista
    escribirAtomico(JSON.stringify({ actualizado: ahora(), mensajes: lista }, null, 2) + '\n')
    return lista
  }

  /** Marca como `expirado` lo pendiente pasado su TTL (persiste solo si cambia algo). */
  function expirar() {
    const t = ahora()
    let cambio = false
    for (const m of mensajes) {
      if (m.estado === 'pendiente' && num(m.expira) && t >= num(m.expira)) { m.estado = 'expirado'; cambio = true }
    }
    if (cambio) guardar()
    return { expirados: cambio }
  }

  function crearMensaje({ de, para, tipo, ref, cuerpo } = {}) {
    if (typeof de !== 'string' || !de.trim()) return fallo(400, 'falta `de`')
    if (typeof para !== 'string' || !para.trim()) return fallo(400, 'falta `para`')
    if (!TIPOS_MENSAJE.includes(tipo)) return fallo(400, `tipo inválido; válidos: ${TIPOS_MENSAJE.join(', ')}`)
    if (typeof ref !== 'string' || !ref.trim()) return fallo(400, 'falta `ref` (jobId o spec)')
    if (typeof cuerpo !== 'string' || !cuerpo.trim()) return fallo(400, 'falta `cuerpo`')
    if (cuerpo.length > CUERPO_MAX) return fallo(400, `el cuerpo supera ${CUERPO_MAX} caracteres`)
    expirar()
    const pendientes = mensajes.filter((m) => m.para === para && m.estado === 'pendiente').length
    if (pendientes >= MAX_PENDIENTES) return fallo(429, `«${para}» ya tiene ${MAX_PENDIENTES} mensajes pendientes`)
    const m = {
      id: 'm_' + ahora().toString(36) + Math.random().toString(36).slice(2, 8),
      de, para, tipo, ref: textoCorto(ref, 300), cuerpo: textoCorto(cuerpo, CUERPO_MAX),
      estado: 'pendiente', creado: ahora(), expira: ahora() + TTL_MENSAJE,
    }
    mensajes.push(m)
    guardar()
    try { metricas?.registrar?.({ tipo: 'a2a', subtipo: 'mensaje', de, para, estado: 'pendiente', chars: m.cuerpo.length }) } catch { /* nada */ }
    return ok({ ok: true, mensaje: m })
  }

  function listarMensajes({ para = null, estado = null, ref = null } = {}) {
    expirar()
    let lista = mensajes
    if (para) lista = lista.filter((m) => m.para === para)
    if (estado) lista = lista.filter((m) => m.estado === estado)
    if (ref) lista = lista.filter((m) => m.ref === ref)
    lista = [...lista].sort((a, b) => num(b.creado) - num(a.creado))
    return ok({ ok: true, mensajes: lista })
  }

  function responder({ id, cuerpo } = {}) {
    if (typeof id !== 'string' || !id.trim()) return fallo(400, 'falta `id`')
    if (typeof cuerpo !== 'string' || !cuerpo.trim()) return fallo(400, 'falta `cuerpo`')
    if (cuerpo.length > CUERPO_MAX) return fallo(400, `el cuerpo supera ${CUERPO_MAX} caracteres`)
    expirar()
    const m = mensajes.find((x) => x.id === id)
    if (!m) return fallo(404, 'mensaje no encontrado')
    if (m.estado === 'expirado') return fallo(409, 'el mensaje ha expirado')
    if (m.estado !== 'pendiente') return fallo(409, `el mensaje ya está ${m.estado}`)
    // Una respuesta NUNCA crea otro mensaje (y en particular nunca una nueva `pregunta`):
    // se guarda dentro del propio mensaje y este pasa a `respondido`.
    m.estado = 'respondido'
    m.respuesta = { cuerpo: textoCorto(cuerpo, CUERPO_MAX), fecha: ahora() }
    guardar()
    try { metricas?.registrar?.({ tipo: 'a2a', subtipo: 'mensaje', de: m.de, para: m.para, estado: 'respondido', chars: m.respuesta.cuerpo.length }) } catch { /* nada */ }
    return ok({ ok: true, mensaje: m })
  }

  // ----- C5 · reparto medido (ledger + métricas + decisiones).

  function reparto({ dias = 7 } = {}) {
    const d = Number.isFinite(Number(dias)) && Number(dias) > 0 ? Math.floor(Number(dias)) : 7
    const corte = ahora() - d * 24 * 60 * 60 * 1000
    const desdeIso = new Date(corte).toISOString()
    const capas = mapaCapas()

    let entradas = []
    try { entradas = ledger?.leer?.() || [] } catch { entradas = [] }
    entradas = entradas.filter((e) => num(e.actualizado) >= corte)

    const porAgente = new Map()
    const fila = (agente) => {
      const k = agente || '?'
      if (!porAgente.has(k)) porAgente.set(k, { agente: k, trabajos: 0, completados: 0, fallidos: 0, cancelados: 0, coste: 0, mediaMs: 0, _sumMs: 0, _nMs: 0 })
      return porAgente.get(k)
    }
    for (const e of entradas) {
      const a = fila(e.agente)
      a.trabajos++
      if (e.estado === 'completado') a.completados++
      else if (e.estado === 'fallido') a.fallidos++
      else if (e.estado === 'cancelado') a.cancelados++
      const ms = num(e.actualizado) - num(e.creado)
      if (ms > 0) { a._sumMs += ms; a._nMs++ }
    }

    let evJobs = []
    try { evJobs = metricas?.leer?.({ tipo: 'job', desde: desdeIso, limite: 1000 }) || [] } catch { evJobs = [] }
    const costes = new Map()
    for (const ev of evJobs) {
      if (!ev?.agente) continue
      costes.set(ev.agente, (costes.get(ev.agente) || 0) + num(ev.coste))
    }
    // Las consultas mediadas no tienen fichero de job del MCP (coste null en su evento `job`):
    // su gasto real está en el evento `a2a` y se atribuye al agente consultado.
    try {
      for (const ev of (metricas?.leer?.({ tipo: 'a2a', desde: desdeIso, limite: 1000 }) || [])) {
        if (ev?.subtipo === 'consulta' && ev.para) costes.set(ev.para, (costes.get(ev.para) || 0) + num(ev.coste))
      }
    } catch { /* sin métricas */ }
    for (const [k, a] of porAgente) {
      a.coste = Number((costes.get(k) || 0).toFixed(6))
      a.mediaMs = a._nMs ? Math.round(a._sumMs / a._nMs) : 0
      delete a._sumMs; delete a._nMs
    }

    // % de trabajos con decisión de triaje previa (decisión ≤ creado y ≤ 30 min antes,
    // con el mismo agente o su original). Heurística documentada en `docs/pruebas.md`.
    let decisiones = []
    try { decisiones = leerDecisiones() || [] } catch { decisiones = [] }
    let conTriaje = 0
    for (const e of entradas) {
      const c = num(e.creado)
      const hay = decisiones.some((dc) => {
        if (!dc) return false
        const t = Date.parse(dc.fecha)
        if (!Number.isFinite(t) || t > c || c - t > VENTANA_TRIAJE_PREVIO) return false
        return dc.agente === e.agente || dc.agenteOriginal === e.agente
      })
      if (hay) conTriaje++
    }

    const porCapa = new Map()
    for (const a of porAgente.values()) {
      const capa = capas.get(a.agente) || 'desconocido'
      const c = porCapa.get(capa) || { capa, trabajos: 0, completados: 0, fallidos: 0, cancelados: 0, coste: 0 }
      c.trabajos += a.trabajos; c.completados += a.completados; c.fallidos += a.fallidos
      c.cancelados += a.cancelados; c.coste = Number((c.coste + a.coste).toFixed(6))
      porCapa.set(capa, c)
    }

    let evA2A = []
    try { evA2A = metricas?.leer?.({ tipo: 'a2a', desde: desdeIso, limite: 1000 }) || [] } catch { evA2A = [] }
    const consultas = evA2A.filter((e) => e.subtipo === 'consulta')
    const consultasA2A = {
      total: consultas.length,
      coste: Number(consultas.reduce((s, e) => s + num(e.coste), 0).toFixed(6)),
      mediaRespuestaChars: consultas.length ? Math.round(consultas.reduce((s, e) => s + num(e.chars), 0) / consultas.length) : 0,
    }

    return ok({
      ok: true,
      dias: d,
      generado: ahora(),
      agentes: [...porAgente.values()].sort((a, b) => b.trabajos - a.trabajos),
      capas: [...porCapa.values()].sort((a, b) => b.trabajos - a.trabajos),
      triaje: { conDecision: conTriaje, total: entradas.length, pct: entradas.length ? Math.round((conTriaje / entradas.length) * 100) : 0 },
      consultasA2A,
    })
  }

  return {
    directorio,
    consultar,
    crearMensaje,
    listarMensajes,
    responder,
    reparto,
    registrarTriajeSiHaceFalta,
    // Utilidad para que el hub pueda revisar el buzón persistido de una vez.
    mensajes: () => listarMensajes(),
  }
}
