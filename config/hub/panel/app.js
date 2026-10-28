/* Cerebro Hub — panel «La oficina». Vanilla, sin dependencias ni CDN.
 * Vista principal: escena con salas por proyecto, personajes SVG, animaciones por estado,
 * globos de tarea, delegaciones, organigrama y reparto. Pestañas secundarias conservan
 * (R15) la funcionalidad anterior. Datos por SSE con caída a polling; ?demo=1 simula.
 *
 * Seguridad: TODO lo que viene del servidor (tarea, título, error, rutas…) se pinta con
 * textContent o con nodos construidos a mano. Nunca se usa innerHTML con datos externos.
 */
'use strict'

const $ = (id) => document.getElementById(id)

// ---------------------------------------------------------------- construcción segura de DOM

function aplicar(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'clase') el.setAttribute('class', String(v))
    else if (k === 'texto') el.textContent = String(v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
}
function anadirHijos(el, hijos) {
  for (const c of hijos) {
    if (c == null || c === false || c === '') continue
    if (Array.isArray(c)) { anadirHijos(el, c); continue }
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}
function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag)
  aplicar(el, attrs)
  anadirHijos(el, hijos)
  return el
}
function sv(tag, attrs, ...hijos) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  aplicar(el, attrs)
  anadirHijos(el, hijos)
  return el
}
function vaciar(el) { while (el.firstChild) el.removeChild(el.firstChild); return el }

// ---------------------------------------------------------------- utilidades

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('es-ES') : '—')
const k = (n) => {
  if (typeof n !== 'number') return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
const hace = (ms) => {
  if (!ms) return '—'
  const d = Math.max(0, Date.now() - ms)
  const s = Math.round(d / 1000)
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const hr = Math.round(m / 60)
  if (hr < 24) return `hace ${hr} h`
  return `hace ${Math.round(hr / 24)} d`
}
const dur = (ms) => {
  if (!ms) return '—'
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr} h ${m % 60} min`
  return `${Math.floor(hr / 24)} d ${hr % 24} h`
}
const corto = (d) => (d ? String(d).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '—')
const escSel = (s) => (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'))
const reducirMovimiento = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// R4 · etiqueta honesta: un modelo ausente se declara como «modelo no informado»
// (nunca «sin modelo»), y el variant se muestra solo si existe.
const etiquetaModelo = (m) => (m ? String(m) : 'modelo no informado')
const modeloYVariant = (m, v) => (v ? `${etiquetaModelo(m)} · ${v}` : etiquetaModelo(m))
const nombreEsfuerzo = (v) => ({ low: 'bajo', medium: 'medio', high: 'alto', max: 'máximo', default: 'por defecto' })[String(v || '').toLowerCase()] || (v ? String(v) : null)

// R7 · estados de job que siguen «en curso» y merecen refresco del detalle.
const EN_CURSO = new Set(['trabajando', 'esperando', 'atascado'])
const EN_CURSO_JOB = new Set(['running', 'accepted', 'input_required'])

// R7 · duración de un tramo ya cerrado (no «hace X»).
function duracionHumana(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr} h ${m % 60} min`
  return `${Math.floor(hr / 24)} d ${hr % 24} h`
}
function recortar(t, n) {
  const s = String(t || '')
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s
}
function textoTokens(t) {
  if (t == null) return null
  if (typeof t === 'number') return fmt(t)
  const partes = []
  if (typeof t.input === 'number') partes.push(`in ${k(t.input)}`)
  if (typeof t.output === 'number') partes.push(`out ${k(t.output)}`)
  if (t.cache && typeof t.cache.read === 'number') partes.push(`caché ${k(t.cache.read)}`)
  return partes.length ? partes.join(' · ') : null
}
function simboloEstado(e) {
  const s = String(e || '').toLowerCase()
  if (s.includes('error') || s.includes('fail')) return { simbolo: '✗', clase: 'mal' }
  if (s.includes('run') || s.includes('progress') || s.includes('pending')) return { simbolo: '⏳', clase: 'curso' }
  if (s === 'completed' || s === 'success' || s === 'ok') return { simbolo: '✓', clase: 'bien' }
  return { simbolo: '•', clase: 'neutro' }
}

// ----------------------------------------------------- consumo y parada de trabajos

const normRuta = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Estado real de Claude (lo empuja la barra de estado) para la ruta de una sala. */
function claudeDeSala(ruta) {
  return (estado.claudeEstados || []).find((e) => normRuta(e.cwd) === normRuta(ruta)) || null
}

function horaReset(epochSeg) {
  if (!epochSeg) return null
  try { return new Date(epochSeg * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return null }
}

/** Botón de emergencia: pide confirmación, cancela y avisa del resultado. */
async function pararTrabajos(cuerpo, mensaje) {
  if (estado.demo) { alert('Modo demo: aquí no se para nada.'); return false }
  if (!confirm(mensaje)) return false
  try {
    const r = await fetch('/api/trabajos/cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }).then((x) => x.json())
    if (r.ok) alert(r.revisados === 0 ? 'No había trabajos activos que parar.' : `Cancelados ${r.cancelados} de ${r.revisados} trabajos.`)
    else alert(`No se pudo parar: ${r.error || 'error desconocido'}`)
    return true
  } catch { alert('El hub no respondió.'); return false }
}

// ---------------------------------------------------------------- familias y agentes

// A4 · figuras planas: cada familia tiene color y accesorio propios.
const FAMILIAS = {
  direccion: { nombre: 'Dirección', color: '#f0b429', accesorio: 'auriculares' },
  exploracion: { nombre: 'Exploración', color: '#38bdf8', accesorio: 'prismaticos' },
  documentacion: { nombre: 'Documentación', color: '#a78bfa', accesorio: 'libro' },
  verificacion: { nombre: 'Verificación', color: '#2dd4bf', accesorio: 'lupa' },
  implementacion: { nombre: 'Implementación', color: '#34d399', accesorio: 'casco' },
  depuracion: { nombre: 'Depuración', color: '#fb7185', accesorio: 'llave' },
  revision: { nombre: 'Revisión', color: '#60a5fa', accesorio: 'gafas' },
  pruebas: { nombre: 'Pruebas', color: '#fbbf24', accesorio: 'probeta' },
  mecanico: { nombre: 'Mecánico', color: '#94a3b8', accesorio: 'engranaje' },
  generica: { nombre: 'Genérica', color: '#8b97a7', accesorio: null },
}
const ORDEN_FAMILIAS = Object.keys(FAMILIAS)

// Mismo mapa que actividad.mjs (el nombre es la identidad del agente).
const FAMILIA_AGENTE = {
  cerebro: 'direccion', subdirector: 'direccion', 'cerebro-oc': 'direccion', arquitecto: 'direccion', consultor: 'direccion', retocador: 'implementacion',
  explorador: 'exploracion', 'explorador-ds': 'exploracion',
  redactor: 'documentacion', 'redactor-ds': 'documentacion',
  analista: 'verificacion', implementador: 'implementacion', debugger: 'depuracion',
  revisor: 'revision', testeador: 'pruebas', local: 'mecanico',
}
const familiaDe = (nombre) => FAMILIA_AGENTE[nombre] || 'generica'
const metaFam = (f) => FAMILIAS[f] || FAMILIAS.generica

const ESTADOS_JOB = {
  accepted: ['azul', 'aceptado'], running: ['ambar', 'en curso'], completed: ['verde', 'completado'],
  failed: ['rojo', 'fallido'], cancelled: ['gris', 'cancelado'], input_required: ['morado', 'pide permiso'],
  unknown: ['gris', 'desconocido'],
}
const badgeEstado = (e) => {
  const [c, t] = ESTADOS_JOB[e] || ['gris', e || '—']
  return h('span', { clase: `badge ${c}`, texto: t })
}

// ---------------------------------------------------------------- figura SVG

function oscurecer(hex, f) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.round(x * (1 + f))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function accesorioSVG(root, tipo, color) {
  const t = (tag, attrs) => root.append(sv(tag, attrs))
  const claro = '#e6ebf2'
  if (tipo === 'auriculares') {
    t('path', { clase: 'accesorio', d: 'M23 17a13 13 0 0 1 26 0', fill: 'none', stroke: claro, 'stroke-width': 2.4 })
    t('rect', { clase: 'accesorio', x: 19.5, y: 16, width: 5, height: 9, rx: 2, fill: claro })
    t('rect', { clase: 'accesorio', x: 47.5, y: 16, width: 5, height: 9, rx: 2, fill: claro })
    t('path', { clase: 'accesorio', d: 'M24.5 25c0 6 4 8 8.5 8', fill: 'none', stroke: claro, 'stroke-width': 1.8, 'stroke-linecap': 'round' })
  } else if (tipo === 'prismaticos') {
    t('circle', { clase: 'accesorio', cx: 27, cy: 21, r: 5, fill: 'none', stroke: claro, 'stroke-width': 2 })
    t('circle', { clase: 'accesorio', cx: 45, cy: 21, r: 5, fill: 'none', stroke: claro, 'stroke-width': 2 })
    t('rect', { clase: 'accesorio', x: 31, y: 19.5, width: 10, height: 3, fill: claro })
    t('rect', { clase: 'accesorio', x: 21, y: 25, width: 4, height: 9, rx: 2, fill: claro })
    t('rect', { clase: 'accesorio', x: 47, y: 25, width: 4, height: 9, rx: 2, fill: claro })
  } else if (tipo === 'libro') {
    t('rect', { clase: 'accesorio', x: 26, y: 50, width: 20, height: 13, rx: 1.5, fill: claro })
    t('path', { clase: 'accesorio', d: 'M36 50v13', stroke: oscurecer('#e6ebf2', -0.35), 'stroke-width': 1.4 })
  } else if (tipo === 'lupa') {
    t('circle', { clase: 'accesorio', cx: 50, cy: 18, r: 6, fill: 'none', stroke: claro, 'stroke-width': 2.2 })
    t('rect', { clase: 'accesorio', x: 53.5, y: 22.5, width: 3, height: 9, rx: 1.5, fill: claro, transform: 'rotate(-45 55 27)' })
  } else if (tipo === 'casco') {
    t('path', { clase: 'accesorio', d: 'M23 16c0-6 5.5-10 13-10s13 4 13 10v2H23Z', fill: color, stroke: oscurecer(color, -0.4), 'stroke-width': 1 })
    t('rect', { clase: 'accesorio', x: 21, y: 16, width: 30, height: 3, rx: 1.5, fill: oscurecer(color, -0.25) })
  } else if (tipo === 'llave') {
    t('path', { clase: 'accesorio', d: 'M50 14a5 5 0 1 1-4.6 7H34v-3h11.4A5 5 0 0 1 50 14Z', fill: claro })
  } else if (tipo === 'gafas') {
    t('rect', { clase: 'accesorio', x: 19, y: 17, width: 14, height: 9, rx: 2, fill: 'none', stroke: claro, 'stroke-width': 2 })
    t('rect', { clase: 'accesorio', x: 39, y: 17, width: 14, height: 9, rx: 2, fill: 'none', stroke: claro, 'stroke-width': 2 })
    t('rect', { clase: 'accesorio', x: 33, y: 20, width: 6, height: 2, fill: claro })
  } else if (tipo === 'probeta') {
    t('path', { clase: 'accesorio', d: 'M49 46h8l-1.5 12a2.5 2.5 0 0 1-5 0Z', fill: claro })
    t('path', { clase: 'accesorio', d: 'M48.6 52h8.8', stroke: '#22d3ee', 'stroke-width': 3 })
  } else if (tipo === 'engranaje') {
    t('circle', { clase: 'accesorio', cx: 53, cy: 52, r: 5.5, fill: 'none', stroke: claro, 'stroke-width': 2.4 })
    t('circle', { clase: 'accesorio', cx: 53, cy: 52, r: 1.8, fill: claro })
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      t('rect', { clase: 'accesorio', x: 52, y: 44, width: 2, height: 4, rx: 1, fill: claro, transform: `rotate(${(a * 180) / Math.PI} 53 52)` })
    }
  }
}

function figuraSVG(familia, estado) {
  const f = metaFam(familia)
  const oscuro = oscurecer(f.color, -0.35)
  const pelopinon = oscurecer(f.color, -0.55)
  const svg = sv('svg', { clase: `figura estado-${estado}`, viewBox: '0 0 72 96', width: '72', height: '96', 'aria-hidden': 'true', focusable: 'false' })
  svg.append(sv('ellipse', { clase: 'sombra', cx: 36, cy: 92, rx: 21, ry: 3.5 }))
  svg.append(sv('rect', { clase: 'pierna pierna-i', x: 27, y: 62, width: 7, height: 26, rx: 3.5, fill: oscuro }))
  svg.append(sv('rect', { clase: 'pierna pierna-d', x: 38, y: 62, width: 7, height: 26, rx: 3.5, fill: oscuro }))
  svg.append(sv('path', { clase: 'cuerpo', d: 'M22 40c0-7 6-11 14-11s14 4 14 11v25c0 3-2 5-5 5H27c-3 0-5-2-5-5V40Z', fill: f.color }))
  svg.append(sv('circle', { clase: 'cabeza', cx: 36, cy: 20, r: 12.5, fill: '#f0c9a6' }))
  svg.append(sv('path', { clase: 'pelo', d: 'M23.5 18.5c0-8 5.5-13 12.5-13s12.5 5 12.5 13c-3-4.5-7-6.5-12.5-6.5s-9.5 2-12.5 6.5Z', fill: pelopinon }))
  svg.append(sv('rect', { clase: 'brazo brazo-i', x: 16, y: 44, width: 6.5, height: 19, rx: 3, fill: f.color }))
  svg.append(sv('rect', { clase: 'brazo brazo-d', x: 49.5, y: 44, width: 6.5, height: 19, rx: 3, fill: f.color }))
  accesorioSVG(svg, f.accesorio, f.color)
  if (estado === 'esperando') svg.append(sv('text', { clase: 'signo signo-esperando', x: 59, y: 15 }, '?'))
  else if (estado === 'atascado') svg.append(sv('text', { clase: 'signo signo-atascado', x: 59, y: 15 }, '!'))
  else if (estado === 'terminado') svg.append(sv('text', { clase: 'signo signo-terminado', x: 55, y: 72 }, '✓'))
  return svg
}

// ---------------------------------------------------------------- estado global

const estado = {
  actividad: null,
  salud: null,
  organizacion: null,
  proyectos: [],
  vigilante: null,
  gastoEquipo: null,
  claudeEstados: [],
  aprobaciones: null,
  salaAbierta: null,
  desplegadas: new Set(),
  plegar: true,
  conexion: 'conectando',
  demo: false,
  pestaña: 'oficina',
}

// ---------------------------------------------------------------- Oficina (R7–R14)

function crearPuesto(personaje, proyecto) {
  const activo = ['trabajando', 'esperando', 'atascado'].includes(personaje.estado)
  const puesto = h('figure', {
    clase: `puesto estado-${personaje.estado} familia-${personaje.familia}`,
    'data-personaje': personaje.id,
    'data-agente': personaje.agente,
    'data-desde': personaje.desde || '',
    title: `${personaje.agente} · ${personaje.estado}`,
  })
  if (activo && (personaje.tarea || personaje.desde)) {
    const globo = h('div', { clase: 'globo' })
    globo.append(h('span', { clase: 'globo-tarea', texto: personaje.tarea || '(sin título)' }))
    if (personaje.desde) globo.append(h('span', { clase: 'globo-tiempo', texto: dur(personaje.desde) }))
    puesto.append(globo)
  }
  const wrap = h('div', { clase: 'figura-wrap' })
  wrap.append(figuraSVG(personaje.familia, personaje.estado))
  puesto.append(wrap)
  puesto.append(h('div', { clase: 'mesa' }, h('div', { clase: 'monitor' })))
  const pie = h('figcaption', { clase: 'puesto-pie' })
  pie.append(h('span', { clase: 'pers-nombre', texto: personaje.agente }))
  pie.append(h('span', { clase: 'chip modelo', texto: etiquetaModelo(personaje.modelo), title: personaje.modelo || '' }))
  // El esfuerzo va debajo, al lado del modelo (no encima de la figura).
  if (personaje.variant) pie.append(h('span', { clase: 'chip esfuerzo', texto: `esfuerzo ${nombreEsfuerzo(personaje.variant)}`, title: `Esfuerzo: ${nombreEsfuerzo(personaje.variant)} (${personaje.variant})` }))
  // R6 · chip de error con el título legible (el crudo queda en el detalle).
  if (personaje.errorInfo) pie.append(h('span', { clase: 'chip error', texto: personaje.errorInfo.titulo, title: personaje.errorInfo.causa || '' }))
  puesto.append(pie)
  puesto.setAttribute('tabindex', '0')
  puesto.setAttribute('role', 'button')
  puesto.setAttribute('aria-label', `${personaje.agente}, ${personaje.estado}`)
  puesto.addEventListener('click', () => abrirDetalle(personaje, proyecto))
  puesto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDetalle(personaje, proyecto) }
  })
  return puesto
}

