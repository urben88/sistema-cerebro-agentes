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
  agentesCache = agentes
  const cont = $('listaAgentes')
  if (!agentes.length) { cont.innerHTML = '<p class="tenue">No se encontraron agentes en ~/.config/opencode/agents.</p>'; return }
  cont.innerHTML = agentes.map((a, i) => {
    const repoBadge = a.repoIgual === true ? '<span class="badge verde">= repo</span>'
      : a.repoIgual === false ? '<span class="badge ambar">≠ repo</span>' : ''
    return `
      <div class="agente" data-agente="${i}">
        <div class="agente-cabecera">
          <span class="agente-nombre">${esc(a.nombre)}</span>
          <span class="tenue">${esc(a.origen)} · ✏️ editar</span>
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
    el.addEventListener('click', () => abrirBot(agentes[Number(el.dataset.agente)]))
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

// ---------------------------------------------------------------- editor de bots

let agentesCache = []
let modelosCache = null
let botEditando = null

async function cargarModelos() {
  if (modelosCache) return modelosCache
  try {
    const r = await fetch('/api/modelos').then((x) => x.json())
    modelosCache = (r.ok && r.modelos) || []
  } catch { modelosCache = [] }
  return modelosCache
}

function cuerpoDeMarkdown(texto) {
  const lineas = String(texto || '').split(/\r?\n/)
  let vistos = 0
  let inicio = -1
  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i].trim() === '---') {
      vistos++
      if (vistos === 2) { inicio = i + 1; break }
    }
  }
  return (inicio >= 0 ? lineas.slice(inicio) : lineas).join('\n').trim()
}

async function abrirBot(agente) {
  const modelos = await cargarModelos()
  const sel = $('botModelo')
  const porProveedor = {}
  for (const m of modelos) {
    const p = m.split('/')[0]
    if (!porProveedor[p]) porProveedor[p] = []
    porProveedor[p].push(m)
  }
  let html = '<option value="">— heredar (sin modelo fijo) —</option>'
  for (const p of Object.keys(porProveedor).sort()) {
    html += `<optgroup label="${esc(p)}">` +
      porProveedor[p].map((m) => `<option value="${esc(m)}">${esc(m.split('/').slice(1).join('/'))}</option>`).join('') +
      '</optgroup>'
  }
  sel.innerHTML = html

  botEditando = agente ? agente.nombre : null
  $('botTitulo').textContent = agente ? `Editar bot: ${agente.nombre}` : 'Nuevo bot'
  $('botNombre').value = agente ? agente.nombre : ''
  $('botNombre').disabled = !!agente
  $('botDescripcion').value = agente ? agente.descripcion : ''
  $('botModo').value = agente && ['primary', 'subagent', 'all'].includes(agente.modo) ? agente.modo : 'all'
  sel.value = agente && modelos.includes(agente.modelo) ? agente.modelo : ''
  $('botPrompt').value = ''
  $('botEliminar').style.display = agente ? '' : 'none'
  $('botErrores').classList.add('oculto')
  $('modalBot').classList.remove('oculto')

  if (agente) {
    const idx = ficherosCache.findIndex((f) => f.ruta === agente.ruta)
    if (idx >= 0) {
      $('botPrompt').value = 'Cargando…'
      try {
        const r = await fetchArchivo(idx)
        $('botPrompt').value = r.ok ? cuerpoDeMarkdown(r.contenido) : ''
      } catch { $('botPrompt').value = '' }
    }
  }
}

function cerrarBot() {
  botEditando = null
  $('modalBot').classList.add('oculto')
}

async function guardarBot() {
  const datos = {
    nombre: $('botNombre').value.trim(),
    descripcion: $('botDescripcion').value.trim(),
    modo: $('botModo').value,
    modelo: $('botModelo').value,
    prompt: $('botPrompt').value,
  }
  const boton = $('botGuardar')
  boton.disabled = true
  boton.textContent = '💾 Guardando…'
  try {
    const r = await fetch('/api/bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) }).then((x) => x.json())
    if (r.ok) {
      cerrarBot()
      await refrescar()
      await cargarFicheros()
    } else {
      $('botErrores').textContent = (r.errores || ['Error desconocido']).join(' · ')
      $('botErrores').classList.remove('oculto')
    }
  } catch (e) {
    $('botErrores').textContent = `Error: ${e}`
    $('botErrores').classList.remove('oculto')
  } finally {
    boton.disabled = false
    boton.textContent = '💾 Guardar'
  }
}

async function eliminarBot() {
  if (!botEditando) return
  if (!confirm(`¿Eliminar el bot "${botEditando}"? Se guardará una copia de seguridad.`)) return
  try {
    const r = await fetch('/api/bot/eliminar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: botEditando }) }).then((x) => x.json())
    if (r.ok) {
      cerrarBot()
      await refrescar()
      await cargarFicheros()
    } else {
      $('botErrores').textContent = (r.errores || ['Error']).join(' · ')
      $('botErrores').classList.remove('oculto')
    }
  } catch (e) {
    $('botErrores').textContent = `Error: ${e}`
    $('botErrores').classList.remove('oculto')
  }
}

$('btnNuevoBot').addEventListener('click', () => abrirBot(null))
$('botCerrar').addEventListener('click', cerrarBot)
$('botCancelar').addEventListener('click', cerrarBot)
$('botGuardar').addEventListener('click', guardarBot)
$('botEliminar').addEventListener('click', eliminarBot)
$('modalBot').addEventListener('click', (e) => { if (e.target === $('modalBot')) cerrarBot() })

// ---------------------------------------------------------------- pestañas

function mostrarPestana(nombre) {
  for (const b of document.querySelectorAll('.pestana-btn')) b.classList.toggle('activa', b.dataset.pestana === nombre)
  for (const p of document.querySelectorAll('.pestana')) p.classList.toggle('oculto', p.id !== `pestana-${nombre}`)
  if (nombre === 'agentes') cargarPerfiles()
  if (nombre === 'modelos') cargarFicha()
  location.hash = nombre === 'panel' ? '' : nombre
}
for (const b of document.querySelectorAll('.pestana-btn')) b.addEventListener('click', () => mostrarPestana(b.dataset.pestana))

// ---------------------------------------------------------------- pestaña Agentes: perfiles

let perfilesCache = null

async function postJson(ruta, datos) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
  return r.json()
}

function mensajePerfil(texto, bueno) {
  const el = $('perfilMsg')
  el.textContent = texto
  el.className = bueno ? 'ok-msg' : 'errores'
  el.classList.toggle('oculto', !texto)
}

function nombrePerfil(id) {
  const p = perfilesCache && perfilesCache.perfiles.find((x) => x.id === id)
  return p ? p.nombre : id
}

function pintarPerfiles() {
  const r = perfilesCache
  const sel = $('selPerfil')
  const previo = sel.value
  sel.innerHTML = r.perfiles.map((p) => `<option value="${esc(p.id)}"${p.error ? ' disabled' : ''}>${esc(p.nombre)}${p.error ? ' (con errores)' : ''}</option>`).join('')
  if (previo && r.perfiles.some((p) => p.id === previo)) sel.value = previo
  const act = $('perfilActivo')
  act.textContent = r.activo ? `en uso: ${nombrePerfil(r.activo)}` : 'en uso: personalizado'
  act.className = 'badge ' + (r.activo ? 'verde' : 'ambar')
  const elegido = r.perfiles.find((p) => p.id === sel.value)
  $('perfilDesc').textContent = elegido ? (elegido.error || elegido.descripcion) : ''
  $('tablaPerfiles').querySelector('tbody').innerHTML = r.agentes.map((a) => `
    <tr>
      <td><span class="badge ${a.origen === 'claude' ? 'morado' : 'azul'}">${a.origen === 'claude' ? 'Claude' : 'OpenCode'}</span></td>
      <td>${esc(a.agente)}</td>
      <td>${esc(a.model || '(hereda)')}</td>
      <td>${esc(a.effort || a.variant || '—')}${a.fuente === 'repo' ? ' <span class="tenue" title="no está instalado: se muestra el repositorio">(repo)</span>' : ''}</td>
    </tr>`).join('')
}

async function cargarPerfiles() {
  try {
    const r = await fetch('/api/perfiles').then((x) => x.json())
    if (!r.ok) { mensajePerfil(r.error || 'No se pudieron leer los perfiles', false); return }
    perfilesCache = r
    pintarPerfiles()
  } catch (e) { mensajePerfil(`Error: ${e}`, false) }
}

async function previaPerfil() {
  const id = $('selPerfil').value
  const caja = $('perfilPrevia')
  mensajePerfil('', true)
  const r = await fetch(`/api/perfiles/previa?id=${encodeURIComponent(id)}`).then((x) => x.json())
  if (!r.ok) { caja.classList.add('oculto'); mensajePerfil((r.errores || ['Error']).join(' · '), false); return }
  if (!r.cambios.length) { caja.classList.add('oculto'); mensajePerfil(`«${r.nombre}» ya está aplicado: no hay nada que cambiar.`, true); return }
  caja.innerHTML = `<strong>Aplicar «${esc(r.nombre)}» cambia ${r.cambios.length} valor(es):</strong>
    <ul>${r.cambios.map((c) => `<li>${esc(c.origen === 'claude' ? 'Claude' : 'OpenCode')} · <b>${esc(c.agente)}</b> · ${esc(c.campo)}: ${esc(c.antes ?? '(sin línea)')} <span class="flecha-cambio">→</span> ${esc(c.despues)}</li>`).join('')}</ul>
    <div class="fila-botones" style="justify-content:flex-start">
      <button class="boton primario" id="btnConfirmar">Confirmar y aplicar</button>
      <button class="boton" id="btnCancelarPerfil">Cancelar</button>
    </div>`
  caja.classList.remove('oculto')
  $('btnCancelarPerfil').addEventListener('click', () => caja.classList.add('oculto'))
  $('btnConfirmar').addEventListener('click', async () => {
    $('btnConfirmar').disabled = true
    try {
      const a = await postJson('/api/perfiles/aplicar', { id })
      caja.classList.add('oculto')
      if (!a.ok) { mensajePerfil((a.errores || [a.error || 'Error']).join(' · '), false); return }
      const avisos = Object.values(a.registro || {}).filter((v) => v !== 'registrado')
      mensajePerfil(`Aplicado «${nombrePerfil(id)}»: ${a.cambios.length} valor(es) en ${a.ficheros.length} fichero(s).${avisos.length ? ' Registro del instalador: ' + avisos.join('; ') : ''}`, true)
      await cargarPerfiles()
    } catch (e) { mensajePerfil(`Error: ${e}`, false) }
  })
}

$('btnAplicar').addEventListener('click', previaPerfil)
$('selPerfil').addEventListener('change', () => { $('perfilPrevia').classList.add('oculto'); mensajePerfil('', true); if (perfilesCache) pintarPerfiles() })

// ---------------------------------------------------------------- pestaña Modelos

let fichaCache = null
let orden = { col: 'indice', desc: true }
const COLORES = { Anthropic: '#f59e0b', OpenAI: '#22c55e', Google: '#3b82f6', DeepSeek: '#a855f7' }

function filasFicha() {
  return fichaCache.modelos.map((m) => ({ ...m, porDolar: m.dolares > 0 ? m.indice / m.dolares : 0 }))
}

function pintarTablaModelos() {
  const filas = filasFicha().sort((a, b) => {
    const x = a[orden.col]; const y = b[orden.col]
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y
    return orden.desc ? -c : c
  })
  for (const th of $('tablaModelos').querySelectorAll('th[data-col]')) {
    th.dataset.base = th.dataset.base || th.textContent
    th.textContent = th.dataset.base + (th.dataset.col === orden.col ? (orden.desc ? ' ▼' : ' ▲') : '')
  }
  $('tablaModelos').querySelector('tbody').innerHTML = filas.map((m) => `
    <tr class="${m.usa ? 'usado' : ''}">
      <td>${m.usa ? '★ ' : ''}${esc(m.modelo)}</td>
      <td><span style="color:${COLORES[m.proveedor] || 'var(--suave)'}">●</span> ${esc(m.proveedor)}</td>
      <td class="num">${m.indice.toFixed(1)}</td><td class="num">$${m.dolares.toFixed(2)}</td>
      <td class="num">${m.minutos.toFixed(1)}</td><td class="num">${m.engineering}</td>
      <td class="num">${m.porDolar.toFixed(1)}</td>
    </tr>`).join('')
}

function pintarGrafica() {
  const filas = filasFicha()
  const W = 900; const H = 460; const mi = 56; const md = 24; const ms = 20; const mb = 44
  const xmin = 0.3; const xmax = 40; const ymin = 25; const ymax = 68
  const X = (v) => mi + ((Math.log10(v) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin))) * (W - mi - md)
  const Y = (v) => H - mb - ((v - ymin) / (ymax - ymin)) * (H - mb - ms)
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Inteligencia frente a coste por tarea">`
  for (const v of [0.3, 1, 3, 10, 30]) svg += `<line x1="${X(v)}" y1="${ms}" x2="${X(v)}" y2="${H - mb}" stroke="#223047"/><text x="${X(v)}" y="${H - mb + 16}" fill="#93a4c3" font-size="11" text-anchor="middle">$${v}</text>`
  for (let v = 30; v <= 65; v += 5) svg += `<line x1="${mi}" y1="${Y(v)}" x2="${W - md}" y2="${Y(v)}" stroke="#223047"/><text x="${mi - 8}" y="${Y(v) + 4}" fill="#93a4c3" font-size="11" text-anchor="end">${v}</text>`
  svg += `<text x="${(mi + W - md) / 2}" y="${H - 6}" fill="#93a4c3" font-size="12" text-anchor="middle">Coste por tarea ($, escala logarítmica)</text>`
  svg += `<text transform="translate(14 ${(ms + H - mb) / 2}) rotate(-90)" fill="#93a4c3" font-size="12" text-anchor="middle">Índice de inteligencia</text>`
  filas.forEach((m, i) => {
    const cx = X(m.dolares); const cy = Y(m.indice)
    const color = COLORES[m.proveedor] || '#64748b'
    const alto = i % 2 ? 14 : -9
    svg += `<g><title>${esc(m.modelo)} · índice ${m.indice} · $${m.dolares}/tarea</title>` +
      `<circle cx="${cx}" cy="${cy}" r="${m.usa ? 7 : 4.5}" fill="${color}" fill-opacity="${m.usa ? 1 : .75}" stroke="${m.usa ? '#fff' : 'none'}" stroke-width="2"/>` +
      `<text x="${cx + 8}" y="${cy + alto}" fill="${m.usa ? '#e6edf7' : '#93a4c3'}" font-size="${m.usa ? 11 : 9.5}" font-weight="${m.usa ? 700 : 400}">${m.usa ? '★ ' : ''}${esc(m.modelo)}</text></g>`
  })
  $('grafica').innerHTML = svg + '</svg>'
  $('leyenda').innerHTML = Object.entries(COLORES).map(([p, c]) => `<span><i style="background:${c}"></i>${esc(p)}</span>`).join('') + '<span>★ borde blanco = lo que usa el sistema</span>'
}

async function cargarFicha() {
  if (!fichaCache) {
    try { fichaCache = await fetch('/modelos.json').then((x) => x.json()) } catch { $('modelosFuente').textContent = '(no se pudo cargar modelos.json)'; return }
    $('modelosFuente').textContent = `· fuente: ${fichaCache.fuente}, ${fichaCache.fecha} (aproximado)`
    for (const th of $('tablaModelos').querySelectorAll('th[data-col]')) {
      th.addEventListener('click', () => {
        orden = { col: th.dataset.col, desc: orden.col === th.dataset.col ? !orden.desc : th.dataset.col !== 'modelo' && th.dataset.col !== 'proveedor' }
        pintarTablaModelos()
      })
    }
  }
  pintarTablaModelos()
  pintarGrafica()
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
if (['agentes', 'modelos'].includes(location.hash.slice(1))) mostrarPestana(location.hash.slice(1))
setInterval(refrescar, 2500)
setInterval(cargarFicheros, 30000)
