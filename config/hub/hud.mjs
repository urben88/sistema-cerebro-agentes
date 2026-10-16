#!/usr/bin/env node
/**
 * Barra de estado con claude-hud (spec 15 · O8) — https://github.com/jarrodwatts/claude-hud
 *
 * Lanza la versión más nueva instalada del plugin claude-hud (como su propio launcher) y le
 * añade la línea del sistema con `--extra-cmd`: `estado-linea.mjs --widget` (modo normal/
 * cerebro, trabajo de OpenCode, subagentes y conteo por modelo; además empuja el estado al
 * panel). Si claude-hud no está instalado, cae al indicador propio para no dejar la barra vacía.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const estadoLinea = path.join(aqui, 'estado-linea.mjs')

// Claude Code deja 2 columnas de margen a cada lado.
const columnas = Number.parseInt(process.env.COLUMNS ?? '', 10)
if (columnas > 0) process.env.COLUMNS = String(Math.max(1, columnas - 4))

const dirEnv = process.env.CLAUDE_CONFIG_DIR?.trim()
const dirClaude = dirEnv ? (dirEnv === '~' || dirEnv.startsWith('~/') ? path.join(os.homedir(), dirEnv.slice(1)) : dirEnv) : path.join(os.homedir(), '.claude')
const cache = path.join(dirClaude, 'plugins', 'cache')
const listar = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
const version = (n) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(n)?.slice(1).map(Number)
const comparar = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

let ultima = null
for (const mercado of listar(cache)) {
  const dir = path.join(cache, mercado, 'claude-hud')
  for (const n of listar(dir)) {
    const v = version(n)
    const f = path.join(dir, n, 'dist', 'index.js')
    if (v && (!ultima || comparar(v, ultima.v) > 0) && fs.existsSync(f)) ultima = { v, f }
  }
}

/** Lee el JSON de Claude una vez (claude-hud y el widget lo necesitan los dos). */
function leerEntrada() {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res('')
    let d = ''
    const fin = () => res(d)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', fin)
    process.stdin.on('error', fin)
    setTimeout(fin, 400)
  })
}

if (ultima && !process.env.SIN_CLAUDE_HUD) {
  // `--extra-cmd` no recibe stdin: el widget lee el mismo JSON de CEREBRO_BARRA_DATOS.
  const entrada = await leerEntrada()
  if (entrada.length < 30000) process.env.CEREBRO_BARRA_DATOS = entrada
  const repetida = new PassThrough()
  repetida.end(entrada)
  Object.defineProperty(process, 'stdin', { value: repetida, configurable: true })
  process.env.CLAUDE_HUD_ALLOW_EXTRA_CMD = '1'
  process.argv.push('--extra-cmd', `node "${estadoLinea}" --widget`)
  const hud = await import(pathToFileURL(ultima.f).href)
  await hud.main()
} else {
  await import(pathToFileURL(estadoLinea).href)
}