function crearSala(proyecto, opciones) {
  const inactiva = Date.now() - (proyecto.ultimaActividad || 0) > 30 * 60 * 1000
  const plegada = inactiva && opciones.plegar && !estado.desplegadas.has(proyecto.slug)
  const familiaDominante = proyecto.personajes[0]?.familia
  const sala = h('section', {
    clase: `sala${opciones.abierta ? ' completa' : ''}${plegada ? ' plegada' : ''}`,
    'data-slug': proyecto.slug,
    style: `--sala-color:${metaFam(familiaDominante).color}`,
  })

  const cab = h('header', { clase: 'sala-cab' })
  cab.append(h('span', { clase: 'sala-color', 'aria-hidden': 'true' }))
  const titulo = h('div', { clase: 'sala-titulo' })
  titulo.append(h('h2', { texto: proyecto.nombre || 'proyecto' }))
  titulo.append(h('span', { clase: 'tenue ruta', texto: proyecto.ruta || '', title: proyecto.ruta || '' }))
  cab.append(titulo)
  const meta = h('div', { clase: 'sala-meta' })
  meta.append(h('span', { clase: 'chip', texto: `última actividad ${hace(proyecto.ultimaActividad)}` }))
  const n = proyecto.personajes.length
  meta.append(h('span', { clase: 'chip', texto: `${n} personaje${n === 1 ? '' : 's'}` }))
  // Consumo de la sala: contexto/ventanas reales de Claude y coste de OpenCode.
  const claudeSala = claudeDeSala(proyecto.ruta)
  if (claudeSala) {
    if (claudeSala.contextoPct != null) meta.append(h('span', { clase: 'chip', texto: `Claude ctx ${Math.round(claudeSala.contextoPct)}%`, title: `Contexto de la sesión de Claude${claudeSala.nombre ? ` «${claudeSala.nombre}»` : ''}` }))
    if (claudeSala.cincoPct != null) meta.append(h('span', { clase: 'chip', texto: `5h ${Math.round(claudeSala.cincoPct)}%`, title: claudeSala.cincoReset ? `Ventana de 5 h · reinicia a las ${horaReset(claudeSala.cincoReset)}` : 'Ventana de 5 h' }))
    if (claudeSala.sietePct != null) meta.append(h('span', { clase: 'chip', texto: `7d ${Math.round(claudeSala.sietePct)}%`, title: claudeSala.sieteReset ? `Ventana de 7 días · reinicia a las ${horaReset(claudeSala.sieteReset)}` : 'Ventana de 7 días' }))
  }
  const costeSala = proyecto.personajes.reduce((s, p) => s + (typeof p.coste === 'number' ? p.coste : 0), 0)
  if (costeSala > 0) meta.append(h('span', { clase: 'chip', texto: `OpenCode ${costeSala.toFixed(3)} $`, title: 'Coste DeepSeek de los trabajos listados en esta sala' }))
  cab.append(meta)

  const acciones = h('div', { clase: 'sala-acciones' })
  const btn = h('button', { clase: 'boton mini', type: 'button', texto: opciones.abierta ? 'Ver todos' : 'Abrir sala' })
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    estado.salaAbierta = opciones.abierta ? null : proyecto.slug
    pintarOficina()
  })
  acciones.append(btn)
  if (inactiva && opciones.plegar) {
    const b2 = h('button', { clase: 'boton mini', type: 'button', texto: plegada ? 'Desplegar' : 'Plegar' })
    b2.addEventListener('click', (e) => {
      e.stopPropagation()
      if (plegada) estado.desplegadas.add(proyecto.slug)
      else estado.desplegadas.delete(proyecto.slug)
      pintarOficina()
    })
    acciones.append(b2)
  }
  // Botón de emergencia por sala: para los trabajos de este proyecto.
  if (proyecto.personajes.some((p) => EN_CURSO.has(p.estado))) {
    const bp = h('button', { clase: 'boton mini peligro', type: 'button', texto: '⛔ Parar' })
    bp.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (await pararTrabajos({ directory: proyecto.ruta }, `¿Parar los trabajos de OpenCode de «${proyecto.nombre}»?`)) refrescarLigero()
    })
    acciones.append(bp)
  }
  cab.append(acciones)
  sala.append(cab)

  if (plegada) {
    sala.append(h('div', { clase: 'sala-plegada' }, h('span', { clase: 'tenue', texto: 'Sin actividad en 30 min · sala plegada' })))
    return sala
  }

  const escena = h('div', { clase: 'escena' })
  escena.append(h('div', { clase: 'suelo', 'aria-hidden': 'true' }))
  const puestos = h('div', { clase: 'puestos' })
  for (const p of proyecto.personajes) puestos.append(crearPuesto(p, proyecto))
  escena.append(puestos)
  escena.append(sv('svg', { clase: 'delega', 'aria-hidden': 'true' }))
  sala.append(escena)
  return sala
}

