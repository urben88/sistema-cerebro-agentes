/**
 * Ledger durable de trabajos (R3 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * El trabajo en segundo plano del MCP es *process-local*: sin un registro propio, un
 * reinicio del hub pierde qué jobs había y en qué estado. Este módulo mantiene
 * `hub-data/trabajos.json` con una entrada por job
 * `{jobId, agente, directorio, estado, creado, actualizado, deadline, ultimoPaso, motivo}`,
 * reconciliada con `leerJobs()` (no con `opencode_job_list`, que el hub no tiene).
 *
 * Estados formales (R3.2): `pendiente → en_curso → completado | fallido | cancelado |
 * atascado | desconocido`. El estado real `unknown` del job se registra como `desconocido`.
 *
 * Reglas de oro:
 *   · Escritura atómica `tmp`+`rename` con *read-merge-write*: se RELEE `trabajos.json`
 *     justo antes de escribir y se hace merge (la memoria gana por `jobId`; las claves
 *     solo en disco se conservan). Tolera un archivo corrupto.
 *   · El ledger es **solo del hub**: NUNCA escribe en los ficheros de job del MCP
 *     (`%LOCALAPPDATA%/opencode-mcp/...`). La detección de atasco solo toca el ledger.
 *   · Retención: 7 días (entradas terminales) y máx. 50 completados.
 *   · Lo terminal (`completado | fallido | cancelado | desconocido`) es **inmutable**: ni
 *     un `unknown` del MCP lo degrada ni un status activo lo revive; `atascado` sí vuelve
 *     a `en_curso` si el job reaparece vivo.
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'

/** Estados formales del ledger (R3.2). */
export const ESTADOS = ['pendiente', 'en_curso', 'completado', 'fallido', 'cancelado', 'atascado', 'desconocido']
const ACTIVOS = new Set(['pendiente', 'en_curso', 'atascado'])
const TERMINALES = new Set(['completado', 'fallido', 'cancelado', 'desconocido'])

/** Traduce el estado crudo de un job del MCP al estado formal del ledger. */
const MAPA_ESTADO = {
  pending: 'pendiente', queued: 'pendiente', created: 'pendiente',
  running: 'en_curso', accepted: 'en_curso', input_required: 'en_curso',
  completed: 'completado', failed: 'fallido',
  cancelled: 'cancelado', canceled: 'cancelado',
  unknown: 'desconocido',
}

/** Estado formal a partir de `job.status`; lo no reconocido (o ausente) es `desconocido`. */
export function estadoDeJob(status) {
  return MAPA_ESTADO[String(status || '').toLowerCase()] || 'desconocido'
}

const normDir = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number(v) || 0))

/**
 * Crea el ledger sobre `dirDatos` (`hub-data/`). Todos los umbrales son configurables
 * (R3.3/R3.4) para poder probar con valores cortos; `ahora` se puede inyectar en pruebas.
 *
 *   avisar(a)               · alerta de atasco → se cablea al mecanismo del vigilante.
 *   anotarBitacora(dir,t,x) · nota en la bitácora del proyecto (si existe la API).
 *   existeJob(jobId)        · ¿sigue existiendo el fichero del job? Evita confundir «fuera
 *                             del top-N de leerJobs()» con «desaparecido» (ver reconciliar).
 *   log(datos)              · registro central de errores.
 */
