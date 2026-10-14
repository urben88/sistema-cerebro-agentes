#!/usr/bin/env node
/**
 * Linter y guard estático de skills (R5.3/R5.4 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 *   · `lintSkill(dir)` — valida la carpeta de un skill:
 *       – frontmatter con `name` y `description`;
 *       – `name` casa `^[a-z0-9][a-z0-9_-]*$` y coincide con el nombre de la carpeta;
 *       – `description` ≤ 300 chars; cuerpo (tras el frontmatter) ≤ 24 000 chars;
 *       – ficheros prohibidos en cualquier nivel: README.md, CHANGELOG.md, .env, install.sh;
 *       – guard estático sobre el cuerpo: un veredicto `peligroso` BLOQUEA (ok=false).
 *   · `guardSkill(texto)` — veredicto `seguro | precaucion | peligroso` sobre el contenido:
 *       – peligroso: `curl|wget … | sh|bash`, `base64`+`eval`, lectura de `~/.ssh` o de
 *         tokens/credenciales, «ignore previous instructions» (y variantes en español);
 *       – precaucion: `sudo`, `rm -r`, `chmod 777`, `eval` suelto.
 *
 * CLI: `node skill-lint.mjs <carpeta-skill>` imprime el JSON y sale 0 (ok) o 1 (rechazado).
 *
 * Sin dependencias (Node >= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Ficheros que nunca deben formar parte de un skill, en ningún nivel de la carpeta. */
export const PROHIBIDOS = ['readme.md', 'changelog.md', '.env', 'install.sh']
/** `name` válido: minúsculas/dígitos al inicio, y luego minúsculas, dígitos, `_` o `-`. */
export const NOMBRE_RE = /^[a-z0-9][a-z0-9_-]*$/
export const MAX_DESCRIPCION = 300
export const MAX_CUERPO = 24000

// ------------------------------------------------------------------- guard

// Peligroso: bloquea. Cada entrada es `{re, motivo}`.
const PELIGROSOS = [
  { re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/i, motivo: 'descarga y ejecución (curl/wget | sh|bash)' },
  { re: /\bbase64\b[^\n]*\beval\b|\beval\b[^\n]*\bbase64\b/i, motivo: 'base64 + eval' },
  { re: /\bbase64\b[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/i, motivo: 'base64 decodificado ejecutado' },
  { re: /(?:~\/\.ssh|\/\.ssh\/|\bid_rsa\b|\bid_ed25519\b|\bid_ecdsa\b)/i, motivo: 'lectura de claves SSH (~/.ssh)' },
  { re: /\b(?:credentials?|credenciales?|tokens?|api[_-]?key|secretos?|auth\.json|\.netrc|\.env\b)/i, motivo: 'lectura de tokens o credenciales' },
  { re: /ignore\s+(?:all\s+)?(?:the\s+)?previous\s+instructions?/i, motivo: 'inyección: «ignore previous instructions»' },
  { re: /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/i, motivo: 'inyección: «disregard previous instructions»' },
  { re: /(?:ignora|olvida)\s+(?:todas\s+)?las\s+instrucciones\s+(?:anteriores|previas|del\s+sistema)/i, motivo: 'inyección: «ignora las instrucciones anteriores»' },
  { re: /(?:ignora|olvida)\s+(?:todo\s+)?lo\s+(?:anterior|previo)/i, motivo: 'inyección: «ignora lo anterior»' },
]

// Precaución: avisa, no bloquea.
const PRECAUCIONES = [
  { re: /\bsudo\b/i, motivo: 'sudo' },
  { re: /\brm\s+-[a-z]*r/i, motivo: 'borrado recursivo (rm -r)' },
  { re: /\bchmod\s+777\b/i, motivo: 'permisos 777' },
  { re: /\beval\b/i, motivo: 'eval' },
]

/**
 * Guard estático: devuelve `{veredicto, hallazgos}` con `hallazgos` `{nivel, motivo}`.
 * El veredicto es la severidad máxima encontrada.
 */
export function guardSkill(texto) {
  const t = String(texto ?? '')
  const hallazgos = []
  for (const { re, motivo } of PELIGROSOS) if (re.test(t)) hallazgos.push({ nivel: 'peligroso', motivo })
  const peligroso = hallazgos.length > 0
  for (const { re, motivo } of PRECAUCIONES) {
    if (re.test(t)) hallazgos.push({ nivel: 'precaucion', motivo })
  }
  const veredicto = peligroso ? 'peligroso' : hallazgos.length ? 'precaucion' : 'seguro'
  return { veredicto, hallazgos }
}

// -------------------------------------------------------------------- lint

/** Separa el frontmatter (`---\n…\n---`) del cuerpo; tolera ausencia de frontmatter. */
function partirFrontmatter(texto) {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(String(texto ?? ''))
  if (!m) return { frontmatter: '', cuerpo: String(texto ?? '') }
  return { frontmatter: m[1], cuerpo: String(texto ?? '').slice(m[0].length) }
}

/** Extrae un campo escalar del frontmatter (`name:`/`description:`), sin comillas. */
function campo(frontmatter, clave) {
  const re = new RegExp(`^${clave}:\\s*(.*)$`, 'm')
  const m = re.exec(frontmatter)
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '').trim()
}

