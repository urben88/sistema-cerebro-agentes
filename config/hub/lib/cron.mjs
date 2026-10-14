/**
 * Cron y tareas programadas (R6 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * El hub mantiene un planificador persistente de tareas (`hub-data/cron/jobs.json`)
 * con jobs `{id, nombre, schedule, destino, prompt, siguiente, estado, ultimo,
 * reintentos, claim, vigilancia}`. `schedule` es tipado:
 *   · `{kind:'cron', expr}`         · 5 campos (min hora diaMes mes diaSemana; 0-7, 7=domingo)
 *   · `{kind:'interval', minutos}`  · cada N minutos
 *   · `{kind:'once', ejecutar_en}`  · una vez, en una fecha ISO
 *
 * Reglas de oro (transversales de la spec 10):
 *   · Escritura atómica `tmp`+`rename` con *read-merge-write*: se RELEE `jobs.json`
 *     justo antes de escribir y se hace merge por `id` (la memoria gana; las claves
 *     solo en disco se conservan). Toleran un archivo corrupto.
 *   · **Tombstones entre instancias**: las bajas se persisten en `jobs.json`
 *     (`{actualizado, jobs, borrados:[ids]}`). `guardar()` une las bajas del disco y de
 *     la memoria y las aplica DESPUÉS del merge, de modo que un job borrado por otra
 *     instancia no resucita aunque siga en memoria; `refrescarDesdeDisco()` olvida los
 *     ids que el disco marca como borrados. La lista se limita a las últimas 200 bajas.
 *   · `tick()` reclama cada job vencido con un `claim` de TTL 300 s ANTES de lanzarlo,
 *     de modo que un reinicio o un segundo tick (incluso otra instancia sobre el mismo
 *     `dataDir`) no lo duplique; los claims caducados se recuperan al arrancar.
 *     Guarda contra el DST *fall-back*: si la ejecución prevista cae en el mismo minuto
 *     de reloj local que la última ejecución, no se repite (se adelanta el calendario).
 *   · Preflight antes de disparar: el agente destino debe existir (**fail-closed**: si
 *     no existe no se lanza y el job pasa a `fallido` con motivo); OpenCode inalcanzable
 *     es **fail-open** (se avisa y se sigue; el lanzamiento fallará con su propio error).
 *   · Reintentos si OpenCode está inalcanzable (`servidor_inalcanzable`): a los 5, 15 y
 *     30 min; tras el tercero el job pasa a `fallido` y se apunta un aviso.
 *   · **Tope de coste real** (R6.4): tras un lanzamiento ok con presupuesto>0 se guarda
 *     `vigilancia:{sessionId, directory, presupuesto, desde}`; en cada `tick()` se mide
 *     con `lanzador.costeSesion()` y, si `coste >= presupuesto`, se aborta la sesión
 *     (`lanzador.abortarSesion()`) con aviso `tope_coste` y se limpia la vigilancia. Si
 *     la sesión terminó, se anota el coste final; pasadas 2 h se limpia con aviso.
 *   · La salida de cada ejecución se escribe en `hub-data/cron/salida/<id>/<fecha>.md`;
 *     solo si el `id` es seguro (`[A-Za-z0-9_-]`).
 *
 * El lanzamiento lo hace `config/hub/lib/lanzador.mjs` (R0), inyectable en pruebas.
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'

/** Retrasos (en minutos) de los reintentos por `servidor_inalcanzable` (R6.5). */
export const RETRASOS_MIN = [5, 15, 30]
/** TTL del claim de ejecución (R6.6). */
export const CLAIM_TTL_MS = 300 * 1000
/** Máximo de bajas (tombstones) recordadas en `jobs.json`. */
export const BORRADOS_MAX = 200
/** Tiempo máximo que se vigila el coste de una sesión (R6.4). */
export const VIGILANCIA_MAX_MS = 2 * 60 * 60 * 1000
/** Agentes que escriben/ejecutan: exigen `aprobado_usuario` al crear el job (R6.7). */
export const AGENTES_ESCRITURA = ['implementador', 'debugger', 'local']
/** Estados válidos de un job. */
export const ESTADOS = ['activo', 'pausado', 'completado', 'fallido']

/** Id de job seguro: solo `[A-Za-z0-9_-]` (se usa como nombre de carpeta de salida). */
const ID_VALIDO = /^[A-Za-z0-9_-]+$/

const EJEMPLO =
  'p. ej. «laborables 9:00», «cada 30m», «cada lunes a las 9», «en 2h», ' +
  '«2026-10-20T09:00:00» o «0 9 * * 1-5»'

const DIAS_SEMANA = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

/** Unidad de duración en minutos (nombres normalizados, sin acentos). */
const UNIDADES_MIN = {
  m: 1, min: 1, minuto: 1, minutos: 1,
  h: 60, hora: 60, horas: 60,
  d: 1440, dia: 1440, dias: 1440,
}

