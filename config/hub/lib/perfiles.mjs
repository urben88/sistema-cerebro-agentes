/**
 * Perfiles de modelos (spec perfiles-modelos · S1-S4).
 *
 * Un perfil es un JSON `config/perfiles/<id>.json` con el modelo y el esfuerzo (Claude) o la
 * variante (OpenCode) de cada agente. Aplicarlo reescribe SOLO las líneas `model:`, `effort:` y
 * `variant:` del frontmatter de los agentes, en el repo y en la copia instalada; el resto del
 * fichero queda byte a byte igual (también CRLF/LF).
 *
 * Todas las rutas llegan por parámetro (`rutas`), para probarlo contra carpetas temporales:
 *   rutas = { repo: { claude, opencode }, instalado: { claude, opencode } }   // `instalado` es opcional
 *
 * Registro del instalador (spec 25): tras aplicar se vuelve a registrar el componente con las
 * funciones de `scripts/instalado.mjs` (se pasan en `opciones.registro = { ruta, api }`), solo si
 * antes estaba `igual`. Si ya estaba tocado o desactualizado NO se registra: no se esconde lo suyo.
 *
 * Sin dependencias (Node >= 22). Validación primero, escritura después.
 */
import fs from 'node:fs'
import path from 'node:path'

export const MODELOS_CLAUDE = ['haiku', 'sonnet', 'opus', 'fable']
export const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max']
const NIVELES_ALTOS = new Set(['xhigh', 'max'])
const AGENTE_VALIDO = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const ID_VALIDO = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const MODELO_OC = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:\/-]+$/
const VARIANTE_OC = /^[a-zA-Z0-9_-]{1,32}$/
const SECCIONES = {
  claude: { campos: ['model', 'effort'], componente: 'agentes-claude' },
  opencode: { campos: ['model', 'variant'], componente: 'agentes-opencode' },
}
// Los dos campos «de esfuerzo» según la sección.
const CAMPO_ESFUERZO = { claude: 'effort', opencode: 'variant' }
const FRONTMATTER = /^((?:ï»¿)?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/

const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x)
const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').toLowerCase()
// Los ficheros se leen y escriben en latin1: es lossless para cualquier byte y las líneas que se tocan son ASCII.
const leerBytes = (f) => fs.readFileSync(f, 'latin1')

// ---------------------------------------------------------------- leer perfiles

