#!/usr/bin/env node
/**
 * Hook de latido de Claude Code.
 *
 * Avisa al Cerebro Hub de que Claude (o uno de sus subagentes) está trabajando en
 * esta carpeta, para que el panel «La oficina» muestre el personaje en vivo. Se
 * registra en los eventos UserPromptSubmit, Stop, SubagentStart y SubagentStop.
 *
 * Silencioso y a prueba de fallos: tope de ~0,8 s, nunca bloquea a Claude y sale
 * siempre con código 0, aunque el hub esté apagado o tardando.
 *
 * R2 · informa del modelo si puede: primero del payload del hook (`model`/`model.id`/
 * `display_name`); si no, lo deduce de la cola del transcript (último mensaje
 * `assistant`), leyendo solo el final del archivo y con tope de 1 s.
 *
 * R2 · nudges de memoria (patrón inspirado en NousResearch/hermes-agent (MIT),
 * reimplementado): SOLO en `UserPromptSubmit` emite un `additionalContext` cuando
 * pasan `nudge_intervalo` turnos sin escritura de memoria; en los otros eventos no
 * devuelve nada. El contador lo posee el hook en `hub-data/estado-nudges.json`, con
 * una clave POR SESIÓN Y PROYECTO (`<slug>:<sesión>`; tmp+rename y read-merge-write
 * que relee el fichero justo antes de escribir y conserva las claves ajenas). El
 * reset lo marca el mtime de `ESTADO.md`. Se podan las entradas con más de 14 días
 * sin actividad (`visto`) y se limita el fichero a 200 entradas.
 *
 * S4 (spec 22) · tarea caducada: en `UserPromptSubmit`, si la sesión edita código y la
 * spec o el ESTADO.md llevan más de `tarea_caducada_min` (30) minutos sin actualizarse,
 * añade un aviso breve (como mucho uno cada N min por sesión). Solo lectura → nada.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportarError } from './reportar.mjs'

if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0) // sesión interna del resumidor (spec 15)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const EVENTOS = new Set(['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop'])
const TAM_COLA_TRANSCRIPT = 64 * 1024
const TOPE_MODELO_MS = 1000
// R2 · nudges: rutas y valores (los mismos que resuelven los demás hooks).
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const MEMORIA_DIR = process.env.HUB_MEMORIA_DIR || path.join(DATA_DIR, 'memoria')
const ESTADO_NUDGES = path.join(DATA_DIR, 'estado-nudges.json')
const NUDGE_DEFECTO = 10
const NUDGE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 días sin actividad → poda
const NUDGE_MAX_ENTRADAS = 200
const TEXTO_NUDGE = [
  'Si en esta conversación hay decisiones, convenciones o preferencias que sobrevivan a la sesión, guárdalas en memoria:',
  'la tarea en curso va a ESTADO.md y las convenciones del proyecto a CONTEXTO-REPO.md (cada hecho, a un solo destino).',
  'No guardes progreso trivial, volcados de datos, logs de trabajo ya acabado ni TODOs temporales.',
  'Si no hay nada, no hagas nada.',
].join(' ')

const normalizar = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Lee un JSON tolerando archivo ausente o corrupto (siempre un objeto). */
function leerJson(archivo) {
  try {
    const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'))
    return datos && typeof datos === 'object' ? datos : {}
  } catch { return {} }
}

/** Slug del proyecto cuyo `ruta` de `proyectos.json` coincide con el cwd (o null). */
function slugDelProyecto(cwd) {
  const reg = leerJson(path.join(MEMORIA_DIR, 'proyectos.json'))
  const n = normalizar(cwd)
  for (const [slug, p] of Object.entries(reg)) {
    if (normalizar(p?.ruta) === n) return slug
  }
  return null
}

/** Intervalo de nudges: `hub-data/reglas.json` → `../hub/reglas.json` → 10. El valor
 *  se trunca (Math.floor) ANTES de validar `>= 1`: 0.5 → 0 → defecto 10. Si
 *  `hub-data/reglas.json` existe pero sin `nudge_intervalo`, se consulta el del hub. */
function intervaloNudge() {
  const local = leerJson(path.join(DATA_DIR, 'reglas.json'))
  const bruto = local.nudge_intervalo ?? leerJson(path.join(__dirname, '..', 'hub', 'reglas.json'))?.nudge_intervalo
  const n = Math.floor(Number(bruto))
  return Number.isFinite(n) && n >= 1 ? n : NUDGE_DEFECTO
}

