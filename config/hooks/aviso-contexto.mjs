#!/usr/bin/env node
/**
 * Hook `UserPromptSubmit` — guardián de contexto (spec 15 · O4).
 *
 * Mide el contexto real del hilo principal (tokens de entrada de la última respuesta:
 * input + caché leída + caché creada) y, al cruzar un umbral, avisa por dos vías:
 *   · al usuario, en la consola (`systemMessage`), en una línea;
 *   · al modelo (`additionalContext`), con qué hacer: ESTADO.md y `/clear`.
 * Avisa al pasar de CONTEXTO_AVISO y cada +CONTEXTO_PASO, una sola vez por nivel y sesión.
 *
 * Variables:
 *   CONTEXTO_AVISO   primer umbral en tokens (por defecto 100000)
 *   CONTEXTO_PASO    tokens entre avisos siguientes (por defecto 50000)
 *
 * Nunca falla: cualquier error se silencia y se sale con código 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0) // sesión interna del resumidor (spec 15)

const AVISO = Number(process.env.CONTEXTO_AVISO) || 100000
const PASO = Number(process.env.CONTEXTO_PASO) || 50000
const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
const ESTADO_AVISOS = path.join(DATA_DIR, 'temporal', 'avisos-contexto.json')
const SIETE_DIAS = 7 * 24 * 60 * 60 * 1000

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 500)
  })
}

/** Lee solo el final del transcript (puede pesar mucho). */
function cola(ruta, bytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(ruta, 'r')
  try {
    const tam = fs.fstatSync(fd).size
    const ini = Math.max(0, tam - bytes)
    const buf = Buffer.alloc(tam - ini)
    fs.readSync(fd, buf, 0, buf.length, ini)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/** Tokens de contexto del hilo principal según la última respuesta con `usage`. */
function tokensContexto(textoTranscript) {
  const lineas = String(textoTranscript || '').split('\n')
  for (let i = lineas.length - 1; i >= 0; i--) {
    let e
    try { e = JSON.parse(lineas[i]) } catch { continue }
    const u = e && e.type === 'assistant' && !e.isSidechain && e.message && e.message.usage
    if (!u) continue
    return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  }
  return 0
}

/** Nivel de aviso (−1 = por debajo del primer umbral). */
const nivelAviso = (tokens, aviso = AVISO, paso = PASO) => (tokens < aviso ? -1 : Math.floor((tokens - aviso) / paso))

function salir(k) {
  if (k) {
    console.log(JSON.stringify({
      systemMessage: `🧠 Contexto en ~${k}k tokens. Si has cerrado una tarea o cambias de tema, haz /clear: la nota de última sesión se guarda y se carga sola. Si necesitas este contexto, sigue.`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `⚠️ Contexto largo: este hilo va por ~${k}k tokens. Antes de seguir con algo nuevo: 1) actualiza el ESTADO.md del proyecto (\`estado.mjs --escribir --archivo …\`) y la bitácora; 2) sugiere al usuario hacer \`/clear\` — el briefing y la nota de última sesión se reinyectan solos; 3) no arrastres conversaciones frías.`,
      },
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

  const tokens = tokensContexto(cola(transcript))
  const nivel = nivelAviso(tokens)
  if (nivel < 0) salir(null)

  // Un aviso por nivel y sesión; las marcas de más de 7 días se podan.
  const sesion = String(datos.session_id || 'sin-sesion').slice(0, 80)
  let avisos = {}
  try { avisos = JSON.parse(fs.readFileSync(ESTADO_AVISOS, 'utf8')) } catch { avisos = {} }
  const previo = avisos[sesion] && typeof avisos[sesion] === 'object' ? avisos[sesion].nivel : -1
  if (nivel <= previo) salir(null)
  avisos[sesion] = { nivel, ts: Date.now() }
  for (const [s, v] of Object.entries(avisos)) {
    const ts = typeof v === 'object' ? v.ts : Number(v)
    if (!ts || Date.now() - ts > SIETE_DIAS) delete avisos[s]
  }
  try {
    fs.mkdirSync(path.dirname(ESTADO_AVISOS), { recursive: true })
    fs.writeFileSync(ESTADO_AVISOS, JSON.stringify(avisos))
  } catch { /* sin persistencia */ }

  salir(Math.round(tokens / 1000))
} catch {
  process.exit(0)
}
