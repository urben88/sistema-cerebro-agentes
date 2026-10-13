/* Panel web de sistema-cerebro-agentes — lógica del dashboard (sin dependencias) */
'use strict'

const $ = (id) => document.getElementById(id)
let ficherosCache = []

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function hace(ms) {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 0) return 'ahora'
  const s = Math.round(d / 1000)
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

function corto(dir) {
  if (!dir) return '—'
  const partes = String(dir).replace(/[\\/]+$/, '').split(/[\\/]/)
  const ult = partes[partes.length - 1] || dir
  return `<span title="${esc(dir)}" class="dir">${esc(ult)}</span>`
}

const ESTADOS = {
  accepted:      ['azul',   'aceptado'],
  running:       ['ambar',  'en curso'],
  completed:     ['verde',  'completado'],
  failed:        ['rojo',   'fallido'],
  cancelled:     ['gris',   'cancelado'],
  input_required:['morado', 'pide permiso'],
  unknown:       ['gris',   'desconocido'],
  pending:       ['gris',   'pendiente'],
}

function badge(estado) {
  const [color, texto] = ESTADOS[estado] || ['gris', estado || '—']
  return `<span class="badge ${color}">${esc(texto)}</span>`
}

function pintarEstado(estado) {
  const s = estado.servidor
  $('chipServidor').textContent = s.ok ? `servidor ok` : 'servidor caído'
  $('chipPuerto').textContent = s.puerto ? `:${s.puerto}` : 'puerto —'
  $('chipNode').textContent = `node ${estado.motores.node || '—'}`
  $('chipServidor').style.borderColor = s.ok ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)'

  const punto = $('puntoVivo')
  punto.className = 'punto' + (s.ok ? '' : ' malo')
  $('textoVivo').textContent = s.ok ? 'en vivo' : 'sin conexión'
  $('textoVivo').style.color = s.ok ? 'var(--verde)' : 'var(--rojo)'

  // pipeline
  $('ncEstado').textContent = estado.motores.claude ? `Claude Code · ${estado.motores.claude.replace(' (Claude Code)', '')}` : 'Claude Code'
  $('nmEstado').textContent = `MCP v${estado.motores.mcp} · lanzador activo`
  $('nsEstado').textContent = s.ok ? `saludable · opencode-ai ${s.version || ''}` : (s.error || 'no responde')
  $('naEstado').textContent = `${estado.agentes.length} agentes · DeepSeek por defecto`
  $('nodoServidor').className = 'nodo ' + (s.ok ? 'ok' : 'malo')
  $('nodoMcp').className = 'nodo ok'
  $('nodoAgentes').className = 'nodo ' + (estado.agentes.length ? 'ok' : '')
  $('nodoCerebro').className = 'nodo ok'

  $('mSesiones').textContent = estado.sesionesTotal
  $('mActivas').textContent = estado.activas
  $('mJobs').textContent = estado.jobs.length
  $('mAgentes').textContent = estado.agentes.length
  $('mUltima').textContent = estado.ultimaSesion
    ? `${estado.ultimaSesion.titulo || estado.ultimaSesion.id} · ${hace(estado.ultimaSesion.updated)}`
    : '—'

  if (!s.ok) {
    $('avisoError').textContent = `El servidor OpenCode V1 no responde (${s.error || 'sin conexión'}). Arrángalo con: ~/.sistema-cerebro-agentes/servidor.ps1 (o servidor.sh) y recarga.`
    $('avisoError').classList.remove('oculto')
  } else {
    $('avisoError').classList.add('oculto')
  }

  const repo = estado.rutas.repo
  $('pieTexto').textContent = `Sistema: ${estado.rutas.sistema}   ·   Repo: ${repo || '(no detectado)'}   ·   Actualizado ${new Date(estado.hora).toLocaleTimeString()}`
}

