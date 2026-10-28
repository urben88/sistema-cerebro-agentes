/**
 * Uso de Claude Code: coste por subagente (spec 22 · S1) y estadísticas (S2).
 *
 * Los datos salen de los transcripts que Claude Code deja en `~/.claude/projects`:
 *   · sesión       `<proyecto>/<sesion>.jsonl`
 *   · subagentes   `<proyecto>/<sesion>/subagents/agent-<id>.jsonl` (+ `.meta.json` con
 *                  `agentType`, `description`, `model`, `effort`)
 * Cada mensaje `assistant` trae `message.usage` (entrada, salida y caché) y `message.model`.
 * Un mismo `message.id` repetido dentro de un fichero se cuenta una sola vez.
 *
 * El precio por modelo NO está en el código: sale de `precios.json` (la tabla de
 * configuración; `hub-data/precios.json` la pisa). La clave se busca dentro del id del
 * modelo («opus» en `claude-opus-5-5`). Sin precio → coste `null`.
 *
 * Solo lectura, nunca lanza. Resultado por fichero cacheado por (tamaño, mtime).
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'

/** Ventana máxima que se escanea (días): cubre la racha sin leer todo el histórico. */
export const VENTANA_DIAS = 90
const DIA_MS = 24 * 60 * 60 * 1000
const TOKENS_VACIOS = () => ({ entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 })

/** Carga la tabla de precios; los ficheros posteriores pisan a los anteriores por modelo. */
export function cargarPrecios(rutas = []) {
  const tabla = { moneda: 'USD', modelos: {} }
  for (const r of rutas) {
    try {
      const t = JSON.parse(fs.readFileSync(r, 'utf8'))
      if (typeof t.moneda === 'string') tabla.moneda = t.moneda
      for (const [k, p] of Object.entries(t.modelos || {})) {
        if (p && typeof p === 'object') tabla.modelos[k.toLowerCase()] = p
      }
    } catch { /* sin fichero o JSON roto: se ignora */ }
  }
  return tabla
}

/** Precio del modelo (clave más larga contenida en el id) o `null`. */
export function precioDe(modelo, precios) {
  const id = String(modelo || '').toLowerCase()
  const claves = Object.keys(precios?.modelos || {}).sort((a, b) => b.length - a.length)
  const k = claves.find((c) => id.includes(c))
  return k ? precios.modelos[k] : null
}

/** Coste (en la moneda de la tabla) de unos tokens, o `null` si no hay precio. */
export function costeDe(tokens, modelo, precios) {
  const p = precioDe(modelo, precios)
  if (!p) return null
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return (n(tokens.entrada) * n(p.entrada) + n(tokens.salida) * n(p.salida) + n(tokens.cacheLectura) * n(p.cacheLectura) + n(tokens.cacheEscritura) * n(p.cacheEscritura)) / 1e6
}

const sumar = (a, b) => { a.entrada += b.entrada; a.salida += b.salida; a.cacheLectura += b.cacheLectura; a.cacheEscritura += b.cacheEscritura; return a }
const totalTokens = (t) => t.entrada + t.salida + t.cacheLectura + t.cacheEscritura

/** Día local `YYYY-MM-DD` de un instante (ms). */
export function diaLocal(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Parsea un transcript: mensajes con uso (sin duplicados), primer/último instante y cwd. */
function leerTranscript(archivo) {
  const salida = { mensajes: [], primero: null, ultimo: null, cwd: null }
  let texto = ''
  try { texto = fs.readFileSync(archivo, 'utf8') } catch { return salida }
  const vistos = new Set()
  for (const linea of texto.split('\n')) {
    if (!linea) continue
    // Atajo: solo se parsean las líneas con uso, o con marca de tiempo para la duración.
    const conUso = linea.includes('"usage"')
    if (!conUso && !linea.includes('"timestamp"')) continue
    let e
    try { e = JSON.parse(linea) } catch { continue }
    const t = Date.parse(e?.timestamp)
    if (Number.isFinite(t)) {
      if (salida.primero == null || t < salida.primero) salida.primero = t
      if (salida.ultimo == null || t > salida.ultimo) salida.ultimo = t
    }
    if (!salida.cwd && typeof e?.cwd === 'string') salida.cwd = e.cwd
    const m = e?.message
    const u = m?.usage
    if (e?.type !== 'assistant' || !u || !Number.isFinite(t)) continue
    if (typeof m.model !== 'string' || m.model.startsWith('<')) continue // «<synthetic>»
    if (m.id) { if (vistos.has(m.id)) continue; vistos.add(m.id) }
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    salida.mensajes.push({
      t, modelo: m.model,
      tokens: { entrada: n(u.input_tokens), salida: n(u.output_tokens), cacheLectura: n(u.cache_read_input_tokens), cacheEscritura: n(u.cache_creation_input_tokens) },
    })
  }
  return salida
}

/** Lista subdirectorios/ficheros de forma tolerante. */
const listar = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }) } catch { return [] } }

