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
  cerebro: 'direccion', subdirector: 'direccion', 'cerebro-oc': 'direccion', arquitecto: 'direccion',
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
  pie.append(h('span', { clase: 'chip modelo', texto: personaje.modelo || 'sin modelo' }))
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

function abrirDetalle(personaje, proyecto) {
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
  fila('Modelo', personaje.modelo || '(hereda)')
  fila('Origen', personaje.origen)
  fila('Tarea', personaje.tarea || '(sin título)')
  fila('En curso desde', personaje.desde ? `${hace(personaje.desde)} · ${dur(personaje.desde)}` : null)
  fila('jobId', personaje.jobId)
  fila('Sesión', personaje.sesion)
  fila('Proyecto', proyecto.nombre)
  fila('Ruta', proyecto.ruta)
  if (personaje.error) fila('Error', personaje.error)
  const b = h('button', { clase: 'boton', type: 'button', texto: 'Ver memoria del proyecto' })
  b.addEventListener('click', () => verProyecto(proyecto.ruta))
  cuerpo.append(b)
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
  if (s) partes.push(s.laya?.disponible ? 'Laya' : 'Laya no')
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
    cont.append(bloque('Por modelo', modelos, () => 'var(--acento)', (m) => m.modelo || 'sin modelo'))
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
    $('modal').classList.remove('oculto')
  } catch { /* nada */ }
}

