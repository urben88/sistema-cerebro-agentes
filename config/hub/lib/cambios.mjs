/**
 * Cambios pendientes (spec 22 · S3): lo que está sin commit en el repo de la sesión y en
 * sus worktrees (incluidos los de los subagentes): archivos y `--stat`.
 *
 * El diff NO viaja con el estado: se carga solo al abrir un archivo (`diff`). Solo lectura:
 * únicamente se ejecutan `git rev-parse`, `worktree list`, `status` y `diff`, con
 * `execFile` (sin shell) y `GIT_OPTIONAL_LOCKS=0` para no tocar el índice.
 *
 * Seguridad: `diff` solo atiende a un árbol que sea el repo/worktree de alguno de los
 * `cwds` dados y a un archivo que figure como cambiado en ese árbol.
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const MAX_ARCHIVOS = 300
const MAX_DIFF = 200 * 1024
const TIMEOUT_MS = 8000

const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Ejecuta git sin shell. Devuelve `{ok, out}`; exit != 0 no lanza (`ok:false`, `out` con lo recibido). */
export function gitReal(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => resolve({ ok: !err, out: String(out || '') }))
  })
}

export function crearCambios({ git = gitReal } = {}) {
  /** Repo y worktrees a partir de una carpeta, o `null` si no es un repo git. */
  async function arbolesDe(cwd) {
    if (!cwd || !fs.existsSync(cwd)) return null
    const top = await git(cwd, ['rev-parse', '--show-toplevel'])
    if (!top.ok || !top.out.trim()) return null
    const lista = await git(top.out.trim(), ['worktree', 'list', '--porcelain'])
    const arboles = []
    if (lista.ok) {
      for (const bloque of lista.out.split(/\r?\n\r?\n/)) {
        const lineas = bloque.split(/\r?\n/)
        const ruta = lineas.find((l) => l.startsWith('worktree '))?.slice(9)
        if (!ruta || lineas.includes('bare') || lineas.some((l) => l.startsWith('prunable'))) continue
        const rama = lineas.find((l) => l.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') || (lineas.includes('detached') ? '(desacoplado)' : null)
        arboles.push({ ruta: path.normalize(ruta), rama, principal: arboles.length === 0 })
      }
    }
    if (!arboles.length) arboles.push({ ruta: path.normalize(top.out.trim()), rama: null, principal: true })
    return arboles
  }

  /** Archivos cambiados de un árbol con `--stat` y contadores por archivo. */
  async function estadoDe(arbol) {
    const st = await git(arbol.ruta, ['status', '--porcelain=v1', '-z', '-uall'])
    const archivos = []
    if (st.ok) {
      const partes = st.out.split('\0')
      for (let i = 0; i < partes.length && archivos.length < MAX_ARCHIVOS; i++) {
        const e = partes[i]
        if (e.length < 4) continue
        const x = e[0]; const y = e[1]
        archivos.push({ ruta: e.slice(3), estado: x === '?' ? '?' : (y !== ' ' ? y : x), insertions: null, deletions: null })
        if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++ // el siguiente campo es el origen
      }
    }
    let base = ['HEAD']
    if (!(await git(arbol.ruta, ['rev-parse', '--verify', '-q', 'HEAD'])).ok) base = []
    const num = await git(arbol.ruta, ['diff', '--numstat', '-z', ...base])
    if (num.ok) {
      for (const l of num.out.split('\0')) {
        const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/s)
        if (!m) continue
        const a = archivos.find((f) => f.ruta === m[3])
        if (a) { a.insertions = m[1] === '-' ? null : Number(m[1]); a.deletions = m[2] === '-' ? null : Number(m[2]) }
      }
    }
    const stat = await git(arbol.ruta, ['diff', '--stat', ...base])
    const ins = archivos.reduce((s, f) => s + (f.insertions || 0), 0)
    const del = archivos.reduce((s, f) => s + (f.deletions || 0), 0)
    return { ...arbol, archivos, stat: stat.ok ? stat.out.trimEnd() : '', insertions: ins, deletions: del }
  }

  /** Repos (uno por repo, aunque se pida desde un worktree) con sus árboles y cambios. */
  async function estado(cwds = []) {
    const repos = []
    const vistos = new Set()
    for (const cwd of [...new Set((cwds || []).filter(Boolean))]) {
      try {
        const arboles = await arbolesDe(cwd)
        if (!arboles) continue
        const clave = norm(arboles[0].ruta)
        if (vistos.has(clave)) continue
        vistos.add(clave)
        const con = []
        for (const a of arboles) { if (fs.existsSync(a.ruta)) con.push(await estadoDe(a)) }
        repos.push({ raiz: arboles[0].ruta, arboles: con })
      } catch { /* un repo roto no tumba al resto */ }
    }
    return { repos, generado: Date.now() }
  }

  /** Diff de UN archivo cambiado de un árbol conocido. */
  async function diff(cwds, arbolRuta, archivo) {
    if (!arbolRuta || !archivo || typeof archivo !== 'string') return { ok: false, error: 'falta árbol o archivo' }
    const { repos } = await estado(cwds)
    const arbol = repos.flatMap((r) => r.arboles).find((a) => norm(a.ruta) === norm(arbolRuta))
    if (!arbol) return { ok: false, error: 'árbol desconocido' }
    const f = arbol.archivos.find((x) => x.ruta === archivo)
    if (!f) return { ok: false, error: 'el archivo no figura entre los cambios' }
    let texto = ''
    if (f.estado === '?') {
      try {
        const buf = fs.readFileSync(path.join(arbol.ruta, f.ruta))
        texto = `--- /dev/null\n+++ b/${f.ruta}\n` + buf.subarray(0, MAX_DIFF).toString('utf8').split('\n').map((l) => `+${l}`).join('\n')
        if (buf.length > MAX_DIFF) texto += '\n'
        var truncadoNuevo = buf.length > MAX_DIFF
      } catch { return { ok: false, error: 'no se pudo leer el archivo' } }
      return { ok: true, diff: texto, truncado: !!truncadoNuevo }
    }
    const base = (await git(arbol.ruta, ['rev-parse', '--verify', '-q', 'HEAD'])).ok ? ['HEAD'] : []
    const r = await git(arbol.ruta, ['diff', ...base, '--', f.ruta])
    texto = r.out
    const truncado = texto.length > MAX_DIFF
    return { ok: true, diff: truncado ? texto.slice(0, MAX_DIFF) : texto, truncado }
  }

  return { estado, diff }
}
