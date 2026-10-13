/* Cerebro Hub — panel minimalista, sin dependencias */
'use strict'
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
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
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

const ESTADOS = {
  accepted: ['azul', 'aceptado'], running: ['ambar', 'en curso'], completed: ['verde', 'completado'],
  failed: ['rojo', 'fallido'], cancelled: ['gris', 'cancelado'], input_required: ['morado', 'pide permiso'],
  unknown: ['gris', 'desconocido'],
}
const badge = (e) => {
  const [c, t] = ESTADOS[e] || ['gris', e || '—']
  return `<span class="badge ${c}">${esc(t)}</span>`
}

function pintarOrganizacion(org) {
  const chipModelo = (a) => `<span class="chip modelo">${esc(a.modelo || '(hereda)')}${a.variant ? ` · <b>${esc(a.variant)}</b>` : ''}</span>`
  $('agentesClaude').innerHTML = (org.claude || []).map((a) => `
    <div class="agente"><div><span class="nombre">${esc(a.nombre)}</span> ${chipModelo(a)}</div>
    <div class="desc">${esc((a.descripcion || '').slice(0, 110))}</div></div>`).join('') || '<p class="tenue">—</p>'
  $('agentesOpenCode').innerHTML = (org.opencode || []).map((a) => `
    <div class="agente"><div><span class="nombre">${esc(a.nombre)}</span> ${chipModelo(a)} ${a.modo ? `<span class="chip">${esc(a.modo)}</span>` : ''}</div>
    <div class="desc">${esc((a.descripcion || '').slice(0, 110))}</div></div>`).join('') || '<p class="tenue">—</p>'
}

function pintarProyectos(lista) {
  $('proyectos').innerHTML = (lista || []).map((p) => `
    <div class="agente clic" data-slug="${esc(p.slug)}" data-ruta="${esc(p.ruta)}">
      <div><span class="nombre">${esc(p.nombre)}</span>
        ${p.tieneEstado ? '<span class="badge verde">estado</span>' : '<span class="badge gris">sin estado</span>'}
        ${p.tieneContexto ? '<span class="badge azul">contexto</span>' : ''}
      </div>
      <div class="desc">${esc(p.ruta)} · último uso ${hace(p.ultimoUso)}</div>
    </div>`).join('') || '<p class="tenue">Aún no hay proyectos en la memoria del hub.</p>'
  for (const el of $('proyectos').querySelectorAll('.clic')) el.addEventListener('click', () => verProyecto(el.dataset.ruta))
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
  const alertas = v.alertas || []
  $('alertas').innerHTML = alertas.length
    ? alertas.map((a) => `<div class="agente"><div><span class="badge ambar">${esc(a.tipo)}</span> <span class="nombre">${esc(a.title || a.jobId)}</span></div>
        <div class="desc">${esc(a.directory || '')} · ${a.minutos} min</div></div>`).join('')
    : '<p class="tenue">Sin alertas: todo en orden.</p>'
}

function pintarTrabajos(jobs) {
  const tb = $('tablaTrabajos').querySelector('tbody')
  if (!jobs || !jobs.length) { tb.innerHTML = '<tr><td colspan="4" class="tenue">Sin trabajos registrados.</td></tr>'; return }
  const corto = (d) => d ? String(d).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '—'
  tb.innerHTML = jobs.slice(0, 20).map((j) => `
    <tr><td>${badge(j.status)}</td><td>${esc(j.title || j.jobId)}</td><td class="tenue">${esc(corto(j.directory))}</td><td class="tenue">${hace(j.updatedAt)}</td></tr>`).join('')
}

function pintarGasto(g) {
  const ds = g.deepseek || {}
  const ses = g.sesiones || {}
  $('gasto').innerHTML = `
    <div class="agente"><div><span class="nombre">DeepSeek</span></div>
      <div class="desc">${ds.ok ? `saldo <b>${esc(ds.saldo)} ${esc(ds.moneda)}</b>${ds.disponible ? '' : ' · no disponible'}` : `— ${esc(ds.error || 'sin datos')}`}</div></div>
    <div class="agente"><div><span class="nombre">Sesiones de hoy</span></div>
      <div class="desc">${ses.ok ? `${fmt(ses.hoy)} sesiones · coste ${(ses.coste || 0).toFixed(4)} $ · total histórico ${fmt(ses.total)}` : `— ${esc(ses.error || 'sin datos')}`}</div></div>`
}