// Líneas animadas de delegación (R11): se dibujan sobre la escena ya maquetada.
function dibujarDelegaciones() {
  for (const escena of document.querySelectorAll('#oficina .escena')) {
    const overlay = escena.querySelector('svg.delega')
    if (!overlay) continue
    vaciar(overlay)
    const slug = escena.closest('.sala')?.dataset.slug
    const proyecto = (estado.actividad?.proyectos || []).find((p) => p.slug === slug)
    if (!proyecto) continue
    const rect = escena.getBoundingClientRect()
    overlay.setAttribute('viewBox', `0 0 ${Math.max(1, Math.round(rect.width))} ${Math.max(1, Math.round(rect.height))}`)
    overlay.setAttribute('preserveAspectRatio', 'none')
    for (const d of proyecto.delegaciones || []) {
      const de = escena.querySelector(`.puesto[data-agente="${escSel(d.de)}"] .figura-wrap`)
      const a = escena.querySelector(`.puesto[data-agente="${escSel(d.a)}"] .figura-wrap`)
      if (!de || !a) continue
      const r1 = de.getBoundingClientRect()
      const r2 = a.getBoundingClientRect()
      const x1 = r1.left - rect.left + r1.width / 2
      const y1 = r1.top - rect.top + r1.height * 0.3
      const x2 = r2.left - rect.left + r2.width / 2
      const y2 = r2.top - rect.top + r2.height * 0.3
      const mx = (x1 + x2) / 2
      const my = Math.min(y1, y2) - 26
      const idPath = `del-${escena.dataset.n || 0}-${Math.random().toString(36).slice(2, 7)}`
      overlay.append(sv('path', { id: idPath, clase: 'linea-delega', d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, fill: 'none' }))
      const paquete = sv('circle', { clase: 'paquete', r: 4 })
      if (!reducirMovimiento()) {
        const anim = sv('animateMotion', { dur: '2.4s', repeatCount: 'indefinite' })
        const mpath = sv('mpath', { href: `#${idPath}` })
        // Compatibilidad con navegadores que aún esperan xlink:href en <mpath>.
        try { mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${idPath}`) } catch { /* nada */ }
        anim.append(mpath)
        paquete.append(anim)
      }
      overlay.append(paquete)
    }
  }
}

function bannerDemo() {
  return h('div', { clase: 'demo-aviso', role: 'note' },
    h('strong', { texto: 'Demostración' }),
    ' · estás viendo actividad simulada (no refleja trabajos reales). Alarga la URL con ',
    h('code', { texto: '?demo=1' }), ' para volver a este modo.'
  )
}

function pintarVacio() {
  const cont = vaciar($('oficinaVacia'))
  cont.classList.remove('oculto')
  cont.append(h('h2', { texto: 'Nadie trabajando ahora' }))
  cont.append(h('p', { clase: 'tenue', texto: 'La oficina está en silencio. Cuando arranque un trabajo, el personaje aparecerá en su sala.' }))
  const reposo = h('div', { clase: 'puestos reposo' })
  const disponibles = []
    .concat(estado.organizacion?.claude || [], estado.organizacion?.opencode || [])
    .filter((a) => FAMILIA_AGENTE[a.nombre])
  const vistas = new Set()
  for (const a of disponibles) {
    if (vistas.has(a.nombre)) continue
    vistas.add(a.nombre)
    const puesto = h('figure', { clase: 'puesto reposo' })
    puesto.append(h('div', { clase: 'figura-wrap' }, figuraSVG(FAMILIA_AGENTE[a.nombre], 'inactivo')))
    const pie = h('figcaption', { clase: 'puesto-pie' })
    pie.append(h('span', { clase: 'pers-nombre', texto: a.nombre }))
    puesto.append(pie)
    reposo.append(puesto)
  }
  if (reposo.childElementCount === 0) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin agentes registrados todavía.' }))
  } else {
    cont.append(h('h3', { texto: 'Agentes disponibles en reposo' }))
    cont.append(reposo)
  }
}

function pintarFiltros(proyectos) {
  const cont = vaciar($('filtrosSala'))
  const todos = h('button', { clase: `boton mini${estado.salaAbierta ? '' : ' activo'}`, type: 'button', texto: 'Todos' })
  todos.addEventListener('click', () => { estado.salaAbierta = null; pintarOficina() })
  cont.append(todos)
  for (const p of proyectos) {
    const b = h('button', {
      clase: `boton mini${estado.salaAbierta === p.slug ? ' activo' : ''}`,
      type: 'button', texto: p.nombre || 'proyecto', title: p.ruta || '',
    })
    b.addEventListener('click', () => { estado.salaAbierta = estado.salaAbierta === p.slug ? null : p.slug; pintarOficina() })
    cont.append(b)
  }
}

function pintarOficina() {
  const proyectos = estado.actividad?.proyectos || []
  estado.plegar = $('plegarInactivas').checked
  pintarFiltros(proyectos)
  const lista = estado.salaAbierta ? proyectos.filter((p) => p.slug === estado.salaAbierta) : proyectos
  const cont = vaciar($('oficina'))
  if (estado.demo) cont.append(bannerDemo())
  if (!lista.length) {
    pintarVacio()
    return
  }
  $('oficinaVacia').classList.add('oculto')
  for (const p of lista) cont.append(crearSala(p, { abierta: estado.salaAbierta === p.slug, plegar: estado.plegar }))
  requestAnimationFrame(dibujarDelegaciones)
}

// R6 · bloque «Qué falló» con causa, acción y texto crudo plegado.
function bloqueError(cont, info) {
  const caja = h('div', { clase: 'bloque-error' })
  caja.append(h('h3', { clase: 'error-titulo', texto: info.titulo || 'Error' }))
  if (info.causa) caja.append(h('p', { clase: 'error-causa', texto: info.causa }))
  if (info.accion) caja.append(h('p', { clase: 'error-accion', texto: `Qué puedes hacer: ${info.accion}` }))
  if (info.crudo) {
    const det = h('details', { clase: 'error-crudo' })
    det.append(h('summary', { texto: 'Texto crudo del error' }))
    det.append(h('pre', { texto: String(info.crudo) }))
    caja.append(det)
  }
  cont.append(caja)
}

// R7 · detalle vivo del trabajo (modelo·variant, duración, coste, tokens, último paso,
// herramientas recientes y archivos tocados).
function pintarDetalleJob(cont, job) {
  vaciar(cont)
  cont.append(h('h3', { texto: 'Detalle del trabajo' }))
  const fila = (etiqueta, valor) => {
    if (valor == null || valor === '') return
    const d = h('div', { clase: 'fila detalle-fila' })
    d.append(h('span', { clase: 'fila-k', texto: etiqueta }))
    d.append(h('span', { clase: 'fila-v', texto: String(valor) }))
    cont.append(d)
  }
  fila('Modelo', etiquetaModelo(job.modelo))
  fila('Esfuerzo', job.variant ? `${nombreEsfuerzo(job.variant)} (${job.variant})` : null)
  fila('Estado', job.status)
  const fin = EN_CURSO_JOB.has(job.status) ? Date.now() : job.updatedAt
  fila('Duración', job.createdAt && fin ? duracionHumana(fin - job.createdAt) : null)
  fila('Coste', typeof job.cost === 'number' ? `${job.cost.toFixed(4)} $` : null)
  fila('Tokens', textoTokens(job.tokens))
  fila('Carpeta', job.directory)
  if (EN_CURSO_JOB.has(job.status)) {
    const bp = h('button', { clase: 'boton mini peligro', type: 'button', texto: '⛔ Parar este trabajo' })
    bp.addEventListener('click', async () => {
      if (await pararTrabajos({ jobId: job.jobId }, `¿Parar el trabajo de ${job.agent || 'este agente'}?`)) {
        if (detalleAbierto && detalleAbierto.cargar) detalleAbierto.cargar()
      }
    })
    cont.append(bp)
  }

  if (job.ultimoTexto) {
    cont.append(h('h3', { texto: 'Último paso' }))
    cont.append(h('p', { clase: 'detalle-paso', texto: recortar(job.ultimoTexto, 400) }))
  }
  const herramientas = job.herramientas || []
  if (herramientas.length) {
    cont.append(h('h3', { texto: `Herramientas recientes (${herramientas.length})` }))
    const ul = h('ul', { clase: 'lista-herramientas' })
    for (const t of herramientas) {
      const s = simboloEstado(t.estado)
      ul.append(h('li', { clase: 'herramienta' },
        h('span', { clase: `marca ${s.clase}`, texto: s.simbolo, title: t.estado || 'sin estado' }),
        h('span', { texto: t.tool + (t.estado ? ` · ${t.estado}` : '') }),
      ))
    }
    cont.append(ul)
  }
  const archivos = job.archivosPatch || []
  if (archivos.length) {
    cont.append(h('h3', { texto: `Archivos modificados (${archivos.length})` }))
    const ul = h('ul', { clase: 'lista-archivos' })
    for (const a of archivos) ul.append(h('li', { clase: 'archivo', texto: String(a) }))
    cont.append(ul)
  }
  if (job.error) bloqueError(cont, { titulo: 'Qué falló', crudo: job.error })
}

// ------------------------------------------- vista viva (razonamiento, actividad y pasos)

function horaCorta(ts) {
  try { return new Date(ts).toTimeString().slice(0, 8) } catch { return '' }
}

// Cada evento recopilado se pinta como una línea; el razonamiento y los textos se
// pueden desplegar para leerlos enteros (el «pensamiento» va en su propio bloque).
function lineaVivo(e) {
  const hora = horaCorta(e.ts)
  if (e.tipo === 'razonamiento' || e.tipo === 'texto') {
    const icono = e.tipo === 'razonamiento' ? '💭' : '🗣️'
    const det = h('details', { clase: 'vivo-evento' })
    const resumen = h('summary', { clase: 'vivo-resumen' })
    resumen.append(h('span', { clase: 'vivo-hora', texto: hora }))
    resumen.append(h('span', { clase: 'vivo-tipo', texto: icono }))
    resumen.append(h('span', { clase: 'vivo-texto', texto: recortar(e.texto, 140) }))
    det.append(resumen)
    det.append(h('pre', { clase: 'vivo-texto-largo', texto: e.texto }))
    return det
  }
  const d = h('div', { clase: 'vivo-evento simple' })
  d.append(h('span', { clase: 'vivo-hora', texto: hora }))
  if (e.tipo === 'herramienta') {
    const s = simboloEstado(e.estado)
    d.append(h('span', { clase: `marca ${s.clase}`, texto: s.simbolo }))
    d.append(h('span', { clase: 'vivo-texto', texto: `${e.tool || 'tool'}${e.entrada ? ` · ${recortar(e.entrada, 110)}` : ''}` }))
  } else if (e.tipo === 'subtarea') {
    d.append(h('span', { clase: 'vivo-tipo', texto: '🧩' }))
    d.append(h('span', { clase: 'vivo-texto', texto: `subtarea${e.subagente ? ` (${e.subagente})` : ''} · ${recortar(e.texto, 110)}` }))
  } else if (e.tipo === 'resultado') {
    d.append(h('span', { clase: `marca ${e.error ? 'mal' : 'bien'}`, texto: e.error ? '✗' : '✓' }))
    d.append(h('span', { clase: 'vivo-texto tenue', texto: recortar(e.texto || 'resultado', 120) }))
  } else if (e.tipo === 'pregunta') {
    d.append(h('span', { clase: 'vivo-tipo', texto: '🧑' }))
    d.append(h('span', { clase: 'vivo-texto tenue', texto: recortar(e.texto, 140) }))
  } else if (e.tipo === 'parche') {
    d.append(h('span', { clase: 'vivo-tipo', texto: '📝' }))
    d.append(h('span', { clase: 'vivo-texto', texto: `Archivos: ${(e.archivos || []).slice(0, 4).join(', ') || '—'}` }))
  } else {
    d.append(h('span', { clase: 'vivo-tipo', texto: '·' }))
    d.append(h('span', { clase: 'vivo-texto tenue', texto: `paso terminado${e.coste != null ? ` · ${Number(e.coste).toFixed(4)} $` : ''}` }))
  }
  return d
}

// Pinta (o actualiza, sin parpadeo) el bloque vivo del detalle: estado del colector,
// «pensando ahora», siguientes pasos y actividad. Conserva el scroll del usuario.
function pintarVivo(caja, vivo, job) {
  const eventos = vivo && Array.isArray(vivo.eventos) ? vivo.eventos : []
  const todos = vivo && Array.isArray(vivo.todos) ? vivo.todos : []
  const col = (vivo && vivo.colector) || {}
  const ultimoPensamiento = [...eventos].reverse().find((e) => e.tipo === 'razonamiento' && e.texto)
  const cuando = col.ultimaLectura ? `última lectura ${hace(col.ultimaLectura)}` : 'esperando la primera lectura…'
  const textoEstado = col.error ? `⚠ ${String(col.error).slice(0, 160)} · ${cuando}` : `● Recopilando en vivo · ${cuando}`
  const firma = JSON.stringify([eventos.length, eventos[eventos.length - 1]?.id || null, todos, col.error || null])
  // La línea de estado se refresca siempre (para que se note «en vivo»), pero el
  // resto solo se repinta si hay cambios: así no se cierran los detalles desplegados.
  const estadoPrevio = caja.querySelector('.vivo-estado')
  if (estadoPrevio && caja.dataset.firma) {
    estadoPrevio.textContent = textoEstado
    estadoPrevio.classList.toggle('mal', !!col.error)
  }
  if (caja.dataset.firma === firma) return
  const previa = caja.querySelector('.vivo-actividad')
  const scrollPrevio = previa ? previa.scrollTop : null
  const pegadoAbajo = !previa || (previa.scrollHeight - previa.scrollTop - previa.clientHeight < 36)
  caja.dataset.firma = firma
  vaciar(caja)

  caja.append(h('p', { clase: `vivo-estado${col.error ? ' mal' : ''}`, texto: textoEstado }))

  if (vivo && vivo.origen === 'claude') {
    caja.append(h('p', { clase: 'tenue vivo-nota', texto: 'Claude no expone su pensamiento interno; aquí ves todo lo que está haciendo en tiempo real: herramientas, archivos, textos y subtareas lanzadas.' }))
  }

  if (ultimoPensamiento) {
    caja.append(h('h3', { texto: 'Pensando ahora' }))
    caja.append(h('pre', { clase: 'vivo-pensando', texto: ultimoPensamiento.texto }))
  } else if (job && EN_CURSO_JOB.has(job.status)) {
    caja.append(h('h3', { texto: 'Pensando ahora' }))
    caja.append(h('p', { clase: 'tenue', texto: 'Todavía sin razonamiento; aparecerá aquí en cuanto llegue.' }))
  }

  if (todos.length) {
    caja.append(h('h3', { texto: `Siguientes pasos (${todos.length})` }))
    const ul = h('ul', { clase: 'vivo-todos' })
    for (const t of todos) {
      const s = String(t.estado || '').toLowerCase()
      const marca = s.includes('complet') ? '✓' : s.includes('progress') ? '⏳' : '○'
      const clase = s.includes('complet') ? 'hecho' : s.includes('progress') ? 'curso' : ''
      ul.append(h('li', { clase: `vivo-todo ${clase}` }, h('span', { clase: 'marca', texto: marca }), h('span', { clase: 'vivo-texto', texto: t.contenido })))
    }
    caja.append(ul)
  }

  caja.append(h('h3', { texto: `Actividad (${eventos.length})` }))
  const activ = h('div', { clase: 'vivo-actividad' })
  if (!eventos.length) {
    activ.append(h('p', { clase: 'tenue', texto: job && EN_CURSO_JOB.has(job.status) ? 'Sin actividad todavía: el colector acaba de empezar.' : 'Sin actividad recopilada.' }))
  } else {
    for (const e of eventos.slice(-100)) activ.append(lineaVivo(e))
  }
  caja.append(activ)
  if (pegadoAbajo) activ.scrollTop = activ.scrollHeight
  else if (scrollPrevio != null) activ.scrollTop = scrollPrevio
}

// Demo de la vista viva de una sesión de Claude (actividad, sin pensamiento interno).
function vivoDemoClaude() {
  const ahora = Date.now()
  const m = (n) => n * 60 * 1000
  const ev = (o) => ({ id: `demo-claude-${o.n}`, ts: ahora - o.hace, ...o })
  const eventos = [
    ev({ n: 1, hace: m(4), tipo: 'pregunta', texto: 'Añade el apagado de trabajos al cerrar la sesión y documenta.' }),
    ev({ n: 2, hace: m(4) + 4000, tipo: 'herramienta', tool: 'Read', entrada: 'file_path: config/hub/lib/opencode.mjs' }),
    ev({ n: 3, hace: m(3), tipo: 'subtarea', subagente: 'explorador', texto: 'Revisar cómo aborta OpenCode una sesión' }),
    ev({ n: 4, hace: m(3) + 3000, tipo: 'resultado', error: false, texto: 'Encontrado: POST /session/{id}/abort en el servidor V1.' }),
    ev({ n: 5, hace: m(2), tipo: 'texto', texto: 'Voy a escribir el hook de cierre y el comando cerebro-parar.' }),
    ev({ n: 6, hace: m(1), tipo: 'herramienta', tool: 'Edit', entrada: 'file_path: config/hooks/cerrar-trabajos.mjs' }),
  ]
  return { recopilado: true, origen: 'claude', eventos, todos: [], colector: { ultimaLectura: ahora - 2000, error: null, activo: true } }
}

// Demo de la vista viva: razonamiento, herramientas, parche, paso y siguientes pasos.
function vivoDemo(jobId) {
  const ahora = Date.now()
  const m = (n) => n * 60 * 1000
  const ev = (o) => ({ id: `demo-${jobId}-${o.n}`, ts: ahora - o.hace, agente: 'demo', ...o })
  const eventos = [
    ev({ n: 1, hace: m(5), tipo: 'razonamiento', texto: 'Voy a leer la spec 04 y el estado del panel para decidir por dónde empezar.' }),
    ev({ n: 2, hace: m(5) + 5000, tipo: 'herramienta', tool: 'read', estado: 'completed', entrada: 'filePath: docs/specs/04-modelo-errores-y-detalle-agentes.md' }),
    ev({ n: 3, hace: m(4), tipo: 'razonamiento', texto: 'El detalle actual solo refresca el resumen; añadiré un bloque vivo con razonamiento, actividad y siguientes pasos.' }),
    ev({ n: 4, hace: m(3), tipo: 'herramienta', tool: 'edit', estado: 'completed', entrada: 'filePath: config/hub/panel/app.js' }),
    ev({ n: 5, hace: m(2), tipo: 'texto', texto: 'He añadido el bloque «Pensando ahora» y la lista de siguientes pasos.' }),
    ev({ n: 6, hace: m(2) + 3000, tipo: 'parche', archivos: ['config/hub/panel/app.js', 'config/hub/panel/style.css'] }),
    ev({ n: 7, hace: m(1), tipo: 'herramienta', tool: 'bash', estado: 'running', entrada: 'command: node config/hub/lib/actividad.mjs' }),
    ev({ n: 8, hace: m(1) + 2000, tipo: 'paso', coste: 0.0123 }),
  ]
  const todos = [
    { contenido: 'Recopilar razonamiento y actividad por trabajo', estado: 'completed' },
    { contenido: 'Mostrar «pensando ahora» y actividad en vivo', estado: 'in_progress' },
    { contenido: 'Siguientes pasos desde la lista del agente', estado: 'pending' },
  ]
  return { recopilado: true, eventos, todos, colector: { ultimaLectura: ahora - 1500, error: null, activo: true } }
}

// R9 · datos simulados de detalle para el modo demo (no hay hub que consultar).
function detalleDemo(jobId) {
  const ahora = Date.now()
  const base = {
    'demo-job-1': { agent: 'cerebro', title: 'Coordinar el tramo B del panel visual', status: 'running', modelo: 'claude-sonnet-4-5', variant: null, cost: 0.004, tokens: { input: 5000, output: 900 }, ultimoTexto: 'Revisando la spec y repartiendo el trabajo entre los agentes.', herramientas: [{ tool: 'task', estado: 'running' }], archivosPatch: [] },
    'demo-job-2': { agent: 'implementador', title: 'La oficina: salas, mesas y monitores', status: 'running', modelo: 'deepseek-v3.2', variant: 'high', cost: 0.0123, tokens: { input: 18234, output: 4210, cache: { read: 9000 } }, ultimoTexto: 'He creado las salas y los personajes. Ahora ajusto las animaciones por estado y el plegado de salas inactivas.', herramientas: [{ tool: 'read', estado: 'completed' }, { tool: 'edit', estado: 'completed' }, { tool: 'bash', estado: 'running' }], archivosPatch: ['config/hub/panel/app.js', 'config/hub/panel/style.css'] },
    'demo-job-3': { agent: 'revisor', title: 'Revisar el diff contra la spec', status: 'input_required', modelo: 'deepseek-v3.2', variant: 'max', cost: 0.003, tokens: { input: 7000, output: 1200 }, ultimoTexto: 'Necesito confirmar si el chip de error debe mostrar el título o el tipo.', herramientas: [{ tool: 'read', estado: 'completed' }], archivosPatch: [] },
    'demo-job-4': { agent: 'testeador', title: 'Pruebas de lógica pura (A2/A3)', status: 'failed', modelo: 'deepseek-flash', variant: 'low', cost: 0.001, tokens: { input: 1200, output: 300 }, ultimoTexto: 'Las pruebas fallan al arrancar el servidor local.', herramientas: [{ tool: 'bash', estado: 'error' }], archivosPatch: [], error: 'Timeout esperando al servidor local' },
    'demo-job-5': { agent: 'explorador-ds', title: 'Reconocer lib/actividad.mjs', status: 'running', modelo: 'deepseek-flash', variant: 'low', cost: 0.0007, tokens: { input: 3000, output: 500 }, ultimoTexto: 'He leído actividad.mjs y resumido sus fuentes: jobs, sesiones y latidos.', herramientas: [{ tool: 'read', estado: 'completed' }], archivosPatch: [] },
  }
  const d = base[jobId] || { agent: 'agente', title: 'Trabajo de demostración', status: 'running', modelo: 'deepseek-v3.2', variant: 'high', cost: 0.0021, tokens: { input: 1000, output: 300 }, ultimoTexto: 'Trabajando en la tarea de demostración.', herramientas: [{ tool: 'read', estado: 'completed' }], archivosPatch: [] }
  return { ok: true, vivo: vivoDemo(jobId), job: { jobId, sessionId: null, createdAt: ahora - 6 * 60 * 1000, updatedAt: ahora, directory: 'C:/demo/panel-la-oficina', ...d } }
}

let temporizadorDetalle = null
let detalleAbierto = null
function pararDetalle() { if (temporizadorDetalle) { clearInterval(temporizadorDetalle); temporizadorDetalle = null } detalleAbierto = null }

function abrirDetalle(personaje, proyecto) {
  pararDetalle()
  $('lateralTitulo').textContent = personaje.agente
  const cuerpo = vaciar($('lateralCuerpo'))
  const fila = (etiqueta, valor) => {
    if (valor == null || valor === '') return
    const d = h('div', { clase: 'fila' })
    d.append(h('span', { clase: 'fila-k', texto: etiqueta }))
    d.append(h('span', { clase: 'fila-v', texto: String(valor) }))
    cuerpo.append(d)
  }
  fila('Estado', personaje.estado)
  fila('Familia', metaFam(personaje.familia).nombre)
  fila('Modelo', personaje.modelo ? etiquetaModelo(personaje.modelo) : 'modelo no informado · hereda el del hilo principal')
  fila('Esfuerzo', personaje.variant ? `${nombreEsfuerzo(personaje.variant)} (${personaje.variant})` : null)
  // R8 · agentes sin job (Claude/latidos): solo lo que se sabe, sin inventar.
  fila('Origen', personaje.origen === 'claude' ? 'Claude (latido)' : personaje.origen)
  fila('Evento', personaje.evento)
  fila('Tarea', personaje.tarea || '(sin título)')
  fila('En curso desde', personaje.desde ? `${hace(personaje.desde)} · ${dur(personaje.desde)}` : null)
  fila('jobId', personaje.jobId)
  fila('Sesión', personaje.sesion)
  fila('Proyecto', proyecto.nombre)
  fila('Ruta', proyecto.ruta)
  if (personaje.errorInfo) bloqueError(cuerpo, personaje.errorInfo)
  else if (personaje.error) fila('Error', personaje.error)

  const b = h('button', { clase: 'boton', type: 'button', texto: 'Ver memoria del proyecto' })
  b.addEventListener('click', () => verProyecto(proyecto.ruta))
  cuerpo.append(b)

  const esClaude = personaje.origen === 'claude' && !!personaje.sesion
  // Contexto y ventanas reales de Claude para esta sesión (los empuja la barra de estado).
  if (esClaude) {
    const ce = (estado.claudeEstados || []).find((x) => x.sesion === personaje.sesion)
    if (ce) {
      fila('Contexto Claude', ce.contextoPct != null ? `${Math.round(ce.contextoPct)} % usado` : null)
      const r5 = horaReset(ce.cincoReset)
      fila('Ventana 5 h', ce.cincoPct != null ? `${Math.round(ce.cincoPct)} %${r5 ? ` · reinicia ${r5}` : ''}` : null)
      const r7 = horaReset(ce.sieteReset)
      fila('Ventana 7 d', ce.sietePct != null ? `${Math.round(ce.sietePct)} %${r7 ? ` · reinicia ${r7}` : ''}` : null)
      fila('Coste Claude (est.)', ce.coste != null ? `${ce.coste.toFixed(2)} $` : null)
    }
  }
  if (personaje.jobId || esClaude) {
    const seccion = h('div', { clase: 'detalle-job' })
    const vivoCaja = h('div', { clase: 'detalle-vivo' })
    cuerpo.append(seccion)
    cuerpo.append(vivoCaja)
    const clave = personaje.jobId ? `job:${personaje.jobId}` : `claude:${personaje.sesion}`
    const cargar = async () => {
      let r = null
      try {
        if (estado.demo) {
          r = esClaude ? { ok: true, vivo: vivoDemoClaude() } : detalleDemo(personaje.jobId)
        } else if (personaje.jobId) {
          r = await fetch(`/api/trabajos/${encodeURIComponent(personaje.jobId)}`).then((x) => x.json())
        } else {
          r = await fetch(`/api/vivo/agente?sesion=${encodeURIComponent(personaje.sesion)}`).then((x) => x.json())
        }
      } catch { r = null }
      if (!r || r.ok === false) {
        if (!seccion.childElementCount) seccion.append(h('p', { clase: 'tenue', texto: (r && r.error) || (esClaude ? 'Sin actividad recopilada de esta sesión.' : 'Sin detalle del trabajo.') }))
        pararDetalle()
        return
      }
      if (r.job) pintarDetalleJob(seccion, r.job)
      else vaciar(seccion)
      pintarVivo(vivoCaja, r.vivo || null, r.job || null)
      const sigue = esClaude ? EN_CURSO.has(personaje.estado) : (!r.job || EN_CURSO_JOB.has(r.job.status))
      if (!sigue) pararDetalle()
    }
    detalleAbierto = { clave, cargar }
    cargar()
    // R7 · refresco cada ~3 s solo si el personaje sigue en curso.
    if (EN_CURSO.has(personaje.estado)) temporizadorDetalle = setInterval(cargar, 3000)
  }

  $('lateral').classList.remove('oculto')
}

function refrescarTiempos() {
  for (const el of document.querySelectorAll('.puesto[data-desde]')) {
    const t = el.querySelector('.globo-tiempo')
    const desde = Number(el.dataset.desde)
    if (t && desde) t.textContent = dur(desde)
  }
}

// ---------------------------------------------------------------- cabecera (R13)

function pintarCabecera() {
  const act = estado.actividad
  const personajes = (act?.proyectos || []).flatMap((p) => p.personajes)
  const activos = personajes.filter((p) => p.estado !== 'terminado').length
  const alertas = (estado.vigilante?.alertas || []).length
  const cont = vaciar($('contadores'))
  cont.append(h('span', { clase: 'chip contador', texto: `${activos} activo${activos === 1 ? '' : 's'}` }))
  cont.append(h('span', { clase: 'chip contador', texto: `${(act?.proyectos || []).length} proyecto${(act?.proyectos || []).length === 1 ? '' : 's'}` }))
  cont.append(h('span', { clase: `chip contador${alertas ? ' alarma' : ''}`, texto: `${alertas} alerta${alertas === 1 ? '' : 's'}` }))

  const modo = estado.conexion === 'sse' ? 'SSE en vivo'
    : estado.demo ? 'demo'
      : estado.conexion === 'polling' ? 'polling 3 s'
        : estado.conexion === 'conectando' ? 'conectando…' : 'sin hub'
  const s = estado.salud
  const partes = [modo]
  partes.push(s ? 'hub ok' : 'hub —')
  if (s) partes.push(s.servidorV1 ? `V1 :${s.servidorV1}${s.servidorV1Ok === false ? ' (sin respuesta)' : ''}` : 'V1 apagado')
  const chip = $('chipConexion')
  chip.textContent = partes.join(' · ')
  chip.className = `chip conexion modo-${estado.conexion === 'sse' ? 'sse' : estado.demo ? 'demo' : 'poll'}`

  if (s) {
    $('sub').textContent = `datos: ${s.datos}`
    $('pie').textContent = `Cerebro Hub v${s.version} · ${s.memoria} · actualizado ${new Date().toLocaleTimeString()}`
  }
}

// ---------------------------------------------------------------- gráficos (R12)

function pintarOrganigrama(org, act) {
  const cont = vaciar($('organigrama'))
  const activos = new Map()
  for (const p of act?.proyectos || []) for (const c of p.personajes) activos.set(c.agente, c.estado)

  const porFamilia = new Map(ORDEN_FAMILIAS.map((f) => [f, new Map()]))
  const meter = (a, origen) => {
    const nombre = a?.nombre
    if (!nombre) return
    const fam = familiaDe(nombre)
    const bolsa = porFamilia.get(fam)
    if (!bolsa) return
    const previo = bolsa.get(nombre) || { nombre, modelo: null, origen }
    bolsa.set(nombre, { ...previo, modelo: a.modelo || previo.modelo, origen: previo.origen || origen })
  }
  for (const a of org?.claude || []) meter(a, 'claude')
  for (const a of org?.opencode || []) meter(a, 'opencode')
  // Agentes activos que no estén en la organización (p. ej. «Agente» genérico).
  for (const [nombre] of activos) {
    const fam = familiaDe(nombre)
    if (!porFamilia.get(fam)?.has(nombre)) porFamilia.get(fam)?.set(nombre, { nombre, modelo: null, origen: 'actividad' })
  }

  for (const f of ORDEN_FAMILIAS) {
    const agentes = [...(porFamilia.get(f) || new Map()).values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
    if (!agentes.length) continue
    const activosFam = agentes.filter((a) => activos.has(a.nombre)).length
    const col = h('div', { clase: `organo-familia${activosFam ? ' con-activos' : ''}`, style: `--fam-color:${metaFam(f).color}` })
    const cab = h('div', { clase: 'organo-cab' })
    cab.append(h('span', { clase: 'punto-fam' }))
    cab.append(h('span', { clase: 'organo-nombre', texto: metaFam(f).nombre }))
    cab.append(h('span', { clase: 'chip', texto: `${agentes.length}` }))
    if (activosFam) cab.append(h('span', { clase: 'badge verde', texto: `${activosFam} activos` }))
    col.append(cab)
    for (const a of agentes) {
      const est = activos.get(a.nombre)
      const card = h('div', { clase: `organo-agente${est ? ` activo estado-${est}` : ''}` })
      card.append(h('span', { clase: 'organo-agente-nombre', texto: a.nombre }))
      card.append(h('span', { clase: 'chip', texto: a.origen === 'claude' ? 'Claude' : a.origen === 'opencode' ? 'OpenCode' : 'actividad' }))
      if (a.modelo) card.append(h('span', { clase: 'chip modelo', texto: a.modelo }))
      if (est) card.append(h('span', { clase: 'tenue', texto: est }))
      col.append(card)
    }
    cont.append(col)
  }
  if (!cont.childElementCount) cont.append(h('p', { clase: 'tenue', texto: 'Sin equipos registrados.' }))
}

function pintarReparto(g) {
  const cont = vaciar($('reparto'))
  const familias = g?.familias || []
  const modelos = g?.modelos || []
  if (!familias.length && !modelos.length) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin actividad real ahora mismo: no hay reparto que mostrar.' }))
    return
  }
  const bloque = (titulo, filas, colorDe, etiqueta) => {
    const max = Math.max(1, ...filas.map((f) => f.personajes))
    const wrap = h('div', { clase: 'reparto-bloque' })
    wrap.append(h('h3', { texto: titulo }))
    for (const f of filas) {
      const fila = h('div', { clase: 'barra' })
      fila.append(h('span', { clase: 'barra-etiqueta', texto: etiqueta(f) }))
      const pista = h('div', { clase: 'barra-pista' })
      const relleno = h('div', { clase: 'barra-relleno', style: `width:${Math.round((f.personajes / max) * 100)}%;background:${colorDe(f)}` })
      pista.append(relleno)
      fila.append(pista)
      fila.append(h('span', { clase: 'barra-valor', texto: `${f.personajes}` }))
      wrap.append(fila)
    }
    return wrap
  }
  if (familias.length) {
    cont.append(bloque('Por familia', familias, (f) => metaFam(f.familia).color, (f) => metaFam(f.familia).nombre))
  }
  if (modelos.length) {
    cont.append(bloque('Por modelo', modelos, () => 'var(--acento)', (m) => etiquetaModelo(m.modelo)))
  }
}

// ---------------------------------------------------------------- secciones conservadas (R15)

function pintarOrganizacion(org) {
  const listaAgentes = (cont, lista, esOC) => {
    vaciar(cont)
    if (!lista || !lista.length) { cont.append(h('p', { clase: 'tenue', texto: '—' })); return }
    for (const a of lista) {
      const card = h('div', { clase: 'agente' })
      const cab = h('div')
      cab.append(h('span', { clase: 'nombre', texto: a.nombre }))
      cab.append(h('span', { clase: 'chip modelo', texto: a.modelo || '(hereda)' }))
      if (a.variant) cab.append(h('span', { clase: 'chip modelo' }, h('b', { texto: a.variant })))
      if (esOC && a.modo) cab.append(h('span', { clase: 'chip', texto: a.modo }))
      card.append(cab)
      card.append(h('div', { clase: 'desc', texto: (a.descripcion || '').slice(0, 110) }))
      cont.append(card)
    }
  }
  listaAgentes($('agentesClaude'), org?.claude, false)
  listaAgentes($('agentesOpenCode'), org?.opencode, true)
}

function pintarProyectos(lista) {
  const cont = vaciar($('proyectos'))
  if (!lista || !lista.length) { cont.append(h('p', { clase: 'tenue', texto: 'Aún no hay proyectos en la memoria del hub.' })); return }
  for (const p of lista) {
    const card = h('div', { clase: 'agente clic', 'data-slug': p.slug, 'data-ruta': p.ruta })
    const cab = h('div')
    cab.append(h('span', { clase: 'nombre', texto: p.nombre }))
    cab.append(h('span', { clase: `badge ${p.tieneEstado ? 'verde' : 'gris'}`, texto: p.tieneEstado ? 'estado' : 'sin estado' }))
    if (p.tieneContexto) cab.append(h('span', { clase: 'badge azul', texto: 'contexto' }))
    card.append(cab)
    card.append(h('div', { clase: 'desc', texto: `${p.ruta} · último uso ${hace(p.ultimoUso)}` }))
    card.addEventListener('click', () => verProyecto(p.ruta))
    cont.append(card)
  }
}

async function verProyecto(ruta) {
  try {
    const r = await fetch(`/api/memoria/proyecto?cwd=${encodeURIComponent(ruta)}`).then((x) => x.json())
    if (!r.ok) return
    $('modalTitulo').textContent = `Proyecto · ${r.proyecto.nombre}`
    $('modalSub').textContent = r.proyecto.ruta
    $('modalCuerpo').textContent = `## ESTADO.md\n\n${r.estado || '(vacío)'}\n\n## CONTEXTO-REPO.md\n\n${r.contexto || '(pendiente)'}\n\n## Última bitácora\n\n${(r.bitacora || '(vacía)').slice(-2000)}`
    // R7 · tamaño de la bitácora y compresión manual del proyecto.
    const acc = $('modalAcciones')
    if (acc) {
      vaciar(acc)
      acc.append(h('span', { clase: 'tenue', texto: `Bitácora: ${fmt(r.bitacoraTamano || 0)} caracteres` }))
      const boton = h('button', { clase: 'boton mini', type: 'button', texto: 'Comprimir ahora' })
      boton.addEventListener('click', async () => {
        boton.disabled = true
        boton.textContent = 'Comprimiendo…'
        try {
          const rr = await fetch('/api/memoria/comprimir', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ proyecto: r.proyecto.ruta, forzar: true }),
          }).then((x) => x.json())
          boton.textContent = rr.ok
            ? (rr.omitido ? `Sin cambios (${rr.omitido})` : `Comprimido (${rr.modo}, ${rr.archivado} apuntes)`)
            : `Error: ${rr.error || 'no se pudo comprimir'}`
        } catch { boton.textContent = 'Error de red' }
      })
      acc.append(boton)
    }
    $('modal').classList.remove('oculto')
  } catch { /* nada */ }
}

