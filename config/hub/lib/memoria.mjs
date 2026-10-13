/**
 * Memoria compartida del Cerebro Hub.
 *
 * Todo vive FUERA de los repositorios del usuario:
 *   memoria/global/            conocimiento compartido entre proyectos
 *   memoria/proyectos/<slug>/  ESTADO.md, BITACORA.md, CONTEXTO-REPO.md, checkpoints/
 *   memoria/temporal/          notas de sesión con caducidad (TTL)
 *
 * Sin dependencias (solo Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function crearMemoria(raiz, { temporalDias = 14, plantillasDir = null } = {}) {
  const dirProyectos = path.join(raiz, 'proyectos')
  const dirTemporal = path.join(raiz, 'temporal')
  const dirGlobal = path.join(raiz, 'global')
  const registroPath = path.join(raiz, 'proyectos.json')

  const ahoraISO = () => new Date().toISOString().replace('T', ' ').slice(0, 16)
  // Normalización de rutas válida en cualquier sistema (Windows nativo o contenedor Linux):
  // se comparan cadenas, no se resuelven contra el sistema de archivos.
  const normalizar = (r) => String(r || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const nombreDe = (r) => String(r || '').split(/[\\/]/).filter(Boolean).pop() || 'proyecto'
  const plantilla = (nombre) => {
    if (!plantillasDir) return ''
    try { return fs.readFileSync(path.join(plantillasDir, nombre), 'utf8') } catch { return '' }
  }

  function inicializar() {
    for (const d of [dirProyectos, dirTemporal, dirGlobal]) fs.mkdirSync(d, { recursive: true })
    const g = path.join(dirGlobal, 'README.md')
    if (!fs.existsSync(g)) {
      fs.writeFileSync(g, '# Memoria global\n\nConocimiento compartido entre todos los proyectos (convenciones, snippets, decisiones generales).\nLos agentes pueden leer y escribir aquí cuando algo no es específico de un proyecto.\n')
    }
  }

  function cargarRegistro() { try { return JSON.parse(fs.readFileSync(registroPath, 'utf8')) } catch { return {} } }
  function guardarRegistro(r) { fs.mkdirSync(raiz, { recursive: true }); fs.writeFileSync(registroPath, JSON.stringify(r, null, 2) + '\n') }

  function slugDe(ruta) {
    const base = nombreDe(ruta).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto'
    const h = crypto.createHash('sha1').update(normalizar(ruta)).digest('hex').slice(0, 6)
    return `${base}-${h}`
  }

  function buscarProyecto(cwd) {
    const n = normalizar(cwd)
    const reg = cargarRegistro()
    for (const [slug, p] of Object.entries(reg)) {
      if (normalizar(p.ruta) === n) return { slug, ...p }
    }
    return null
  }

  function crearProyecto(cwd) {
    const ruta = String(cwd || '.').replace(/[\\/]+$/, '')
    const slug = slugDe(ruta)
    const reg = cargarRegistro()
    if (!reg[slug]) reg[slug] = { ruta, nombre: nombreDe(ruta), creado: Date.now(), actualizado: Date.now(), ultimoUso: Date.now() }
    reg[slug].ultimoUso = Date.now()
    guardarRegistro(reg)
    fs.mkdirSync(path.join(dirProyectos, slug, 'checkpoints'), { recursive: true })
    return { slug, ...reg[slug] }
  }

  function asegurarProyecto(cwd) {
    return buscarProyecto(cwd) || crearProyecto(cwd)
  }

  function tocar(slug) {
    const reg = cargarRegistro()
    if (reg[slug]) { reg[slug].ultimoUso = Date.now(); reg[slug].actualizado = Date.now(); guardarRegistro(reg) }
  }

  const rutaProyecto = (slug) => path.join(dirProyectos, slug)
  const leer = (archivo, max = 200 * 1024) => {
    try {
      const b = fs.readFileSync(archivo)
      return b.subarray(0, max).toString('utf8')
    } catch { return null }
  }
  const escribir = (archivo, texto) => {
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    fs.writeFileSync(archivo, String(texto ?? '').endsWith('\n') ? texto : String(texto ?? '') + '\n', 'utf8')
  }

  const leerEstado = (slug) => leer(path.join(rutaProyecto(slug), 'ESTADO.md'))
  const leerContexto = (slug) => leer(path.join(rutaProyecto(slug), 'CONTEXTO-REPO.md'))
  const leerBitacora = (slug) => leer(path.join(rutaProyecto(slug), 'BITACORA.md')) || ''

  function escribirEstado(cwd, contenido) {
    const p = asegurarProyecto(cwd)
    escribir(path.join(rutaProyecto(p.slug), 'ESTADO.md'), contenido)
    tocar(p.slug)
    return p
  }

  function escribirContexto(cwd, contenido) {
    const p = asegurarProyecto(cwd)
    escribir(path.join(rutaProyecto(p.slug), 'CONTEXTO-REPO.md'), contenido)
    tocar(p.slug)
    return p
  }

  function agregarBitacora(cwd, titulo, texto = '') {
    const p = asegurarProyecto(cwd)
    const archivo = path.join(rutaProyecto(p.slug), 'BITACORA.md')
    if (!fs.existsSync(archivo)) escribir(archivo, plantilla('BITACORA.md') || '# BITÁCORA\n')
    fs.appendFileSync(archivo, `\n## ${ahoraISO()} — ${titulo}\n${texto ? texto.trim() + '\n' : ''}`, 'utf8')
    tocar(p.slug)
    return p
  }

  function checkpoint(cwd, motivo = 'manual', extra = '') {
    const p = asegurarProyecto(cwd)
    const marca = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(rutaProyecto(p.slug), 'checkpoints', `${marca}.md`)
    const estado = leerEstado(p.slug) || '(sin ESTADO.md todavía)'
    const partes = [
      `# Checkpoint — ${p.nombre} (${p.ruta})`,
      `- Fecha: ${ahoraISO()}`,
      `- Motivo: ${motivo}`,
      extra ? `- Nota: ${extra}` : null,
      '',
      '## ESTADO.md',
      estado,
    ].filter((x) => x !== null)
    escribir(destino, partes.join('\n'))
    tocar(p.slug)
    return { proyecto: p, archivo: destino }
  }

  function ultimasBitacora(slug, n = 5) {
    const texto = leerBitacora(slug)
    const bloques = texto.split(/\n(?=## )/).filter((b) => b.startsWith('## ')).slice(-n)
    return bloques.map((b) => b.trim())
  }

  function proyectos() {
    const reg = cargarRegistro()
    return Object.entries(reg)
      .map(([slug, p]) => {
        const estado = leerEstado(slug)
        return {
          slug,
          ...p,
          tieneEstado: !!estado,
          tieneContexto: fs.existsSync(path.join(rutaProyecto(slug), 'CONTEXTO-REPO.md')),
          estado: estado ? estado.slice(0, 600) : null,
        }
      })
      .sort((a, b) => (b.ultimoUso || 0) - (a.ultimoUso || 0))
  }

  function limpiarTemporales() {
    const limite = Date.now() - temporalDias * 24 * 60 * 60 * 1000
    let borrados = 0
    const walk = (dir) => {
      let entradas = []
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entradas) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else {
          try { if (fs.statSync(full).mtimeMs < limite) { fs.unlinkSync(full); borrados++ } } catch { /* nada */ }
        }
      }
    }
    walk(dirTemporal)
    return borrados
  }

  function briefing(cwd, { alertas = [], jobs = [], hallazgos = [] } = {}) {
    const p = buscarProyecto(cwd)
    const lineas = []
    lineas.push(`# Briefing · ${p ? p.nombre : nombreDe(cwd)}`)
    lineas.push(`Generado por Cerebro Hub · ${ahoraISO()}${p ? ` · memoria: ${p.slug}` : ' · (proyecto nuevo, aún sin memoria)'}`)
    if (p) {
      const estado = leerEstado(p.slug)
      const contexto = leerContexto(p.slug)
      const movimientos = ultimasBitacora(p.slug, 5)
      lineas.push('', '## Estado actual (ESTADO.md)', estado ? estado.trim() : '(sin estado guardado todavía; escribe ESTADO.md al terminar la tarea o antes de /clear)')
      lineas.push('', '## Contexto del repositorio', contexto ? contexto.trim() : '(sin reconocimiento guardado; si el repo es nuevo o cambió, delega el reconocimiento: explorador/explorador-ds y guarda CONTEXTO-REPO.md)')
      if (movimientos.length) lineas.push('', '## Últimos movimientos (bitácora)', ...movimientos)
    }
    const rutaActual = normalizar(cwd)
    const esDeAqui = (d) => normalizar(d) === rutaActual
    const alertasPropias = alertas.filter((a) => esDeAqui(a.directory)).slice(0, 5)
    const alertasOtras = alertas.filter((a) => !esDeAqui(a.directory)).length
    if (alertasPropias.length) {
      lineas.push('', '## Alertas del vigilante (este proyecto)')
      for (const a of alertasPropias) lineas.push(`- [${a.tipo}] ${a.title || a.jobId} (${a.minutos} min)`)
    }
    if (alertasOtras) lineas.push('', `(Hay ${alertasOtras} alerta(s) en otros proyectos; están en el panel del hub.)`)
    const jobsVivos = jobs.filter((j) => esDeAqui(j.directory) && (j.status === 'running' || j.status === 'accepted' || j.status === 'input_required')).slice(0, 5)
    if (jobsVivos.length) {
      lineas.push('', '## Trabajos en curso en esta carpeta')
      for (const j of jobsVivos) lineas.push(`- ${j.status} · ${j.title || j.jobId} · jobId ${j.jobId}`)
    }
    if (hallazgos.length) {
      lineas.push('', '## Hallazgos pendientes de validar (buscar antes de crear)')
      for (const h of hallazgos.slice(0, 5)) lineas.push(`- ${h.nombre}${h.url ? ` — ${h.url}` : ''} (propuesto por ${h.por || 'un agente'}) · id ${h.id}`)
      lineas.push('Pregúntale al usuario si quiere usar alguno (validar / descartar) ANTES de crear nada nuevo; si valida, intégralo en vez de construirlo.')
    }
    const texto = lineas.join('\n')
    return texto.length > 6000 ? texto.slice(0, 6000) + '\n… (briefing truncado)' : texto
  }

  return {
    raiz, dirProyectos, dirTemporal, dirGlobal,
    inicializar, asegurarProyecto, buscarProyecto, crearProyecto, tocar,
    escribirEstado, escribirContexto, agregarBitacora, checkpoint,
    leerEstado, leerContexto, leerBitacora, ultimasBitacora,
    proyectos, limpiarTemporales, briefing,
    rutaProyecto,
  }
}
