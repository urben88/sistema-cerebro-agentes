#!/usr/bin/env node
/**
 * Hook `UserPromptSubmit` — guardián de contexto.
 *
 * Vigila el tamaño del hilo (transcripción) y, SOLO cuando pasa de un umbral,
 * inyecta un aviso corto para refrescar: volcar ESTADO.md y hacer `/clear`
 * (el briefing de la sesión siguiente recupera todo). Con enfriamiento, para
 * no repetir el aviso en cada mensaje ni gastar contexto.
 *
 * Variables:
 *   AVISO_CONTEXTO_MB     umbral en MB del transcript (por defecto 2)
 *   AVISO_CONTEXTO_MIN    minutos de enfriamiento entre avisos (por defecto 30)
 *
 * Nunca falla: cualquier error se silencia y se sale con código 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const UMBRAL_MB = parseFloat(process.env.AVISO_CONTEXTO_MB || '2')
const ENFRIAMIENTO_MIN = parseFloat(process.env.AVISO_CONTEXTO_MIN || '30')
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const ESTADO_AVISOS = path.join(DATA_DIR, 'temporal', 'avisos-contexto.json')

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 500)
  })
}

function salir(texto) {
  if (texto) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: texto },
    }))
  }
  process.exit(0)
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* sin payload */ }
  const transcript = datos.transcript_path
  if (!transcript || !fs.existsSync(transcript)) salir(null)

  const tamMB = fs.statSync(transcript).size / (1024 * 1024)
  if (tamMB < UMBRAL_MB) salir(null)

  // Enfriamiento por sesión
  const sesion = String(datos.session_id || 'sin-sesion').slice(0, 80)
  let avisos = {}
  try { avisos = JSON.parse(fs.readFileSync(ESTADO_AVISOS, 'utf8')) } catch { avisos = {} }
  const ultimo = Number(avisos[sesion] || 0)
  if (Date.now() - ultimo < ENFRIAMIENTO_MIN * 60 * 1000) salir(null)
  avisos[sesion] = Date.now()
  try {
    fs.mkdirSync(path.dirname(ESTADO_AVISOS), { recursive: true })
    fs.writeFileSync(ESTADO_AVISOS, JSON.stringify(avisos))
  } catch { /* sin persistencia */ }

  salir([
    `⚠️ Contexto largo: este hilo va por ~${tamMB.toFixed(1)} MB.`,
    'Antes de seguir: 1) actualiza el ESTADO.md del proyecto (`estado.mjs --escribir --archivo …`) y la bitácora; 2) dile al usuario que haga `/clear` y continúe — el briefing de la próxima sesión reinyecta estado, contexto, alertas y hallazgos; 3) no arrastres conversaciones frías.',
  ].join(' '))
} catch {
  process.exit(0)
}
