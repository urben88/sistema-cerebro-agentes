#!/usr/bin/env node
/**
 * Descubrimiento de MCPs — inventario GENÉRICO de los servidores MCP disponibles
 * en esta máquina, sin listar nada a mano (funciona con los que tengas ahora y
 * con los que instales en el futuro).
 *
 * Fuentes:
 *   · OpenCode: sección `mcp` de ~/.config/opencode/opencode.jsonc (JSONC tolerante)
 *   · Claude Code: `mcpServers` inline de los agentes de ~/.claude/agents/*.md
 *     y `claude mcp list` (registro global)
 *
 * Salidas (fuera de tus repos):
 *   · hub-data/mcps.json               (datos para el panel y la API)
 *   · hub-data/memoria/global/MCPS.md  (inventario legible + prioridad de uso)
 *
 * Uso: node mcps.mjs [--print]
 * Re-ejecútalo cuando instales o quites MCPs (o deja que lo haga `adaptador-mcps`).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

const HOME = os.homedir()
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(HOME, '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const OPENCODE_DIR = process.env.OPENCODE_DIR || path.join(HOME, '.config', 'opencode')
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(HOME, '.claude')

// Capacidades por patrón (genérico y ampliable: se añaden patrones, no servidores)
const CAPACIDADES = [
  { claves: ['web-search', 'websearch', 'search', 'brave', 'tavily', 'searx', 'duckduckgo', 'perplexity'], capacidad: 'búsqueda web' },
  { claves: ['context7', 'docs', 'documentation', 'ref'], capacidad: 'documentación de librerías' },
  { claves: ['github', 'gitlab', 'gitea', 'git'], capacidad: 'repositorios y código remoto' },
  { claves: ['playwright', 'browser', 'puppeteer', 'chrome', 'firefox'], capacidad: 'navegador web' },
  { claves: ['ssh', 'remote'], capacidad: 'acceso a servidores' },
  { claves: ['pieces', 'basic-memory', 'mem-persistence', 'memory'], capacidad: 'memoria' },
  { claves: ['agentation', 'annotation'], capacidad: 'anotaciones de UI' },
  { claves: ['triaje'], capacidad: 'triaje local' },
  { claves: ['filesystem', 'files'], capacidad: 'ficheros' },
  { claves: ['postgres', 'mysql', 'sqlite', 'database', 'mongo', 'redis'], capacidad: 'bases de datos' },
  { claves: ['slack', 'discord', 'telegram', 'mail', 'email'], capacidad: 'comunicación' },
  { claves: ['notion', 'obsidian', 'jira', 'linear', 'confluence'], capacidad: 'gestión del conocimiento' },
  { claves: ['docker', 'kubernetes', 'k8s'], capacidad: 'infraestructura' },
  { claves: ['fetch', 'http'], capacidad: 'peticiones web' },
]

function parseJsonc(texto) {
  let out = ''
  let enCadena = false
  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    if (enCadena) {
      out += c
      if (c === '\\') { out += texto[i + 1] ?? ''; i += 2; continue }
      if (c === '"') enCadena = false
      i++
      continue
    }
    if (c === '"') { enCadena = true; out += c; i++; continue }
    if (c === '/' && texto[i + 1] === '/') { while (i < texto.length && texto[i] !== '\n') i++; continue }
    if (c === '/' && texto[i + 1] === '*') { i += 2; while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) i++; i += 2; continue }
    out += c
    i++
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function leerOpencode() {
  const lista = []
  try {
    const j = parseJsonc(fs.readFileSync(path.join(OPENCODE_DIR, 'opencode.jsonc'), 'utf8'))
    for (const [nombre, cfg] of Object.entries(j.mcp || {})) {
      lista.push({
        nombre,
        origen: 'OpenCode',
        tipo: cfg.type || 'local',
        habilitado: cfg.enabled !== false,
        detalle: Array.isArray(cfg.command) ? cfg.command.join(' ') : (cfg.url || ''),
      })
    }
  } catch { /* sin configuración legible */ }
  return lista
}

