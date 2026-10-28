#!/usr/bin/env node
/**
 * Fusiona en ~/.claude/settings.json lo que necesita el sistema:
 *   · modelSettings en «medium» para Opus 5.5, Sonnet 5/5.5 y Haiku 5.5 (solo si faltan)
 *   · modelo principal Opus (spec 15: Opus dirige; solo si no hay uno elegido)
 *   · los hooks de contexto (SessionStart, PreCompact, SessionEnd)
 *   · los hooks de latido de actividad (UserPromptSubmit, Stop, SubagentStart, SubagentStop)
 *   · el freno a comandos que fallan en bucle (PostToolUse + PostToolUseFailure, solo Bash)
 *
 * Uso: node settings-merge.mjs [directorio-de-hooks]
 * Lo llaman install.ps1 e install.sh (el backup lo hace el instalador antes).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { hudInstalado, escribirConfigHud, statusLineEsNuestra, comandoHud, RUTA_CONFIG_HUD } from './barra-hud.mjs'

const hooksDir = process.argv[2] || path.join(os.homedir(), '.sistema-cerebro-agentes', 'hooks')
const ruta = path.join(os.homedir(), '.claude', 'settings.json')

let s = {}
try { s = JSON.parse(fs.readFileSync(ruta, 'utf8')) } catch { s = {} }
if (typeof s !== 'object' || s === null || Array.isArray(s)) s = {}

s.modelSettings = s.modelSettings || {}
for (const modelo of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
  if (!s.modelSettings[modelo]) s.modelSettings[modelo] = { effortLevel: 'medium' }
}

// Spec 15 · Opus 5.5 dirige en los dos modos. Si el usuario ya eligió modelo, se respeta.
if (!s.model) s.model = 'opus'

// Advisor: los subagentes (Sonnet/Haiku) heredan a Opus como asesor y lo consultan en los
// puntos de decisión. Solo si falta: si el usuario lo cambió o lo quitó (/advisor), se respeta.
if (s.advisorModel === undefined) s.advisorModel = 'opus'

s.hooks = s.hooks || {}

/** Ficheros que gestiona el sistema: se registran solo si existen en disco. */
const GESTIONADOS = ['session-start.mjs', 'pre-compact.mjs', 'session-end.mjs', 'cerrar-trabajos.mjs', 'latido.mjs', 'aviso-contexto.mjs', 'skills-uso.mjs', 'errores-repetidos.mjs']
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

// Sustituye solo nuestros grupos (los que llaman a un hook GESTIONADO) y conserva los
// ajenos (p. ej. `gentle-ai review stop-hook`), que antes se perdían en cada install.
const esPropio = (g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && GESTIONADOS.some((f) => h.command.includes(f)))
function reemplazarPropios(evento, nuevos) {
  const ajenos = (Array.isArray(s.hooks[evento]) ? s.hooks[evento] : []).filter((g) => !esPropio(g))
  s.hooks[evento] = [...nuevos, ...ajenos]
}

function registrarContexto(evento, matcher, archivo) {
  if (!existe(archivo)) { faltan.push(archivo); return }
  reemplazarPropios(evento, [{ matcher, hooks: [{ type: 'command', command: comando(archivo) }] }])
}
registrarContexto('SessionStart', 'startup|resume|clear|compact', 'session-start.mjs')
registrarContexto('PreCompact', 'manual|auto', 'pre-compact.mjs')
// SessionEnd (cualquier motivo: clear, prompt_input_exit, logout, other…): nota de última
// sesión con Haiku en segundo plano + checkpoint si es /clear (session-end.mjs) y apagado de
// los trabajos de OpenCode. El de apagado lleva 8 s de presupuesto para abortar las sesiones
// en el servidor V1; session-end sale enseguida (el resumen va desacoplado).
{
  const grupos = []
  if (existe('session-end.mjs')) grupos.push({ hooks: [{ type: 'command', command: comando('session-end.mjs'), timeout: 10 }] })
  else faltan.push('session-end.mjs')
  if (existe('cerrar-trabajos.mjs')) grupos.push({ hooks: [{ type: 'command', command: comando('cerrar-trabajos.mjs'), timeout: 8 }] })
  else faltan.push('cerrar-trabajos.mjs')
  if (grupos.length) reemplazarPropios('SessionEnd', grupos)
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

// R5 · contador de uso de skills: se alimenta al terminar el turno (Stop) y al cerrar
// la sesión (SessionEnd), parseando el transcript. Idempotente y sin pisar otros hooks.
if (existe('skills-uso.mjs')) {
  const cmdSkills = comando('skills-uso.mjs')
  const registrarSkillsUso = (evento) => {
    const grupos = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : []
    const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('skills-uso.mjs')))
    if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: cmdSkills }] })
    s.hooks[evento] = grupos
  }
  registrarSkillsUso('Stop')
  registrarSkillsUso('SessionEnd')
} else faltan.push('skills-uso.mjs')

