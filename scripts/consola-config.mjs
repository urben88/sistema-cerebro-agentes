#!/usr/bin/env node
/**
 * Configuracion y estado de la consola del Cerebro.
 *
 * La comparten `scripts/consola.ps1` (Windows) y `scripts/consola.sh` (macOS/Linux),
 * igual que `scripts/instalado.mjs` lo comparten los dos instaladores.
 *
 *   node consola-config.mjs ruta [home]
 *   node consola-config.mjs leer [home]
 *   node consola-config.mjs resolver [home] [--sin-hub] [--sin-panel] [--sin-navegador]
 *                                   [--con-servidor] [--guardar]
 *   node consola-config.mjs estado [home]
 *   node consola-config.mjs guardar-estado [home] <json>
 *   node consola-config.mjs borrar-estado [home]
 *
 * Ficheros (dentro de <home>/.sistema-cerebro-agentes):
 *   consola.json         ajustes del usuario (se conservan entre ejecuciones)
 *   consola-estado.json  estado de la consola en marcha (runtime)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const AJUSTES_POR_DEFECTO = {
  hub: true,          // levantar el Cerebro Hub (Docker o nativo)
  panel: true,        // levantar el panel web de actividad
  navegador: true,    // abrir el navegador al arrancar
  servidor: false,    // levantar el servidor OpenCode V1 (lo arranca el MCP solo)
  puertoHub: 4597,
  puertoPanel: 4598
}

const bool = (v, def) => (v === undefined || v === null ? def : Boolean(v))
const puerto = (v, def) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : def
}

export function dirSistema(home = os.homedir()) {
  return path.join(home, '.sistema-cerebro-agentes')
}
export function rutaAjustes(home = os.homedir()) {
  return path.join(dirSistema(home), 'consola.json')
}
export function rutaEstado(home = os.homedir()) {
  return path.join(dirSistema(home), 'consola-estado.json')
}

/** Ajustes guardados con los valores por defecto de los que falten. */
export function leerAjustes(home = os.homedir()) {
  let guardado = {}
  try {
    guardado = JSON.parse(fs.readFileSync(rutaAjustes(home), 'utf8')) || {}
  } catch { guardado = {} }
  return {
    hub: bool(guardado.hub, AJUSTES_POR_DEFECTO.hub),
    panel: bool(guardado.panel, AJUSTES_POR_DEFECTO.panel),
    navegador: bool(guardado.navegador, AJUSTES_POR_DEFECTO.navegador),
    servidor: bool(guardado.servidor, AJUSTES_POR_DEFECTO.servidor),
    puertoHub: puerto(guardado.puertoHub, AJUSTES_POR_DEFECTO.puertoHub),
    puertoPanel: puerto(guardado.puertoPanel, AJUSTES_POR_DEFECTO.puertoPanel)
  }
}

/** Aplica los indicadores de la linea de comandos encima de lo guardado. */
export function resolverAjustes(home = os.homedir(), flags = {}) {
  const a = leerAjustes(home)
  if (flags.sinHub) a.hub = false
  if (flags.sinPanel) a.panel = false
  if (flags.sinNavegador) a.navegador = false
  if (flags.conServidor) a.servidor = true
  if (flags.sinServidor) a.servidor = false
  return a
}

/** Guarda los ajustes. Devuelve la ruta. */
export function guardarAjustes(home = os.homedir(), ajustes = {}) {
  const limpio = {
    hub: bool(ajustes.hub, AJUSTES_POR_DEFECTO.hub),
    panel: bool(ajustes.panel, AJUSTES_POR_DEFECTO.panel),
    navegador: bool(ajustes.navegador, AJUSTES_POR_DEFECTO.navegador),
    servidor: bool(ajustes.servidor, AJUSTES_POR_DEFECTO.servidor),
    puertoHub: puerto(ajustes.puertoHub, AJUSTES_POR_DEFECTO.puertoHub),
    puertoPanel: puerto(ajustes.puertoPanel, AJUSTES_POR_DEFECTO.puertoPanel)
  }
  const dir = dirSistema(home)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(rutaAjustes(home), JSON.stringify(limpio, null, 2) + '\n', 'utf8')
  return rutaAjustes(home)
}

/** Estado de la consola en marcha. */
export function leerEstado(home = os.homedir()) {
  try {
    return JSON.parse(fs.readFileSync(rutaEstado(home), 'utf8')) || {}
  } catch { return {} }
}
export function guardarEstado(home = os.homedir(), estado = {}) {
  const dir = dirSistema(home)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(rutaEstado(home), JSON.stringify(estado, null, 2) + '\n', 'utf8')
  return rutaEstado(home)
}
export function borrarEstado(home = os.homedir()) {
  try { fs.rmSync(rutaEstado(home), { force: true }) } catch { /* nada */ }
}

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2)
const cmd = args[0] || 'leer'
const home = args[1] && !args[1].startsWith('--') ? args[1] : os.homedir()
const flags = {
  sinHub: args.includes('--sin-hub'),
  sinPanel: args.includes('--sin-panel'),
  sinNavegador: args.includes('--sin-navegador'),
  conServidor: args.includes('--con-servidor'),
  sinServidor: args.includes('--sin-servidor')
}

switch (cmd) {
  case 'ruta':
    console.log(rutaAjustes(home))
    break
  case 'leer':
    console.log(JSON.stringify(leerAjustes(home)))
    break
  case 'resolver': {
    const resueltos = resolverAjustes(home, flags)
    if (args.includes('--guardar')) guardarAjustes(home, resueltos)
    console.log(JSON.stringify(resueltos))
    break
  }
  case 'estado':
    console.log(JSON.stringify(leerEstado(home)))
    break
  case 'guardar-estado': {
    const json = args.slice(2).find(a => !a.startsWith('--')) || '{}'
    let estado = {}
    try { estado = JSON.parse(json) } catch { estado = {} }
    console.log(guardarEstado(home, estado))
    break
  }
  case 'borrar-estado':
    borrarEstado(home)
    console.log('ok')
    break
  default:
    console.error(`Comando desconocido: ${cmd}`)
    process.exit(2)
}