function pintarVigilante(v) {
  const cont = vaciar($('alertas'))
  const alertas = v?.alertas || []
  if (!alertas.length) { cont.append(h('p', { clase: 'tenue', texto: 'Sin alertas: todo en orden.' })); return }
  for (const a of alertas) {
    const info = a.info || null
    const card = h('div', { clase: 'agente' })
    const cab = h('div')
    // R6 · la alerta usa el mismo clasificador: título legible en lugar del tipo crudo.
    cab.append(h('span', { clase: 'badge ambar', texto: info?.titulo || a.tipo }))
    cab.append(h('span', { clase: 'nombre', texto: a.title || a.jobId || '—' }))
    card.append(cab)
    const desc = [info?.causa, `${a.directory || ''} · ${a.minutos} min`.trim(), info?.accion].filter(Boolean).join(' · ')
    card.append(h('div', { clase: 'desc', texto: desc }))
    cont.append(card)
  }
}

function pintarTrabajos(jobs) {
  const tb = $('tablaTrabajos').querySelector('tbody')
  vaciar(tb)
  if (!jobs || !jobs.length) {
    const tr = h('tr')
    tr.append(h('td', { clase: 'tenue', colspan: '4', texto: 'Sin trabajos registrados.' }))
    tb.append(tr)
    return
  }
  for (const j of jobs.slice(0, 20)) {
    const tr = h('tr')
    const td1 = h('td'); td1.append(badgeEstado(j.status)); tr.append(td1)
    tr.append(h('td', { texto: j.title || j.jobId || '—' }))
    tr.append(h('td', { clase: 'tenue', texto: corto(j.directory) }))
    tr.append(h('td', { clase: 'tenue', texto: hace(j.updatedAt) }))
    tb.append(tr)
  }
}

