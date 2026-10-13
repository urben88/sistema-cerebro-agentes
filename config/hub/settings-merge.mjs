#!/usr/bin/env node
/**
 * Fusiona en ~/.claude/settings.json lo que necesita el sistema:
 *   · modelSettings en «medium» para Sonnet 5/5.5 y Haiku 5.5 (solo si faltan)
 *   · los hooks de contexto (SessionStart, PreCompact, SessionEnd)
 *   · los hooks de latido de actividad (UserPromptSubmit, Stop, SubagentStart, SubagentStop)
 *
 * Uso: node settings-merge.mjs [directorio-de-hooks]
 * Lo llaman install.ps1 e install.sh (el backup lo hace el instalador antes).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const hooksDir = process.argv[2] || path.join(os.homedir(), '.sistema-cerebro-agentes', 'hooks')
const ruta = path.join(os.homedir(), '.claude', 'settings.json')

let s = {}
try { s = JSON.parse(fs.readFileSync(ruta, 'utf8')) } catch { s = {} }
if (typeof s !== 'object' || s === null || Array.isArray(s)) s = {}

s.modelSettings = s.modelSettings || {}
for (const modelo of ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
  if (!s.modelSettings[modelo]) s.modelSettings[modelo] = { effortLevel: 'medium' }
}

s.hooks = s.hooks || {}

/** Ficheros que gestiona el sistema: se registran solo si existen en disco. */
const GESTIONADOS = ['session-start.mjs', 'pre-compact.mjs', 'session-end.mjs', 'cerrar-trabajos.mjs', 'latido.mjs', 'aviso-contexto.mjs']
const existe = (f) => fs.existsSync(path.join(hooksDir, f))
const comando = (f) => `node "${path.join(hooksDir, f)}"`
const faltan = []

// Limpieza: retira registros nuestros que apunten a ficheros que ya no están.
// (Si un hook no se desplegó, mejor no registrarlo que romper cada sesión con un
// MODULE_NOT_FOUND; el instalador copia los hooks antes de llamar aquí.)
for (const evento of Object.keys(s.hooks)) {
  const grupos = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : null
  if (!grupos) continue
  const limpios = grupos.filter((g) => !(Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && GESTIONADOS.some((f) => h.command.includes(f) && !existe(f)))))
  if (limpios.length) s.hooks[evento] = limpios
  else delete s.hooks[evento]
}

function registrarContexto(evento, matcher, archivo) {
  if (!existe(archivo)) { faltan.push(archivo); return }
  s.hooks[evento] = [{ matcher, hooks: [{ type: 'command', command: comando(archivo) }] }]
}
registrarContexto('SessionStart', 'startup|resume|clear|compact', 'session-start.mjs')
registrarContexto('PreCompact', 'manual|auto', 'pre-compact.mjs')
// SessionEnd: checkpoint en /clear + apagado de los trabajos de OpenCode al cerrar
// la sesión (cualquier motivo: prompt_input_exit, logout, other…). El de apagado
// lleva 8 s de presupuesto para abortar las sesiones en el servidor V1.
{
  const grupos = []
  if (existe('session-end.mjs')) grupos.push({ matcher: 'clear', hooks: [{ type: 'command', command: comando('session-end.mjs') }] })
  else faltan.push('session-end.mjs')
  if (existe('cerrar-trabajos.mjs')) grupos.push({ hooks: [{ type: 'command', command: comando('cerrar-trabajos.mjs'), timeout: 8 }] })
  else faltan.push('cerrar-trabajos.mjs')
  if (grupos.length) s.hooks.SessionEnd = grupos
}

// Latidos de actividad (panel «La oficina»): se añaden sin pisar los hooks del usuario
// y sin duplicar si ya estaban registrados (idempotente). Solo si el fichero existe.
if (existe('latido.mjs')) {
  const eventosLatido = ['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop']
  const comandoLatido = comando('latido.mjs')
  for (const evento of eventosLatido) {
    const grupos = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : []
    const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('latido.mjs')))
    if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: comandoLatido }] })
    s.hooks[evento] = grupos
  }
} else faltan.push('latido.mjs')

// Guardián de contexto: aviso corto (con enfriamiento) cuando el hilo crece demasiado.
// Se suma a los latidos de UserPromptSubmit sin pisarlos (idempotente).
if (existe('aviso-contexto.mjs')) {
  const grupos = Array.isArray(s.hooks.UserPromptSubmit) ? s.hooks.UserPromptSubmit : []
  const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('aviso-contexto.mjs')))
  if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: comando('aviso-contexto.mjs') }] })
  s.hooks.UserPromptSubmit = grupos
} else faltan.push('aviso-contexto.mjs')

// Barra de estado: modelo + contexto + trabajo de OpenCode en curso. Se registra
// solo si el usuario no tiene una propia (nunca se pisa la suya); el fichero vive
// en hub/estado-linea.mjs (el instalador copia hub/ antes de llamar aquí).
const estadoLinea = path.join(path.dirname(hooksDir), 'hub', 'estado-linea.mjs')
if (fs.existsSync(estadoLinea)) {
  const actual = s.statusLine
  const esNuestra = actual && typeof actual.command === 'string' && actual.command.includes('estado-linea.mjs')
  if (!actual || esNuestra) {
    s.statusLine = { type: 'command', command: `node "${estadoLinea}"`, refreshInterval: 3 }
  } else {
    console.log('Aviso: ya hay una statusLine propia en settings.json; el indicador del sistema no se activa.')
  }
} else faltan.push('estado-linea.mjs')

fs.mkdirSync(path.dirname(ruta), { recursive: true })
fs.writeFileSync(ruta, JSON.stringify(s, null, 2) + '\n')
console.log('settings.json actualizado: esfuerzos medium (si faltaban) y hooks de contexto.')
if (faltan.length) console.log(`Aviso: hooks no desplegados (no se registran): ${[...new Set(faltan)].join(', ')}. Ejecuta install.ps1/install.sh para copiarlos.`)
