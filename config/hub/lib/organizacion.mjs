/**
 * Vista de organización: quién es quién y con qué modelo y esfuerzo.
 * Lee los agentes de OpenCode (instalados) y los subagentes de Claude Code.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function parseFrontmatter(texto) {
  const m = texto.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const datos = {}
  for (const linea of m[1].split(/\r?\n/)) {
    if (/^\s/.test(linea)) continue
    const i = linea.indexOf(':')
    if (i > 0) {
      const k = linea.slice(0, i).trim()
      const v = linea.slice(i + 1).trim()
      if (k) datos[k] = v
    }
  }
  return datos
}

function leerDir(dir) {
  const lista = []
  let entradas = []
  try { entradas = fs.readdirSync(dir) } catch { return lista }
  for (const nombre of entradas.filter((n) => n.endsWith('.md')).sort()) {
    try {
      const texto = fs.readFileSync(path.join(dir, nombre), 'utf8')
      const fm = parseFrontmatter(texto)
      lista.push({
        nombre: nombre.replace(/\.md$/, ''),
        descripcion: fm.description || '',
        modo: fm.mode || null,
        modelo: fm.model || null,
        variant: fm.variant || null,
      })
    } catch { /* ilegible */ }
  }
  return lista
}

export function crearOrganizacion({ home = os.homedir(), opencodeDir = null, claudeDir = null } = {}) {
  const dirOC = opencodeDir || path.join(home, '.config', 'opencode')
  const dirCC = claudeDir || path.join(home, '.claude')
  function datos() {
    const ocPlural = leerDir(path.join(dirOC, 'agents'))
    const ocSingular = leerDir(path.join(dirOC, 'agent'))
    const opencode = [...ocPlural, ...ocSingular.filter((a) => !ocPlural.some((b) => b.nombre === a.nombre))]
    const claude = leerDir(path.join(dirCC, 'agents'))
    return {
      claude: claude.map((a) => ({ ...a, origen: '~/.claude/agents' })),
      opencode: opencode.map((a) => ({ ...a, origen: '~/.config/opencode/agents' })),
    }
  }
  return { datos }
}