export function crearLedger({
  dirDatos,
  ahora = () => Date.now(),
  retencionDias = 7,
  maxCompletados = 50,
  minutosAtasco = 12,
  minutosAtascoHerramienta = null,
  minutosGraciaAtasco = 2,
  maxConcurrentes = 3,
  horasMaxJob = 24,
  avisar = null,
  anotarBitacora = null,
  existeJob = null,
  log = null,
} = {}) {
  const archivo = path.join(dirDatos, 'trabajos.json')
  // «por defecto igual a minutosAtasco» (R3.4) si no se fija un valor propio.
  const umbralHerramienta = Number.isFinite(minutosAtascoHerramienta) ? minutosAtascoHerramienta : minutosAtasco
  const entradas = new Map() // jobId -> entrada

  /** Lee el fichero tolerando ausencia o corrupción (siempre un array de entradas). */
  function leerArchivo() {
    try {
      const j = JSON.parse(fs.readFileSync(archivo, 'utf8'))
      const lista = Array.isArray(j) ? j : (Array.isArray(j?.trabajos) ? j.trabajos : [])
      return lista.filter((e) => e && typeof e === 'object' && e.jobId)
    } catch { return [] }
  }

  /** Escritura atómica tmp+rename, con reintento y relectura de control (bind mounts). */
  function escribirAtomico(texto) {
    const escribir = () => {
      const tmp = `${archivo}.tmp-${process.pid}-${Date.now()}`
      try {
        fs.mkdirSync(dirDatos, { recursive: true })
        fs.writeFileSync(tmp, texto, 'utf8')
        fs.renameSync(tmp, archivo)
      } catch {
        // Docker Desktop sobre bind mounts: el rename puede no garantizarse.
        try { fs.writeFileSync(archivo, texto, 'utf8') } catch { /* sin disco */ }
        try { fs.unlinkSync(tmp) } catch { /* nada */ }
      }
    }
    escribir()
    try {
      if (fs.readFileSync(archivo, 'utf8') !== texto) escribir()
    } catch { escribir() }
  }

  /** Poda: entradas terminales de más de `retencionDias` y tope de `maxCompletados`. */
  function podarLista(lista) {
    const corte = ahora() - retencionDias * 24 * 60 * 60 * 1000
    let vivos = lista.filter((e) => !TERMINALES.has(e.estado) || num(e.actualizado) >= corte)
    const completados = vivos
      .filter((e) => e.estado === 'completado')
      .sort((a, b) => num(b.actualizado) - num(a.actualizado))
    if (completados.length > maxCompletados) {
      const sobra = new Set(completados.slice(maxCompletados).map((e) => e.jobId))
      vivos = vivos.filter((e) => !(e.estado === 'completado' && sobra.has(e.jobId)))
    }
    return vivos.sort((a, b) => num(b.actualizado) - num(a.actualizado))
  }

  /** Read-merge-write: relee el disco, une (la memoria gana por jobId), poda y escribe. */
  function guardar() {
    const porId = new Map()
    for (const e of leerArchivo()) porId.set(e.jobId, e)
    for (const [id, e] of entradas) porId.set(id, e) // la memoria manda
    const lista = podarLista([...porId.values()])
    entradas.clear()
    for (const e of lista) entradas.set(e.jobId, e)
    escribirAtomico(JSON.stringify({ actualizado: ahora(), trabajos: lista }, null, 2) + '\n')
    return lista
  }

  /** Upsert en memoria SIN persistir (lo usan reconciliar/atasco, que guardan al final). */
  function poner(job, { estado = null, motivo = null, ultimoPaso = null } = {}) {
    if (!job?.jobId) return null
    const t = ahora()
    const previo = entradas.get(job.jobId) || null
    const act = num(job.updatedAt)
    const entry = {
      jobId: job.jobId,
      agente: job.agent ?? job.agente ?? previo?.agente ?? null,
      directorio: job.directory ?? job.directorio ?? previo?.directorio ?? null,
      estado: estado || (job.status != null ? estadoDeJob(job.status) : (previo?.estado || 'pendiente')),
      creado: previo?.creado ?? (num(job.createdAt) || t),
      actualizado: Math.max(act, num(previo?.actualizado)) || t,
      deadline: previo?.deadline ?? ((num(job.createdAt) || t) + horasMaxJob * 60 * 60 * 1000),
      ultimoPaso: ultimoPaso ?? previo?.ultimoPaso ?? (job.title || null),
      motivo: motivo ?? previo?.motivo ?? null,
    }
    entradas.set(entry.jobId, entry)
    return entry
  }

  /** Registra/actualiza una entrada desde un job observado y persiste. */
  function registrar(job, opts = {}) {
    const e = poner(job, opts)
    if (e) guardar()
    return e
  }

  /** Deja rastro (bitácora del proyecto si hay API + registro central) del cambio. */
  function anotar(e, motivo) {
    try {
      log?.({ origen: 'ledger', severidad: 'aviso', mensaje: `Trabajo ${e.jobId} → desconocido (${motivo})`, contexto: { jobId: e.jobId, directorio: e.directorio, agente: e.agente } })
    } catch { /* nada */ }
    if (anotarBitacora && e.directorio) {
      try { anotarBitacora(e.directorio, 'Trabajo desconocido (ledger)', `El job ${e.jobId} (${e.agente || 'agente'}) desapareció o quedó en estado unknown: ${motivo}. No se ha cancelado nada.`) } catch { /* nada */ }
    }
  }

  /** Marca una entrada como `desconocido` y anota SOLO si cambia de estado (evita repetir). */
  function marcarDesconocido(e, job, motivo, informe) {
    const cambio = e.estado !== 'desconocido'
    e.estado = 'desconocido'
    e.motivo = `reconciliación: ${motivo}`
    if (job && num(job.updatedAt)) e.actualizado = Math.max(num(e.actualizado), num(job.updatedAt))
    if (cambio) {
      informe.desconocidos.push({ jobId: e.jobId, motivo })
      anotar(e, motivo)
    }
    return e
  }

  /**
   * Reconciliación con `leerJobs()` (R3.3): lo vivo se re-engancha y pasa a `en_curso`;
   * lo que desapareció o está `unknown` pasa a `desconocido` (con nota de bitácora/log).
   *
   * Inmutabilidad de lo terminal: `completado | fallido | cancelado | desconocido` no
   * retroceden. Un `unknown` del MCP sobre una entrada terminal se ignora (no la degrada)
   * y un status activo tampoco revive un terminal a `en_curso`. `atascado`, en cambio, SÍ
   * vuelve a `en_curso` cuando el job reaparece vivo (este es el desatasco de reconciliar).
   *
   * «Desaparecido» de verdad: un job que no aparece en `leerJobs()` puede estar solo fuera
   * del top-N pedido. Si se inyecta `existeJob(jobId)` (en el hub, `oc.existeJob`), solo se
   * marca `desconocido` cuando su fichero de job no existe o no se puede leer; sin él se
   * mantiene el comportamiento anterior (ausencia en `leerJobs()` = desaparecido).
   *
   * Devuelve `{nuevos, reEnganchados, desconocidos}` para que el hub re-hooke a `vivo.mjs`.
   */
  function reconciliar(jobs = []) {
    const mapa = new Map()
    for (const j of (Array.isArray(jobs) ? jobs : [])) if (j?.jobId) mapa.set(j.jobId, j)
    const informe = { nuevos: [], reEnganchados: [], desconocidos: [] }

    // 1 · Jobs observados por el MCP.
    for (const [jobId, j] of mapa) {
      const est = estadoDeJob(j.status)
      const previo = entradas.get(jobId)
      if (!previo) {
        const e = poner(j, { motivo: est === 'desconocido' ? 'reconciliación: status unknown' : `reconciliación: ${j.status}` })
        informe.nuevos.push(jobId)
        if (est === 'desconocido') { informe.desconocidos.push({ jobId, motivo: 'status unknown' }); anotar(e, 'status unknown') }
        else if (ACTIVOS.has(est)) informe.reEnganchados.push(jobId)
        continue
      }
      // Lo terminal es inmutable: ni `unknown` lo degrada ni lo vivo lo revive a `en_curso`.
      if (TERMINALES.has(previo.estado)) continue
      if (est === 'desconocido') { marcarDesconocido(previo, j, 'status unknown', informe); continue }
      if (ACTIVOS.has(est)) {
        previo.estado = 'en_curso'
        previo.agente = previo.agente || j.agent || null
        previo.directorio = previo.directorio || j.directory || null
        previo.actualizado = Math.max(num(previo.actualizado), num(j.updatedAt)) || num(previo.actualizado)
        previo.ultimoPaso = j.title || previo.ultimoPaso || null
        previo.motivo = 'reconciliación: job vivo, re-enganchado a la vista viva'
        informe.reEnganchados.push(jobId)
      } else {
        previo.estado = est
        previo.motivo = `reconciliación: ${j.status}`
        previo.actualizado = Math.max(num(previo.actualizado), num(j.updatedAt)) || num(previo.actualizado)
        previo.ultimoPaso = j.title || previo.ultimoPaso || null
      }
    }

    // 2 · Entradas del ledger que ya no aparecen en `leerJobs()`.
    for (const e of entradas.values()) {
      if (mapa.has(e.jobId)) continue
      if (!ACTIVOS.has(e.estado)) continue
      // Estar fuera del top-N de `leerJobs()` NO es «desaparecido»: con el sondeo
      // `existeJob`, solo se marca `desconocido` si el fichero del job ya no está.
      if (existeJob) {
        let existe = false
        try { existe = existeJob(e.jobId) === true } catch { existe = false }
        if (existe) continue
      }
      marcarDesconocido(e, null, 'el job desapareció', informe)
    }

    guardar()
    return informe
  }

  /** ¿El último evento está «dentro de una herramienta» (aún sin terminar)? */
  function enHerramienta(evento) {
    if (!evento || evento.tipo !== 'herramienta') return false
    return !['completed', 'error', 'failed'].includes(String(evento.estado || '').toLowerCase())
  }

  /**
   * Detección de atasco por PROGRESO (R3.4): `updatedAt` del job + eventos con `ts` de
   * `vivo.mjs`. Umbral = `minutosAtasco` (o `minutosAtascoHerramienta` si el último
   * evento está dentro de una herramienta) + `minutosGraciaAtasco`. Pasa a `atascado`
   * SOLO en el ledger y avisa (nunca cancela solo).
   */
  function revisarAtascos({ jobs = [], eventos = {} } = {}) {
    const t = ahora()
    const mapa = new Map()
    for (const j of (Array.isArray(jobs) ? jobs : [])) if (j?.jobId) mapa.set(j.jobId, j)
    const atascados = []
    for (const e of entradas.values()) {
      if (e.estado !== 'en_curso') continue
      const j = mapa.get(e.jobId)
      if (!j) continue
      if (!ACTIVOS.has(estadoDeJob(j.status))) continue
      const evs = Array.isArray(eventos[e.jobId]) ? eventos[e.jobId] : []
      const ultimoEvento = evs.length ? evs[evs.length - 1] : null
      const tsEvento = ultimoEvento?.ts ? num(ultimoEvento.ts) : 0
      const ultimo = Math.max(num(j.updatedAt), tsEvento, num(e.actualizado))
      if (!ultimo) continue
      const dentro = enHerramienta(ultimoEvento)
      const base = dentro ? umbralHerramienta : minutosAtasco
      const umbralMs = (base + minutosGraciaAtasco) * 60 * 1000
      if (t - ultimo >= umbralMs) {
        const minutos = Math.round((t - ultimo) / 60000)
        e.estado = 'atascado'
        e.actualizado = ultimo
        e.motivo = `atascado: sin progreso ${minutos} min${dentro ? ' dentro de una herramienta' : ''}`
        const alerta = { tipo: 'atascado', jobId: e.jobId, sessionId: j.sessionId || null, directory: e.directorio, title: j.title || null, agente: e.agente, minutos, origen: 'ledger' }
        atascados.push(alerta)
        try { avisar?.(alerta) } catch { /* nada */ }
      }
    }
    if (atascados.length) guardar()
    return { atascados }
  }

  /**
   * Mide (no impone) concurrencia y profundidad (R3.5): jobs `en_curso` frente a
   * `maxConcurrentes` y máximo de jobs simultáneos sobre el mismo directorio.
   */
  function medir() {
    const activos = [...entradas.values()].filter((e) => e.estado === 'en_curso')
    const porDir = new Map()
    for (const e of activos) {
      const k = normDir(e.directorio) || '(sin directorio)'
      porDir.set(k, (porDir.get(k) || 0) + 1)
    }
    const profundidad = activos.length ? Math.max(...porDir.values()) : 0
    const enCurso = activos.length
    const aviso = enCurso > maxConcurrentes
    return {
      enCurso,
      maxConcurrentes,
      profundidad,
      aviso,
      mensaje: aviso ? `Hay ${enCurso} trabajos en curso (máximo recomendado ${maxConcurrentes}); la consigna al cerebro es no pasar de ${maxConcurrentes}.` : null,
    }
  }

  /** Copia de todas las entradas (de más reciente a más antigua). */
  function leer() {
    return [...entradas.values()].map((e) => ({ ...e }))
  }

  /** Lista filtrable por estado (para `GET /api/trabajos/ledger`). */
  function listar({ estado = null } = {}) {
    const lista = leer()
    return estado ? lista.filter((e) => e.estado === estado) : lista
  }

  /** Fuerza la poda y la escritura (retención de 7 días / 50 completados). */
  function podar() {
    const antes = entradas.size
    const lista = guardar()
    return { quitados: antes - lista.length, quedan: lista.length }
  }

  // Carga inicial: tolera fichero ausente o corrupto.
  for (const e of leerArchivo()) entradas.set(e.jobId, e)

  return { archivo, leer, listar, reconciliar, revisarAtascos, medir, registrar, podar, estadoDeJob }
}
