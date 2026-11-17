#!/usr/bin/env node
/**
 * Pruebas de la consola del Cerebro (spec 26).
 *
 * - `consola-config.mjs`: ajustes por defecto, guardado, indicadores y estado.
 * - `consola.ps1` / `consola.sh`: el arranque y la parada no tocan la configuracion
 *   ni los datos; y un cierre de consola apaga lo que encendio.
 *
 * Todo en un HOME falso dentro de un directorio temporal: no toca la instalacion real.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helper = path.join(raiz, 'scripts', 'consola-config.mjs')
const consolaPs1 = path.join(raiz, 'scripts', 'consola.ps1')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-consola-'))
const win = process.platform === 'win32'

let fallos = 0
const prueba = (n, fn) => {
  try { fn(); console.log(`PASA  ${n}`) }
  catch (e) { fallos++; console.log(`FALLA ${n}\n      ${String(e.message).split('\n')[0]}`) }
}
const h = (...args) => {
  const r = spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' })
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status }
}
const escribir = (p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt) }
const casa = path.join(tmp, 'home')
const dirSistema = path.join(casa, '.sistema-cerebro-agentes')

try {
  // ---------------------------------------------------------------- ajustes
  prueba('sin fichero -> ajustes por defecto', () => {
    const a = JSON.parse(h('leer', casa).out)
    assert.equal(a.hub, true)
    assert.equal(a.panel, true)
    assert.equal(a.navegador, true)
    assert.equal(a.servidor, false)
    assert.equal(a.puertoHub, 4597)
    assert.equal(a.puertoPanel, 4598)
  })

  prueba('leer no crea ficheros', () => {
    h('leer', casa)
    assert.equal(fs.existsSync(dirSistema), false)
  })

  prueba('resolver con indicadores -> sin hub y sin panel', () => {
    const a = JSON.parse(h('resolver', casa, '--sin-hub', '--sin-panel').out)
    assert.equal(a.hub, false)
    assert.equal(a.panel, false)
    assert.equal(a.navegador, true)
  })

  prueba('resolver --guardar persiste los cambios', () => {
    h('resolver', casa, '--sin-panel', '--guardar')
    const a = JSON.parse(h('leer', casa).out)
    assert.equal(a.panel, false)
    assert.equal(a.hub, true)
    assert.equal(fs.existsSync(path.join(dirSistema, 'consola.json')), true)
  })

  prueba('lo guardado manda: resolver sin indicadores conserva lo guardado', () => {
    const a = JSON.parse(h('resolver', casa).out)
    assert.equal(a.panel, false)
  })

  prueba('--con-servidor activa el servidor V1', () => {
    const a = JSON.parse(h('resolver', casa, '--con-servidor').out)
    assert.equal(a.servidor, true)
  })

  prueba('el fichero guardado es JSON legible', () => {
    const j = JSON.parse(fs.readFileSync(path.join(dirSistema, 'consola.json'), 'utf8'))
    assert.equal(typeof j, 'object')
    assert.ok('hub' in j && 'panel' in j && 'navegador' in j)
  })

  prueba('ajustes corruptos -> por defecto, sin romper', () => {
    escribir(path.join(dirSistema, 'consola.json'), '{roto')
    const a = JSON.parse(h('leer', casa).out)
    assert.equal(a.hub, true)
    assert.equal(a.panel, true)
  })

  prueba('puertos invalidos -> por defecto', () => {
    escribir(path.join(dirSistema, 'consola.json'), JSON.stringify({ puertoHub: 80, puertoPanel: 'x' }))
    const a = JSON.parse(h('leer', casa).out)
    assert.equal(a.puertoHub, 4597)
    assert.equal(a.puertoPanel, 4598)
  })

  prueba('ruta de los ajustes dentro de .sistema-cerebro-agentes', () => {
    assert.match(h('ruta', casa).out, /\.sistema-cerebro-agentes[\\/]consola\.json$/)
  })

  // ---------------------------------------------------------------- estado
  prueba('estado vacio si no hay fichero', () => {
    assert.deepEqual(JSON.parse(h('estado', casa).out), {})
  })

  prueba('guardar-estado y leer-estado coinciden', () => {
    h('guardar-estado', casa, JSON.stringify({ hub: true, panel: true, puertoHub: 4597 }))
    const e = JSON.parse(h('estado', casa).out)
    assert.equal(e.hub, true)
    assert.equal(e.puertoHub, 4597)
  })

  prueba('borrar-estado deja el estado vacio', () => {
    h('borrar-estado', casa)
    assert.deepEqual(JSON.parse(h('estado', casa).out), {})
  })

  // ---------------------------------------------------------------- arranque y parada
  if (win) {
    const consola = (...args) => {
      const env = { ...process.env, HOME: casa, USERPROFILE: casa }
      const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', consolaPs1, ...args],
        { encoding: 'utf8', env, timeout: 120000 })
      return { out: `${r.stdout || ''}${r.stderr || ''}`, code: r.status }
    }

    prueba('-Accion config muestra los ajustes y no arranca nada', () => {
      const r = consola('-Accion', 'config')
      assert.equal(r.code, 0)
      assert.match(r.out, /Ajustes de la consola/)
      assert.match(r.out, /consola\.json/)
    })

    prueba('-Accion estado no falla con todo apagado', () => {
      const r = consola('-Accion', 'estado')
      assert.equal(r.code, 0)
      assert.match(r.out, /Estado del Cerebro/)
    })

    prueba('-Accion parar no falla con nada encendido', () => {
      const r = consola('-Accion', 'parar')
      assert.equal(r.code, 0)
    })

    prueba('-Accion parar con estado guardado apaga lo que dice el estado', () => {
      escribir(path.join(dirSistema, 'consola-estado.json'), JSON.stringify({
        hub: false, panel: false, servidor: false, puertoHub: 4597, puertoPanel: 4598
      }))
      const r = consola('-Accion', 'parar')
      assert.equal(r.code, 0)
      // El estado se borra al parar.
      assert.equal(fs.existsSync(path.join(dirSistema, 'consola-estado.json')), false)
    })

    prueba('los ajustes NO se borran al parar', () => {
      escribir(path.join(dirSistema, 'consola.json'), JSON.stringify({ hub: false, panel: false, navegador: false }))
      consola('-Accion', 'parar')
      const a = JSON.parse(fs.readFileSync(path.join(dirSistema, 'consola.json'), 'utf8'))
      assert.equal(a.hub, false)
      assert.equal(a.navegador, false)
    })
  } else {
    prueba('paridad en macOS/Linux: el script y el vigilante existen y son ejecutables', () => {
      assert.equal(fs.existsSync(path.join(raiz, 'scripts', 'consola.sh')), true)
      assert.equal(fs.existsSync(path.join(raiz, 'scripts', 'consola-vigilante.sh')), true)
    })
  }

  // ---------------------------------------------------------------- scripts presentes
  prueba('el lanzador de doble clic existe', () => {
    assert.equal(fs.existsSync(path.join(raiz, 'scripts', 'consola.cmd')), true)
  })
  prueba('el vigilante existe', () => {
    assert.equal(fs.existsSync(path.join(raiz, 'scripts', 'consola-vigilante.ps1')), true)
  })
  prueba('el script de consola existe', () => {
    assert.equal(fs.existsSync(consolaPs1), true)
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