/** Normaliza texto: minúsculas y sin acentos (para el parser de frases). */
const N = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

// ------------------------------------------------------------ evaluador cron (5 campos)

/**
 * Parsea un campo cron (asterisco, `a`, `a-b`, `a,b`, `a/step`, `a-b/step`) a un Set.
 * `N/step` significa desde N hasta el máximo del campo con ese paso (p. ej. `5/15` en
 * minutos → 5, 20, 35, 50), como en cron estándar.
 */
function parsearCampo(campo, min, max) {
  const set = new Set()
  for (const parte of String(campo).split(',')) {
    let cuerpo = parte
    let step = 1
    let conPaso = false
    const barra = parte.indexOf('/')
    if (barra >= 0) {
      conPaso = true
      cuerpo = parte.slice(0, barra)
      step = parseInt(parte.slice(barra + 1), 10)
      if (!Number.isFinite(step) || step <= 0) return null
    }
    let ini
    let fin
    if (cuerpo === '*') { ini = min; fin = max }
    else if (cuerpo.includes('-')) {
      const [a, b] = cuerpo.split('-')
      ini = parseInt(a, 10); fin = parseInt(b, 10)
    } else {
      ini = parseInt(cuerpo, 10)
      // `N/step` → de N al máximo del campo; `N` a secas → solo N.
      fin = conPaso ? max : ini
    }
    if (!Number.isFinite(ini) || !Number.isFinite(fin)) return null
    if (ini < min || fin > max || ini > fin) return null
    for (let v = ini; v <= fin; v += step) set.add(v)
  }
  return set.size ? set : null
}

/** ¿El campo es «libre» (asterisco, o asterisco con paso 1)? Base de la semántica DOM/DOW. */
const esLibre = (campo) => campo === '*' || campo === '*/1'

/** Valida SOLO la sintaxis de una expresión cron de 5 campos (sin calcular siguiente). */
function cronSintaxisValida(expr) {
  const campos = String(expr || '').trim().split(/\s+/)
  if (campos.length !== 5) return false
  const [cMin, cHora, cDom, cMes, cDow] = campos
  return Boolean(
    parsearCampo(cMin, 0, 59) && parsearCampo(cHora, 0, 23) &&
    parsearCampo(cDom, 1, 31) && parsearCampo(cMes, 1, 12) && parsearCampo(cDow, 0, 7),
  )
}

/** Horizonte máximo de búsqueda de la próxima ejecución (~8 años). */
const HORIZONTE_CRON_MS = 8 * 366 * 24 * 60 * 60 * 1000

/**
 * Valida una expresión cron de 5 campos: sintaxis correcta **y** con al menos una
 * próxima ejecución en el horizonte (rechaza «crones imposibles» como `0 0 30 2 *`).
 */
export function validarCron(expr) {
  if (!cronSintaxisValida(expr)) return false
  return siguienteCron(expr, Date.now()) != null
}

/**
 * Siguiente instante (ms) que casa la expresión cron, estrictamente después de
 * `desdeMs`. Avanza a saltos (mes → día → hora → minuto) para no recorrer minuto a
 * minuto si el hueco es grande; el tope de búsqueda es de ~8 años.
 */
function siguienteCron(expr, desdeMs) {
  const campos = String(expr || '').trim().split(/\s+/)
  if (campos.length !== 5) return null
  const [cMin, cHora, cDom, cMes, cDow] = campos
  const min = parsearCampo(cMin, 0, 59)
  const hora = parsearCampo(cHora, 0, 23)
  const dom = parsearCampo(cDom, 1, 31)
  const mes = parsearCampo(cMes, 1, 12)
  const dow = parsearCampo(cDow, 0, 7)
  if (!min || !hora || !dom || !mes || !dow) return null
  const domLibre = esLibre(cDom)
  const dowLibre = esLibre(cDow)
  const MIN = 60 * 1000
  let t = Math.floor(desdeMs / MIN) * MIN + MIN // primer minuto estrictamente posterior
  const limite = t + HORIZONTE_CRON_MS
  while (t <= limite) {
    const d = new Date(t)
    // Mes: salta al primer día del mes siguiente a medianoche.
    if (!mes.has(d.getMonth() + 1)) {
      t = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime()
      continue
    }
    const dia = d.getDate()
    const semana = d.getDay()
    const domOk = dom.has(dia)
    const dowOk = dow.has(semana) || (semana === 0 && dow.has(7))
    const diaOk = (domLibre && dowLibre) ? true
      : domLibre ? dowOk
        : dowLibre ? domOk
          : (domOk || dowOk)
    // Día: salta al día siguiente a medianoche.
    if (!diaOk) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
      continue
    }
    // Hora: salta a la hora siguiente en punto.
    if (!hora.has(d.getHours())) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0, 0).getTime()
      continue
    }
    // Minuto: avanza al siguiente minuto (máx. 60 iteraciones por hora).
    if (!min.has(d.getMinutes())) { t += MIN; continue }
    return t
  }
  return null
}