function pintarVigilante(v) {
  const cont = vaciar($('alertas'))
  const alertas = v?.alertas || []
  if (!alertas.length) { cont.append(h('p', { clase: 'tenue', texto: 'Sin alertas: todo en orden.' })); return }
  for (const a of alertas) {
    const card = h('div', { clase: 'agente' })
    const cab = h('div')
    cab.append(h('span', { clase: 'badge ambar', texto: a.tipo }))
    cab.append(h('span', { clase: 'nombre', texto: a.title || a.jobId || '—' }))
    card.append(cab)
    card.append(h('div', { clase: 'desc', texto: `${a.directory || ''} · ${a.minutos} min` }))
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

function pintarTriaje(laya, dec) {
  const cont = vaciar($('layaEstado'))
  const card = h('div', { clase: 'agente' })
  const cab = h('div')
  cab.append(h('span', { clase: 'nombre', texto: 'Laya' }))
  cab.append(h('span', { clase: `badge ${laya?.disponible ? 'verde' : 'gris'}`, texto: laya?.disponible ? 'disponible' : 'no disponible (triaje por reglas)' }))
  card.append(cab)
  card.append(h('div', { clase: 'desc', texto: laya?.url || '' }))
  cont.append(card)

  const contDec = vaciar($('decisiones'))
  const lista = (dec?.decisiones || []).slice(0, 8)
  if (!lista.length) { contDec.append(h('p', { clase: 'tenue', texto: 'Sin decisiones registradas todavía.' })); return }
  for (const d of lista) {
    const c = h('div', { clase: 'agente' })
    const cab2 = h('div')
    cab2.append(h('span', { clase: 'badge azul', texto: d.capa }))
    cab2.append(' ')
    cab2.append(h('span', { clase: 'nombre', texto: d.agente || '?' }))
    if (d.esfuerzo) cab2.append(h('span', { clase: 'chip modelo', texto: String(d.esfuerzo) }))
    if (d.confianza != null) cab2.append(h('span', { clase: 'tenue', texto: `p=${Number(d.confianza).toFixed(2)}` }))
    c.append(cab2)
    c.append(h('div', { clase: 'desc', texto: `${(d.tarea || '').slice(0, 100)} · ${d.fuente || ''}` }))
    contDec.append(c)
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

const PESTANAS = [
  ['oficina', 'Oficina'],
  ['organizacion', 'Organización'],
  ['proyectos', 'Proyectos'],
  ['vigilante', 'Vigilante'],
  ['trabajos', 'Trabajos'],
  ['triaje', 'Triaje·Laya'],
  ['datos', 'Datos'],
  ['mcps', 'MCPs'],
  ['hallazgos', 'Hallazgos'],
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
    id: o.id, agente: o.agente, familia: o.familia, modelo: o.modelo, estado: o.estado,
    tarea: o.tarea, desde: ahora - o.hace, origen: 'opencode-job', jobId: o.jobId || null,
    sesion: o.sesion || null, error: o.error || null,
  })
  return {
    demo: true,
    generado: ahora,
    proyectos: [
      {
        ruta: 'C:/demo/panel-la-oficina', nombre: 'panel-la-oficina', slug: 'demo-panel', ultimaActividad: ahora,
        personajes: [
          p({ id: 'demo-1', agente: 'cerebro', familia: 'direccion', modelo: 'claude-sonnet-4-5', estado: 'trabajando', tarea: 'Coordinar el tramo B del panel visual', hace: m(4), jobId: 'demo-job-1' }),
          p({ id: 'demo-2', agente: 'implementador', familia: 'implementacion', modelo: 'deepseek-v3.2', estado: 'trabajando', tarea: 'La oficina: salas, mesas y monitores', hace: m(6), jobId: 'demo-job-2' }),
          p({ id: 'demo-3', agente: 'revisor', familia: 'revision', modelo: 'deepseek-v3.2', estado: 'esperando', tarea: 'Revisar el diff contra la spec', hace: m(9), jobId: 'demo-job-3' }),
          p({ id: 'demo-4', agente: 'testeador', familia: 'pruebas', modelo: 'deepseek-flash', estado: 'atascado', tarea: 'Pruebas de lógica pura (A2/A3)', hace: m(42), jobId: 'demo-job-4', error: 'Timeout esperando al servidor local' }),
          p({ id: 'demo-5', agente: 'redactor', familia: 'documentacion', modelo: 'claude-haiku-4-5', estado: 'terminado', tarea: 'docs/panel.md actualizado', hace: m(2) }),
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
          p({ id: 'demo-7', agente: 'explorador-ds', familia: 'exploracion', modelo: 'deepseek-flash', estado: 'trabajando', tarea: 'Reconocer lib/actividad.mjs', hace: m(3), jobId: 'demo-job-5' }),
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
    const [salud, org, proyectos, vig] = await Promise.all([
      fetch('/api/salud').then((r) => r.json()),
      fetch('/api/organizacion').then((r) => r.json()),
      fetch('/api/proyectos').then((r) => r.json()),
      fetch('/api/vigilante').then((r) => r.json()),
    ])
    estado.salud = salud
    estado.organizacion = org
    estado.proyectos = proyectos.proyectos || []
    estado.vigilante = vig
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
    const [gasto, ventana, laya, dec, mcps, hallazgos, equipo] = await Promise.all([
      fetch('/api/gasto').then((r) => r.json()),
      fetch('/api/ventana').then((r) => r.json()),
      fetch('/api/laya').then((r) => r.json()),
      fetch('/api/decisiones').then((r) => r.json()),
      fetch('/api/mcps').then((r) => r.json()),
      fetch('/api/hallazgos').then((r) => r.json()),
      fetch('/api/gasto/equipo').then((r) => r.json()).catch(() => null),
    ])
    pintarGasto(gasto)
    pintarVentana(ventana)
    pintarTriaje(laya, dec)
    pintarMcps(mcps)
    pintarHallazgos(hallazgos)
    estado.gastoEquipo = equipo
    pintarReparto(equipo)
  } catch { /* nada */ }
}

// ---------------------------------------------------------------- arranque

$('cerrar').addEventListener('click', () => $('modal').classList.add('oculto'))
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('oculto') })
$('lateralCerrar').addEventListener('click', () => $('lateral').classList.add('oculto'))
$('botonTema').addEventListener('click', () => {
  aplicarTema(document.documentElement.dataset.tema === 'claro' ? 'oscuro' : 'claro')
})
$('plegarInactivas').addEventListener('change', () => pintarOficina())

let debounceResize = null
window.addEventListener('resize', () => {
  clearTimeout(debounceResize)
  debounceResize = setTimeout(dibujarDelegaciones, 150)
})

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
    aplicarActividad(actividadDemo())
  }

  refrescarLigero()
  refrescarPesado()
  if (!estado.demo) conectarSse()
  setInterval(refrescarLigero, 15000)
  setInterval(refrescarPesado, 60000)
  setInterval(refrescarTiempos, 30000)
}

arrancar()