/** Perfiles de una carpeta: `[{ id, perfil, error }]` ordenados por id. Un JSON roto no tumba al resto. */
export function leerPerfiles(dir) {
  let nombres = []
  try { nombres = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort() } catch { return [] }
  return nombres.map((n) => {
    const id = n.slice(0, -5)
    try { return { id, perfil: JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')), error: null } }
    catch (e) { return { id, perfil: null, error: `JSON inválido: ${e.message}` } }
  })
}

// ---------------------------------------------------------------- validar

/** Errores de un perfil (esquema + tope de esfuerzo S4). `[]` si es válido. */
export function validarPerfil(perfil) {
  const e = []
  if (!esObjeto(perfil)) return ['el perfil no es un objeto JSON']
  if (typeof perfil.nombre !== 'string' || !perfil.nombre.trim()) e.push('falta «nombre»')
  if (perfil.descripcion !== undefined && typeof perfil.descripcion !== 'string') e.push('«descripcion» debe ser texto')
  if (perfil.permitirMasDeHigh !== undefined && typeof perfil.permitirMasDeHigh !== 'boolean') e.push('«permitirMasDeHigh» debe ser true o false')
  const permitido = perfil.permitirMasDeHigh === true
  for (const [seccion, def] of Object.entries(SECCIONES)) {
    const agentes = perfil[seccion]
    if (agentes === undefined) continue
    if (!esObjeto(agentes)) { e.push(`«${seccion}» debe ser un objeto`); continue }
    for (const [agente, v] of Object.entries(agentes)) {
      const que = `${seccion}/${agente}`
      if (!AGENTE_VALIDO.test(agente)) { e.push(`${que}: nombre de agente inválido`); continue }
      if (!esObjeto(v)) { e.push(`${que}: debe ser un objeto`); continue }
      const extra = Object.keys(v).filter((k) => !def.campos.includes(k))
      if (extra.length) e.push(`${que}: campos no permitidos (${extra.join(', ')})`)
      if (!def.campos.some((k) => v[k] !== undefined)) e.push(`${que}: sin ${def.campos.join(' ni ')}`)
      if (v.model !== undefined) {
        if (typeof v.model !== 'string') e.push(`${que}: «model» debe ser texto`)
        else if (seccion === 'claude' && !MODELOS_CLAUDE.includes(v.model)) e.push(`${que}: modelo «${v.model}» no válido (${MODELOS_CLAUDE.join(', ')})`)
        else if (seccion === 'opencode' && !MODELO_OC.test(v.model)) e.push(`${que}: modelo «${v.model}» con formato inválido (proveedor/modelo)`)
      }
      if (v.effort !== undefined && !ESFUERZOS.includes(v.effort)) e.push(`${que}: effort «${v.effort}» no válido (${ESFUERZOS.join(', ')})`)
      if (v.variant !== undefined && (typeof v.variant !== 'string' || !VARIANTE_OC.test(v.variant))) e.push(`${que}: variant «${v.variant}» no válida`)
      // S4: con un modelo fable, ni effort ni variant por encima de high salvo permiso explícito.
      const nivel = v[CAMPO_ESFUERZO[seccion]]
      if (!permitido && typeof v.model === 'string' && /fable/i.test(v.model) && NIVELES_ALTOS.has(nivel)) {
        e.push(`${que}: ${v.model} con ${nivel} supera high; añade "permitirMasDeHigh": true al perfil si lo quieres`)
      }
    }
  }
  const hayAgentes = Object.keys(SECCIONES).some((s) => esObjeto(perfil[s]) && Object.keys(perfil[s]).length)
  if (!e.length && !hayAgentes) e.push('el perfil no define ningún agente')
  return e
}

// ---------------------------------------------------------------- frontmatter

/** Valores `clave: valor` de primer nivel del frontmatter (sin comillas ni espacios). */
export function leerCampos(texto) {
  const m = texto.match(FRONTMATTER)
  const datos = {}
  if (!m) return datos
  for (const linea of m[2].split(/\r?\n/)) {
    if (/^\s/.test(linea)) continue
    const i = linea.indexOf(':')
    if (i > 0) datos[linea.slice(0, i).trim()] = linea.slice(i + 1).trim()
  }
  return datos
}

/**
 * Cambia solo las líneas pedidas del frontmatter. Si el campo no existe, lo añade tras `model:`
 * (o al final del frontmatter). Devuelve `{ texto }` o `{ error }`. Una línea que ya vale lo pedido no se toca.
 */
export function editarFrontmatter(texto, campos) {
  const m = texto.match(FRONTMATTER)
  if (!m) return { error: 'no tiene frontmatter' }
  const nl = (texto.match(/\r?\n/) || ['\n'])[0]
  const partes = m[2].split(/(\r?\n)/) // pares: línea, separador, línea, ...
  for (const [clave, valor] of Object.entries(campos)) {
    const idx = []
    for (let i = 0; i < partes.length; i += 2) if (new RegExp(`^${clave}[ \\t]*:`).test(partes[i])) idx.push(i)
    if (idx.length > 1) return { error: `«${clave}» aparece más de una vez` }
    if (idx.length === 1) {
      const i = idx[0]
      if (partes[i].replace(/^[^:]*:/, '').trim() !== valor) partes[i] = `${clave}: ${valor}`
    } else {
      let despuesDe = -1
      for (let i = 0; i < partes.length; i += 2) if (/^model[ \t]*:/.test(partes[i])) despuesDe = i
      if (despuesDe >= 0) partes.splice(despuesDe + 1, 0, nl, `${clave}: ${valor}`)
      else partes.push(nl, `${clave}: ${valor}`)
    }
  }
  return { texto: m[1] + partes.join('') + texto.slice(m[1].length + m[2].length) }
}

// ---------------------------------------------------------------- agentes actuales

/** Agentes de una carpeta de agentes: `{ <agente>: { model, effort|variant } }`. */
function leerDir(dir, seccion) {
  const out = {}
  let nombres = []
  try { nombres = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort() } catch { return out }
  for (const n of nombres) {
    const c = leerCampos(leerBytes(path.join(dir, n)))
    const e = {}
    for (const k of SECCIONES[seccion].campos) if (c[k] !== undefined) e[k] = c[k]
    out[n.slice(0, -3)] = e
  }
  return out
}

/** Tabla de agentes tal como está hoy (lo instalado si existe; si no, el repo): `[{ origen, agente, model, effort|variant, fuente }]`. */
export function leerAgentes(rutas) {
  const lista = []
  for (const seccion of Object.keys(SECCIONES)) {
    const repo = leerDir(rutas.repo?.[seccion], seccion)
    const inst = rutas.instalado?.[seccion] ? leerDir(rutas.instalado[seccion], seccion) : {}
    for (const agente of Object.keys(repo).sort()) {
      const fuente = inst[agente] ? 'instalado' : 'repo'
      lista.push({ origen: seccion, agente, ...(inst[agente] || repo[agente]), fuente })
    }
  }
  return lista
}

// ---------------------------------------------------------------- planificar (sin escribir)

function planificar(perfil, rutas) {
  const errores = validarPerfil(perfil)
  if (errores.length) return { ok: false, errores, cambios: [], ediciones: [] }
  const cambios = []
  const ediciones = []
  for (const [seccion, def] of Object.entries(SECCIONES)) {
    for (const [agente, pedido] of Object.entries(perfil[seccion] || {})) {
      const archivo = `${agente}.md`
      const rutaRepo = rutas.repo?.[seccion] ? path.join(rutas.repo[seccion], archivo) : null
      if (!rutaRepo || !fs.existsSync(rutaRepo)) { errores.push(`${seccion}/${agente}: no existe el agente (${rutaRepo || 'sin carpeta del repo'})`); continue }
      const campos = Object.fromEntries(def.campos.filter((k) => pedido[k] !== undefined).map((k) => [k, pedido[k]]))
      const copias = [{ ruta: rutaRepo, instalada: false }]
      const rutaInst = rutas.instalado?.[seccion] ? path.join(rutas.instalado[seccion], archivo) : null
      if (rutaInst && fs.existsSync(rutaInst)) copias.push({ ruta: rutaInst, instalada: true })
      const porCampo = {}
      for (const c of copias) {
        const antes = leerBytes(c.ruta)
        const r = editarFrontmatter(antes, campos)
        if (r.error) { errores.push(`${seccion}/${agente}: ${r.error} (${c.ruta})`); continue }
        const actuales = leerCampos(antes)
        for (const k of Object.keys(campos)) {
          if (actuales[k] === campos[k]) continue
          const p = (porCampo[k] ||= { antesRepo: null, antesInstalado: null })
          if (c.instalada) p.antesInstalado = actuales[k] ?? null; else p.antesRepo = actuales[k] ?? null
        }
        if (r.texto !== antes) ediciones.push({ ruta: c.ruta, seccion, instalada: c.instalada, antes, despues: r.texto })
      }
      for (const [campo, p] of Object.entries(porCampo)) {
        const antes = p.antesInstalado ?? p.antesRepo
        cambios.push({ origen: seccion, agente, campo, antes, despues: campos[campo], antesRepo: p.antesRepo, antesInstalado: p.antesInstalado })
      }
    }
  }
  if (errores.length) return { ok: false, errores, cambios: [], ediciones: [] }
  return { ok: true, errores: [], cambios, ediciones }
}

/** Qué cambiaría aplicar el perfil: `{ ok, errores, cambios:[{origen, agente, campo, antes, despues}] }`. No escribe. */
export function comparar(perfil, rutas) {
  const { ok, errores, cambios } = planificar(perfil, rutas)
  return { ok, errores, cambios }
}

/** Id del primer perfil cuyos valores coinciden con lo instalado (o el repo si no hay copia), o `null` («personalizado»). */
export function perfilActivo(perfiles, rutas) {
  const hoy = {}
  for (const a of leerAgentes(rutas)) hoy[`${a.origen}/${a.agente}`] = a
  for (const p of perfiles) {
    if (!p.perfil || validarPerfil(p.perfil).length) continue
    let coincide = true
    for (const seccion of Object.keys(SECCIONES)) {
      for (const [agente, pedido] of Object.entries(p.perfil[seccion] || {})) {
        const a = hoy[`${seccion}/${agente}`]
        if (!a) { coincide = false; break }
        for (const k of SECCIONES[seccion].campos) if (pedido[k] !== undefined && a[k] !== pedido[k]) coincide = false
      }
      if (!coincide) break
    }
    if (coincide) return p.id
  }
  return null
}

// ---------------------------------------------------------------- aplicar

function parejas(registro, componente, dirRepo) {
  const destinos = registro.api.destinosRegistrados(registro.ruta, componente)
  if (!destinos) return null
  return destinos.map((destino) => ({ origen: path.resolve(dirRepo, path.basename(destino)), destino: path.resolve(destino) }))
}

/** Estado del instalador de un componente antes de escribir: `{ pares, estado }` o `{ motivo }`. */
function estadoAntes(registro, seccion, rutas, ediciones) {
  if (!registro?.api || !registro.ruta) return { motivo: 'sin registro configurado' }
  const instaladas = ediciones.filter((x) => x.seccion === seccion && x.instalada)
  if (!instaladas.length) return { motivo: 'no se tocó ninguna copia instalada' }
  if (!fs.existsSync(registro.ruta)) return { motivo: 'no hay registro de instalación' }
  const pares = parejas(registro, SECCIONES[seccion].componente, rutas.repo[seccion])
  if (!pares) return { motivo: 'el componente no consta en el registro' }
  const registrados = new Set(pares.map((p) => norm(p.destino)))
  if (instaladas.some((x) => !registrados.has(norm(x.ruta)))) return { motivo: 'las copias instaladas no coinciden con las registradas' }
  const estado = registro.api.estado(registro.ruta, SECCIONES[seccion].componente, pares)
  return estado === 'igual' ? { pares, estado } : { motivo: `estaba «${estado}» antes de aplicar; se conserva para que el instalador lo vea` }
}

/**
 * Aplica el perfil. Valida y calcula todo en memoria; solo si no hay errores escribe (con vuelta atrás
 * si una escritura falla). Después registra los componentes que estaban `igual`.
 * Devuelve `{ ok, errores, cambios, ficheros, registro: { <componente>: 'registrado' | 'omitido: motivo' | 'fallo: ...' } }`.
 */
export function aplicar(perfil, rutas, opciones = {}) {
  const plan = planificar(perfil, rutas)
  if (!plan.ok) return { ok: false, errores: plan.errores, cambios: [], ficheros: [], registro: {} }
  const registro = opciones.registro
  const previos = {}
  for (const seccion of Object.keys(SECCIONES)) {
    try { previos[seccion] = estadoAntes(registro, seccion, rutas, plan.ediciones) } catch (e) { previos[seccion] = { motivo: `no se pudo leer el registro (${e.message})` } }
  }
  const escritos = []
  try {
    for (const x of plan.ediciones) { fs.writeFileSync(x.ruta, x.despues, 'latin1'); escritos.push(x) }
  } catch (e) {
    const sinRestaurar = []
    for (const x of escritos) { try { fs.writeFileSync(x.ruta, x.antes, 'latin1') } catch { sinRestaurar.push(x.ruta) } }
    const resto = sinRestaurar.length ? ` No se pudo restaurar: ${sinRestaurar.join(', ')}` : ' Se ha restaurado lo escrito.'
    return { ok: false, errores: [`falló la escritura: ${e.message}.${resto}`], cambios: [], ficheros: [], registro: {} }
  }
  const resultado = {}
  for (const [seccion, { componente }] of Object.entries(SECCIONES)) {
    const p = previos[seccion]
    if (!p.pares) { resultado[componente] = `omitido: ${p.motivo}`; continue }
    try { registro.api.registrar(registro.ruta, componente, p.pares); resultado[componente] = 'registrado' } catch (e) { resultado[componente] = `fallo: ${e.message}` }
  }
  return { ok: true, errores: [], cambios: plan.cambios, ficheros: plan.ediciones.map((x) => x.ruta), registro: resultado }
}