/** Poda el contador: descarta entradas con más de 14 días sin actividad (campo
 *  `visto`, en ms) y recorta a 200, conservando las de `visto` más reciente. */
function podarNudges(todos, ahora) {
  const vivas = Object.entries(todos)
    .filter(([, v]) => v && typeof v === 'object')
    .filter(([, v]) => ahora - (Number(v.visto) || 0) <= NUDGE_TTL_MS)
    .sort((a, b) => (Number(b[1].visto) || 0) - (Number(a[1].visto) || 0))
    .slice(0, NUDGE_MAX_ENTRADAS)
  return Object.fromEntries(vivas)
}

/** Read-merge-write bajo `clave`: RELEE el fichero justo antes de escribir, conserva
 *  las claves ajenas y poda; escritura atómica tmp+rename con relectura de control. */
function guardarNudges(clave, entrada) {
  const ahora = Date.now()
  const todos = podarNudges(leerJson(ESTADO_NUDGES), ahora) // relee justo antes de escribir
  todos[clave] = entrada
  const texto = JSON.stringify(podarNudges(todos, ahora), null, 2) + '\n'
  const escribir = () => {
    const tmp = `${ESTADO_NUDGES}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.mkdirSync(path.dirname(ESTADO_NUDGES), { recursive: true })
      fs.writeFileSync(tmp, texto, 'utf8')
      fs.renameSync(tmp, ESTADO_NUDGES)
    } catch {
      // Docker Desktop sobre bind mounts: el rename puede no garantizarse.
      try { fs.writeFileSync(ESTADO_NUDGES, texto, 'utf8') } catch { /* sin persistencia */ }
      try { fs.unlinkSync(tmp) } catch { /* nada */ }
    }
  }
  escribir()
  try {
    if (fs.readFileSync(ESTADO_NUDGES, 'utf8') !== texto) escribir()
  } catch { escribir() }
}

/**
 * Decide y persiste el contador de (proyecto, sesión). Devuelve el texto del nudge si
 * toca (turno N, y no otra vez hasta N más), o `null`. Sin proyecto → sin nudge.
 */
function nudgeSiToca(cwd, sesion) {
  const slug = slugDelProyecto(cwd)
  if (!slug) return null
  const clave = `${slug}:${sesion || 'sin-sesion'}`
  const intervalo = intervaloNudge()

  let mtime = 0
  try { mtime = fs.statSync(path.join(MEMORIA_DIR, 'proyectos', slug, 'ESTADO.md')).mtimeMs } catch { mtime = 0 }

  const todos = leerJson(ESTADO_NUDGES)
  const previo = todos[clave] && typeof todos[clave] === 'object' ? todos[clave] : {}
  let turnos = Number(previo.turnos) || 0
  let ultimoAviso = Number(previo.ultimoAviso) || 0

  // Reset al detectar escritura de memoria en este proyecto (cambia el mtime de
  // ESTADO.md); cada sesión compara con el mtime guardado en su propia entrada.
  if (mtime !== (Number(previo.mtime) || 0)) { turnos = 0; ultimoAviso = 0 }
  turnos += 1

  let texto = null
  if (turnos - ultimoAviso >= intervalo) { ultimoAviso = turnos; texto = TEXTO_NUDGE }

  try { guardarNudges(clave, { turnos, ultimoAviso, mtime, visto: Date.now() }) } catch { /* sin persistencia: mejor no avisar de más */ }
  return texto
}

// S4 (spec 22) · tarea caducada: valores y herramientas que cuentan como «editar código».
const CADUCADA_DEFECTO_MIN = 30
const HERRAMIENTAS_EDICION = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Minutos de `tarea_caducada_min` (hub-data/reglas.json → reglas del hub → 30). */
function minutosCaducada() {
  const local = leerJson(path.join(DATA_DIR, 'reglas.json'))
  const bruto = local.tarea_caducada_min ?? leerJson(path.join(__dirname, '..', 'hub', 'reglas.json'))?.tarea_caducada_min
  const n = Math.floor(Number(bruto))
  return Number.isFinite(n) && n >= 1 ? n : CADUCADA_DEFECTO_MIN
}

/** ¿La cola del transcript tiene alguna herramienta de edición? (sesión de solo lectura → no). */
function editandoCodigo(ruta) {
  if (!ruta) return false
  try {
    const fd = fs.openSync(ruta, 'r')
    try {
      const tam = fs.fstatSync(fd).size
      const bytes = Math.min(tam, TAM_COLA_TRANSCRIPT)
      if (bytes <= 0) return false
      const buf = Buffer.alloc(bytes)
      fs.readSync(fd, buf, 0, bytes, tam - bytes)
      for (const l of buf.toString('utf8').split('\n')) {
        if (!l.includes('tool_use')) continue
        let e
        try { e = JSON.parse(l) } catch { continue }
        const partes = Array.isArray(e?.message?.content) ? e.message.content : []
        if (partes.some((c) => c?.type === 'tool_use' && HERRAMIENTAS_EDICION.has(c?.name))) return true
      }
    } finally { fs.closeSync(fd) }
  } catch { /* sin transcript legible */ }
  return false
}

/** mtime más reciente entre ESTADO.md y las specs/tareas del repo (0 si no hay ninguno). */
function ultimaActualizacion(cwd, slug) {
  const archivos = []
  if (slug) archivos.push(path.join(MEMORIA_DIR, 'proyectos', slug, 'ESTADO.md'))
  for (const sub of [['docs', 'specs'], ['specs'], ['odd', 'tasks']]) {
    const dir = path.join(cwd || '', ...sub)
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) archivos.push(path.join(dir, f)) } catch { /* no existe */ }
  }
  let max = 0
  for (const a of archivos) { try { max = Math.max(max, fs.statSync(a).mtimeMs) } catch { /* ausente */ } }
  return max
}

/** Aviso breve si se edita código y la spec/ESTADO.md llevan > N min sin tocarse; como
 *  mucho uno cada N min por sesión (clave propia en estado-nudges.json). */
function caducadaSiToca(cwd, sesion, transcript) {
  if (!editandoCodigo(transcript)) return null
  const slug = slugDelProyecto(cwd)
  const ultima = ultimaActualizacion(cwd, slug)
  if (!ultima) return null
  const ahora = Date.now()
  const limite = minutosCaducada() * 60000
  if (ahora - ultima <= limite) return null
  const clave = `caducada:${slug || normalizar(cwd)}:${sesion || 'sin-sesion'}`
  const previo = leerJson(ESTADO_NUDGES)[clave]
  if (previo && ahora - (Number(previo.ultimoAviso) || 0) < limite) return null
  try { guardarNudges(clave, { ultimoAviso: ahora, visto: ahora }) } catch { return null }
  const min = Math.round((ahora - ultima) / 60000)
  return `Aviso: estás editando código y la spec/ESTADO.md del proyecto lleva ~${min} min sin actualizarse (tarea caducada). Si el plan cambió, actualízalo; si no, ignora este aviso.`
}

/** Modelo declarado directamente en el payload del hook (string u objeto). */
function modeloDelPayload(d) {
  const limpio = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (d?.model) {
    if (typeof d.model === 'string') return limpio(d.model)
    const m = limpio(d.model.id) || limpio(d.model.display_name) || limpio(d.model.model)
    if (m) return m
  }
  return limpio(d?.model_id) || limpio(d?.modelId) || limpio(d?.display_name) || null
}

/** Modelo del último mensaje `assistant` de la cola del transcript (JSONL). */
function modeloDelTranscript(ruta) {
  if (!ruta) return null
  try {
    const fd = fs.openSync(ruta, 'r')
    try {
      const tam = fs.fstatSync(fd).size
      const bytes = Math.min(tam, TAM_COLA_TRANSCRIPT)
      if (bytes <= 0) return null
      const buf = Buffer.alloc(bytes)
      fs.readSync(fd, buf, 0, bytes, tam - bytes)
      const lineas = buf.toString('utf8').split('\n')
      for (let i = lineas.length - 1; i >= 0; i--) {
        const l = lineas[i].trim()
        if (!l) continue
        let e
        try { e = JSON.parse(l) } catch { continue } // la primera línea puede venir cortada
        if (e?.type !== 'assistant' && e?.message?.role !== 'assistant') continue
        const m = e?.message?.model || e?.model
        if (typeof m === 'string' && m.trim()) return m.trim()
      }
    } finally { fs.closeSync(fd) }
  } catch { /* sin transcript legible */ }
  return null
}

/** Modelo del latido: payload primero, transcript después; nunca espera más de 1 s. */
function modeloDe(datos, inicio) {
  const directo = modeloDelPayload(datos)
  if (directo) return directo
  if (Date.now() - inicio > TOPE_MODELO_MS) return null
  return modeloDelTranscript(datos.transcript_path || datos.transcriptPath)
}

/** Modelo y esfuerzo declarados en la definición del agente (`model:` y `effort:` del
 *  frontmatter). Para un subagente (`agent_type`), esto es lo fiable: el transcript lo
 *  escribe el hilo principal y su último mensaje no siempre es el del subagente. */
function definicionDeAgente(tipo, cwd) {
  const salida = { modelo: null, esfuerzo: null }
  if (!tipo) return salida
  const limpio = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const rutas = [
    cwd ? path.join(cwd, '.claude', 'agents', `${tipo}.md`) : null,
    path.join(os.homedir(), '.claude', 'agents', `${tipo}.md`),
  ].filter(Boolean)
  for (const r of rutas) {
    try {
      const t = fs.readFileSync(r, 'utf8')
      const m = t.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
      if (!m) continue
      const lineas = m[1].split(/\r?\n/)
      const lineaModelo = lineas.find((l) => /^model:\s*/i.test(l))
      const lineaEsfuerzo = lineas.find((l) => /^effort:\s*/i.test(l))
      if (lineaModelo) salida.modelo = limpio(lineaModelo.replace(/^model:\s*/i, ''))
      if (lineaEsfuerzo) salida.esfuerzo = limpio(lineaEsfuerzo.replace(/^effort:\s*/i, ''))
      if (salida.modelo || salida.esfuerzo) return salida
    } catch { /* sin fichero en esa ruta */ }
  }
  return salida
}

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    let hecho = false
    const terminar = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', terminar)
    // Tope corto: no esperar al cierre del stdin si Claude tarda en cerrarlo.
    setTimeout(terminar, 200)
  })
}

try {
  const inicio = Date.now()
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }

  const evento = datos.hook_event_name || process.argv[2] || ''
  if (EVENTOS.has(evento)) {
    const agente = datos.agent_type || datos.agent || datos.subagent_type || null
    // Para subagentes, el modelo y el esfuerzo de su definición mandan (p. ej.
    // explorador → haiku · low); si no hay definición, se deducen del payload o
    // de la cola del transcript.
    const definicion = definicionDeAgente(agente, datos.cwd)
    const modelo = definicion.modelo || modeloDe(datos, inicio)
    const cuerpo = {
      cwd: datos.cwd || process.cwd(),
      sesion: datos.session_id || datos.sessionId || null,
      evento,
      agente,
      tarea: (datos.prompt || datos.task || datos.description || '').slice(0, 200) || null,
      modelo: modelo ? modelo.slice(0, 80) : null,
      esfuerzo: definicion.esfuerzo ? definicion.esfuerzo.slice(0, 20) : null,
      // Ruta del transcript de la sesión: la usa el hub para la vista viva (solo
      // actividad: herramientas, textos y subtareas; el pensamiento no es legible).
      transcript: datos.transcript_path || datos.transcriptPath || null,
    }
    // R2 · el nudge se decide ANTES de avisar al hub, para poder reportar su resultado
    // (spec 11 · M3: disparado/descartado). Viaja SOLO como additionalContext de
    // UserPromptSubmit; en el resto de eventos el hook no devuelve nada.
    let nudge = null
    let caducada = null
    if (evento === 'UserPromptSubmit') {
      try { nudge = nudgeSiToca(cuerpo.cwd, cuerpo.sesion) } catch { nudge = null }
      try { caducada = caducadaSiToca(cuerpo.cwd, cuerpo.sesion, cuerpo.transcript) } catch { caducada = null }
      cuerpo.nudge = nudge ? 'disparado' : 'descartado'
    }
    try {
      await fetch(`${HUB}/api/latido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(600),
      })
    } catch { /* hub apagado o lento: se ignora */ }

    const contexto = [nudge, caducada].filter(Boolean).join(' ')
    if (evento === 'UserPromptSubmit' && contexto) {
      console.log(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contexto },
      }))
    }
  }
  process.exit(0)
} catch (e) {
  await reportarError('latido', e)
  process.exit(0)
}