/**
 * Crea el lector de uso.
 *   dirProyectos · `~/.claude/projects` (inyectable en pruebas).
 *   precios      · tabla ya cargada (`cargarPrecios`) o función que la devuelve (se relee
 *                  en cada consulta, así editar `precios.json` no exige reiniciar).
 *   ahora        · reloj inyectable (ms).
 *   jobs         · opcional `() => [eventos job de métricas]` para sumar OpenCode a stats.
 */
export function crearUso({ dirProyectos, precios = { modelos: {} }, ahora = () => Date.now(), jobs = null } = {}) {
  if (!dirProyectos) throw new Error('crearUso: falta dirProyectos')
  const cache = new Map() // ruta -> { firma, datos }
  const tabla = () => (typeof precios === 'function' ? precios() : precios)

  function transcript(ruta, stat) {
    const firma = `${stat.size}:${stat.mtimeMs}`
    const c = cache.get(ruta)
    if (c && c.firma === firma) return c.datos
    const datos = leerTranscript(ruta)
    cache.set(ruta, { firma, datos })
    return datos
  }

  /** Recorre los transcripts tocados en la ventana: `{ruta, stat, proyectoDir, sesion, subagente}`. */
  function* recorrer(dias) {
    const corte = ahora() - dias * DIA_MS
    for (const p of listar(dirProyectos)) {
      if (!p.isDirectory()) continue
      const dirP = path.join(dirProyectos, p.name)
      for (const f of listar(dirP)) {
        const ruta = path.join(dirP, f.name)
        if (f.isFile() && f.name.endsWith('.jsonl')) {
          const stat = safeStat(ruta)
          if (stat && stat.mtimeMs >= corte) yield { ruta, stat, proyectoDir: p.name, sesion: f.name.slice(0, -6), subagente: null }
        } else if (f.isDirectory()) {
          const dirS = path.join(ruta, 'subagents')
          for (const s of listar(dirS)) {
            if (!s.isFile() || !s.name.endsWith('.jsonl')) continue
            const rs = path.join(dirS, s.name)
            const stat = safeStat(rs)
            if (stat && stat.mtimeMs >= corte) yield { ruta: rs, stat, proyectoDir: p.name, sesion: f.name, subagente: s.name.replace(/\.jsonl$/, '') }
          }
        }
      }
    }
  }

  /** Subagentes con tokens, coste, modelo y duración (S1), del más reciente al más antiguo. */
  function agentes({ dias = 7, limite = 50, sesion = null } = {}) {
    const t = tabla()
    const lista = []
    try {
      for (const f of recorrer(Math.min(dias, VENTANA_DIAS))) {
        if (!f.subagente) continue
        if (sesion && f.sesion !== sesion) continue
        const d = transcript(f.ruta, f.stat)
        if (!d.mensajes.length) continue
        let meta = {}
        try { meta = JSON.parse(fs.readFileSync(f.ruta.replace(/\.jsonl$/, '.meta.json'), 'utf8')) } catch { /* sin meta */ }
        const tokens = TOKENS_VACIOS()
        const porModelo = new Map()
        for (const m of d.mensajes) { sumar(tokens, m.tokens); porModelo.set(m.modelo, (porModelo.get(m.modelo) || 0) + m.tokens.salida) }
        // Modelo principal = el que más salida generó; el coste suma cada mensaje con su precio.
        const modelo = [...porModelo.entries()].sort((a, b) => b[1] - a[1])[0][0]
        let coste = 0
        let sinPrecio = false
        for (const m of d.mensajes) { const c = costeDe(m.tokens, m.modelo, t); if (c == null) sinPrecio = true; else coste += c }
        lista.push({
          id: f.subagente.replace(/^agent-/, ''),
          agente: meta.agentType || 'subagente',
          descripcion: typeof meta.description === 'string' ? meta.description.slice(0, 200) : null,
          esfuerzo: meta.effort || null,
          sesion: f.sesion,
          proyecto: d.cwd || f.proyectoDir,
          modelo,
          tokens,
          coste: sinPrecio && coste === 0 ? null : coste,
          duracionMs: d.primero != null && d.ultimo != null ? d.ultimo - d.primero : null,
          inicio: d.primero,
          fin: d.ultimo,
        })
      }
    } catch { /* lectura best-effort */ }
    lista.sort((a, b) => (b.fin || 0) - (a.fin || 0))
    const total = lista.reduce((a, x) => ({ tokens: sumar(a.tokens, x.tokens), coste: a.coste + (x.coste || 0) }), { tokens: TOKENS_VACIOS(), coste: 0 })
    const lim = Math.max(1, Math.min(parseInt(limite, 10) || 50, 500))
    return { agentes: lista.slice(0, lim), total: { agentes: lista.length, ...total }, moneda: t.moneda || 'USD' }
  }

  /** Estadísticas de uso por modelo, día y proyecto, más racha de días (S2). */
  function stats({ dias = 30 } = {}) {
    const t = tabla()
    const hoy = diaLocal(ahora())
    const desde = diaLocal(ahora() - (Math.max(1, dias) - 1) * DIA_MS)
    const porModelo = new Map(); const porDia = new Map(); const porProyecto = new Map()
    const diasActivos = new Set()
    const total = { tokens: TOKENS_VACIOS(), coste: 0, mensajes: 0 }
    const acum = (mapa, clave, tokens, coste) => {
      const a = mapa.get(clave) || { tokens: TOKENS_VACIOS(), coste: 0, mensajes: 0 }
      sumar(a.tokens, tokens); a.coste += coste; a.mensajes++
      mapa.set(clave, a)
    }
    try {
      for (const f of recorrer(VENTANA_DIAS)) {
        const d = transcript(f.ruta, f.stat)
        const proyecto = d.cwd || f.proyectoDir
        for (const m of d.mensajes) {
          const dia = diaLocal(m.t)
          diasActivos.add(dia)
          if (dia < desde || dia > hoy) continue
          const c = costeDe(m.tokens, m.modelo, t) || 0
          acum(porModelo, m.modelo, m.tokens, c)
          acum(porDia, dia, m.tokens, c)
          acum(porProyecto, proyecto, m.tokens, c)
          sumar(total.tokens, m.tokens); total.coste += c; total.mensajes++
        }
      }
    } catch { /* lectura best-effort */ }
    const lista = (mapa, campo) => [...mapa.entries()].map(([k, v]) => ({ [campo]: k, ...v, totalTokens: totalTokens(v.tokens) }))
    return {
      dias, desde, hasta: hoy, moneda: t.moneda || 'USD',
      total: { ...total, totalTokens: totalTokens(total.tokens) },
      porModelo: lista(porModelo, 'modelo').sort((a, b) => b.coste - a.coste || b.totalTokens - a.totalTokens),
      porDia: lista(porDia, 'dia').sort((a, b) => (a.dia < b.dia ? -1 : 1)),
      porProyecto: lista(porProyecto, 'proyecto').sort((a, b) => b.coste - a.coste || b.totalTokens - a.totalTokens),
      racha: racha(diasActivos, hoy),
      opencode: opencode(jobs, desde, hoy),
    }
  }

  return { agentes, stats }
}

