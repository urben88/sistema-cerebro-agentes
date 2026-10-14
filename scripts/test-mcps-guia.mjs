#!/usr/bin/env node
/**
 * Pruebas de la guía de uso de MCPs (spec 13 · `docs/specs/13-guia-de-uso-de-mcps.md`, N1–N4).
 *
 * Sin dependencias (solo `node:assert`). Trabaja SIEMPRE en un directorio temporal: copia
 * `config/hub/mcps.mjs` a un `hub/` propio, apunta `HUB_DATA_DIR`/`OPENCODE_DIR`/`CLAUDE_DIR`
 * al temporal y deja un `claude` de mentira (que falla) para que el inventario sea hermoso y
 * determinista. Nunca toca el `hub-data` real, ni la configuración de ningún MCP, ni `MCPS.md`.
 *
 * Comprueba:
 *   · N1 · la plantilla existe, cabe en 4000 caracteres y trae las secciones y MCPs pedidos;
 *   · N2 · la primera ejecución crea `MCPS-GUIA.md`; editar la guía y re-ejecutar NO la pisa;
 *     `--forzar-guia` sí la regenera; `MCPS.md` es idéntico con y sin guía;
 *   · N3 · `resumenGuia` extrae la tabla + reglas, respeta el tope (1200) y es vacío sin guía;
 *   · N3/N4 · los agentes indicados apuntan a `MCPS-GUIA.md` (y `local-codigo` no).
 *
 * Uso: node scripts/test-mcps-guia.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resumenGuia, LIMITE_RESUMEN } from '../config/hooks/mcps-guia.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const MCPS_SRC = path.join(REPO, 'config', 'hub', 'mcps.mjs')
const PLANTILLA_SRC = path.join(REPO, 'config', 'hub', 'plantillas', 'mcps-guia.md')

let fallos = 0
function prueba(nombre, fn) {
  try {
    fn()
    console.log(`PASA  ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

// ---------------------------------------------------------------- montaje temporal
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-mcps-guia-'))
const hubDir = path.join(raiz, 'hub')
const plantillasDir = path.join(hubDir, 'plantillas')
fs.mkdirSync(plantillasDir, { recursive: true })
fs.copyFileSync(MCPS_SRC, path.join(hubDir, 'mcps.mjs'))
fs.copyFileSync(PLANTILLA_SRC, path.join(plantillasDir, 'mcps-guia.md'))

const dataDir = path.join(raiz, 'hub-data')
const ocDir = path.join(raiz, 'opencode')
const claudeDir = path.join(raiz, 'claude')
fs.mkdirSync(ocDir, { recursive: true })
fs.mkdirSync(claudeDir, { recursive: true })

// `claude` de mentira que falla: así `claude mcp list` no mete ruido ni depende de la máquina.
const binDir = path.join(raiz, 'bin')
fs.mkdirSync(binDir, { recursive: true })
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nexit /b 1\r\n')
} else {
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
}

const env = { ...process.env, SISTEMA_CEREBRO_DIR: raiz, HUB_DATA_DIR: dataDir, OPENCODE_DIR: ocDir, CLAUDE_DIR: claudeDir }
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
env[pathKey] = binDir + path.delimiter + (env[pathKey] || '')

const guiaDst = path.join(dataDir, 'memoria', 'global', 'MCPS-GUIA.md')
const mcpsMd = path.join(dataDir, 'memoria', 'global', 'MCPS.md')
const mcpsJson = path.join(dataDir, 'mcps.json')

function ejecutarMcps(args = []) {
  return spawnSync(process.execPath, [path.join(hubDir, 'mcps.mjs'), ...args], { cwd: hubDir, env, encoding: 'utf8' })
}
// El inventario lleva la hora de generación: se normaliza para comparar dos ejecuciones.
const normalizarMcps = (t) => t.replace(/· \d{4}-\d\d-\d\dT[^·]+·/, '· <ts> ·')

console.log(`=== Pruebas de la guía de uso de MCPs ===`)
console.log(`Temporal: ${raiz}\n`)

// ---------------------------------------------------------------- N1
prueba('N1 · la plantilla existe, cabe en 4000 chars y trae las secciones y MCPs pedidos', () => {
  const g = fs.readFileSync(PLANTILLA_SRC, 'utf8')
  assert.ok(g.length <= 4000, `la plantilla tiene ${g.length} caracteres (> 4000)`)
  assert.ok(g.includes('Si necesitas X → usa Y'), 'falta la tabla «Si necesitas X → usa Y»')
  for (const mcp of ['context7', 'web-search', 'playwright', 'claude-in-chrome', 'github', 'ssh', 'pieces', 'agentation', 'opencode', 'triaje']) {
    assert.ok(g.includes('`' + mcp + '`'), `falta el MCP ${mcp}`)
  }
  for (const etiqueta of ['Úsalo cuando', 'No lo uses para', 'Ejemplo', 'Herramientas']) {
    assert.ok(g.includes(etiqueta), `falta la etiqueta «${etiqueta}»`)
  }
  assert.ok(g.includes('## Reglas'), 'falta la sección de reglas')
})

// ---------------------------------------------------------------- N2
prueba('N2 · la primera ejecución crea MCPS.md, mcps.json y MCPS-GUIA.md', () => {
  const r = ejecutarMcps()
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(mcpsMd), 'falta MCPS.md')
  assert.ok(fs.existsSync(mcpsJson), 'falta mcps.json')
  assert.ok(fs.existsSync(guiaDst), 'falta MCPS-GUIA.md')
  assert.equal(fs.readFileSync(guiaDst, 'utf8'), fs.readFileSync(PLANTILLA_SRC, 'utf8'), 'la guía debía ser copia de la plantilla')
})

prueba('N2 · re-ejecutar NO pisa la guía editada, y MCPS.md es idéntico', () => {
  fs.appendFileSync(guiaDst, '\n<!-- EDITADO POR EL USUARIO -->\n')
  const antes = normalizarMcps(fs.readFileSync(mcpsMd, 'utf8'))
  const r = ejecutarMcps()
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.readFileSync(guiaDst, 'utf8').includes('EDITADO POR EL USUARIO'), 'la copia no debía pisar la edición del usuario')
  assert.equal(normalizarMcps(fs.readFileSync(mcpsMd, 'utf8')), antes, 'MCPS.md debía quedar idéntico')
})

prueba('N2 · --forzar-guia regenera la guía desde la plantilla', () => {
  const r = ejecutarMcps(['--forzar-guia'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(guiaDst, 'utf8'), fs.readFileSync(PLANTILLA_SRC, 'utf8'))
  assert.ok(!fs.readFileSync(guiaDst, 'utf8').includes('EDITADO POR EL USUARIO'), '--forzar-guia debía regenerar')
})

prueba('N2 · MCPS.md es idéntico con y sin guía (plantilla ausente → no se crea guía)', () => {
  const conGuia = normalizarMcps(fs.readFileSync(mcpsMd, 'utf8'))
  fs.rmSync(guiaDst, { force: true })
  fs.rmSync(path.join(plantillasDir, 'mcps-guia.md'), { force: true })
  const r = ejecutarMcps()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.existsSync(guiaDst), false, 'sin plantilla no debía crearse la guía')
  assert.equal(normalizarMcps(fs.readFileSync(mcpsMd, 'utf8')), conGuia, 'MCPS.md debía ser idéntico con y sin guía')
  fs.copyFileSync(PLANTILLA_SRC, path.join(plantillasDir, 'mcps-guia.md'))
})

// ---------------------------------------------------------------- N3
prueba('N3 · resumenGuia extrae la tabla y las reglas, respeta el tope y es vacío sin guía', () => {
  assert.equal(resumenGuia(''), '')
  assert.equal(resumenGuia(null), '')
  assert.equal(resumenGuia('   \n  '), '')
  const r = resumenGuia(fs.readFileSync(PLANTILLA_SRC, 'utf8'))
  assert.ok(r.length > 0, 'debía haber resumen')
  assert.ok(r.length <= LIMITE_RESUMEN, `${r.length} > ${LIMITE_RESUMEN}`)
  assert.ok(r.includes('| Necesitas | Usa |'), 'falta la tabla')
  assert.ok(r.includes('context7'), 'la tabla debía nombrar context7')
  assert.ok(r.includes('Reglas:') && r.includes('no se puede'), 'faltan las 3 reglas')
  // Un texto que pase del tope se recorta y sigue respetando el límite.
  const filas = Array.from({ length: 200 }, (_, i) => `| fila ${i} con relleno xxxxxxxxxxxxxxxxxxxx | cosa |`).join('\n')
  const larga = resumenGuia(`| Necesitas | Usa |\n${filas}\n## Reglas\n1. una regla larga`)
  assert.ok(larga.length <= LIMITE_RESUMEN, `recorte ${larga.length} > ${LIMITE_RESUMEN}`)
})

// ---------------------------------------------------------------- N3/N4
prueba('N3/N4 · los agentes indicados apuntan a MCPS-GUIA.md y local-codigo no', () => {
  const apuntan = [
    'config/claude/CLAUDE.md',
    'config/claude/agents/cerebro.md',
    'config/claude/agents/explorador.md',
    'config/claude/agents/analista.md',
    'config/opencode/agents/explorador-ds.md',
    'config/opencode/agents/implementador.md',
    'config/opencode/agents/debugger.md',
    'config/opencode/agents/redactor-ds.md',
    'config/opencode/agents/revisor.md',
    'config/opencode/agents/cerebro-oc.md',
  ]
  for (const f of apuntan) {
    assert.ok(fs.readFileSync(path.join(REPO, f), 'utf8').includes('MCPS-GUIA.md'), `${f} no apunta a MCPS-GUIA.md`)
  }
  assert.ok(!fs.readFileSync(path.join(REPO, 'config/opencode/agents/local-codigo.md'), 'utf8').includes('MCPS-GUIA.md'), 'local-codigo no debía mencionarla')
})

// ---------------------------------------------------------------- limpieza
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }

console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
