/**
 * Estimación de la "ventana" de Claude Code desde el historial local
 * (~/.claude/projects/**.jsonl). Da tokens por modelo en las últimas 5 h y 7 días.
 * La barra OFICIAL está en /usage dentro de Claude Code y en claude.ai/settings/usage.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function crearVentana({ baseDir = path.join(os.homedir(), '.claude', 'projects'), maxArchivos = 400, maxBytes = 30 * 1024 * 1024 } = {}) {
  let cache = { ts: 0, datos: null }

  function listarArchivos(desde) {
    const encontrados = []
    const walk = (dir, profundidad = 0) => {
      if (profundidad > 6) return
      let entradas = []
      try { entradas = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entradas) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full, profundidad + 1)
        else if (e.name.endsWith('.jsonl')) {
          try {
            const st = fs.statSync(full)
            if (st.mtimeMs >= desde) encontrados.push({ ruta: full, mtime: st.mtimeMs })
          } catch { /* nada */ }
        }
      }
    }
    walk(baseDir)
    return encontrados.sort((a, b) => b.mtime - a.mtime).slice(0, maxArchivos)
  }

  async function calcular({ forzar = false } = {}) {
    const ahora = Date.now()
    if (!forzar && cache.datos && ahora - cache.ts < 5 * 60 * 1000) return cache.datos
    const desde = ahora - 8 * 24 * 60 * 60 * 1000
    const archivos = listarArchivos(desde)
    const porModelo = {}
    let lineasLeidas = 0
    for (const f of archivos) {
      let fd = null
      try {
        fd = fs.openSync(f.ruta, 'r')
        const tam = fs.fstatSync(fd).size
        const buf = Buffer.alloc(Math.min(tam, maxBytes))
        fs.readSync(fd, buf, 0, buf.length, 0)
        const texto = buf.toString('utf8')
        for (const linea of texto.split('\n')) {
          if (!linea.includes('"usage"')) continue
          lineasLeidas++
          let obj
          try { obj = JSON.parse(linea) } catch { continue }
          const uso = obj?.message?.usage || obj?.usage
          if (!uso) continue
          const ts = Date.parse(obj.timestamp || obj?.message?.timestamp || '')
          if (!ts || ts < desde) continue
          const modelo = obj?.message?.model || obj?.model || 'desconocido'
          const nuevos = (uso.input_tokens || 0) + (uso.output_tokens || 0) + (uso.cache_creation_input_tokens || 0)
          const cache = uso.cache_read_input_tokens || 0
          const entrada = (porModelo[modelo] ||= { n5: 0, n7: 0, c7: 0, mensajes: 0 })
          entrada.n7 += nuevos
          entrada.c7 += cache
          if (ahora - ts <= 5 * 60 * 60 * 1000) entrada.n5 += nuevos
          entrada.mensajes++
        }
      } catch { /* ilegible */ } finally { if (fd !== null) { try { fs.closeSync(fd) } catch { /* nada */ } } }
    }
    const datos = {
      generado: ahora,
      archivos: archivos.length,
      lineasLeidas,
      nota: 'Estimación local (tokens). La barra oficial: /usage en Claude Code.',
      porModelo,
    }
    cache = { ts: ahora, datos }
    return datos
  }

  return { calcular }
}
