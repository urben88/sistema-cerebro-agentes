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
const comando = (f) => `node "${path.join(hooksDir, f)}"`
s.hooks.SessionStart = [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: comando('session-start.mjs') }] }]
s.hooks.PreCompact = [{ matcher: 'manual|auto', hooks: [{ type: 'command', command: comando('pre-compact.mjs') }] }]
s.hooks.SessionEnd = [{ matcher: 'clear', hooks: [{ type: 'command', command: comando('session-end.mjs') }] }]

// Latidos de actividad (panel «La oficina»): se añaden sin pisar los hooks del usuario
// y sin duplicar si ya estaban registrados (idempotente).
const eventosLatido = ['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop']
const comandoLatido = comando('latido.mjs')
for (const evento of eventosLatido) {
  const grupos = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : []
  const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('latido.mjs')))
  if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: comandoLatido }] })
  s.hooks[evento] = grupos
}

// Guardián de contexto: aviso corto (con enfriamiento) cuando el hilo crece demasiado.
// Se suma a los latidos de UserPromptSubmit sin pisarlos (idempotente).
{
  const grupos = Array.isArray(s.hooks.UserPromptSubmit) ? s.hooks.UserPromptSubmit : []
  const yaEsta = grupos.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('aviso-contexto.mjs')))
  if (!yaEsta) grupos.push({ hooks: [{ type: 'command', command: comando('aviso-contexto.mjs') }] })
  s.hooks.UserPromptSubmit = grupos
}

fs.mkdirSync(path.dirname(ruta), { recursive: true })
fs.writeFileSync(ruta, JSON.stringify(s, null, 2) + '\n')
console.log('settings.json actualizado: esfuerzos medium (si faltaban) y hooks de contexto.')