// Guardián de contexto: aviso corto (con enfriamiento) cuando el hilo crece demasiado.
// Se suma a los latidos de UserPromptSubmit sin pisarlos (idempotente).
if (existe('aviso-contexto.mjs')) {
  const grupos = Array.isArray(s.hooks.UserPromptSubmit) ? s.hooks.UserPromptSubmit : []
  const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('aviso-contexto.mjs')))
  if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: comando('aviso-contexto.mjs') }] })
  s.hooks.UserPromptSubmit = grupos
} else faltan.push('aviso-contexto.mjs')

// Freno a bucles de error: avisa cuando el mismo comando de Bash falla 2-3 veces seguidas.
// Va en PostToolUseFailure (comandos con exit ≠ 0) y PostToolUse (éxitos, que reinician el
// contador). Idempotente y sin pisar otros hooks del usuario.
if (existe('errores-repetidos.mjs')) {
  const cmdErrores = comando('errores-repetidos.mjs')
  for (const evento of ['PostToolUse', 'PostToolUseFailure']) {
    const grupos = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : []
    const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('errores-repetidos.mjs')))
    if (!yaEsta) grupos.push({ matcher: 'Bash', hooks: [{ type: 'command', command: cmdErrores }] })
    s.hooks[evento] = grupos
  }
} else faltan.push('errores-repetidos.mjs')

// Barra de estado (spec 15 · O8): claude-hud si el plugin está instalado (hub/hud.mjs le
// añade la línea del sistema: modo y OpenCode); si no, el indicador propio (estado-linea.mjs).
// Nunca se pisa una statusLine del usuario. SIN_CLAUDE_HUD=1 fuerza el indicador propio.
const dirHub = path.join(path.dirname(hooksDir), 'hub')
const estadoLinea = path.join(dirHub, 'estado-linea.mjs')
if (fs.existsSync(estadoLinea)) {
  const actual = s.statusLine
  if (!actual || statusLineEsNuestra(actual)) {
    if (!process.env.SIN_CLAUDE_HUD && hudInstalado() && fs.existsSync(path.join(dirHub, 'hud.mjs'))) {
      const r = escribirConfigHud()
      s.statusLine = { type: 'command', command: comandoHud(dirHub), padding: 0, refreshInterval: 3 }
      console.log(`Barra de estado: claude-hud (configuración ${r === 'propia' ? 'tuya, sin tocar' : 'creada'}: ${RUTA_CONFIG_HUD}).`)
    } else {
      s.statusLine = { type: 'command', command: `node "${estadoLinea}"`, refreshInterval: 3 }
    }
  } else {
    console.log('Aviso: ya hay una statusLine propia en settings.json; el indicador del sistema no se activa.')
  }
} else faltan.push('estado-linea.mjs')

// Mod «mesa de trabajo»: Claude Code lo carga en cada sesión vía
// CLAUDE_CODE_PLUGIN_DIRS (se conserva lo que el usuario tenga ahí).
{
  const dirMod = path.join(path.dirname(hooksDir), 'mods', 'mesa-de-trabajo')
  s.env = (s.env && typeof s.env === 'object') ? s.env : {}
  const actual = typeof s.env.CLAUDE_CODE_PLUGIN_DIRS === 'string' ? s.env.CLAUDE_CODE_PLUGIN_DIRS : ''
  const partes = actual.split(path.delimiter).map((p) => p.trim()).filter(Boolean)
  const otros = partes.filter((p) => p.toLowerCase() !== dirMod.toLowerCase())
  if (fs.existsSync(dirMod)) {
    otros.push(dirMod)
    s.env.CLAUDE_CODE_PLUGIN_DIRS = otros.join(path.delimiter)
  } else {
    if (otros.length) s.env.CLAUDE_CODE_PLUGIN_DIRS = otros.join(path.delimiter)
    else delete s.env.CLAUDE_CODE_PLUGIN_DIRS
    if (!Object.keys(s.env).length) delete s.env
    faltan.push('mods/mesa-de-trabajo')
  }
}

fs.mkdirSync(path.dirname(ruta), { recursive: true })
fs.writeFileSync(ruta, JSON.stringify(s, null, 2) + '\n')
console.log(`settings.json actualizado: modelo ${s.model}, advisor ${s.advisorModel || 'off'}, esfuerzos medium (si faltaban) y hooks de contexto.`)
if (faltan.length) console.log(`Aviso: hooks no desplegados (no se registran): ${[...new Set(faltan)].join(', ')}. Ejecuta install.ps1/install.sh para copiarlos.`)