function pintarVentana(v) {
  const tb = $('tablaVentana').querySelector('tbody')
  const filas = Object.entries(v.porModelo || {}).sort((a, b) => b[1].n7 - a[1].n7)
  if (!filas.length) { tb.innerHTML = `<tr><td colspan="5" class="tenue">Sin datos aún (${v.archivos || 0} archivos del historial revisados).</td></tr>`; return }
  tb.innerHTML = filas.map(([modelo, d]) => `<tr><td>${esc(modelo)}</td><td>${k(d.n5)}</td><td>${k(d.n7)}</td><td class="tenue">${k(d.c7)}</td><td class="tenue">${fmt(d.mensajes)}</td></tr>`).join('')
}

function pintarTriaje(laya, dec) {
  $('layaEstado').innerHTML = `
    <div class="agente"><div><span class="nombre">Laya</span>
      ${laya.disponible ? '<span class="badge verde">disponible</span>' : '<span class="badge gris">no disponible (triaje por reglas)</span>'}</div>
      <div class="desc">${esc(laya.url || '')}</div></div>`
  const lista = (dec.decisiones || []).slice(0, 8)
  $('decisiones').innerHTML = lista.length
    ? lista.map((d) => `<div class="agente"><div><span class="badge azul">${esc(d.capa)}</span> <span class="nombre">${esc(d.agente || '?')}</span>
        ${d.esfuerzo ? `<span class="chip modelo">${esc(String(d.esfuerzo))}</span>` : ''}
        ${d.confianza != null ? `<span class="tenue">p=${Number(d.confianza).toFixed(2)}</span>` : ''}</div>
      <div class="desc">${esc((d.tarea || '').slice(0, 100))} · ${esc(d.fuente || '')}</div></div>`).join('')
    : '<p class="tenue">Sin decisiones registradas todavía.</p>'
}

async function refrescar() {
  try {
    const [salud, org, proyectos, vig] = await Promise.all([
      fetch('/api/salud').then((r) => r.json()),
      fetch('/api/organizacion').then((r) => r.json()),
      fetch('/api/proyectos').then((r) => r.json()),
      fetch('/api/vigilante').then((r) => r.json()),
    ])
    $('punto').className = 'punto'
    $('textoVivo').textContent = 'en vivo'
    $('chipV1').textContent = salud.servidorV1
      ? `servidor V1 :${salud.servidorV1}${salud.servidorV1Ok === false ? ' (sin respuesta)' : ''}`
      : 'servidor V1 apagado'
    $('sub').textContent = `datos: ${salud.datos}`
    $('pie').textContent = `Cerebro Hub v${salud.version} · ${salud.memoria} · actualizado ${new Date().toLocaleTimeString()}`
    pintarOrganizacion(org)
    pintarProyectos(proyectos.proyectos)
    pintarVigilante(vig)
    pintarTrabajos(vig.trabajos)
    $('aviso').classList.add('oculto')
  } catch (e) {
    $('textoVivo').textContent = 'sin conexión con el hub'
    $('punto').className = 'punto malo'
    $('aviso').textContent = 'El hub no responde. Arráncalo con: hub.ps1 (o hub.sh).'
    $('aviso').classList.remove('oculto')
  }
}

async function refrescarPesado() {
  try {
    const [gasto, ventana, laya, dec] = await Promise.all([
      fetch('/api/gasto').then((r) => r.json()),
      fetch('/api/ventana').then((r) => r.json()),
      fetch('/api/laya').then((r) => r.json()),
      fetch('/api/decisiones').then((r) => r.json()),
    ])
    pintarGasto(gasto)
    pintarVentana(ventana)
    pintarTriaje(laya, dec)
  } catch { /* nada */ }
}

$('cerrar').addEventListener('click', () => $('modal').classList.add('oculto'))
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('oculto') })

refrescar()
refrescarPesado()
setInterval(refrescar, 5000)
setInterval(refrescarPesado, 60000)