/** Lista recursiva de ficheros de una carpeta (vacío si no se puede leer). */
function listarFicheros(dir) {
  const out = []
  let entradas = []
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entradas) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listarFicheros(p))
    else out.push(p)
  }
  return out
}

/**
 * Linta la carpeta de un skill. Devuelve:
 *   `{ ok, carpeta, problemas: [{nivel, mensaje}], guard: {veredicto, hallazgos} }`
 * `ok` es false si hay algún problema de nivel `error` (incluido un guard `peligroso`).
 */
export function lintSkill(dir) {
  const problemas = []
  const error = (mensaje) => problemas.push({ nivel: 'error', mensaje })
  const aviso = (mensaje) => problemas.push({ nivel: 'aviso', mensaje })

  if (typeof dir !== 'string' || !dir.trim()) {
    return { ok: false, carpeta: null, problemas: [{ nivel: 'error', mensaje: 'falta la carpeta del skill' }], guard: { veredicto: 'seguro', hallazgos: [] } }
  }
  const carpeta = path.basename(path.resolve(dir))
  const archivo = path.join(dir, 'SKILL.md')

  let texto = null
  try { texto = fs.readFileSync(archivo, 'utf8') } catch { texto = null }
  if (texto === null) {
    error('falta SKILL.md')
    return { ok: false, carpeta, problemas, guard: { veredicto: 'seguro', hallazgos: [] } }
  }

  const { frontmatter, cuerpo } = partirFrontmatter(texto)
  const name = campo(frontmatter, 'name')
  const description = campo(frontmatter, 'description')

  if (!name) error('falta `name` en el frontmatter')
  else if (!NOMBRE_RE.test(name)) error(`\`name\` inválido «${name}»: debe casar ${NOMBRE_RE}`)
  else if (name !== carpeta) error(`\`name\` («${name}») no coincide con la carpeta («${carpeta}»)`)
  if (!description) error('falta `description` en el frontmatter')
  else if (description.length > MAX_DESCRIPCION) error(`\`description\` supera ${MAX_DESCRIPCION} chars (${description.length})`)
  if (cuerpo.length > MAX_CUERPO) error(`el cuerpo supera ${MAX_CUERPO} chars (${cuerpo.length})`)

  // Ficheros prohibidos en cualquier nivel.
  for (const f of listarFicheros(dir)) {
    const base = path.basename(f).toLowerCase()
    if (PROHIBIDOS.includes(base)) error(`fichero prohibido: ${path.relative(dir, f)}`)
  }

  // Guard estático sobre el cuerpo; `peligroso` bloquea.
  const guard = guardSkill(cuerpo)
  if (guard.veredicto === 'peligroso') {
    error(`guard: contenido peligroso (${guard.hallazgos.filter((h) => h.nivel === 'peligroso').map((h) => h.motivo).join('; ')})`)
  } else if (guard.veredicto === 'precaucion') {
    aviso(`guard: contenido a revisar (${guard.hallazgos.map((h) => h.motivo).join('; ')})`)
  }

  const ok = !problemas.some((p) => p.nivel === 'error')
  return { ok, carpeta, problemas, guard }
}

// ---------------------------------------------------------------------- CLI

const este = fileURLToPath(import.meta.url)
const ejecutado = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (ejecutado && path.resolve(este) === ejecutado) {
  const dir = process.argv[2]
  if (!dir) {
    console.log(JSON.stringify({ ok: false, error: 'uso: node skill-lint.mjs <carpeta-skill>' }, null, 2))
    process.exit(1)
  }
  const r = lintSkill(dir)
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}
