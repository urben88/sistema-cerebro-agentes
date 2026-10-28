#!/usr/bin/env node
/**
 * Pruebas de cambios pendientes (spec 22 · S3).
 *
 * Monta un repo git real en un directorio temporal (nunca toca el repo de trabajo) con un
 * worktree aparte y comprueba:
 *   · el estado lista los archivos sin commit y el `--stat` del repo de la sesión y de
 *     cada worktree, SIN cargar el diff;
 *   · el diff se pide aparte, solo de un archivo que esté realmente cambiado;
 *   · rutas fuera del árbol, árboles desconocidos y carpetas sin git no rompen nada.
 *
 * Uso: node scripts/test-cambios.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { crearCambios } from '../config/hub/lib/cambios.mjs'

let fallos = 0
async function prueba(nombre, fn) {
  try { await fn(); console.log(`PASA  ${nombre}`) } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cambios-'))
console.log('=== Pruebas de cambios pendientes ===')
console.log(`Temporal: ${raiz}\n`)

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const repo = path.join(raiz, 'repo')
const wt = path.join(raiz, 'repo-wt')
fs.mkdirSync(repo)
git(repo, 'init', '-q', '-b', 'main')
fs.writeFileSync(path.join(repo, 'a.txt'), 'uno\ndos\ntres\n')
fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\n')
git(repo, 'add', '.')
git(repo, 'commit', '-q', '-m', 'inicial')
git(repo, 'worktree', 'add', '-q', '-b', 'rama-sub', wt)
// Cambios sin commit: repo principal (modificado + nuevo) y worktree (modificado).
fs.writeFileSync(path.join(repo, 'a.txt'), 'uno\nDOS\ntres\ncuatro\n')
fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'hola\nmundo\n')
fs.writeFileSync(path.join(wt, 'b.txt'), 'bee\nmas\n')

const c = crearCambios()
const norm = (p) => path.resolve(p).toLowerCase()

await prueba('S3 · lista archivos y --stat del repo y del worktree, sin cargar el diff', async () => {
  const r = await c.estado([repo])
  assert.equal(r.repos.length, 1)
  const arboles = r.repos[0].arboles
  assert.equal(arboles.length, 2)
  const principal = arboles.find((a) => norm(a.ruta) === norm(repo))
  const sub = arboles.find((a) => norm(a.ruta) === norm(wt))
  assert.ok(principal && sub)
  assert.equal(principal.principal, true)
  assert.equal(sub.principal, false)
  assert.equal(sub.rama, 'rama-sub')
  const porRuta = Object.fromEntries(principal.archivos.map((a) => [a.ruta, a]))
  assert.deepEqual(Object.keys(porRuta).sort(), ['a.txt', 'nuevo.txt'])
  assert.equal(porRuta['a.txt'].estado, 'M')
  assert.equal(porRuta['nuevo.txt'].estado, '?')
  assert.equal(porRuta['a.txt'].insertions, 2)
  assert.equal(porRuta['a.txt'].deletions, 1)
  assert.match(principal.stat, /a\.txt/)
  assert.equal(sub.archivos.length, 1)
  assert.equal(sub.archivos[0].ruta, 'b.txt')
  // El diff NO viaja con el estado.
  assert.ok(JSON.stringify(r).indexOf('DOS') === -1)
})

await prueba('S3 · pedir desde el worktree o desde el repo da el mismo repo (una sola entrada)', async () => {
  const r = await c.estado([repo, wt])
  assert.equal(r.repos.length, 1)
})

await prueba('S3 · el diff se carga al abrir un archivo (rastreado y nuevo)', async () => {
  const d1 = await c.diff([repo], repo, 'a.txt')
  assert.equal(d1.ok, true)
  assert.match(d1.diff, /-dos/)
  assert.match(d1.diff, /\+DOS/)
  const d2 = await c.diff([repo], repo, 'nuevo.txt')
  assert.equal(d2.ok, true)
  assert.match(d2.diff, /\+hola/)
  const d3 = await c.diff([repo], wt, 'b.txt')
  assert.match(d3.diff, /\+mas/)
})

await prueba('S3 · rechaza árboles desconocidos, archivos sin cambios y rutas fuera del árbol', async () => {
  assert.equal((await c.diff([repo], raiz, 'a.txt')).ok, false)
  assert.equal((await c.diff([repo], repo, 'b.txt')).ok, false)
  assert.equal((await c.diff([repo], repo, '../repo-wt/b.txt')).ok, false)
  assert.equal((await c.diff([repo], repo, '')).ok, false)
})

await prueba('S3 · carpeta sin git o inexistente: sin repos y sin lanzar', async () => {
  const sinGit = path.join(raiz, 'sin-git'); fs.mkdirSync(sinGit)
  assert.deepEqual((await c.estado([sinGit, path.join(raiz, 'nada')])).repos, [])
  assert.deepEqual((await c.estado([])).repos, [])
})

await prueba('S3 · repo limpio: árbol sin archivos', async () => {
  git(repo, 'checkout', '-q', '--', 'a.txt'); fs.rmSync(path.join(repo, 'nuevo.txt'))
  git(wt, 'checkout', '-q', '--', 'b.txt')
  const r = await c.estado([repo])
  assert.equal(r.repos[0].arboles.every((a) => a.archivos.length === 0), true)
})

try { git(repo, 'worktree', 'remove', '--force', wt) } catch { /* nada */ }
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