/** Siguiente instante (ms) de un `schedule` tipado, o null (once ya pasado / inválido). */
export function siguiente(schedule, desdeMs = Date.now()) {
  if (!schedule || typeof schedule !== 'object') return null
  if (schedule.kind === 'interval') {
    const m = Number(schedule.minutos)
    return Number.isFinite(m) && m > 0 ? desdeMs + m * 60 * 1000 : null
  }
  if (schedule.kind === 'once') {
    const t = Date.parse(schedule.ejecutar_en)
    if (!Number.isFinite(t)) return null
    return t > desdeMs ? t : null
  }
  if (schedule.kind === 'cron') return siguienteCron(schedule.expr, desdeMs)
  return null
}

// ------------------------------------------------------------ parser de frases (R6.2)

const err = (error) => ({ ok: false, error, ejemplo: EJEMPLO })

/** Intenta interpretar `texto` como fecha ISO (once); null si no lo es. */
function intentarIso(texto, ahora) {
  const re = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
  const m = re.exec(texto)
  if (!m) return null
  let ms
  if (m[4] === undefined) {
    ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  } else if (m[8]) {
    ms = Date.parse(texto)
  } else {
    ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime()
  }
  if (!Number.isFinite(ms)) return null
  if (ms <= ahora()) return err('la fecha ya pasó')
  return { ok: true, schedule: { kind: 'once', ejecutar_en: new Date(ms).toISOString() } }
}

/** Construye un `schedule` cron a partir de hora (y minutos opcionales) y campo de día. */
function cronConHora(hora, minutos, campoDia) {
  const h = parseInt(hora, 10)
  if (!Number.isFinite(h) || h < 0 || h > 23) return null
  const mm = minutos === undefined || minutos === null ? 0 : parseInt(minutos, 10)
  if (!Number.isFinite(mm) || mm < 0 || mm > 59) return null
  const expr = `${mm} ${h} * * ${campoDia}`
  return validarCron(expr) ? { kind: 'cron', expr } : null
}

/**
 * Convierte una frase (español o inglés) a un `schedule` tipado.
 *
 * Entiende: «cada lunes a las 9», «laborables 9:00», «cada 30m» / «every 30m»,
 * «cada 2h», «en 2h» / «in 2h», una fecha ISO (once) y una expresión cron de 5
 * campos tal cual. Lo no entendido devuelve `{ok:false, error, ejemplo}`; una fecha
 * once en el pasado se rechaza.
 */
