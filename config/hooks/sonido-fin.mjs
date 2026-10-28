#!/usr/bin/env node
/**
 * Hook Stop: sonido al terminar el turno de la sesión principal (spec 22 · S6).
 *
 * Reproduce el primer archivo que exista de `~/.sistema-cerebro-agentes/sonidos/fin.{mp3,wav,ogg}`;
 * si no hay ninguno, el sonido del sistema. Se lanza en segundo plano (desacoplado), vuelve
 * al instante y sale siempre con 0. Interruptor: `sonido_fin` en `hub-data/reglas.json`
 * (o en la `reglas.json` de serie del hub); por defecto activo.
 *
 * Pruebas: SONIDO_DRY=1 imprime el plan {archivo, cmd, args, env} sin reproducir;
 * SONIDO_PLATFORM fuerza la plataforma.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

try {
  if (process.env.ULTIMA_SESION_RESUMIENDO) process.exit(0)
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const SYSTEM_DIR = process.env.SISTEMA_CEREBRO_DIR || path.join(os.homedir(), '.sistema-cerebro-agentes')
  const DATA_DIR = process.env.HUB_DATA_DIR || path.join(SYSTEM_DIR, 'hub-data')
  const plataforma = process.env.SONIDO_PLATFORM || process.platform

  const leerJson = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d && typeof d === 'object' ? d : {} } catch { return {} } }
  const stdin = await new Promise((res) => {
    let d = ''; let hecho = false
    const fin = () => { if (!hecho) { hecho = true; res(d) } }
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', fin)
    process.stdin.on('error', fin)
    setTimeout(fin, 200)
  })
  let datos = {}
  try { datos = JSON.parse(stdin || '{}') } catch { /* payload no JSON */ }
  const evento = datos.hook_event_name || 'Stop'
  if (evento !== 'Stop') process.exit(0)

  const local = leerJson(path.join(DATA_DIR, 'reglas.json'))
  const bruto = local.sonido_fin ?? leerJson(path.join(__dirname, '..', 'hub', 'reglas.json')).sonido_fin
  if (bruto === false || bruto === 'false' || bruto === 0) process.exit(0)

  const carpeta = path.join(SYSTEM_DIR, 'sonidos')
  const archivo = ['mp3', 'wav', 'ogg'].map((e) => path.join(carpeta, `fin.${e}`)).find((f) => fs.existsSync(f)) || null
  const ext = archivo ? path.extname(archivo).slice(1) : null

  const PS_SISTEMA = '[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 800'
  let plan
  if (plataforma === 'win32') {
    let script = PS_SISTEMA
    if (ext === 'wav') script = '(New-Object System.Media.SoundPlayer $env:SONIDO_ARCHIVO).PlaySync()'
    else if (archivo) {
      script = 'Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; '
        + '$p.Open([uri]$env:SONIDO_ARCHIVO); $t = 0; '
        + 'while (-not $p.NaturalDuration.HasTimeSpan -and $t -lt 50) { Start-Sleep -Milliseconds 100; $t++ }; '
        + 'if ($p.NaturalDuration.HasTimeSpan) { $p.Play(); Start-Sleep -Milliseconds ([int]$p.NaturalDuration.TimeSpan.TotalMilliseconds + 300) } '
        + `else { ${PS_SISTEMA} }`
    }
    plan = { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script] }
  } else if (plataforma === 'darwin') {
    plan = { cmd: 'afplay', args: [archivo || '/System/Library/Sounds/Glass.aiff'] }
  } else {
    const f = archivo || '/usr/share/sounds/freedesktop/stereo/complete.oga'
    plan = { cmd: 'sh', args: ['-c', '(paplay "$SONIDO_ARCHIVO" || aplay -q "$SONIDO_ARCHIVO") >/dev/null 2>&1'], archivo: f }
  }
  const env = { SONIDO_ARCHIVO: plan.archivo || archivo || '' }
  const salida = { archivo, plataforma, cmd: plan.cmd, args: plan.args, env }

  if (process.env.SONIDO_DRY) { console.log(JSON.stringify(salida)); process.exit(0) }
  try {
    const hijo = spawn(plan.cmd, plan.args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } })
    hijo.on('error', () => { /* sin reproductor: se ignora */ })
    hijo.unref()
    await new Promise((r) => setTimeout(r, 50)) // deja que el spawn arranque antes de salir
  } catch { /* sin audio: no pasa nada */ }
} catch { /* nunca falla */ }
process.exit(0)
