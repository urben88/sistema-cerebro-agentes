#!/usr/bin/env node
/**
 * Fusiona permisos prudentes en settings.json de Claude (spec 21 · S5).
 *
 * Uso: node permisos.mjs [ruta-settings.json]   (por defecto ~/.claude/settings.json)
 *
 *   · allow: lectura, git de solo lectura, tests y lint
 *   · ask:   git push, instalaciones de paquetes y borrado recursivo
 *   · deny:  leer y editar credenciales de Claude y ~/.ssh (forma ~/ y forma absoluta)
 *
 * Idempotente: une las listas sin duplicar, no quita nada y no toca defaultMode
 * ni ninguna otra clave. Lo llaman install.ps1 e install.sh después de settings-merge.
 *
 * Limitación: Bash(prefijo:*) casa solo al inicio del comando, así que
 * `Remove-Item -Recurse` no se detecta si va dentro de otro comando (p. ej. tras `;`).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ruta = process.argv[2] || path.join(os.homedir(), '.claude', 'settings.json')
const home = process.env.PERMISOS_HOME || os.homedir()

/** C:\Users\x → /c/Users/x (forma POSIX que usa Claude Code en Windows). */
function posix(p) {
  const q = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const m = /^([A-Za-z]):(\/.*)?$/.exec(q)
  return m ? `/${m[1].toLowerCase()}${m[2] || ''}` : q
}
// En el formato de permisos, `~/` es el home y `//ruta` es absoluta desde la raíz.
const absoluta = (rel) => `/${posix(home)}/${rel}`

const SENSIBLES = ['.claude/.credentials.json', '.claude.json', '.ssh/**']
const deny = []
for (const rel of SENSIBLES) {
  for (const herramienta of ['Read', 'Edit']) {
    deny.push(`${herramienta}(~/${rel})`, `${herramienta}(${absoluta(rel)})`)
  }
}

const PERMISOS = {
  allow: [
    'Read', 'Glob', 'Grep',
    'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
    'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run lint:*)',
    'Bash(pytest:*)', 'Bash(go test:*)', 'Bash(cargo test:*)',
  ],
  ask: [
    'Bash(git push:*)',
    'Bash(npm install:*)', 'Bash(pip install:*)', 'Bash(pip3 install:*)',
    'Bash(winget:*)', 'Bash(choco:*)',
    'Bash(rm -r:*)', 'Bash(rm -fr:*)', 'Bash(Remove-Item -Recurse:*)',
  ],
  deny,
}

let s = {}
try { s = JSON.parse(fs.readFileSync(ruta, 'utf8')) } catch { s = {} }
if (typeof s !== 'object' || s === null || Array.isArray(s)) s = {}
if (typeof s.permissions !== 'object' || s.permissions === null || Array.isArray(s.permissions)) s.permissions = {}

const anadidos = {}
for (const [lista, reglas] of Object.entries(PERMISOS)) {
  const actual = Array.isArray(s.permissions[lista]) ? s.permissions[lista] : []
  const nuevas = reglas.filter((r) => !actual.includes(r))
  s.permissions[lista] = [...actual, ...nuevas]
  anadidos[lista] = nuevas.length
}

// `gentle-ai install` sube defaultMode a bypassPermissions. El instalador guarda el modo
// previo en MODO_PREVIO (`(ninguno)` si no había) y aquí se devuelve, sin tocar otro caso.
const previo = process.env.MODO_PREVIO
let restaurado = ''
if (previo && previo !== 'bypassPermissions' && s.permissions.defaultMode === 'bypassPermissions') {
  if (previo === '(ninguno)') delete s.permissions.defaultMode
  else s.permissions.defaultMode = previo
  restaurado = `; defaultMode devuelto a ${previo}`
}

fs.mkdirSync(path.dirname(ruta), { recursive: true })
fs.writeFileSync(ruta, JSON.stringify(s, null, 2) + '\n')
console.log(`Permisos: +${anadidos.allow} allow, +${anadidos.ask} ask, +${anadidos.deny} deny (lo existente, sin tocar${restaurado}).`)
