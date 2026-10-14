#!/usr/bin/env node
/**
 * Hook `Stop`/`SessionEnd` — alimenta el contador de uso de skills (R5.5, spec 10).
 *
 * Parsea el transcript de la sesión y, por cada skill existente mencionado
 * (invocación Skill tool, `/<nombre>` o `skills/<nombre>`), hace `POST /api/skills/uso`
 * al hub. Falla en silencio si el hub no responde (nunca bloquea el cierre).
 *
 * Limitación (R5.5): solo cuenta lo que pasa por Claude Code. Los usos fuera de Claude
 * Code (OpenCode, ejecución directa) NO se cuentan.
 *
 * Reutiliza el patrón de los demás hooks: leer stdin con tope, best-effort y salir 0.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportarError } from './reportar.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude')
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills')
const MAX_TRANSCRIPT = 4 * 1024 * 1024

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    let hecho = false
    const terminar = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', terminar)
    setTimeout(terminar, 400)
  })
}

try {
  const bruto = await leerStdin()
  try { process.stdin.destroy() } catch { /* stdin ya cerrado */ }
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }

  const ruta = datos.transcript_path || datos.transcriptPath || null
  if (ruta) {
    let texto = ''
    try { texto = fs.readFileSync(ruta, 'utf8').slice(-MAX_TRANSCRIPT) } catch { texto = '' }
    if (texto) {
      const { crearSkills } = await import(new URL('../hub/lib/skills.mjs', import.meta.url).href)
      const skills = crearSkills({ dataDir: DATA_DIR, skillsDir: SKILLS_DIR })
      let conteos = {}
      try { conteos = skills.contarUsoDeTranscript(texto) } catch { conteos = {} }
      for (const [nombre, veces] of Object.entries(conteos)) {
        try {
          await fetch(`${HUB}/api/skills/uso`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, tipo: 'uso', veces }),
            signal: AbortSignal.timeout(1000),
          })
        } catch { /* hub apagado o lento: se ignora */ }
      }
    }
  }
  process.exitCode = 0
} catch (e) {
  await reportarError('skills-uso', e)
  process.exitCode = 0
}