function safeStat(r) { try { return fs.statSync(r) } catch { return null } }

/** Racha de días consecutivos con uso. «Actual» sigue viva si hoy aún no hay uso pero ayer sí. */
export function racha(dias, hoy) {
  const ant = (dia) => diaLocal(Date.parse(`${dia}T12:00:00`) - DIA_MS)
  let actual = 0
  let c = dias.has(hoy) ? hoy : ant(hoy)
  while (dias.has(c)) { actual++; c = ant(c) }
  let mejor = 0; let corrida = 0; let previo = null
  for (const dia of [...dias].sort()) {
    corrida = previo && ant(dia) === previo ? corrida + 1 : 1
    if (corrida > mejor) mejor = corrida
    previo = dia
  }
  return { actual, mejor }
}

/** Trabajos de OpenCode (eventos `job` de las métricas del hub) en el mismo periodo. */
function opencode(jobs, desde, hasta) {
  const vacio = { jobs: 0, coste: 0, porModelo: [], porDia: [] }
  if (typeof jobs !== 'function') return vacio
  try {
    const porModelo = new Map(); const porDia = new Map()
    let n = 0; let coste = 0
    for (const e of jobs() || []) {
      const dia = diaLocal(Date.parse(e.ts))
      if (!Number.isFinite(Date.parse(e.ts)) || dia < desde || dia > hasta) continue
      const c = typeof e.coste === 'number' ? e.coste : 0
      n++; coste += c
      const pm = porModelo.get(e.modelo || 'desconocido') || { jobs: 0, coste: 0 }; pm.jobs++; pm.coste += c; porModelo.set(e.modelo || 'desconocido', pm)
      const pd = porDia.get(dia) || { jobs: 0, coste: 0 }; pd.jobs++; pd.coste += c; porDia.set(dia, pd)
    }
    return {
      jobs: n, coste,
      porModelo: [...porModelo.entries()].map(([modelo, v]) => ({ modelo, ...v })),
      porDia: [...porDia.entries()].map(([dia, v]) => ({ dia, ...v })).sort((a, b) => (a.dia < b.dia ? -1 : 1)),
    }
  } catch { return vacio }
}
