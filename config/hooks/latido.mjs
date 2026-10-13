#!/usr/bin/env node
/**
 * Hook de latido de Claude Code.
 *
 * Avisa al Cerebro Hub de que Claude (o uno de sus subagentes) está trabajando en
 * esta carpeta, para que el panel «La oficina» muestre el personaje en vivo. Se
 * registra en los eventos UserPromptSubmit, Stop, SubagentStart y SubagentStop.
 *
 * Silencioso y a prueba de fallos: tope de ~0,8 s, nunca bloquea a Claude y sale
 * siempre con código 0, aunque el hub esté apagado o tardando.
 */
const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const EVENTOS = new Set(['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop'])

function leerStdin() {
  return new Promise((res) => {
    let d = ''
    let hecho = false
    const terminar = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', terminar)
    // Tope corto: no esperar al cierre del stdin si Claude tarda en cerrarlo.
    setTimeout(terminar, 200)
  })
}

try {
  const bruto = await leerStdin()
  let datos = {}
  try { datos = JSON.parse(bruto || '{}') } catch { /* payload no JSON */ }

  const evento = datos.hook_event_name || process.argv[2] || ''
  if (EVENTOS.has(evento)) {
    const cuerpo = {
      cwd: datos.cwd || process.cwd(),
      sesion: datos.session_id || datos.sessionId || null,
      evento,
      agente: datos.agent_type || datos.agent || datos.subagent_type || null,
      tarea: (datos.prompt || datos.task || datos.description || '').slice(0, 200) || null,
    }
    try {
      await fetch(`${HUB}/api/latido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(600),
      })
    } catch { /* hub apagado o lento: se ignora */ }
  }
  process.exit(0)
} catch {
  process.exit(0)
}
