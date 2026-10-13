/**
 * Triaje: decide quién hace cada tarea (agente + esfuerzo) usando Laya —el modelo
 * local de decisiones— y reglas fijas como respaldo. Cada decisión se registra en
 * logs/decisiones.jsonl para poder afinar Laya más adelante con uso real.
 *
 * API real de Laya (descubierta del contenedor): POST /v1/systemone
 *   { state, questions: { id: { type: 'choice'|'score'|'noul', instructions, criteria } } }
 *   → { answers: { id: { type, choice, probabilities, answer_confidence, noul } }, routing: {...} }
 */
import fs from 'node:fs'
import path from 'node:path'

const CATALOGO_AGENTES = ['implementador', 'debugger', 'revisor', 'testeador', 'explorador-ds', 'redactor-ds', 'local', 'cerebro', 'arquitecto']

export function crearTriaje({ url = process.env.LAYA_URL || 'http://127.0.0.1:8000', reglas = {}, logDecisiones = null } = {}) {
  let cacheEstado = { ts: 0, ok: false }

  async function disponible() {
    if (Date.now() - cacheEstado.ts < 15000) return cacheEstado.ok
    let ok = false
    try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }); ok = r.ok } catch { ok = false }
    cacheEstado = { ts: Date.now(), ok }
    return ok
  }

  function clasificarPorReglas(tarea) {
    const t = String(tarea || '').toLowerCase()
    for (const r of reglas.reglas || []) {
      if ((r.claves || []).some((k) => t.includes(k))) {
        return { capa: r.capa, agente: r.agente, esfuerzo: r.esfuerzo, escalar: false, riesgo: false, confianza: 0.6, fuente: 'reglas', motivo: r.motivo || 'coincidencia de palabras clave' }
      }
    }
    const d = reglas.porDefecto || { capa: 'claude', agente: 'cerebro', esfuerzo: 'medium' }
    return { capa: d.capa, agente: d.agente, esfuerzo: d.esfuerzo ?? null, escalar: false, riesgo: false, confianza: 0.4, fuente: 'reglas', motivo: d.motivo || 'sin coincidencia clara: decide el cerebro' }
  }

  async function consultarLaya(tarea, contexto = '') {
    const preguntas = {
      agente: {
        type: 'choice',
        instructions: '¿Qué agente debe realizar esta tarea?',
        criteria: CATALOGO_AGENTES,
      },
      esfuerzo: {
        type: 'choice',
        instructions: '¿Cuánto esfuerzo de razonamiento necesita esta tarea?',
        criteria: ['low', 'medium', 'high', 'max'],
      },
      escalar: {
        type: 'noul',
        instructions: '¿Debería revisar el resultado un modelo mayor o un humano antes de darlo por bueno?',
      },
      riesgo: {
        type: 'noul',
        instructions: '¿Es una tarea de alto riesgo (datos sensibles, seguridad, cambios irreversibles)?',
      },
    }
    const estado = `${tarea}\n${contexto || ''}`.trim()
    const r = await fetch(`${url}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: estado, questions: preguntas }),
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) throw new Error(`Laya HTTP ${r.status}`)
    const j = await r.json()
    return normalizar(j, { tarea, contexto })
  }

  function buscarRespuesta(j, nombre) {
    if (!j) return null
    const contenedores = [j.answers, j.results, j.decisions, j.outputs]
    for (const c of contenedores) {
      if (!c) continue
      if (Array.isArray(c)) {
        const encontrado = c.find((x) => x && (x.name === nombre || x.question === nombre))
        if (encontrado) return encontrado
      } else if (typeof c === 'object' && c[nombre] !== undefined) {
        return c[nombre]
      }
    }
    if (j[nombre] !== undefined) return j[nombre]
    return null
  }

  function normalizar(j, { tarea, contexto }) {
    const rAg = buscarRespuesta(j, 'agente')
    const rEs = buscarRespuesta(j, 'esfuerzo')
    const rEsc = buscarRespuesta(j, 'escalar')
    const rRie = buscarRespuesta(j, 'riesgo')
    if (!rAg) return null

    const opcion = (x) => {
      if (!x) return { valor: null, prob: null }
      if (typeof x === 'string') return { valor: x, prob: null }
      if (x.choice !== undefined) return { valor: x.choice, prob: x.answer_confidence ?? x.confidence ?? null }
      if (Array.isArray(x.criteria)) return { valor: null, prob: null }
      if (x.probabilities && typeof x.probabilities === 'object') {
        const pares = Object.entries(x.probabilities).sort((a, b) => b[1] - a[1])
        if (pares.length) return { valor: pares[0][0], prob: pares[0][1] }
      }
      return { valor: null, prob: null }
    }
    const siNo = (x) => {
      if (!x) return null
      if (typeof x === 'boolean') return x
      if (typeof x.noul === 'number') return x.noul >= 0.5
      if (typeof x.noul === 'boolean') return x.noul
      if (typeof x.probability === 'number') return x.probability >= 0.5
      if (typeof x.p === 'number') return x.p >= 0.5
      if (typeof x.choice === 'boolean') return x.choice
      return null
    }
    const ag = opcion(rAg)
    const es = opcion(rEs)
    if (!ag.valor) return null
    const capa = ['cerebro', 'arquitecto'].includes(ag.valor) ? 'claude' : 'opencode'
    return {
      capa,
      agente: ag.valor,
      esfuerzo: es.valor || null,
      escalar: siNo(rEsc) === true,
      riesgo: siNo(rRie) === true,
      confianza: Math.min(ag.prob ?? 0.5, es.prob ?? 1),
      fuente: 'laya',
      motivo: 'decisión del modelo local Laya',
      detalles: {
        laya: j.model || null,
        idioma: j.routing?.detection?.language || null,
        checkpoint: j.routing?.model || null,
        probabilidades: { agente: rAg?.probabilities || null, esfuerzo: rEs?.probabilities || null },
        confianza_agente: ag.prob ?? null,
        confianza_esfuerzo: es.prob ?? null,
        instrucciones: { escalar: siNo(rEsc), riesgo: siNo(rRie) },
      },
    }
  }

  function registrar(decision) {
    if (!logDecisiones) return
    try {
      fs.mkdirSync(path.dirname(logDecisiones), { recursive: true })
      fs.appendFileSync(logDecisiones, JSON.stringify({ ...decision, fecha: new Date().toISOString() }) + '\n')
    } catch { /* nada */ }
  }

  async function decidir({ tarea, contexto = '' } = {}) {
    const respaldo = clasificarPorReglas(tarea)
    if (await disponible()) {
      try {
        const d = await consultarLaya(tarea, contexto)
        if (d) {
          if (d.confianza < (reglas.confianzaMinima ?? 0.6)) {
            const combinada = { ...respaldo, fuente: 'laya+reglas', motivo: `Laya dudó (p=${d.confianza.toFixed(2)}); se aplica la regla: ${respaldo.motivo}`, sugerencia: { agente: d.agente, esfuerzo: d.esfuerzo, escalar: d.escalar, riesgo: d.riesgo } }
            registrar({ tarea, ...combinada })
            return combinada
          }
          registrar({ tarea, ...d })
          return d
        }
      } catch (e) {
        const conError = { ...respaldo, motivo: `${respaldo.motivo} (Laya no respondió: ${String(e?.message || e).slice(0, 120)})` }
        registrar({ tarea, ...conError })
        return conError
      }
    }
    registrar({ tarea, ...respaldo })
    return respaldo
  }

  return { decidir, disponible, clasificarPorReglas }
}
