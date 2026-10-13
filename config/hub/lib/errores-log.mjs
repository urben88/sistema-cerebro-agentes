/**
 * Registro central de errores del sistema.
 *
 * Guarda cada error completo en `logs/errores.jsonl` (una línea JSON por error)
 * para poder verlo en el panel o exportarlo en Markdown y pasárselo a una IA.
 * Captura desde todas las capas: hub, colector de la vista viva, trabajos
 * fallidos, hooks, MCP y panel. Sin dependencias.
 *
 * Rotación: al pasar de 4 MB se guarda una copia en `errores.1.jsonl`.
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_LISTAR = 500

export function crearLogErrores({ dirLogs }) {
  const archivo = path.join(dirLogs, 'errores.jsonl')
  const rotado = path.join(dirLogs, 'errores.1.jsonl')
  let memoria = []

  const recortar = (v, max) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    if (!s) return null
    return s.length > max ? `${s.slice(0, max)}…` : s
  }

  function cargar() {
    memoria = []
    try {
      const texto = fs.readFileSync(archivo, 'utf8')
      for (const l of texto.split('\n')) {
        if (!l.trim()) continue
        try { memoria.push(JSON.parse(l)) } catch { /* línea rota */ }
      }
      memoria = memoria.slice(-MAX_LISTAR)
    } catch { /* todavía sin fichero */ }
  }

  function rotar() {
    try {
      if (fs.statSync(archivo).size > MAX_BYTES) {
        try { fs.rmSync(rotado, { force: true }) } catch { /* nada */ }
        fs.renameSync(archivo, rotado)
      }
    } catch { /* sin fichero */ }
  }

  /** Registra un error (o aviso) completo. Devuelve la entrada guardada. */
  function registrar(datos = {}) {
    const entrada = {
      id: `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      fecha: new Date().toISOString(),
      severidad: ['info', 'aviso', 'error', 'critico'].includes(datos.severidad) ? datos.severidad : 'error',
      origen: recortar(String(datos.origen || 'desconocido'), 60),
      mensaje: recortar(String(datos.mensaje || datos.error || 'error sin mensaje'), 4000),
      stack: recortar(datos.stack || null, 8000),
      contexto: datos.contexto && typeof datos.contexto === 'object'
        ? recortar(datos.contexto, 4000)
        : (datos.contexto ? recortar(String(datos.contexto), 2000) : null),
    }
    memoria.push(entrada)
    memoria = memoria.slice(-MAX_LISTAR)
    try {
      fs.mkdirSync(dirLogs, { recursive: true })
      rotar()
      fs.appendFileSync(archivo, JSON.stringify(entrada) + '\n')
    } catch { /* sin disco: queda en memoria */ }
    return entrada
  }

  /** Registra y deja una línea en la consola (para los logs de Docker). */
  function registrarYLog(datos) {
    const e = registrar(datos)
    try { console.error(`[error][${e.origen}] ${e.mensaje.slice(0, 300)}`) } catch { /* nada */ }
    return e
  }

  function listar({ limite = 100, origen = null, severidad = null } = {}) {
    let out = [...memoria].reverse()
    if (origen) out = out.filter((e) => e.origen === origen)
    if (severidad) out = out.filter((e) => e.severidad === severidad)
    return out.slice(0, Math.max(1, Math.min(limite, MAX_LISTAR)))
  }

  function resumen({ limite = MAX_LISTAR } = {}) {
    const porOrigen = {}
    const porSeveridad = {}
    for (const e of listar({ limite })) {
      porOrigen[e.origen] = (porOrigen[e.origen] || 0) + 1
      porSeveridad[e.severidad] = (porSeveridad[e.severidad] || 0) + 1
    }
    return { porOrigen, porSeveridad }
  }

  /** Informe Markdown listo para pegar en una IA y corregir los problemas. */
  function exportar({ limite = 50 } = {}) {
    const errores = listar({ limite })
    const r = resumen({ limite })
    const L = []
    L.push('# Informe de errores — sistema-cerebro-agentes')
    L.push('')
    L.push(`Generado: ${new Date().toISOString()} · Últimos ${errores.length} errores`)
    L.push(`Reparto por origen: ${JSON.stringify(r.porOrigen)} · por severidad: ${JSON.stringify(r.porSeveridad)}`)
    L.push('')
    L.push('Contexto: Cerebro Hub (Node, sin dependencias) + servidor OpenCode V1 + agentes de Claude/DeepSeek.')
    L.push('Cada error lleva su stack y contexto; úsalo para diagnosticar y proponer la corrección.')
    L.push('')
    errores.forEach((e, i) => {
      L.push(`## [${i + 1}] ${e.fecha} · ${e.origen} · ${e.severidad}`)
      L.push(`- mensaje: ${e.mensaje}`)
      if (e.contexto) L.push(`- contexto: ${e.contexto}`)
      if (e.stack) {
        L.push('- stack:')
        L.push('```')
        L.push(e.stack)
        L.push('```')
      }
      L.push('')
    })
    return L.join('\n')
  }

  cargar()
  return { registrar, registrarYLog, listar, resumen, exportar, archivo }
}
