/**
 * Barra de estado con claude-hud (spec 15 · O8) — https://github.com/jarrodwatts/claude-hud
 *
 * claude-hud es la barra más recomendada por la comunidad: modelo, carpeta y git; barra de
 * contexto y cuota con reinicio; y, activadas aquí, herramientas en curso, subagentes,
 * tareas, coste, duración y esfuerzo. La línea del sistema (modo y OpenCode) la añade
 * `hud.mjs` con `--extra-cmd`.
 *
 * La configuración de claude-hud (~/.claude/plugins/claude-hud/config.json) solo se escribe
 * si no existe: lo que el usuario cambie con `/claude-hud:configure` se respeta.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const RUTA_CONFIG_HUD = path.join(os.homedir(), '.claude', 'plugins', 'claude-hud', 'config.json')
const CACHE = path.join(os.homedir(), '.claude', 'plugins', 'cache')

/** ¿Hay alguna versión de claude-hud instalada como plugin? */
export function hudInstalado(cache = CACHE) {
  const listar = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
  return listar(cache).some((m) => listar(path.join(cache, m, 'claude-hud')).some((v) => fs.existsSync(path.join(cache, m, 'claude-hud', v, 'dist', 'index.js'))))
}

/** ¿El `statusLine` de Claude es del sistema (indicador propio, claude-hud vía hud.mjs o el ccstatusline de 0.9.0)? */
export function statusLineEsNuestra(actual) {
  const cmd = actual && typeof actual.command === 'string' ? actual.command.trim() : ''
  return /estado-linea\.mjs|[\\/]hub[\\/]hud\.(mjs|cmd)/.test(cmd) || /^(npx -y |bunx -y )?ccstatusline(@[\w.]+)?$/.test(cmd)
}

/**
 * Comando de la barra. En Windows con Git Bash, Claude lanza la barra por bash: se pasa por
 * cmd.exe (hud.cmd) para no dejar procesos node.exe suspendidos (lo mismo que hace claude-hud).
 */
export function comandoHud(dirHub, plataforma = process.platform) {
  const mjs = path.join(dirHub, 'hud.mjs')
  if (plataforma !== 'win32') return `node "${mjs}"`
  const hayGit = spawnSync('where', ['git'], { windowsHide: true }).status === 0
  return hayGit ? `exec "${path.join(dirHub, 'hud.cmd').replace(/\\/g, '/')}"` : `node "${mjs}"`
}

export const CONFIG_HUD = {
  lineLayout: 'expanded',
  pathLevels: 2,
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true, showFileStats: false },
  display: {
    showModel: true,
    showProject: true,
    showContextBar: true,
    showUsage: true,
    showCost: true,
    showDuration: true,
    showEffortLevel: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
  },
}

/** Escribe la configuración de claude-hud solo si no existe. */
export function escribirConfigHud(ruta = RUTA_CONFIG_HUD) {
  if (fs.existsSync(ruta)) return 'propia'
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  fs.writeFileSync(ruta, JSON.stringify(CONFIG_HUD, null, 2) + '\n')
  return 'creada'
}
