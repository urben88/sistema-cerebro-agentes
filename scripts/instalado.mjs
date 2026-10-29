#!/usr/bin/env node
/**
 * Registro de lo instalado (spec 25 · S1-S3). Lo usan install.ps1 e install.sh.
 *
 * Un componente es una lista de pares origen→destino (archivo o carpeta). Se guarda la huella
 * (sha256) del origen en el repo y la de lo copiado en destino, solo sobre los archivos que
 * venían del origen: lo que otras herramientas añaden dentro (p. ej. tsconfig de los mods) no cuenta.
 *
 * Uso:
 *   node instalado.mjs estado      <registro> <nombre> <origen> <destino> [<origen> <destino>...]
 *   node instalado.mjs registrar   <registro> <nombre> <origen> <destino> [...]
 *   node instalado.mjs diferencias <registro> <nombre> <origen> <destino> [...]
 *   node instalado.mjs valor       <registro> <nombre> [<texto>]
 *   node instalado.mjs cerrar      <registro> <version>
 *
 * estado imprime: nuevo | igual | actualizar | tocado
 *   nuevo      sin registro o sin nada instalado: se instala sin preguntar
 *   igual      mismo origen y lo instalado no se ha tocado: se salta
 *   actualizar el origen cambió y lo instalado no se ha tocado: se reemplaza con copia
 *   tocado     lo instalado ya no coincide con lo registrado: hay que preguntar
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function listar(base) {
  // Rutas relativas de los archivos de un origen ('' si el origen es un archivo).
  if (!fs.existsSync(base)) return []
  if (fs.statSync(base).isFile()) return ['']
  const fuera = []
  const recorrer = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) recorrer(path.join(dir, e.name), r)
      else if (e.isFile()) fuera.push(r)
    }
  }
  recorrer(base, '')
  return fuera.sort()
}

function huella(base, rels) {
  const h = crypto.createHash('sha256')
  for (const rel of rels) {
    const p = rel ? path.join(base, ...rel.split('/')) : base
    let contenido = 'FALTA'
    try { if (fs.statSync(p).isFile()) contenido = sha(fs.readFileSync(p)) } catch { }
    h.update(`${rel}\0${contenido}\n`)
  }
  return h.digest('hex')
}

function pares(args) {
  if (args.length === 0 || args.length % 2 !== 0) throw new Error('hacen falta pares <origen> <destino>')
  const fuera = []
  for (let i = 0; i < args.length; i += 2) fuera.push({ origen: path.resolve(args[i]), destino: path.resolve(args[i + 1]) })
  return fuera
}

const huellaOrigen = (ps) => sha(ps.map((p) => huella(p.origen, listar(p.origen))).join('|'))
const huellaDestino = (ps, archivos) => sha(ps.map((p, i) => huella(p.destino, archivos[i] || [])).join('|'))

function leer(registro) {
  try {
    const r = JSON.parse(fs.readFileSync(registro, 'utf8'))
    if (r && typeof r === 'object' && r.componentes && typeof r.componentes === 'object') return r
  } catch { }
  return { version: null, componentes: {} }
}

function guardar(registro, r) {
  fs.mkdirSync(path.dirname(registro), { recursive: true })
  const tmp = `${registro}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n')
  fs.renameSync(tmp, registro)
}

export function estado(registro, nombre, ps) {
  const c = leer(registro).componentes[nombre]
  if (!c || !c.origen || !Array.isArray(c.archivos)) return 'nuevo'
  if (ps.every((p) => !fs.existsSync(p.destino))) return 'nuevo'
  if (huellaDestino(ps, c.archivos) !== c.destino) return 'tocado'
  return huellaOrigen(ps) === c.origen ? 'igual' : 'actualizar'
}

export function registrar(registro, nombre, ps) {
  const r = leer(registro)
  const archivos = ps.map((p) => listar(p.origen))
  r.componentes[nombre] = { ...(r.componentes[nombre] || {}), origen: huellaOrigen(ps), destino: huellaDestino(ps, archivos), archivos, fecha: new Date().toISOString() }
  guardar(registro, r)
}

function diferencias(registro, nombre, ps) {
  // Lista lo que difiere entre el repo y lo instalado y, si hay git, enseña el diff de cada archivo.
  const c = leer(registro).componentes[nombre] || {}
  let hay = 0
  ps.forEach((p, i) => {
    const rels = [...new Set([...listar(p.origen), ...((c.archivos || [])[i] || [])])].sort()
    for (const rel of rels) {
      const o = rel ? path.join(p.origen, ...rel.split('/')) : p.origen
      const d = rel ? path.join(p.destino, ...rel.split('/')) : p.destino
      const ho = huella(o, ['']); const hd = huella(d, [''])
      if (ho === hd) continue
      hay++
      console.log(`--- ${d}`)
      if (fs.existsSync(o) && fs.existsSync(d)) {
        const g = spawnSync('git', ['diff', '--no-index', '--no-color', '--', d, o], { encoding: 'utf8' })
        if (g.stdout) console.log(g.stdout.split('\n').slice(4).join('\n').trimEnd())
      } else console.log(fs.existsSync(d) ? '    (no existe en el repo)' : '    (falta en lo instalado)')
    }
  })
  if (!hay) console.log('Sin diferencias con el repo.')
}

function main(argv) {
  const [cmd, registro, ...resto] = argv
  if (!cmd || !registro) { console.error('Uso: node instalado.mjs <estado|registrar|diferencias|valor|cerrar> <registro> ...'); return 2 }
  if (cmd === 'cerrar') {
    const r = leer(registro); r.version = resto[0] || null; r.actualizado = new Date().toISOString(); guardar(registro, r); return 0
  }
  const [nombre, ...args] = resto
  if (!nombre) { console.error('Falta el nombre del componente'); return 2 }
  if (cmd === 'valor') {
    const r = leer(registro)
    if (args.length === 0) { process.stdout.write(String((r.componentes[nombre] || {}).valor ?? '')); return 0 }
    r.componentes[nombre] = { ...(r.componentes[nombre] || {}), valor: args.join(' '), fecha: new Date().toISOString() }
    guardar(registro, r); return 0
  }
  const ps = pares(args)
  if (cmd === 'estado') { process.stdout.write(estado(registro, nombre, ps)); return 0 }
  if (cmd === 'registrar') { registrar(registro, nombre, ps); return 0 }
  if (cmd === 'diferencias') { diferencias(registro, nombre, ps); return 0 }
  console.error(`Comando desconocido: ${cmd}`); return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))) } catch (e) { console.error(`instalado.mjs: ${e.message}`); process.exit(2) }
}