function pintarGasto(g) {
  const cont = vaciar($('gasto'))
  const ds = g?.deepseek || {}
  const ses = g?.sesiones || {}
  const card1 = h('div', { clase: 'agente' })
  card1.append(h('div', {}, h('span', { clase: 'nombre', texto: 'DeepSeek' })))
  const d1 = h('div', { clase: 'desc' })
  if (ds.ok) {
    d1.append('saldo ', h('b', { texto: `${ds.saldo} ${ds.moneda}` }), ds.disponible ? '' : ' · no disponible')
  } else d1.append(`— ${ds.error || 'sin datos'}`)
  card1.append(d1)
  cont.append(card1)

  const card2 = h('div', { clase: 'agente' })
  card2.append(h('div', {}, h('span', { clase: 'nombre', texto: 'Sesiones de hoy' })))
  const d2 = h('div', { clase: 'desc' })
  if (ses.ok) d2.append(`${fmt(ses.hoy)} sesiones · coste ${(ses.coste || 0).toFixed(4)} $ · total histórico ${fmt(ses.total)}`)
  else d2.append(`— ${ses.error || 'sin datos'}`)
  card2.append(d2)
  cont.append(card2)
}

// Spec 11 · M7 · tarjeta pequeña de métricas: interruptor, tamaño, nº de eventos y exportar.
function pintarMetricas(resumen, activas) {
  const cont = vaciar($('metricas'))
  if (!cont) return
  const r = resumen || {}
  const bytes = typeof r.bytes === 'number' ? r.bytes : 0
  const tam = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
  const card = h('div', { clase: 'agente' })

  const cab = h('div', { clase: 'cab-oficina' })
  const casilla = h('label', { clase: 'chip casilla', title: 'Activar o desactivar la recogida de métricas' })
  const chk = h('input', { type: 'checkbox' })
  chk.checked = activas !== false
  chk.addEventListener('change', async () => {
    try {
      await fetch('/api/metricas/activas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activas: chk.checked }) })
    } catch { /* hub caído */ }
    refrescarPesado()
  })
  casilla.append(chk, ' activas')
  cab.append(casilla)
  cab.append(h('a', { clase: 'boton mini', href: '/api/metricas/exportar', download: 'metricas.jsonl', texto: 'Exportar .jsonl' }))
  card.append(cab)

  card.append(h('div', { clase: 'desc', texto: `${fmt(r.eventos || 0)} eventos · ${tam}${r.desde ? ` · desde ${String(r.desde).slice(0, 10)}` : ''}` }))
  const tipos = Object.entries(r.porTipo || {}).sort((a, b) => b[1] - a[1])
  if (tipos.length) card.append(h('div', { clase: 'desc tenue', texto: tipos.map(([t, n]) => `${t}:${n}`).join(' · ') }))
  card.append(h('div', { clase: 'desc tenue', texto: 'Log local en hub-data/logs/metricas.jsonl · nunca guarda prompts, respuestas ni comandos.' }))
  cont.append(card)
}

// Spec 14 · C5 · tarjeta «Reparto»: carga por agente y capa y consultas A2A.
function pintarRepartoCarga(d) {
  const cont = vaciar($('repartoCarga'))
  if (!cont) return
  const datos = d || {}
  const agentes = datos.agentes || []
  if (!agentes.length) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin trabajos en el periodo (últimos 7 días).' }))
  } else {
    const tabla = h('table')
    tabla.append(h('thead', {}, h('tr', {},
      h('th', { texto: 'Agente' }), h('th', { texto: 'Trabajos' }), h('th', { texto: 'OK' }),
      h('th', { texto: 'Fallidos' }), h('th', { texto: 'Cancel.' }), h('th', { texto: 'Coste' }),
      h('th', { texto: 'Media' }))))
    const tb = h('tbody')
    for (const a of agentes) {
      tb.append(h('tr', {},
        h('td', { texto: a.agente || '?' }),
        h('td', { texto: fmt(a.trabajos || 0) }),
        h('td', { texto: fmt(a.completados || 0) }),
        h('td', { texto: fmt(a.fallidos || 0) }),
        h('td', { texto: fmt(a.cancelados || 0) }),
        h('td', { texto: typeof a.coste === 'number' ? `$${a.coste.toFixed(2)}` : '—' }),
        h('td', { texto: a.mediaMs ? `${Math.round(a.mediaMs / 1000)} s` : '—' })))
    }
    tabla.append(tb)
    cont.append(tabla)
  }
  const c = datos.consultasA2A || {}
  const capas = (datos.capas || []).map((x) => `${x.capa}: ${x.trabajos}`).join(' · ')
  cont.append(h('div', { clase: 'desc tenue', texto: `Por capa — ${capas || 'sin datos'}` }))
  cont.append(h('div', { clase: 'desc tenue', texto: `Consultas A2A: ${c.total || 0} · coste $${(c.coste || 0).toFixed(2)} · respuesta media ${c.mediaRespuestaChars || 0} chars` }))
}

function pintarVentana(v) {
  const tb = $('tablaVentana').querySelector('tbody')
  vaciar(tb)
  const filas = Object.entries(v?.porModelo || {}).sort((a, b) => b[1].n7 - a[1].n7)
  if (!filas.length) {
    const tr = h('tr')
    tr.append(h('td', { clase: 'tenue', colspan: '5', texto: `Sin datos aún (${v?.archivos || 0} archivos del historial revisados).` }))
    tb.append(tr)
    return
  }
  for (const [modelo, d] of filas) {
    const tr = h('tr')
    tr.append(h('td', { texto: modelo }))
    tr.append(h('td', { texto: k(d.n5) }))
    tr.append(h('td', { texto: k(d.n7) }))
    tr.append(h('td', { clase: 'tenue', texto: k(d.c7) }))
    tr.append(h('td', { clase: 'tenue', texto: fmt(d.mensajes) }))
    tb.append(tr)
  }
}

