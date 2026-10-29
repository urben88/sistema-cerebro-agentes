/**
 * Utilidades compartidas de la nota de última sesión (spec 15 · O5):
 * dónde vive, cómo se nombra por proyecto, cómo se lanza el resumen y cómo se lee.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')

export const dirUltimaSesion = () => path.join(DATA_DIR, 'memoria', 'ultima-sesion')

export const slugProyecto = (cwd) =>
  String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-proyecto'

/** Lanza `resumir-sesion.mjs` desacoplado (sobrevive al cierre de Claude) y marca «pendiente». */
export function lanzarResumen(transcript, cwd) {
  if (!transcript || !cwd || !fs.existsSync(transcript)) return false
  const dir = dirUltimaSesion()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${slugProyecto(cwd)}.pendiente`), '')
  // RESUMIR_SCRIPT: solo pruebas (spec 23), para observar si se lanza el resumen.
  const script = process.env.RESUMIR_SCRIPT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'resumir-sesion.mjs')
  const hijo = spawn(process.execPath, [script, transcript, cwd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ULTIMA_SESION_RESUMIENDO: '1' },
  })
  hijo.unref()
  return true
}

/**
 * Devuelve la nota del proyecto. Si el resumen anterior sigue en curso (p. ej. justo
 * tras `/clear`), lo espera hasta `esperaMaxMs`. Una marca de más de 3 min se ignora.
 */
export async function leerNota(cwd, esperaMaxMs = 60000) {
  const dir = dirUltimaSesion()
  const slug = slugProyecto(cwd)
  const pendiente = path.join(dir, `${slug}.pendiente`)
  const inicio = Date.now()
  for (;;) {
    let enCurso = false
    try { enCurso = Date.now() - fs.statSync(pendiente).mtimeMs < 180000 } catch { /* sin marca */ }
    if (!enCurso || Date.now() - inicio >= esperaMaxMs) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  try { return fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8').trim() } catch { return '' }
}