function leerClaude() {
  const encontrados = new Map()
  try {
    const dir = path.join(CLAUDE_DIR, 'agents')
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const t = fs.readFileSync(path.join(dir, f), 'utf8')
      const m = t.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
      if (!m || !m[1].includes('mcpServers:')) continue
      const bloque = m[1].split('mcpServers:')[1]
      for (const linea of bloque.split('\n')) {
        const mm = linea.match(/^\s*-\s*([a-zA-Z0-9._-]+):\s*$/)
        if (mm && !encontrados.has(mm[1])) encontrados.set(mm[1], { nombre: mm[1], origen: `Claude (inline en ${f.replace('.md', '')})`, tipo: 'stdio', habilitado: true, detalle: '' })
      }
    }
  } catch { /* sin agentes */ }
  try {
    const out = execSync('claude mcp list', { timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    for (const linea of out.split(/\r?\n/)) {
      const mm = linea.match(/^([a-zA-Z0-9._-]+):/)
      if (mm && !encontrados.has(mm[1])) {
        encontrados.set(mm[1], { nombre: mm[1], origen: 'Claude (registro global)', tipo: 'stdio', habilitado: true, detalle: linea.trim() })
      }
    }
  } catch { /* sin CLI de Claude o sin MCPs globales */ }
  return [...encontrados.values()]
}

function capacidadDe(nombre, detalle = '') {
  const t = `${nombre} ${detalle}`.toLowerCase()
  const cats = new Set()
  for (const c of CAPACIDADES) if (c.claves.some((k) => t.includes(k))) cats.add(c.capacidad)
  return cats.size ? [...cats] : ['general']
}

const lista = [...leerOpencode(), ...leerClaude()]
  .map((m) => ({ ...m, capacidades: capacidadDe(m.nombre, m.detalle) }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre))

const datos = { generado: new Date().toISOString(), total: lista.length, mcps: lista }
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'mcps.json'), JSON.stringify(datos, null, 2) + '\n')

const guia = [
  '# MCPs disponibles (inventario automático)',
  '',
  `> Generado por \`hub/mcps.mjs\` · ${datos.generado} · ${datos.total} servidores.`,
  '> Re-ejecútalo cuando instales o quites MCPs (o invoca al agente `adaptador-mcps`).',
  '',
  '| MCP | Origen | Capacidad | Detalle |',
  '|---|---|---|---|',
  ...lista.map((m) => `| \`${m.nombre}\` | ${m.origen} | ${m.capacidades.join(', ')} | ${String(m.detalle || '').slice(0, 70)} |`),
  '',
  '## Prioridad de uso (genérico)',
  '',
  '- **Usa los MCPs siempre que aporten** antes de asumir que algo no se puede hacer: búsqueda web, documentación de librerías (context7), repos remotos (github), servidores (ssh), navegador (playwright)…',
  '- **Exploradores**: si el encargo pide datos externos (web, docs, repos), su primera opción es el MCP de la capacidad correspondiente; cita las fuentes.',
  '- **Implementación**: consulta la documentación de las librerías (context7 y similares) antes de inventar APIs.',
  '- **No inventes herramientas**: solo existen las de este inventario (y las locales de cada agente); si un MCP está deshabilitado (`enabled: false`), no cuenta.',
  '- **Si falta una capacidad recurrente**, propón instalar el MCP correspondiente y re-ejecutar `mcps.mjs` + el agente `adaptador-mcps`.',
  '',
].join('\n')
fs.mkdirSync(path.join(DATA_DIR, 'memoria', 'global'), { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'memoria', 'global', 'MCPS.md'), guia)

if (process.argv.includes('--print')) {
  console.log(guia)
} else {
  console.log(`MCPs descubiertos: ${datos.total}`)
  for (const m of lista) console.log(`  · ${m.nombre} (${m.origen}) → ${m.capacidades.join(', ')}`)
  console.log(`Escrito: ${path.join(DATA_DIR, 'mcps.json')}`)
  console.log(`Escrito: ${path.join(DATA_DIR, 'memoria', 'global', 'MCPS.md')}`)
}
