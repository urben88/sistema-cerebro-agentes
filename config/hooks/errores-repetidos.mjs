#!/usr/bin/env node
/**
 * Hooks `PostToolUseFailure` + `PostToolUse` (matcher «Bash») — freno a los bucles de error.
 *
 * Cuenta cuántas veces seguidas falla el MISMO comando de Bash (firma = comando con espacios
 * colapsados) y avisa:
 *   · 2.º fallo seguido: al modelo (`additionalContext`), que no lo repita igual;
 *   · 3.er fallo seguido: además al usuario (`systemMessage`), en una línea.
 * Un aviso por nivel (2 y 3) y firma. Un éxito del mismo comando reinicia su contador.
 *
 * Claude Code manda los comandos con exit ≠ 0 a `PostToolUseFailure` (campo `error`) y los
 * correctos a `PostToolUse`. Por si acaso, en `PostToolUse` también se detecta el fallo por la
 * respuesta (exit code ≠ 0 / `error`). Las interrupciones del usuario no cuentan.
 *
 * Estado: os.tmpdir()/cerebro-errores/<sesión[-agente]>.json (se podan los de más de 2 días).
 * Nunca falla: cualquier error se silencia y se sale con código 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0) // sesión interna del resumidor (spec 15)

const DIR_ESTADO = path.join(os.tmpdir(), 'cerebro-errores')
const DOS_DIAS = 2 * 24 * 60 * 60 * 1000
const MAX_FIRMAS = 50 // tope de firmas por sesión, para que el fichero no crezca

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => res(d))
    setTimeout(() => res(d), 500)
  })
}

/** Firma normalizada: trim y espacios colapsados. */
const firma = (cmd) => String(cmd || '').trim().replace(/\s+/g, ' ')

/** ¿Falló? `null` = no cuenta (interrupción del usuario). */
function hayFallo(datos) {
  if (datos.is_interrupt === true) return null
  if (datos.hook_event_name === 'PostToolUseFailure') return true
  const r = datos.tool_response
  if (r && typeof r === 'object') {
    if (r.interrupted === true) return null
    const code = r.exit_code ?? r.exitCode ?? r.returncode
    if (typeof code === 'number' && code !== 0) return true
    if (r.error) return true
  }
  return false
}

/** Aplica un resultado al estado y devuelve el nivel a avisar (2, 3) o 0. */
function registrar(estado, sig, fallo, ahora = Date.now()) {
  if (!fallo) { delete estado[sig]; return 0 }
  const e = estado[sig] || { n: 0, avisado: [] }
  e.n += 1
  e.ts = ahora
  let nivel = 0
  if ((e.n === 2 || e.n === 3) && !e.avisado.includes(e.n)) { nivel = e.n; e.avisado.push(e.n) }
  estado[sig] = e
  const claves = Object.keys(estado)
  if (claves.length > MAX_FIRMAS) {
    claves.sort((a, b) => (estado[a].ts || 0) - (estado[b].ts || 0))
    for (const k of claves.slice(0, claves.length - MAX_FIRMAS)) delete estado[k]
  }
  return nivel
}

/** Borra los estados de sesiones con más de 2 días. */
function podar() {
  for (const f of fs.readdirSync(DIR_ESTADO)) {
    try {
      const p = path.join(DIR_ESTADO, f)
      if (Date.now() - fs.statSync(p).mtimeMs > DOS_DIAS) fs.unlinkSync(p)
    } catch { /* ya no está */ }
  }
}

const corto = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { process.exit(0) }
  if (datos.tool_name !== 'Bash') process.exit(0)
  const sig = firma(datos.tool_input && datos.tool_input.command)
  if (!sig) process.exit(0)
  const fallo = hayFallo(datos)
  if (fallo === null) process.exit(0)

  const clave = [datos.session_id || 'sin-sesion', datos.agent_id].filter(Boolean).join('-').replace(/[^\w.-]/g, '_').slice(0, 120)
  const fichero = path.join(DIR_ESTADO, `${clave}.json`)
  let estado = {}
  try { estado = JSON.parse(fs.readFileSync(fichero, 'utf8')) } catch { estado = {} }
  if (!estado || typeof estado !== 'object' || Array.isArray(estado)) estado = {}

  const antes = JSON.stringify(estado)
  const nivel = registrar(estado, sig, fallo)
  if (JSON.stringify(estado) !== antes) {
    try {
      fs.mkdirSync(DIR_ESTADO, { recursive: true })
      fs.writeFileSync(fichero, JSON.stringify(estado))
      if (fallo) podar()
    } catch { /* sin persistencia */ }
  }

  if (nivel) {
    const evento = datos.hook_event_name === 'PostToolUse' ? 'PostToolUse' : 'PostToolUseFailure'
    const salida = {
      hookSpecificOutput: {
        hookEventName: evento,
        additionalContext: `El comando \`${corto(sig)}\` ha fallado ${nivel} veces seguidas. No lo repitas igual: lee el error, cambia el enfoque o consulta al advisor; si sigue, para y explica el bloqueo.`,
      },
    }
    if (nivel >= 3) salida.systemMessage = `🔁 El comando \`${corto(sig, 60)}\` ha fallado ${nivel} veces seguidas; se ha avisado al modelo para que cambie de enfoque.`
    console.log(JSON.stringify(salida))
  }
  process.exit(0)
} catch {
  process.exit(0)
}