export function parsearSchedule(frase, { ahora = () => Date.now() } = {}) {
  const original = String(frase ?? '').trim()
  if (!original) return err('frase vacía')
  const t = N(original)

  // 1 · Fecha ISO (once).
  const iso = intentarIso(original, ahora)
  if (iso) return iso

  // 2 · Cron de 5 campos tal cual.
  const tokens = original.split(/\s+/)
  if (tokens.length === 5 && tokens.every((x) => /^[0-9*/,-]+$/.test(x)) && validarCron(tokens.join(' '))) {
    return { ok: true, schedule: { kind: 'cron', expr: tokens.join(' ') } }
  }

  // 3 · «en 2h» / «in 30m» → once.
  const mEn = /^(?:en|in)\s+(\d+)\s*([a-z]+)$/.exec(t)
  if (mEn) {
    const unidad = UNIDADES_MIN[mEn[2]]
    if (unidad) {
      const ms = ahora() + parseInt(mEn[1], 10) * unidad * 60 * 1000
      return { ok: true, schedule: { kind: 'once', ejecutar_en: new Date(ms).toISOString() } }
    }
    return err('unidad de tiempo no reconocida')
  }

  // 4 · «cada 30m» / «every 2h» → interval.
  const mCada = /^(?:cada|every)\s+(\d+)\s*([a-z]+)$/.exec(t)
  if (mCada) {
    const unidad = UNIDADES_MIN[mCada[2]]
    if (unidad) return { ok: true, schedule: { kind: 'interval', minutos: parseInt(mCada[1], 10) * unidad } }
    return err('unidad de tiempo no reconocida')
  }

  // 5 · «cada día a las H» / «cada day at H».
  const mDia = /^(?:cada|every)\s+(?:dia|day)\s+(?:a\s+las\s+|at\s+)?(\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (mDia) {
    const s = cronConHora(mDia[1], mDia[2], '*')
    return s ? { ok: true, schedule: s } : err('hora inválida')
  }

  // 6 · «laborables 9:00» / «weekdays 9:00» → L-V.
  const mLab = /^(?:laborables|dias laborables|weekdays)\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (mLab) {
    const s = cronConHora(mLab[1], mLab[2], '1-5')
    return s ? { ok: true, schedule: s } : err('hora inválida')
  }

  // 7 · «cada lunes a las 9» / «every monday at 9».
  const mDiaSemana = /^(?:cada|every)\s+([a-z]+)\s+(?:a\s+las\s+|at\s+)?(\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (mDiaSemana) {
    const dow = DIAS_SEMANA[mDiaSemana[1]]
    if (dow === undefined) return err(`día de la semana no reconocido: «${mDiaSemana[1]}»`)
    const s = cronConHora(mDiaSemana[2], mDiaSemana[3], String(dow))
    return s ? { ok: true, schedule: s } : err('hora inválida')
  }

  return err('no he entendido la programación')
}

// ------------------------------------------------------------ utilidades de fichero

/** Lee un JSON tolerando ausencia o corrupción (devuelve `defecto`). */
function leerJson(archivo, defecto) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')) } catch { return defecto }
}

/** Escritura atómica tmp+rename, con reintento y relectura de control (bind mounts). */
function escribirAtomico(archivo, texto) {
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

/** Normaliza un `schedule` entrante; devuelve el schedule saneado o null. */
function normalizarSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null
  if (schedule.kind === 'cron') {
    const expr = String(schedule.expr || '').trim()
    return validarCron(expr) ? { kind: 'cron', expr } : null
  }
  if (schedule.kind === 'interval') {
    const m = Number(schedule.minutos)
    return Number.isFinite(m) && m > 0 ? { kind: 'interval', minutos: m } : null
  }
  if (schedule.kind === 'once') {
    const ms = Date.parse(schedule.ejecutar_en)
    return Number.isFinite(ms) ? { kind: 'once', ejecutar_en: new Date(ms).toISOString() } : null
  }
  return null
}

// ------------------------------------------------------------ cron

/**
 * Crea el planificador sobre `dataDir` (`hub-data/`).
 *
 *   lanzador   · `crearLanzador()` (R0), inyectable en pruebas.
 *   reglas     · reglas cargadas del hub (`reglas.presupuestos[agente]` = tope de coste).
 *   ahora      · reloj inyectable (ms).
 *   preflight  · validador previo al disparo; por defecto usa `lanzador.agentes()`.
 */
export function crearCron({
  dataDir,
  lanzador = null,
  reglas = {},
  ahora = () => Date.now(),
  preflight = null,
} = {}) {
  if (!dataDir) throw new Error('crearCron: falta dataDir')
  const dirCron = path.join(dataDir, 'cron')
  const archivo = path.join(dirCron, 'jobs.json')
  const archivoAvisos = path.join(dirCron, 'avisos.json')
  const dirSalida = path.join(dirCron, 'salida')

  const jobs = new Map()
  const borrados = new Set()
  let avisos = []
  let enTick = false

  const nuevoId = (prefijo) => prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  // ----- jobs.json

  /** Lee `jobs.json` (tolerante a ausencia o corrupción); descarta ids no seguros. */
  function leerArchivo() {
    const j = leerJson(archivo, null)
    const lista = Array.isArray(j) ? j : (Array.isArray(j?.jobs) ? j.jobs : [])
    return lista.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && ID_VALIDO.test(e.id))
  }

  /** Ids de jobs borrados (tombstones) recordados en `jobs.json`. */
  function leerBorradosDisco() {
    const j = leerJson(archivo, null)
    const lista = Array.isArray(j) ? [] : (Array.isArray(j?.borrados) ? j.borrados : [])
    return lista.filter((x) => typeof x === 'string' && ID_VALIDO.test(x))
  }

  /**
   * Read-merge-write: relee el disco, une (la memoria gana) y aplica DESPUÉS la unión
   * de tombstones (disco + memoria), de modo que un job borrado por otra instancia no
   * resucita aunque siga en memoria. Escribe `jobs` + `borrados` (últimas 200 bajas).
   */
  function guardar() {
    const porId = new Map()
    for (const j of leerArchivo()) porId.set(j.id, j)
    for (const [id, j] of jobs) porId.set(id, j)
    const bajas = new Set(leerBorradosDisco())
    for (const id of borrados) bajas.add(id)
    for (const id of bajas) porId.delete(id)
    const lista = [...porId.values()]
    jobs.clear()
    for (const j of lista) jobs.set(j.id, j)
    const listaBajas = [...bajas].slice(-BORRADOS_MAX)
    borrados.clear()
    for (const id of listaBajas) borrados.add(id)
    escribirAtomico(archivo, JSON.stringify({ actualizado: ahora(), jobs: lista, borrados: listaBajas }, null, 2) + '\n')
    return lista
  }

  /** Reconstruye la memoria desde el disco (lo llama `tick`/los mutadores). */
  function refrescarDesdeDisco() {
    // Olvida los ids que el disco marca como borrados (y los recuerda como bajas).
    for (const id of leerBorradosDisco()) { borrados.add(id); jobs.delete(id) }
    for (const j of leerArchivo()) if (!borrados.has(j.id)) jobs.set(j.id, j)
  }

  // ----- avisos.json (barra del panel)

  function leerAvisosDisco() {
    const j = leerJson(archivoAvisos, null)
    return Array.isArray(j?.avisos) ? j.avisos : []
  }

  function avisar({ tipo, jobId = null, mensaje }) {
    const a = { id: nuevoId('a_'), fecha: new Date(ahora()).toISOString(), tipo, jobId, mensaje: String(mensaje || '') }
    avisos.push(a)
    if (avisos.length > 200) avisos = avisos.slice(-200)
    escribirAtomico(archivoAvisos, JSON.stringify({ actualizado: ahora(), avisos }, null, 2) + '\n')
    return a
  }

  // ----- salida

  function escribirSalida(job, resultado, t) {
    // Saneo del id: solo [A-Za-z0-9_-]. Si no es seguro, no se escribe (ni se sale del dir).
    if (!ID_VALIDO.test(String(job?.id || ''))) {
      avisar({ tipo: 'id_invalido', jobId: String(job?.id ?? ''), mensaje: `Id de job no seguro («${job?.id}»): no se escribe la salida` })
      return null
    }
    try {
      const dir = path.join(dirSalida, job.id)
      fs.mkdirSync(dir, { recursive: true })
      const nombre = new Date(t).toISOString().replace(/[:.]/g, '-') + '.md'
      const destino = path.join(dir, nombre)
      const lineas = [
        `# Job programado: ${job.nombre}`,
        '',
        `- id: ${job.id}`,
        `- agente: ${job.destino.agente}`,
        `- directory: ${job.destino.directory || '(sin directorio)'}`,
        `- schedule: ${JSON.stringify(job.schedule)}`,
        `- ejecutado: ${new Date(t).toISOString()}`,
        `- tope de coste (reglas.json): ${resultado.presupuesto != null ? resultado.presupuesto : 'sin tope configurado'}`,
        `- resultado: ${resultado.ok ? 'lanzado' : 'error'}`,
      ]
      if (resultado.sessionId) lineas.push(`- sesión OpenCode: ${resultado.sessionId}`)
      if (resultado.messageId) lineas.push(`- mensaje: ${resultado.messageId}`)
      if (resultado.codigo) lineas.push(`- código de error: ${resultado.codigo}`)
      if (resultado.error) lineas.push(`- detalle: ${resultado.error}`)
      if (resultado.avisos && resultado.avisos.length) {
        lineas.push('', '## Avisos del preflight', '')
        for (const a of resultado.avisos) lineas.push(`- ${a}`)
      }
      if (resultado.presupuesto == null) {
        lineas.push('', '> Nota: el tope de coste no está configurado para este agente en `reglas.json`; no se vigila el gasto.')
      } else {
        lineas.push('', `> Nota: el tope de coste (${resultado.presupuesto}) se vigila en cada \`tick()\` con \`lanzador.costeSesion()\`; al alcanzarlo se aborta la sesión.`)
      }
      lineas.push('', '## Prompt', '', job.prompt || '', '')
      escribirAtomico(destino, lineas.join('\n'))
      return destino
    } catch { return null }
  }

  /** Anota en `cron/salida/<id>/` un evento de la vigilancia de coste (R6.4). */
  function escribirSalidaVigilancia(job, v, datos) {
    if (!ID_VALIDO.test(String(job?.id || ''))) return null
    try {
      const dir = path.join(dirSalida, job.id)
      fs.mkdirSync(dir, { recursive: true })
      const nombre = new Date(ahora()).toISOString().replace(/[:.]/g, '-') + `.vigilancia-${datos.motivo}.md`
      const destino = path.join(dir, nombre)
      const lineas = [
        `# Vigilancia de coste: ${job.nombre}`,
        '',
        `- id: ${job.id}`,
        `- sesión OpenCode: ${v.sessionId}`,
        `- momento: ${new Date(ahora()).toISOString()}`,
        `- coste observado: ${datos.coste != null ? datos.coste : 'desconocido'}`,
        `- tope de coste: ${v.presupuesto}`,
        `- motivo: ${datos.motivo}`,
      ]
      if (datos.abortado != null) lineas.push(`- sesión abortada: ${datos.abortado ? 'sí' : 'no'}`)
      escribirAtomico(destino, lineas.join('\n') + '\n')
      return destino
    } catch { return null }
  }

  // ----- preflight

  /**
   * Preflight por defecto (R6.3): si OpenCode responde, el agente debe existir
   * (fail-closed). Si no responde, se avisa y se sigue (fail-open; el lanzamiento
   * fallará con su propio error). Limitación: `lanzador` no expone la comprobación
   * del proveedor configurado, así que no se verifica aquí.
   */
  async function preflightPorDefecto(job) {
    if (!lanzador || typeof lanzador.agentes !== 'function') {
      return { ok: true, avisos: ['sin lanzador inyectado: no se puede verificar el agente'] }
    }
    const lista = await lanzador.agentes()
    if (!lista || lista.ok === false) {
      return { ok: true, avisos: [`OpenCode no disponible (${(lista && lista.error) || 'sin respuesta'}); se intenta lanzar igualmente`] }
    }
    if (!Array.isArray(lista.agentes) || !lista.agentes.includes(job.destino.agente)) {
      return { ok: false, motivo: `el agente «${job.destino.agente}» no existe en el servidor`, disponibles: lista.agentes || [] }
    }
    return { ok: true, avisos: [] }
  }

  // ----- ejecución

  /** Ejecuta un job ya reclamado: preflight → lanzar → estado/reintentos/salida. */
  async function ejecutarUno(job) {
    const t = ahora()
    let pf
    try {
      pf = await (preflight || preflightPorDefecto)(job)
    } catch (e) {
      pf = { ok: false, motivo: `preflight falló: ${String(e?.message || e)}` }
    }

    // FAIL-CLOSED: agente inexistente → no se lanza, el job pasa a error con motivo.
    if (pf && pf.ok === false) {
      job.estado = 'fallido'
      job.motivo = pf.motivo
      job.claim = null
      job.ultimo = t
      guardar()
      avisar({ tipo: 'fail_closed', jobId: job.id, mensaje: `Job «${job.nombre}» no lanzado: ${pf.motivo}` })
      escribirSalida(job, { ok: false, error: pf.motivo, avisos: [] }, t)
      return { jobId: job.id, ok: false, codigo: 'fail_closed', motivo: pf.motivo }
    }
    // FAIL-OPEN: avisos que no bloquean.
    const avisosPf = (pf && pf.avisos) || []
    for (const a of avisosPf) avisar({ tipo: 'fail_open', jobId: job.id, mensaje: `Job «${job.nombre}»: ${a}` })

    const presupuesto = reglas?.presupuestos?.[job.destino.agente] ?? null
    let r
    try {
      // `lanzarJob` no acepta tope de coste: este se aplica después con la vigilancia.
      r = await lanzador.lanzarJob({
        agente: job.destino.agente,
        directory: job.destino.directory,
        prompt: job.prompt,
        titulo: `cron:${job.nombre}`,
      })
    } catch (e) {
      r = { ok: false, codigo: 'servidor_inalcanzable', error: String(e?.message || e) }
    }

    if (r && r.ok) {
      job.ultimo = t
      job.reintentos = 0
      job.claim = null
      job.motivo = null
      // R6.4 · tope de coste real: se vigila la sesión lanzada en cada `tick()`.
      const tope = Number(presupuesto)
      job.vigilancia = (Number.isFinite(tope) && tope > 0 && r.sessionId)
        ? { sessionId: r.sessionId, directory: job.destino.directory || null, presupuesto: tope, desde: t }
        : null
      if (job.schedule.kind === 'once') { job.estado = 'completado'; job.siguiente = null }
      else job.siguiente = siguiente(job.schedule, ahora())
      guardar()
      escribirSalida(job, { ok: true, sessionId: r.sessionId, messageId: r.messageId, presupuesto, avisos: avisosPf }, t)
      return { jobId: job.id, ok: true, sessionId: r.sessionId }
    }

    // Fallo al lanzar.
    const codigo = (r && r.codigo) || 'error_job'
    if (codigo === 'servidor_inalcanzable') {
      if (job.reintentos < RETRASOS_MIN.length) {
        job.reintentos++
        job.claim = null
        job.siguiente = ahora() + RETRASOS_MIN[job.reintentos - 1] * 60 * 1000
        guardar()
        avisar({ tipo: 'reintento', jobId: job.id, mensaje: `Job «${job.nombre}»: OpenCode inalcanzable; reintento ${job.reintentos}/${RETRASOS_MIN.length} en ${RETRASOS_MIN[job.reintentos - 1]} min` })
        escribirSalida(job, { ok: false, codigo, error: r.error, presupuesto, avisos: avisosPf }, t)
        return { jobId: job.id, ok: false, codigo, reintento: job.reintentos }
      }
      job.estado = 'fallido'
      job.motivo = `OpenCode inalcanzable tras ${RETRASOS_MIN.length} reintentos`
      job.claim = null
      job.siguiente = null
      job.ultimo = t
      guardar()
      avisar({ tipo: 'fallido', jobId: job.id, mensaje: `Job «${job.nombre}» fallido: ${job.motivo}` })
      escribirSalida(job, { ok: false, codigo, error: r.error, presupuesto, avisos: avisosPf }, t)
      return { jobId: job.id, ok: false, codigo: 'fallido' }
    }

    // Otros errores: fallido con motivo y aviso.
    job.estado = 'fallido'
    job.motivo = (r && r.error) || 'error al lanzar'
    job.claim = null
    job.siguiente = null
    job.ultimo = t
    guardar()
    avisar({ tipo: 'fallido', jobId: job.id, mensaje: `Job «${job.nombre}» fallido: ${job.motivo}` })
    escribirSalida(job, { ok: false, codigo, error: r && r.error, presupuesto, avisos: avisosPf }, t)
    return { jobId: job.id, ok: false, codigo }
  }

  const claimVivo = (job, t) => Boolean(job.claim && job.claim.hasta > t)

  /** ¿Dos instantes caen en el mismo minuto de reloj local? (guarda contra el DST fall-back). */
  function mismaMinutoLocal(a, b) {
    if (a == null || b == null) return false
    const da = new Date(a)
    const db = new Date(b)
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate() && da.getHours() === db.getHours() && da.getMinutes() === db.getMinutes()
  }

  /**
   * Vigila el coste de los jobs con `vigilancia` (R6.4). Con `lanzador.costeSesion()`:
   *   · si `coste >= presupuesto` → aborta la sesión (`abortarSesion`), avisa `tope_coste`,
   *     anota la salida y limpia la vigilancia (una sola vez);
   *   · si la sesión terminó → anota el coste final y limpia;
   *   · si lleva más de 2 h → limpia con aviso.
   * Devuelve las acciones tomadas.
   */
  async function vigilar() {
    const t = ahora()
    const pendientes = [...jobs.values()].filter((j) => j.vigilancia && j.vigilancia.sessionId)
    const acciones = []
    for (const job of pendientes) {
      const v = job.vigilancia
      let info = null
      try {
        info = typeof lanzador?.costeSesion === 'function'
          ? await lanzador.costeSesion({ sessionId: v.sessionId, directory: v.directory })
          : null
      } catch (e) {
        info = { ok: false, error: String(e?.message || e) }
      }
      const coste = info && info.ok ? info.coste : null
      const completado = Boolean(info && info.ok && info.completado)
      const caducada = (t - (v.desde || t)) > VIGILANCIA_MAX_MS

      if (coste != null && Number(v.presupuesto) > 0 && coste >= Number(v.presupuesto)) {
        let abortado = false
        if (typeof lanzador?.abortarSesion === 'function') {
          try {
            const ab = await lanzador.abortarSesion({ sessionId: v.sessionId, directory: v.directory })
            abortado = Boolean(ab && ab.ok)
          } catch { /* sin abortar: se anota igual */ }
        }
        escribirSalidaVigilancia(job, v, { coste, motivo: 'tope_coste', abortado })
        avisar({
          tipo: 'tope_coste',
          jobId: job.id,
          mensaje: `Job «${job.nombre}»: coste ${coste} ≥ tope ${v.presupuesto}; sesión ${abortado ? 'abortada' : 'no abortada'}`,
        })
        job.vigilancia = null
        guardar()
        acciones.push({ jobId: job.id, accion: 'tope_coste', coste })
        continue
      }
      if (completado) {
        escribirSalidaVigilancia(job, v, { coste, motivo: 'completada' })
        job.vigilancia = null
        guardar()
        acciones.push({ jobId: job.id, accion: 'completada', coste })
        continue
      }
      if (caducada) {
        escribirSalidaVigilancia(job, v, { coste, motivo: 'caducada' })
        avisar({ tipo: 'vigilancia', jobId: job.id, mensaje: `Job «${job.nombre}»: vigilancia de coste caducada (>2 h); se deja de medir` })
        job.vigilancia = null
        guardar()
        acciones.push({ jobId: job.id, accion: 'caducada', coste })
      }
    }
    return acciones
  }

  /** Limpia claims caducados (recuperación al arrancar, R6.6). Devuelve cuántos liberó. */
  function recuperar() {
    const t = ahora()
    let liberados = 0
    for (const j of jobs.values()) {
      if (j.claim && j.claim.hasta <= t) { j.claim = null; liberados++ }
    }
    if (liberados) guardar()
    return { liberados }
  }

  /** Ejecuta los jobs vencidos, reclamando cada uno antes de lanzarlo (R6.4/R6.6). */
  async function tick() {
    if (enTick) return { ocupado: true, ejecutados: [], vigilados: [] }
    enTick = true
    try {
      refrescarDesdeDisco()
      recuperar()
      const vigilados = await vigilar()
      const t = ahora()
      const vencidos = [...jobs.values()].filter(
        (j) => j.estado === 'activo' && j.siguiente != null && j.siguiente <= t && !claimVivo(j, t),
      )
      const ejecutados = []
      for (const job of vencidos) {
        // DST fall-back: si la ejecución prevista cae en el mismo minuto local que la
        // última ejecución, no se repite: se adelanta el calendario.
        if (mismaMinutoLocal(job.ultimo, job.siguiente)) {
          job.siguiente = siguiente(job.schedule, t)
          guardar()
          continue
        }
        // Claim ANTES de lanzar: un reinicio o un segundo tick no lo duplican.
        job.claim = { id: nuevoId('cl_'), hasta: ahora() + CLAIM_TTL_MS }
        guardar()
        ejecutados.push(await ejecutarUno(job))
      }
      return { ocupado: false, ejecutados, vigilados }
    } finally {
      enTick = false
    }
  }

  // ----- API de gestión

  function crear({ nombre, schedule, destino = {}, prompt, aprobado_usuario = false } = {}) {
    if (typeof nombre !== 'string' || !nombre.trim()) return { ok: false, error: 'falta nombre' }
    // Cron imposible: sintaxis correcta pero sin próxima ocurrencia en 8 años.
    if (schedule && schedule.kind === 'cron') {
      const expr = String(schedule.expr || '').trim()
      if (cronSintaxisValida(expr) && siguienteCron(expr, ahora()) == null) {
        return { ok: false, error: `programación imposible: «${expr}» no se ejecutará nunca (sin próxima ocurrencia en 8 años)` }
      }
    }
    const sched = normalizarSchedule(schedule)
    if (!sched) return { ok: false, error: 'schedule inválido' }
    const agente = destino && destino.agente
    if (!agente || typeof agente !== 'string') return { ok: false, error: 'falta destino.agente' }
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'falta prompt' }
    // R6.7 · consigna ligera: los agentes que escriben/ejecutan exigen aprobación del usuario.
    if (AGENTES_ESCRITURA.includes(agente) && aprobado_usuario !== true) {
      return {
        ok: false,
        codigo: 'requiere_aprobacion',
        error: `el agente «${agente}» escribe o ejecuta código; vuelve a enviarlo con «aprobado_usuario:true» para confirmarlo`,
      }
    }
    const t = ahora()
    const sig = sched.kind === 'once' ? Date.parse(sched.ejecutar_en) : siguiente(sched, t)
    if (sched.kind === 'once' && (!Number.isFinite(sig) || sig <= t)) return { ok: false, error: 'la fecha ya pasó' }
    if (sched.kind === 'cron' && sig == null) {
      return { ok: false, error: `programación imposible: «${sched.expr}» no se ejecutará nunca (sin próxima ocurrencia en 8 años)` }
    }
    const job = {
      id: nuevoId('cron_'),
      nombre: nombre.trim(),
      schedule: sched,
      destino: { agente, directory: destino.directory || null },
      prompt,
      siguiente: sig,
      estado: 'activo',
      ultimo: null,
      reintentos: 0,
      claim: null,
      creado: t,
    }
    jobs.set(job.id, job)
    guardar()
    return { ok: true, job: { ...job } }
  }

  function listar() {
    return [...jobs.values()].map((j) => ({ ...j })).sort((a, b) => (a.siguiente ?? Infinity) - (b.siguiente ?? Infinity))
  }

  function obtener(id) {
    const j = jobs.get(id)
    return j ? { ...j } : null
  }

  function pausar(id) {
    refrescarDesdeDisco()
    const j = jobs.get(id)
    if (!j) return { ok: false, error: 'job no encontrado' }
    j.estado = 'pausado'
    guardar()
    return { ok: true, job: { ...j } }
  }

  function reanudar(id) {
    refrescarDesdeDisco()
    const j = jobs.get(id)
    if (!j) return { ok: false, error: 'job no encontrado' }
    j.estado = 'activo'
    if (j.siguiente == null && j.schedule.kind !== 'once') j.siguiente = siguiente(j.schedule, ahora())
    if (j.motivo) delete j.motivo
    guardar()
    return { ok: true, job: { ...j } }
  }

  function borrar(id) {
    refrescarDesdeDisco()
    if (!jobs.has(id)) return { ok: false, error: 'job no encontrado' }
    jobs.delete(id)
    borrados.add(id)
    guardar()
    return { ok: true, id }
  }

  /** Disparo manual (POST /api/cron/ejecutar): ignora el calendario y ejecuta ya. */
  async function ejecutar(id) {
    refrescarDesdeDisco()
    const j = jobs.get(id)
    if (!j) return { ok: false, error: 'job no encontrado' }
    j.reintentos = 0
    j.claim = { id: nuevoId('cl_'), hasta: ahora() + CLAIM_TTL_MS }
    guardar()
    return ejecutarUno(j)
  }

  function listarAvisos() {
    return avisos.map((a) => ({ ...a }))
  }

  // Carga inicial: tolera fichero ausente o corrupto; respeta tombstones y ids seguros.
  for (const id of leerBorradosDisco()) borrados.add(id)
  for (const j of leerArchivo()) if (!borrados.has(j.id)) jobs.set(j.id, j)
  avisos = leerAvisosDisco()

  return {
    archivo,
    dirSalida,
    crear,
    listar,
    obtener,
    pausar,
    reanudar,
    borrar,
    ejecutar,
    tick,
    recuperar,
    avisos: listarAvisos,
  }
}