function pintarJobs(jobs) {
  const tbody = $('tablaJobs').querySelector('tbody')
  if (!jobs.length) { tbody.innerHTML = `<tr><td colspan="4" class="tenue">Sin trabajos registrados todavía.</td></tr>`; return }
  tbody.innerHTML = jobs.map((j) => `
    <tr class="clic" data-sesion="${esc(j.sessionId || '')}">
      <td>${badge(j.status)}</td>
      <td>${esc(j.title || j.jobId)}</td>
      <td>${corto(j.directory)}</td>
      <td class="tenue">${hace(j.updatedAt)}</td>
    </tr>`).join('')
  for (const tr of tbody.querySelectorAll('tr.clic[data-sesion]')) {
    tr.addEventListener('click', () => { if (tr.dataset.sesion) verSesion(tr.dataset.sesion) })
  }
}

function pintarSesiones(act) {
  const tbody = $('tablaSesiones').querySelector('tbody')
  if (!act.ok || !act.sesiones.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="tenue">${act.ok ? 'Sin sesiones.' : 'Servidor no disponible.'}</td></tr>`
    return
  }
  const ahora = Date.now()
  tbody.innerHTML = act.sesiones.map((s) => {
    const activa = s.actualizada && ahora - s.actualizada < 5 * 60 * 1000
    const costo = typeof s.costo === 'number' ? `$${s.costo.toFixed(4)}` : '—'
    return `
      <tr class="clic" data-sesion="${esc(s.id)}">
        <td>${activa ? '<span class="badge verde">activa</span>' : ''}${s.padre ? ' <span class="badge gris">sub</span>' : ''}</td>
        <td>${esc(s.titulo)}</td>
        <td>${corto(s.directory)}</td>
        <td class="tenue">${costo}</td>
        <td class="tenue">${hace(s.actualizada)}</td>
      </tr>`
  }).join('')
  for (const tr of tbody.querySelectorAll('tr.clic')) {
    tr.addEventListener('click', () => verSesion(tr.dataset.sesion))
  }
}

function pintarAgentes(agentes) {
  const cont = $('listaAgentes')
  if (!agentes.length) { cont.innerHTML = '<p class="tenue">No se encontraron agentes en ~/.config/opencode/agents.</p>'; return }
  cont.innerHTML = agentes.map((a, i) => {
    const repoBadge = a.repoIgual === true ? '<span class="badge verde">= repo</span>'
      : a.repoIgual === false ? '<span class="badge ambar">≠ repo</span>' : ''
    return `
      <div class="agente" data-agente="${i}">
        <div class="agente-cabecera">
          <span class="agente-nombre">${esc(a.nombre)}</span>
          <span class="tenue">${esc(a.origen)}</span>
        </div>
        <div class="agente-meta">
          <span class="badge azul">modo: ${esc(a.modo)}</span>
          <span class="badge morado">${esc(a.modelo)}</span>
          ${repoBadge}
        </div>
        <div class="agente-desc">${esc(a.descripcion.slice(0, 160))}${a.descripcion.length > 160 ? '…' : ''}</div>
      </div>`
  }).join('')
  for (const el of cont.querySelectorAll('.agente')) {
    el.addEventListener('click', () => {
      const a = agentes[Number(el.dataset.agente)]
      const idx = ficherosCache.findIndex((f) => f.ruta === a.ruta)
      abrirModal(`Agente: ${a.nombre}`, a.ruta, () =>
        idx >= 0 ? fetchArchivo(idx) : Promise.resolve({ ok: false, error: 'no está en el registro de ficheros' }))
    })
  }
}

function pintarFicheros(ficheros) {
  ficherosCache = ficheros
  const cont = $('listaFicheros')
  const grupos = {}
  for (const f of ficheros) (grupos[f.grupo] ||= []).push(f)
  let html = ''
  for (const [grupo, lista] of Object.entries(grupos)) {
    html += `<div class="grupo-ficheros"><div class="grupo-titulo">${esc(grupo)}</div>`
    for (const f of lista) {
      html += `<div class="fichero ${f.existe ? '' : 'no-existe'}" data-i="${f.i}">
        <span>${esc(f.nombre)}</span><span class="ext">${esc(f.ext)}</span></div>`
    }
    html += '</div>'
  }
  cont.innerHTML = html || '<p class="tenue">Sin ficheros.</p>'
  for (const el of cont.querySelectorAll('.fichero:not(.no-existe)')) {
    el.addEventListener('click', () => {
      const f = ficherosCache[Number(el.dataset.i)]
      abrirModal(`Fichero: ${f.nombre}`, f.ruta, () => fetchArchivo(f.i))
    })
  }
}

// ---------------------------------------------------------------- modal

let cargarModal = null

function abrirModal(titulo, ruta, cargador) {
  $('modal').classList.remove('oculto')
  $('modalTitulo').textContent = titulo
  $('modalRuta').textContent = ruta || ''
  $('modalCuerpo').textContent = 'Cargando…'
  cargarModal = cargador
  cargador().then((r) => {
    if (cargarModal !== cargador) return
    if (!r.ok) { $('modalCuerpo').textContent = `Error: ${r.error}`; return }
    let texto = r.contenido
    if (r.truncado) texto += `\n\n… (fichero truncado; ${r.bytes} bytes en total)`
    if (r.nota) texto += `\n\n${r.nota}`
    $('modalCuerpo').textContent = texto
  }).catch((e) => { if (cargarModal === cargador) $('modalCuerpo').textContent = `Error: ${e}` })
}

$('modalCerrar').addEventListener('click', () => { cargarModal = null; $('modal').classList.add('oculto') })
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) { cargarModal = null; $('modal').classList.add('oculto') } })

async function fetchArchivo(i) {
  const r = await fetch(`/api/archivo?i=${i}`).then((x) => x.json())
  return r
}

function extraerTextoMensajes(data) {
  const msgs = data.mensajes
  if (!Array.isArray(msgs)) return JSON.stringify(data, null, 2)
  return msgs.map((m) => {
    const info = m?.info || m
    const rol = info?.role || info?.type || '?'
    let texto = ''
    if (Array.isArray(m?.parts)) {
      texto = m.parts.filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
    } else if (typeof info?.text === 'string') {
      texto = info.text
    }
    const modelo = info?.modelID ? ` · ${info.providerID || ''}/${info.modelID}` : ''
    const cabecera = `── ${rol}${modelo} ${info?.time?.created ? `· ${new Date(info.time.created).toLocaleTimeString()}` : ''}`
    return texto ? `${cabecera}\n${texto}` : cabecera + '\n' + JSON.stringify(m, null, 1).slice(0, 1200)
  }).join('\n\n')
}

async function verSesion(id) {
  abrirModal(`Sesión ${id}`, id, async () => {
    const r = await fetch(`/api/sesion/${encodeURIComponent(id)}`).then((x) => x.json())
    if (!r.ok) return r
    return { ok: true, contenido: extraerTextoMensajes(r), nota: '(últimos mensajes de la sesión)' }
  })
}

// ---------------------------------------------------------------- ciclo

async function refrescar() {
  try {
    const [estado, actividad] = await Promise.all([
      fetch('/api/estado').then((r) => r.json()),
      fetch('/api/actividad').then((r) => r.json()),
    ])
    pintarEstado(estado)
    pintarAgentes(estado.agentes)
    pintarJobs(actividad.jobs || estado.jobs)
    pintarSesiones(actividad)
  } catch (e) {
    $('textoVivo').textContent = 'sin conexión con el panel'
    $('textoVivo').style.color = 'var(--rojo)'
  }
}

async function cargarFicheros() {
  try {
    const r = await fetch('/api/ficheros').then((x) => x.json())
    if (r.ok) pintarFicheros(r.ficheros)
  } catch { /* se reintenta */ }
}

refrescar()
cargarFicheros()
setInterval(refrescar, 2500)
setInterval(cargarFicheros, 30000)