function pintarSaludAgentes(datos) {
  const cont = vaciar($('saludAgentes'))
  const lista = (datos && datos.agentes) || []
  if (!lista.length) { cont.append(h('p', { clase: 'tenue', texto: 'Sin agentes con respaldo configurado.' })); return }
  for (const a of lista) {
    const ok = Math.max(0, Math.round((a.muestras || 0) * (1 - (a.tasaFallo || 0))))
    const est = a.degradado && a.proximaPrueba
      ? `degradado hasta ${new Date(a.proximaPrueba).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'activo'
    const card = h('div', { clase: 'agente' })
    const cab = h('div')
    cab.append(h('span', { clase: 'nombre', texto: a.agente }))
    cab.append(h('span', { clase: `badge ${a.degradado ? 'ambar' : 'verde'}`, texto: est }))
    cab.append(h('span', { clase: 'chip', texto: `${ok}/${a.muestras || 0} OK` }))
    card.append(cab)
    cont.append(card)
  }
}

function pintarMcps(m) {
  const cont = vaciar($('mcps'))
  const lista = m?.mcps || []
  if (!lista.length) {
    cont.append(h('p', { clase: 'tenue' }, 'Sin inventario todavía: ejecuta ', h('code', { texto: 'hub/mcps.mjs' }), ' o invoca al agente ', h('code', { texto: 'adaptador-mcps' }), '.'))
    return
  }
  for (const x of lista) {
    const card = h('div', { clase: 'agente' })
    const cab = h('div')
    cab.append(h('span', { clase: 'nombre', texto: x.nombre }))
    if (!x.habilitado) cab.append(h('span', { clase: 'badge gris', texto: 'deshabilitado' }))
    cab.append(h('span', { clase: 'chip', texto: x.origen }))
    card.append(cab)
    const detalle = x.detalle ? ' · ' + String(x.detalle).slice(0, 60) : ''
    card.append(h('div', { clase: 'desc', texto: (x.capacidades || []).join(', ') + detalle }))
    cont.append(card)
  }
}

function pintarHallazgos(hh) {
  const cont = vaciar($('hallazgos'))
  const lista = hh?.hallazgos || []
  if (!lista.length) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin hallazgos. Los agentes apuntan aquí lo que encuentran antes de crear nada nuevo.' }))
    return
  }
  for (const x of lista.slice(0, 12)) {
    const color = x.estado === 'validado' ? 'verde' : x.estado === 'descartado' ? 'gris' : x.estado === 'integrado' ? 'azul' : 'ambar'
    const card = h('div', { clase: 'agente' })
    const cab = h('div')
    cab.append(h('span', { clase: 'nombre', texto: x.nombre }))
    cab.append(h('span', { clase: `badge ${color}`, texto: x.estado }))
    // Solo enlaces http(s): nunca `javascript:` ni esquemas raros llegados del servidor.
    if (x.url && /^https?:\/\//i.test(String(x.url))) {
      const a = h('a', { clase: 'tenue', href: String(x.url), target: '_blank', rel: 'noreferrer', texto: 'enlace' })
      cab.append(a)
    }
    card.append(cab)
    card.append(h('div', { clase: 'desc', texto: (x.nota || '').slice(0, 120) + (x.por ? ' · por ' + x.por : '') }))
    if (x.estado === 'propuesto') {
      const fila = h('div', { clase: 'desc' })
      for (const [texto, nuevo] of [['Validar', 'validado'], ['Descartar', 'descartado'], ['Integrado', 'integrado']]) {
        const b = h('button', { clase: 'boton mini', type: 'button', texto })
        b.addEventListener('click', async () => {
          try {
            await fetch('/api/hallazgos/estado', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: x.id, estado: nuevo }),
            })
            refrescarPesado()
          } catch { /* nada */ }
        })
        fila.append(b)
      }
      card.append(fila)
    }
    cont.append(card)
  }
}

// ---------------------------------------------------------------- pestañas

// Registro de errores: lista completa (mensaje, stack y contexto) para revisar o
// exportar. Cada capa (hub, trabajos, hooks, MCP, panel) reporta a /api/log.
// R6 · cron: lista de jobs programados (con siguiente ejecución y estado), botones
// ejecutar/pausar/reanudar/borrar y los avisos del planificador (fallos, preflight, reintentos).
function pintarProgramadas(datos) {
  const d = datos || {}
  const cont = vaciar($('cronJobs'))
  const jobs = d.jobs || []
  if (!jobs.length) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin tareas programadas. Créalas con POST /api/cron (o pídeselas al cerebro).' }))
  } else {
    for (const j of jobs) {
      const c = h('div', { clase: 'agente' })
      const cab = h('div')
      const clase = j.estado === 'activo' ? 'verde' : j.estado === 'fallido' ? 'rojo' : j.estado === 'pausado' ? 'ambar' : 'azul'
      cab.append(h('span', { clase: `badge ${clase}`, texto: j.estado || '—' }))
      cab.append(h('span', { clase: 'nombre', texto: j.nombre || j.id }))
      c.append(cab)
      const programacion = !j.schedule ? '—'
        : j.schedule.kind === 'cron' ? `cron «${j.schedule.expr}»`
          : j.schedule.kind === 'interval' ? `cada ${j.schedule.minutos} min`
            : `una vez · ${j.schedule.ejecutar_en}`
      c.append(h('div', { clase: 'desc', texto: `${(j.destino && j.destino.agente) || '—'} · ${programacion}` }))
      c.append(h('div', {
        clase: 'desc tenue',
        texto: `siguiente: ${j.siguiente ? new Date(j.siguiente).toLocaleString() : '—'} · reintentos: ${j.reintentos || 0}${j.motivo ? ` · ${j.motivo}` : ''}`,
      }))
      const accion = (ruta, texto, peligro) => {
        const b = h('button', { clase: `boton mini${peligro ? ' peligro' : ''}`, type: 'button', texto })
        b.addEventListener('click', async () => {
          try {
            await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: j.id }) })
            refrescarPesado()
          } catch { /* nada */ }
        })
        return b
      }
      const fila = h('div', { clase: 'desc' })
      fila.append(accion('/api/cron/ejecutar', 'Ejecutar'))
      fila.append(accion(j.estado === 'pausado' ? '/api/cron/reanudar' : '/api/cron/pausar', j.estado === 'pausado' ? 'Reanudar' : 'Pausar'))
      fila.append(accion('/api/cron/borrar', 'Borrar', true))
      c.append(fila)
      cont.append(c)
    }
  }

  const contA = vaciar($('cronAvisos'))
  const avisos = d.avisos || []
  if (!avisos.length) {
    contA.append(h('p', { clase: 'tenue', texto: 'Sin avisos.' }))
  } else {
    for (const a of avisos.slice(-20).reverse()) {
      const c = h('div', { clase: 'agente' })
      const clase = a.tipo === 'fallido' ? 'rojo' : a.tipo === 'fail_closed' ? 'ambar' : 'azul'
      const cab = h('div')
      cab.append(h('span', { clase: `badge ${clase}`, texto: a.tipo || 'aviso' }))
      const ts = a.fecha ? Date.parse(a.fecha) : null
      cab.append(h('span', { clase: 'desc tenue', texto: ts ? hace(ts) : '' }))
      c.append(cab)
      c.append(h('div', { clase: 'desc', texto: a.mensaje || '' }))
      contA.append(c)
    }
  }
}

function pintarErrores(datos) {
  const cont = vaciar($('errores'))
  const errores = (datos && datos.errores) || []
  const resumen = (datos && datos.resumen) || {}
  $('erroresResumen').textContent = errores.length
    ? `${errores.length} recientes · ${Object.entries(resumen.porOrigen || {}).map(([o, n]) => `${o}:${n}`).join(' ')}`
    : 'sin errores'
  if (!errores.length) {
    cont.append(h('p', { clase: 'tenue', texto: 'Sin errores registrados. 🎉' }))
    return
  }
  for (const e of errores) {
    const card = h('div', { clase: 'agente' })
    const cab = h('div', { clase: 'cab-oficina' })
    cab.append(h('span', { clase: `badge ${e.severidad === 'critico' || e.severidad === 'error' ? 'ambar' : 'verde'}`, texto: e.severidad }))
    cab.append(h('span', { clase: 'nombre', texto: `${e.origen} · ${new Date(e.fecha).toLocaleString()}` }))
    card.append(cab)
    card.append(h('div', { clase: 'desc', texto: e.mensaje }))
    if (e.contexto) card.append(h('div', { clase: 'desc tenue', texto: String(e.contexto).slice(0, 320) }))
    if (e.stack) {
      const det = h('details', { clase: 'error-crudo' })
      det.append(h('summary', { texto: 'Stack' }))
      det.append(h('pre', { texto: e.stack }))
      card.append(det)
    }
    cont.append(card)
  }
}

function erroresDemo() {
  return {
    resumen: { porOrigen: { job: 1, 'hook:latido': 1, panel: 1 }, porSeveridad: { error: 2, aviso: 1 } },
    errores: [
      { id: 'err_demo1', fecha: new Date(Date.now() - 4 * 60000).toISOString(), severidad: 'error', origen: 'job', mensaje: 'Trabajo FALLIDO (testeador): Timeout esperando al servidor local', contexto: '{"jobId":"job_demo4","agente":"testeador","titulo":"Pruebas de lógica pura (A2/A3)","coste":0.001}', stack: null },
      { id: 'err_demo2', fecha: new Date(Date.now() - 9 * 60000).toISOString(), severidad: 'aviso', origen: 'hook:latido', mensaje: 'ENOENT: no such file or directory, stat "...9cdf5b62....jsonl"', contexto: '{"sesion":"9cdf5b62-...","ruta":"~/.claude/projects/G--Mi-unidad-Universidad-TFG"}', stack: null },
      { id: 'err_demo3', fecha: new Date(Date.now() - 15 * 60000).toISOString(), severidad: 'error', origen: 'panel', mensaje: 'TypeError: Cannot read properties of null (reading \'status\')', contexto: '{"url":"http://127.0.0.1:4597/?demo=1"}', stack: 'TypeError: Cannot read properties of null\n    at pintarDetalleVivo (app.js:1234)' },
    ],
  }
}

// R4 · aprobaciones: modo, reglas activas, allowlist propio y pendientes.
function pintarAprobaciones(d) {
  const datos = d || {}
  const contModo = vaciar($('aprobacionesModo'))
  const cardModo = h('div', { clase: 'agente' })
  const cabModo = h('div')
  cabModo.append(h('span', { clase: `badge ${datos.modo === 'abierto' ? 'ambar' : 'azul'}`, texto: `modo: ${datos.modo || 'manual'}` }))
  if (datos.modoEfectivo && datos.modoEfectivo !== datos.modo) cabModo.append(h('span', { clase: 'chip', texto: `efectivo: ${datos.modoEfectivo}` }))
  cardModo.append(cabModo)
  const notaModo = datos.modo === 'abierto' ? 'Solo bloquea hardline; lo peligroso se aprueba (decisión explícita del usuario).'
    : datos.modo === 'inteligente' ? 'Inteligente: lo peligroso lo evalúa el guardián; 3 denegaciones seguidas pasan a manual.'
      : 'Manual: lo peligroso pregunta; lo seguro se aprueba. El allowlist nunca salva un hardline.'
  cardModo.append(h('div', { clase: 'desc', texto: notaModo }))
  contModo.append(cardModo)

  // R8 · guardián: circuit-breaker, últimos veredictos y reinicio del circuito.
  pintarGuardian(datos.guardian || {})

  // Reglas activas: conteos + lista de hardline y peligroso (seguro solo el conteo).
  const reglas = datos.reglas || {}
  const conteos = reglas.conteos || {}
  const contReglas = vaciar($('aprobacionesReglas'))
  for (const [nivel, clase] of [['hardline', 'rojo'], ['peligroso', 'ambar'], ['seguro', 'verde']]) {
    const lista = reglas[nivel] || []
    const c = h('div', { clase: 'agente' })
    const cab = h('div')
    cab.append(h('span', { clase: `badge ${clase}`, texto: nivel }))
    cab.append(h('span', { clase: 'chip', texto: `${conteos[nivel] != null ? conteos[nivel] : lista.length}` }))
    c.append(cab)
    if (nivel !== 'seguro') {
      for (const r of lista) c.append(h('div', { clase: 'desc tenue', texto: `${r.patron} · ${r.motivo || ''}` }))
    }
    contReglas.append(c)
  }

  // Allowlist propio (hub-data/aprobaciones.json): entradas "siempre" y por sesión.
  const al = datos.allowlist || {}
  const siempre = al.siempre || []
  const sesiones = Object.keys(al.sesion || {})
  const totalSesion = sesiones.reduce((n, s) => n + (al.sesion[s] || []).length, 0)
  const contAl = vaciar($('aprobacionesAllowlist'))
  const cAl = h('div', { clase: 'agente' })
  cAl.append(h('div', {}, h('span', { clase: 'nombre', texto: 'Allowlist' }), h('span', { clase: 'chip', texto: `siempre ${siempre.length} · sesión ${totalSesion}` })))
  if (!siempre.length && !totalSesion) cAl.append(h('div', { clase: 'desc tenue', texto: 'Vacío: todo lo peligroso pregunta.' }))
  for (const p of siempre) cAl.append(h('div', { clase: 'desc', texto: p }))
  contAl.append(cAl)

  // Pendientes (memoria y skills) en cola para revisar fuera de banda.
  const contPend = vaciar($('aprobacionesPendientes'))
  const pend = datos.pendientes || []
  if (!pend.length) {
    contPend.append(h('p', { clase: 'tenue', texto: 'Sin pendientes en cola.' }))
  } else {
    for (const p of pend) {
      const c = h('div', { clase: 'agente' })
      const cab = h('div')
      cab.append(h('span', { clase: 'badge azul', texto: p.tipo }))
      cab.append(h('span', { clase: 'nombre', texto: p.resumen || p.id }))
      c.append(cab)
      const ts = p.creado ? Date.parse(p.creado) : null
      c.append(h('div', { clase: 'desc tenue', texto: `${p.origen || '—'} · ${hace(ts)}` }))
      contPend.append(c)
    }
  }
}

// R8 · guardián: estado del circuit-breaker, últimos veredictos y botón de reinicio.
function pintarGuardian(g) {
  const cont = vaciar($('aprobacionesGuardian'))
  if (!cont) return
  const circuito = (g && g.circuito) || {}
  const card = h('div', { clase: 'agente' })
  const cab = h('div')
  cab.append(h('span', { clase: `badge ${circuito.abierto ? 'rojo' : 'verde'}`, texto: circuito.abierto ? 'circuito: abierto' : 'circuito: cerrado' }))
  cab.append(h('span', { clase: 'chip', texto: `denegaciones seguidas: ${circuito.denegacionesSeguidas || 0}` }))
  card.append(cab)
  card.append(h('div', { clase: 'desc', texto: circuito.abierto
    ? `Modo efectivo manual hasta que el usuario lo reinicie${circuito.desde ? ` (desde ${hace(Date.parse(circuito.desde))})` : ''}.`
    : 'Lo peligroso lo evalúa el guardián (modo inteligente); ante duda, al usuario.' }))
  const btn = h('button', { clase: 'boton mini', type: 'button', texto: 'Reiniciar circuito' })
  btn.addEventListener('click', async () => {
    try {
      await fetch('/api/aprobaciones/circuito/reiniciar', { method: 'POST' })
      refrescarPesado()
    } catch { /* nada */ }
  })
  const fila = h('div', { clase: 'desc' })
  fila.append(btn)
  card.append(fila)
  cont.append(card)

  const veredictos = (g && g.veredictos) || []
  if (!veredictos.length) {
    cont.append(h('div', { clase: 'desc tenue', texto: 'Sin veredictos del guardián todavía.' }))
  } else {
    const lista = h('div', { clase: 'agente' })
    lista.append(h('div', {}, h('span', { clase: 'nombre', texto: 'Últimos veredictos' }), h('span', { clase: 'chip', texto: `${veredictos.length}` })))
    for (const v of [...veredictos].reverse()) {
      const clase = v.veredicto === 'APROBAR' ? 'verde' : v.veredicto === 'DENEGAR' ? 'rojo' : 'ambar'
      const fila2 = h('div', { clase: 'desc' })
      fila2.append(h('span', { clase: `badge ${clase}`, texto: `${v.veredicto || '?'}→${v.accionFinal || '?'}` }))
      const resumen = String(v.comando || '').replace(/\s+/g, ' ').slice(0, 120)
      fila2.append(h('span', { texto: ` ${v.nivel || '?'} · ${resumen}${v.ts ? ` · ${hace(Date.parse(v.ts))}` : ''}` }))
      lista.append(fila2)
    }
    cont.append(lista)
  }
}

// R5 · skills: pendientes con Aprobar/Rechazar y tabla de uso (contador).
function pintarSkills(datos, usoDatos) {
  const contPend = vaciar($('skillsPendientes'))
  const pend = (datos && datos.pendientes) || []
  if (!pend.length) {
    contPend.append(h('p', { clase: 'tenue', texto: 'Sin skills propuestos pendientes.' }))
  } else {
    for (const p of pend) {
      const c = h('div', { clase: 'agente' })
      const nombre = (p.payload && p.payload.nombre) || p.id
      const cab = h('div')
      cab.append(h('span', { clase: 'badge azul', texto: 'skill' }))
      cab.append(h('span', { clase: 'nombre', texto: nombre }))
      c.append(cab)
      c.append(h('div', { clase: 'desc', texto: (p.payload && p.payload.descripcion) || p.resumen || '' }))
      const ts = p.creado ? Date.parse(p.creado) : null
      c.append(h('div', { clase: 'desc tenue', texto: `${p.origen || '—'} · ${hace(ts)}` }))
      const fila = h('div', { clase: 'desc' })
      const aprobar = h('button', { clase: 'boton mini', type: 'button', texto: 'Aprobar' })
      aprobar.addEventListener('click', async () => {
        try {
          await fetch('/api/skills/aprobar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
          refrescarPesado()
        } catch { /* nada */ }
      })
      const rechazar = h('button', { clase: 'boton mini peligro', type: 'button', texto: 'Rechazar' })
      rechazar.addEventListener('click', async () => {
        try {
          await fetch('/api/skills/rechazar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
          refrescarPesado()
        } catch { /* nada */ }
      })
      fila.append(aprobar)
      fila.append(rechazar)
      c.append(fila)
      contPend.append(c)
    }
  }

  const contUso = vaciar($('skillsUso'))
  const uso = (usoDatos && usoDatos.uso) || {}
  const candidatos = new Set(((usoDatos && usoDatos.candidatos) || []).map((x) => x.nombre))
  const entradas = Object.entries(uso).sort((a, b) => (b[1].uso || 0) - (a[1].uso || 0))
  if (!entradas.length) {
    contUso.append(h('p', { clase: 'tenue', texto: 'Sin uso registrado todavía.' }))
  } else {
    const tabla = h('table')
    tabla.append(h('thead', {}, h('tr', {},
      h('th', { texto: 'Skill' }), h('th', { texto: 'Uso' }), h('th', { texto: 'Visto' }),
      h('th', { texto: 'Parcheado' }), h('th', { texto: 'Último uso' }), h('th', { texto: '' }))))
    const tb = h('tbody')
    for (const [nombre, u] of entradas) {
      const ultimo = u.ultimo_uso ? Date.parse(u.ultimo_uso) : null
      tb.append(h('tr', {},
        h('td', { texto: nombre }),
        h('td', { texto: String(u.uso || 0) }),
        h('td', { texto: String(u.visto || 0) }),
        h('td', { texto: String(u.parcheado || 0) }),
        h('td', { texto: ultimo ? hace(ultimo) : '—' }),
        h('td', { texto: candidatos.has(nombre) ? 'candidato a archivar' : '' })))
    }
    tabla.append(tb)
    contUso.append(tabla)
  }
}

function aprobacionesDemo() {
  return {
    modo: 'inteligente',
    modoEfectivo: 'manual',
    reglas: {
      conteos: { hardline: 6, peligroso: 9, seguro: 3 },
      hardline: [{ patron: '\\brm\\s+…(?:/|~|\\$HOME)…', motivo: 'borrado recursivo de la raíz o del directorio personal' }, { patron: '\\bmkfs…', motivo: 'formateo de disco' }],
      peligroso: [{ patron: '\\bgit\\s+push\\b…--force', motivo: 'git push forzado' }, { patron: '\\brm\\s+…-[a-zA-Z]*r', motivo: 'borrado recursivo' }],
      seguro: [],
    },
    allowlist: { siempre: ['npm run build'], sesion: { 'demo-ses': ['git push origin main'] } },
    guardian: {
      circuito: { denegacionesSeguidas: 3, abierto: true, desde: new Date(Date.now() - 12 * 60000).toISOString() },
      veredictos: [
        { ts: new Date(Date.now() - 12 * 60000).toISOString(), nivel: 'peligroso', veredicto: 'DENEGAR', accionFinal: 'rechazar', motivo: 'borrado recursivo fuera del proyecto', comando: 'rm -rf C:/Users/otro/proyecto' },
        { ts: new Date(Date.now() - 20 * 60000).toISOString(), nivel: 'peligroso', veredicto: 'ESCALAR', accionFinal: 'preguntar', motivo: 'contexto insuficiente', comando: 'git reset --hard origin/main' },
      ],
    },
    pendientes: [
      { tipo: 'skills', id: 'demo-skill', resumen: 'Skill propuesto: resumir-bitacora', origen: 'cerebro', creado: new Date(Date.now() - 8 * 60000).toISOString(), payload: null },
      { tipo: 'memoria', id: 'demo-mem', resumen: 'Consolidar ESTADO.md del proyecto demo', origen: 'hub', creado: new Date(Date.now() - 32 * 60000).toISOString(), payload: null },
    ],
  }
}

const PESTANAS = [
  ['oficina', 'Oficina'],
  ['organizacion', 'Organización'],
  ['proyectos', 'Proyectos'],
  ['vigilante', 'Vigilante'],
  ['trabajos', 'Trabajos'],
  ['datos', 'Datos'],
  ['mcps', 'MCPs'],
  ['hallazgos', 'Hallazgos'],
  ['uso', 'Uso'],
  ['cambios', 'Cambios'],
  ['aprobaciones', 'Aprobaciones'],
  ['programadas', 'Programadas'],
  ['errores', 'Errores'],
]

function pintarPestanas() {
  const nav = vaciar($('pestanas'))
  for (const [id, texto] of PESTANAS) {
    const b = h('button', {
      clase: `pestana${estado.pestaña === id ? ' activa' : ''}`,
      type: 'button', role: 'tab', 'data-vista': id,
      'aria-selected': estado.pestaña === id ? 'true' : 'false',
      texto,
    })
    b.addEventListener('click', () => cambiarPestana(id))
    nav.append(b)
  }
}

function cambiarPestana(id) {
  estado.pestaña = id
  for (const [pid] of PESTANAS) $(`vista-${pid}`).classList.toggle('oculto', pid !== id)
  for (const b of $('pestanas').querySelectorAll('.pestana')) {
    const activa = b.dataset.vista === id
    b.classList.toggle('activa', activa)
    b.setAttribute('aria-selected', activa ? 'true' : 'false')
  }
  if (id === 'oficina') requestAnimationFrame(dibujarDelegaciones)
  if (id === 'uso') cargarUso()
  if (id === 'cambios') cargarCambios()
}

// ---------------------------------------------------------------- tema (R16)

function aplicarTema(t) {
  document.documentElement.dataset.tema = t
  try { localStorage.setItem('cerebro-tema', t) } catch { /* nada */ }
  $('botonTema').textContent = t === 'claro' ? 'Oscuro' : 'Claro'
}

function iniciarTema() {
  let t = 'oscuro'
  try { t = localStorage.getItem('cerebro-tema') || 'oscuro' } catch { /* nada */ }
  aplicarTema(t)
}

// ---------------------------------------------------------------- demo (R17)

function actividadDemo() {
  const ahora = Date.now()
  const m = (n) => n * 60 * 1000
  const p = (o) => ({
    id: o.id, agente: o.agente, familia: o.familia, modelo: o.modelo, variant: o.variant || null,
    estado: o.estado, tarea: o.tarea, desde: ahora - o.hace, origen: o.origen || 'opencode-job',
    evento: o.evento || null, jobId: o.jobId || null, sesion: o.sesion || null,
    coste: typeof o.coste === 'number' ? o.coste : null,
    error: o.error || null, errorInfo: o.errorInfo || null,
  })
  return {
    demo: true,
    generado: ahora,
    proyectos: [
      {
        ruta: 'C:/demo/panel-la-oficina', nombre: 'panel-la-oficina', slug: 'demo-panel', ultimaActividad: ahora,
        personajes: [
          p({ id: 'demo-1', agente: 'cerebro', familia: 'direccion', modelo: 'claude-sonnet-4-5', estado: 'trabajando', tarea: 'Coordinar el tramo B del panel visual', hace: m(4), jobId: 'demo-job-1', origen: 'claude', sesion: 'demo-ses-cerebro' }),
          p({ id: 'demo-2', agente: 'implementador', familia: 'implementacion', modelo: 'deepseek-v3.2', variant: 'high', estado: 'trabajando', tarea: 'La oficina: salas, mesas y monitores', hace: m(6), jobId: 'demo-job-2', coste: 0.012 }),
          p({ id: 'demo-3', agente: 'revisor', familia: 'revision', modelo: 'deepseek-v3.2', variant: 'max', estado: 'esperando', tarea: 'Revisar el diff contra la spec', hace: m(9), jobId: 'demo-job-3', coste: 0.021 }),
          p({
            id: 'demo-4', agente: 'testeador', familia: 'pruebas', modelo: 'deepseek-flash', variant: 'low', estado: 'atascado',
            tarea: 'Pruebas de lógica pura (A2/A3)', hace: m(42), jobId: 'demo-job-4',
            error: 'Timeout esperando al servidor local',
            errorInfo: { tipo: 'timeout', titulo: 'Tiempo de espera agotado', causa: 'La operación tardó más de lo permitido y se cortó.', accion: 'Reintenta el trabajo o reduce el alcance de la tarea.', crudo: 'Timeout esperando al servidor local' },
          }),
          p({ id: 'demo-5', agente: 'redactor', familia: 'documentacion', modelo: 'claude-haiku-4-5', estado: 'terminado', tarea: 'docs/panel.md actualizado', hace: m(2), origen: 'claude', evento: 'SubagentStop' }),
        ],
        delegaciones: [
          { de: 'cerebro', a: 'implementador', jobId: 'demo-job-2' },
          { de: 'cerebro', a: 'revisor', jobId: 'demo-job-3' },
        ],
      },
      {
        ruta: 'C:/demo/api-actividad', nombre: 'api-actividad', slug: 'demo-api', ultimaActividad: ahora - m(12),
        personajes: [
          p({ id: 'demo-6', agente: 'arquitecto', familia: 'direccion', modelo: 'claude-sonnet-4-5', estado: 'esperando', tarea: 'Diseñar el esquema de actividad', hace: m(8) }),
          p({ id: 'demo-7', agente: 'explorador-ds', familia: 'exploracion', modelo: 'deepseek-flash', estado: 'trabajando', tarea: 'Reconocer lib/actividad.mjs', hace: m(3), jobId: 'demo-job-5', coste: 0.004 }),
          p({ id: 'demo-8', agente: 'Agente', familia: 'generica', modelo: null, estado: 'trabajando', tarea: 'Tarea sin agente declarado (A3)', hace: m(7) }),
          p({ id: 'demo-9', agente: 'local', familia: 'mecanico', modelo: 'qwen3.5:9b', estado: 'terminado', tarea: 'Renombrar campos de la tabla', hace: m(5) }),
        ],
        delegaciones: [{ de: 'arquitecto', a: 'explorador-ds', jobId: 'demo-job-5' }],
      },
    ],
  }
}

// ---------------------------------------------------------------- datos: SSE y polling (R5)

let fuente = null
let timerPoll = null
let reintentoSse = null

function pararPoll() { if (timerPoll) { clearInterval(timerPoll); timerPoll = null } }
function pararSse() { if (fuente) { try { fuente.close() } catch { /* nada */ } fuente = null } }

function aplicarActividad(a) {
  if (!a || !Array.isArray(a.proyectos)) return
  estado.actividad = a
  pintarOficina()
  pintarCabecera()
  pintarOrganigrama(estado.organizacion, a)
}

function iniciarPoll() {
  if (timerPoll || estado.demo) return
  estado.conexion = 'polling'
  pintarCabecera()
  const tic = async () => {
    try {
      const a = await fetch('/api/actividad').then((r) => r.json())
      aplicarActividad(a)
    } catch { estado.conexion = 'sin hub'; pintarCabecera() }
  }
  tic()
  timerPoll = setInterval(tic, 3000)
}

function conectarSse() {
  if (estado.demo || typeof EventSource === 'undefined') return
  pararSse()
  try {
    fuente = new EventSource('/api/eventos')
    fuente.addEventListener('open', () => { estado.conexion = 'sse'; pararPoll(); pintarCabecera() })
    fuente.addEventListener('actividad', (e) => { try { aplicarActividad(JSON.parse(e.data)) } catch { /* nada */ } })
    // Vista viva: si llega actividad del trabajo que está abierto en el lateral, se refresca ya.
    fuente.addEventListener('trabajo', (e) => {
      try {
        const d = JSON.parse(e.data)
        if (detalleAbierto && d && d.clave === detalleAbierto.clave) detalleAbierto.cargar()
      } catch { /* nada */ }
    })
    fuente.addEventListener('error', () => {
      pararSse()
      estado.conexion = 'polling'
      pintarCabecera()
      iniciarPoll()
      if (!reintentoSse) {
        reintentoSse = setTimeout(() => { reintentoSse = null; if (!estado.demo && estado.conexion !== 'sse') conectarSse() }, 15000)
      }
    })
  } catch { iniciarPoll() }
}

async function refrescarLigero() {
  try {
    const [salud, org, proyectos, vig, claude] = await Promise.all([
      fetch('/api/salud').then((r) => r.json()),
      fetch('/api/organizacion').then((r) => r.json()),
      fetch('/api/proyectos').then((r) => r.json()),
      fetch('/api/vigilante').then((r) => r.json()),
      fetch('/api/claude/estado').then((r) => r.json()).catch(() => null),
    ])
    estado.salud = salud
    estado.organizacion = org
    estado.proyectos = proyectos.proyectos || []
    estado.vigilante = vig
    estado.claudeEstados = (claude && claude.estados) || []
    pintarOrganizacion(org)
    pintarProyectos(estado.proyectos)
    pintarVigilante(vig)
    pintarTrabajos(vig.trabajos)
    pintarOrganigrama(org, estado.actividad)
    pintarCabecera()
    if (!estado.demo) $('aviso').classList.add('oculto')
  } catch {
    if (!estado.demo) {
      if (estado.conexion === 'conectando') { estado.conexion = 'sin hub'; pintarCabecera() }
      $('aviso').textContent = 'El hub no responde. Arráncalo con hub.ps1 (o hub.sh).'
      $('aviso').classList.remove('oculto')
    }
  }
}

async function refrescarPesado() {
  try {
    const [gasto, ventana, mcps, hallazgos, equipo, logs, aprob, skillsPend, skillsUso, cronDatos, metricasRes, metricasAct, agentesSalud, repartoDatos] = await Promise.all([
      fetch('/api/gasto').then((r) => r.json()),
      fetch('/api/ventana').then((r) => r.json()),
      fetch('/api/mcps').then((r) => r.json()),
      fetch('/api/hallazgos').then((r) => r.json()),
      fetch('/api/gasto/equipo').then((r) => r.json()).catch(() => null),
      fetch('/api/logs?limite=80').then((r) => r.json()).catch(() => null),
      fetch('/api/aprobaciones').then((r) => r.json()).catch(() => null),
      fetch('/api/skills/pendientes').then((r) => r.json()).catch(() => null),
      fetch('/api/skills/uso').then((r) => r.json()).catch(() => null),
      fetch('/api/cron').then((r) => r.json()).catch(() => null),
      fetch('/api/metricas/resumen').then((r) => r.json()).catch(() => null),
      fetch('/api/metricas/activas').then((r) => r.json()).catch(() => null),
      fetch('/api/agentes/salud').then((r) => r.json()).catch(() => null),
      fetch('/api/reparto?dias=7').then((r) => r.json()).catch(() => null),
    ])
    pintarGasto(gasto)
    pintarVentana(ventana)
    pintarSaludAgentes(estado.demo ? { agentes: [{ agente: 'local-codigo', muestras: 6, tasaFallo: 0.33, fallosSeguidos: 0, degradado: false, proximaPrueba: null }] } : agentesSalud)
    pintarMcps(mcps)
    pintarHallazgos(hallazgos)
    pintarErrores(estado.demo ? erroresDemo() : (logs || { errores: [] }))
    estado.gastoEquipo = equipo
    pintarReparto(equipo)
    estado.aprobaciones = aprob
    pintarAprobaciones(estado.demo ? aprobacionesDemo() : aprob)
    pintarSkills(estado.demo ? { pendientes: [] } : skillsPend, estado.demo ? { uso: {}, candidatos: [] } : skillsUso)
    pintarProgramadas(estado.demo ? { jobs: [], avisos: [] } : cronDatos)
    pintarMetricas(estado.demo ? { eventos: 0, bytes: 0, porTipo: {} } : (metricasRes || {}), estado.demo ? true : (metricasAct ? metricasAct.activas : true))
    pintarRepartoCarga(estado.demo ? { agentes: [], capas: [], consultasA2A: { total: 0, coste: 0, mediaRespuestaChars: 0 } } : repartoDatos)
  } catch { /* nada */ }
}

// ---------------------------------------------------------------- arranque

$('cerrar').addEventListener('click', () => $('modal').classList.add('oculto'))
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('oculto') })
$('lateralCerrar').addEventListener('click', () => { pararDetalle(); $('lateral').classList.add('oculto') })
$('pararTodo').addEventListener('click', async () => {
  if (await pararTrabajos({ todo: true }, '¿Parar TODOS los trabajos de OpenCode en segundo plano (todos los proyectos)?')) refrescarLigero()
})
$('copiarInforme').addEventListener('click', async () => {
  if (estado.demo) { alert('Modo demo: usa el hub real para generar el informe de tus errores.'); return }
  try {
    const texto = await fetch('/api/logs/exportar?limite=50').then((r) => r.text())
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto)
      alert('Informe copiado al portapapeles. Pégalo en tu IA para corregir los problemas.')
    } else {
      window.prompt('Copia el informe:', texto)
    }
  } catch { alert('No se pudo generar el informe (¿hub caído?).') }
})

// El propio panel también reporta sus errores al registro central (1/min como mucho).
let ultimoReporteError = 0
function reportarErrorPanel(mensaje, stack) {
  if (estado.demo) return
  const ahora = Date.now()
  if (ahora - ultimoReporteError < 60000) return
  ultimoReporteError = ahora
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origen: 'panel', severidad: 'error', mensaje: String(mensaje || 'error en el panel').slice(0, 1000), stack: stack || null, contexto: { url: location.href } }),
    }).catch(() => { /* hub caído */ })
  } catch { /* nada */ }
}
window.addEventListener('error', (ev) => reportarErrorPanel(ev.message, ev.error && ev.error.stack))
window.addEventListener('unhandledrejection', (ev) => reportarErrorPanel(String((ev.reason && ev.reason.message) || ev.reason), ev.reason && ev.reason.stack))
$('botonTema').addEventListener('click', () => {
  aplicarTema(document.documentElement.dataset.tema === 'claro' ? 'oscuro' : 'claro')
})
$('plegarInactivas').addEventListener('change', () => pintarOficina())

let debounceResize = null
window.addEventListener('resize', () => {
  clearTimeout(debounceResize)
  debounceResize = setTimeout(dibujarDelegaciones, 150)
})

// ---------------------------------------------------------------- coste, uso y cambios (spec 22)

const usd = (n) => (typeof n === 'number' ? `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}` : '—')
const duracion = (ms) => {
  if (typeof ms !== 'number') return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
const nombreCorto = (m) => String(m || '—').replace(/^claude-/, '')
const cacheTxt = (t) => `${k(t.cacheLectura)} / ${k(t.cacheEscritura)}`

function pintarTabla(id, filas) {
  const tb = vaciar($(id).querySelector('tbody'))
  for (const f of filas) tb.append(h('tr', null, f.map((c) => h('td', null, c))))
  if (!filas.length) tb.append(h('tr', null, h('td', { colspan: 8, clase: 'tenue', texto: 'Sin datos todavía.' })))
}

async function cargarCosteAgentes() {
  if (estado.demo) { $('costeResumen').textContent = 'demo: sin datos reales'; return }
  try {
    const r = await fetch('/api/agentes/coste?dias=7&limite=30').then((x) => x.json())
    $('costeResumen').textContent = `${r.total.agentes} subagentes · ${k(r.total.tokens.entrada + r.total.tokens.salida)} tokens (sin caché) · ${usd(r.total.coste)} · 7 días`
    pintarTabla('tablaCoste', r.agentes.map((a) => [
      a.agente, nombreCorto(a.modelo), k(a.tokens.entrada), k(a.tokens.salida), cacheTxt(a.tokens), usd(a.coste), duracion(a.duracionMs), hace(a.fin),
    ]))
  } catch { $('costeResumen').textContent = 'sin datos' }
}

async function cargarUso() {
  cargarCosteAgentes()
  if (estado.demo) return
  try {
    const s = await fetch('/api/stats?dias=30').then((x) => x.json())
    $('usoTotal').textContent = `30 días · ${k(s.total.tokens.entrada + s.total.tokens.salida)} tokens (sin caché) · ${usd(s.total.coste)}`
    $('usoRacha').textContent = `racha: ${s.racha.actual} días (mejor ${s.racha.mejor})`
    const fila = (nombre, x) => [nombre, k(x.tokens.entrada), k(x.tokens.salida), cacheTxt(x.tokens), usd(x.coste)]
    pintarTabla('tablaUsoModelo', s.porModelo.map((x) => fila(nombreCorto(x.modelo), x)))
    pintarTabla('tablaUsoDia', s.porDia.slice().reverse().map((x) => fila(x.dia, x)))
    pintarTabla('tablaUsoProyecto', s.porProyecto.slice(0, 20).map((x) => fila(x.proyecto, x)))
    const oc = vaciar($('usoOpencode'))
    const o = s.opencode || { jobs: 0, coste: 0, porModelo: [] }
    oc.append(h('p', { clase: 'tenue', texto: o.jobs ? `${o.jobs} trabajos · ${usd(o.coste)} · ${o.porModelo.map((m) => `${m.modelo}: ${m.jobs}`).join(', ')}` : 'Sin trabajos de OpenCode en el periodo.' }))
  } catch { $('usoTotal').textContent = 'sin datos' }
}

const ESTADO_CAMBIO = { M: 'modificado', A: 'añadido', D: 'borrado', R: 'renombrado', '?': 'nuevo' }

function pintarArbol(arbol, raiz) {
  const caja = h('div', { clase: 'agente' })
  const cab = h('div', { clase: 'cab-oficina' })
  cab.append(h('span', { clase: `badge ${arbol.principal ? 'verde' : 'ambar'}`, texto: arbol.principal ? 'repo' : 'worktree' }))
  cab.append(h('span', { clase: 'nombre', texto: `${arbol.rama || '(sin rama)'} · ${arbol.ruta}` }))
  cab.append(h('span', { clase: 'chip', texto: `${arbol.archivos.length} archivos · +${arbol.insertions} −${arbol.deletions}` }))
  caja.append(cab)
  if (!arbol.archivos.length) { caja.append(h('p', { clase: 'tenue', texto: 'Sin cambios pendientes.' })); return caja }
  if (arbol.stat) {
    const det = h('details', { clase: 'error-crudo' })
    det.append(h('summary', { texto: 'git diff --stat' }), h('pre', { texto: arbol.stat }))
    caja.append(det)
  }
  for (const a of arbol.archivos) {
    const det = h('details', { clase: 'error-crudo' })
    const pre = h('pre', { texto: 'Abre para cargar el diff…' })
    let cargado = false
    det.append(h('summary', { texto: `${ESTADO_CAMBIO[a.estado] || a.estado} · ${a.ruta}${a.insertions != null ? ` (+${a.insertions} −${a.deletions})` : ''}` }), pre)
    det.addEventListener('toggle', async () => {
      if (!det.open || cargado) return
      cargado = true
      try {
        const r = await fetch(`/api/cambios/diff?cwd=${encodeURIComponent(raiz)}&arbol=${encodeURIComponent(arbol.ruta)}&archivo=${encodeURIComponent(a.ruta)}`).then((x) => x.json())
        pre.textContent = r.ok ? (r.diff || '(sin diferencias)') + (r.truncado ? '\n… (recortado)' : '') : (r.error || 'no se pudo cargar')
      } catch { pre.textContent = 'no se pudo cargar'; cargado = false }
    })
    caja.append(det)
  }
  return caja
}

async function cargarCambios() {
  const cont = vaciar($('cambios'))
  if (estado.demo) { cont.append(h('p', { clase: 'tenue', texto: 'Modo demo: sin repos reales.' })); return }
  try {
    const r = await fetch('/api/cambios').then((x) => x.json())
    if (!r.repos.length) { cont.append(h('p', { clase: 'tenue', texto: 'No hay un repo git activo (se usan las carpetas de las sesiones en marcha).' })); return }
    for (const repo of r.repos) for (const arbol of repo.arboles) cont.append(pintarArbol(arbol, repo.raiz))
  } catch { cont.append(h('p', { clase: 'tenue', texto: 'No se pudieron leer los cambios.' })) }
}
$('cambiosRefrescar').addEventListener('click', () => cargarCambios())

function arrancar() {
  iniciarTema()
  pintarPestanas()

  let params = new URLSearchParams()
  try { params = new URLSearchParams(window.location.search) } catch { /* nada */ }
  estado.demo = params.get('demo') === '1'
  if (estado.demo) {
    estado.conexion = 'demo'
    $('etiquetaDemo').classList.remove('oculto')
    document.body.classList.add('modo-demo')
    $('sub').textContent = 'modo demostración · actividad simulada'
    $('pie').textContent = 'Cerebro Hub · demo (?demo=1) · sin datos reales'
    const ahoraSeg = Math.floor(Date.now() / 1000)
    estado.claudeEstados = [{
      cwd: 'C:/demo/panel-la-oficina', sesion: 'demo-ses-cerebro', nombre: 'panel-oficina',
      contextoPct: 37, cincoPct: 22, sietePct: 41, coste: 2.4,
      cincoReset: ahoraSeg + 3600, sieteReset: ahoraSeg + 86400,
    }]
    aplicarActividad(actividadDemo())
  }

  refrescarLigero()
  refrescarPesado()
  if (!estado.demo) conectarSse()
  setInterval(refrescarLigero, 15000)
  setInterval(refrescarPesado, 60000)
  cargarCosteAgentes()
  setInterval(cargarCosteAgentes, 60000)
  setInterval(refrescarTiempos, 30000)
}

arrancar()
