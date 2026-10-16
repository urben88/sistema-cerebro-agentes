#!/usr/bin/env node
/**
 * MCP de triaje — expone dos cosas del ecosistema Cerebro como herramientas MCP
 * para Claude Code (y OpenCode): la decisión local del hub (Laya + reglas) y el
 * estado de los trabajos lanzados por el puente opencode-mcp. Sin dependencias.
 *
 * Herramientas:
 *   · triaje_decidir { tarea, contexto? } → { capa, agente, esfuerzo, ... }
 *   · trabajo_estado { jobId? } → lista de trabajos activos/recientes o detalle
 *     de uno (estado, tiempo, coste, tokens, último paso, herramientas y
 *     pregunta pendiente). Para enseñar el progreso sin volcar conversaciones.
 *   · parar_trabajos { todo?, directorio? } → cancela los trabajos de OpenCode
 *     (corta el consumo); todo:true los para todos.
 *
 * Variables: HUB_URL (por defecto http://127.0.0.1:4597)
 */
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aClaude } from '../hub/lib/reparto-claude.mjs'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const VERSION = '0.4.0'
const RAIZ = process.env.SISTEMA_CEREBRO_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TOOLS = [
  {
    name: 'triaje_decidir',
    description: 'Decide qué agente y esfuerzo debe hacer una tarea (modelo local Laya + reglas). Úsalo antes de delegar si dudas de a quién mandar el trabajo. Devuelve la capa (claude/opencode), agente, esfuerzo, si conviene escalar, si hay riesgo y el motivo.',
    inputSchema: {
      type: 'object',
      properties: {
        tarea: { type: 'string', description: 'Descripción breve de la tarea (una o dos frases).' },
        contexto: { type: 'string', description: 'Contexto opcional: proyecto, ficheros, complejidad.' },
        solo_claude: { type: 'boolean', description: 'true en modo normal (sin OpenCode): traduce la decisión a un subagente de Claude (Haiku, Sonnet `resolutor` u Opus `arquitecto`) con su modelo y esfuerzo.' },
      },
      required: ['tarea'],
    },
  },
  {
    name: 'trabajo_estado',
    description: 'Estado de los trabajos de OpenCode lanzados por el puente MCP: sin argumentos lista los activos y los recientes; con jobId devuelve el detalle (estado, duración, coste, tokens, último paso, últimas herramientas y preguntas pendientes). Úsalo para enseñar el progreso al usuario sin volcar la conversación completa ni gastar contexto.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'ID del trabajo (job_…). Si se omite, se listan los trabajos.' },
      },
      required: [],
    },
  },
  {
    name: 'parar_trabajos',
    description: 'Cancela de golpe los trabajos de OpenCode en segundo plano (corta el consumo de tokens). Úsalo cuando el usuario diga "para todo", "cancela los trabajos" o al terminar una sesión con trabajos colgados: con `todo: true` los para todos; con `directorio` solo los de ese proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        todo: { type: 'boolean', description: 'true para cancelar TODOS los trabajos activos (todos los proyectos).' },
        directorio: { type: 'string', description: 'Ruta absoluta del proyecto: cancela solo los trabajos de ese directorio.' },
      },
      required: [],
    },
  },
]

// Modo normal: la traducción a subagentes de Claude (Opus/Sonnet/Haiku) vive en hub/lib/reparto-claude.mjs (spec 15).

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

let ocCache = null
async function cargarOpenCode() {
  if (ocCache) return ocCache
  const mod = await import(new URL('../hub/lib/opencode.mjs', import.meta.url).href)
  ocCache = mod.crearOpenCode({ systemDir: RAIZ })
  return ocCache
}

const MIN = 60 * 1000
const ESTADOS = { running: 'en marcha', accepted: 'aceptado (arrancando)', input_required: 'ESPERA RESPUESTA', completed: 'terminado', failed: 'FALLIDO', cancelled: 'cancelado', unknown: 'desconocido' }
const estado = (s) => ESTADOS[s] || s || '?'
const dinero = (c) => (typeof c === 'number' ? `$${c.toFixed(2)}` : '—')
const miles = (n) => (typeof n === 'number' ? (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)) : '—')

function hace(ts) {
  if (!ts) return 'sin fecha'
  const m = Math.max(0, Math.round((Date.now() - ts) / MIN))
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m}m`
  return `hace ${Math.floor(m / 60)}h ${m % 60}m`
}

function duracion(desde, hasta) {
  const m = Math.max(0, Math.round(((hasta || Date.now()) - (desde || Date.now())) / MIN))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatearLista(lista) {
  const esActivo = (j) => ['running', 'accepted', 'input_required'].includes(j.status)
  const esReciente = (j) => Date.now() - (j.updatedAt || 0) < 60 * MIN
  const enCurso = lista.filter((j) => esActivo(j) && esReciente(j))
  const parados = lista.filter((j) => esActivo(j) && !esReciente(j)).slice(0, 5)
  const cerrados = lista.filter((j) => !esActivo(j)).slice(0, 5)
  const fila = (j) => `- ${j.jobId} · ${j.agent || '?'}${j.variant ? ` (${j.variant})` : ''} · ${estado(j.status)} · ${duracion(j.createdAt, j.updatedAt)} · ${dinero(j.cost)} · ${j.title || '(sin título)'} · ${hace(j.updatedAt)}`
  const partes = []
  if (enCurso.length) {
    partes.push(`Trabajos de OpenCode (${enCurso.length} en curso):`)
    for (const j of enCurso) partes.push(fila(j))
  }
  if (parados.length) {
    partes.push('Sin actividad (posibles restos; última actividad > 1h):')
    for (const j of parados) partes.push(fila(j))
  }
  if (cerrados.length) {
    partes.push('Recientes:')
    for (const j of cerrados) partes.push(fila(j))
  }
  if (!partes.length) return 'No hay trabajos de OpenCode recientes.'
  partes.push('Detalle de uno: trabajo_estado { jobId: "job_…" }')
  return partes.join('\n')
}

function formatearDetalle(j) {
  const L = [`Trabajo ${j.jobId} · ${j.agent || '?'} · ${estado(j.status)}`]
  if (j.title) L.push(`Título: ${j.title}`)
  if (j.directory) L.push(`Directorio: ${j.directory}`)
  L.push(`Duración: ${duracion(j.createdAt, j.updatedAt)} · última actividad ${hace(j.updatedAt)}`)
  const tok = j.tokens ? `in ${miles(j.tokens.input)} / out ${miles(j.tokens.output)} / raz ${miles(j.tokens.reasoning)}` : null
  L.push(`Modelo: ${j.modelo || '?'}${j.variant ? ` (${j.variant})` : ''} · Coste: ${dinero(j.cost)}${tok ? ` · Tokens: ${tok}` : ''}`)
  if (j.status === 'input_required') L.push('⚠ Hay una pregunta o permiso pendiente: míralo con opencode_question_list / opencode_permission_list y responde con opencode_job_input.')
  if (j.error) L.push(`Error: ${j.error}`)
  if (j.herramientas?.length) L.push(`Últimas herramientas: ${j.herramientas.map((h) => h.tool + (h.estado ? ` (${h.estado})` : '')).join(', ')}`)
  if (j.archivosPatch?.length) L.push(`Archivos del último parche: ${j.archivosPatch.slice(0, 8).join(', ')}`)
  if (j.ultimoTexto) L.push(`Último paso:\n${j.ultimoTexto.slice(0, 900)}`)
  L.push('(Un timeout de observación no es un fallo: el trabajo sigue; vuelve a consultar.)')
  return L.join('\n')
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg == null || msg.method === undefined) return

  if (msg.method === 'initialize') {
    return send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'triaje-mcp', version: VERSION },
      },
    })
  }
  if (msg.method === 'notifications/initialized') return
  if (msg.method === 'ping') return send({ jsonrpc: '2.0', id: msg.id, result: {} })
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } })
  if (msg.method === 'tools/call') {
    const nombre = msg.params?.name
    const args = msg.params?.arguments || {}
    try {
      if (nombre === 'triaje_decidir') {
        const r = await fetch(`${HUB}/api/triaje`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tarea: String(args.tarea || ''), contexto: String(args.contexto || '') }),
          signal: AbortSignal.timeout(20000),
        })
        const j = await r.json()
        if (j.ok && args.solo_claude === true) {
          const c = aClaude(j)
          const texto = `modo: normal (solo Claude)\nsubagent_type: ${c.subagente}\nmodel: ${c.modelo}\neffort: ${c.esfuerzo}\nnota: ${c.nota}\n(origen: capa ${j.capa}, agente ${j.agente}, confianza ${typeof j.confianza === 'number' ? j.confianza.toFixed(2) : j.confianza}, fuente ${j.fuente})`
          return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: texto }] } })
        }
        const texto = j.ok
          ? `capa: ${j.capa}\nagente: ${j.agente}\nesfuerzo: ${j.esfuerzo ?? '(el del agente)'}\nescalar: ${j.escalar}\nriesgo: ${j.riesgo}\nconfianza: ${typeof j.confianza === 'number' ? j.confianza.toFixed(2) : j.confianza}\nfuente: ${j.fuente}\nmotivo: ${j.motivo}`
          : `Error del hub: ${j.error || 'desconocido'}`
        return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: texto }] } })
      }
      if (nombre === 'trabajo_estado') {
        const oc = await cargarOpenCode()
        const jobId = args.jobId ? String(args.jobId) : ''
        let texto
        if (jobId) {
          const r = oc.detalleJob(jobId)
          texto = r.ok ? formatearDetalle(r.job) : `No se pudo leer el trabajo: ${r.error}`
        } else {
          texto = formatearLista(oc.leerJobsRecientes(12 * 60 * 60 * 1000, 40))
        }
        return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: texto }] } })
      }
      if (nombre === 'parar_trabajos') {
        const todo = args.todo === true
        const directorio = args.directorio ? String(args.directorio) : ''
        if (!todo && !directorio) throw new Error('indica "todo": true para pararlo todo, o "directorio" para un proyecto concreto')
        const oc = await cargarOpenCode()
        const r = await oc.cancelarTrabajos({ todo, directory: directorio || null })
        const texto = r.revisados === 0
          ? 'No había trabajos activos que cancelar.'
          : `Cancelados ${r.cancelados} de ${r.revisados} trabajos activos:\n` + r.resultados.map((x) => `- ${x.jobId} · ${x.agente || '?'} · ${x.cancelado ? 'cancelado' : 'NO cancelado'} · ${x.motivo}`).join('\n')
        return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: texto }] } })
      }
      throw new Error(`herramienta desconocida: ${nombre}`)
    } catch (e) {
      // Reporta el fallo al registro central del hub (best effort, sin bloquear).
      try {
        await fetch(`${HUB}/api/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origen: 'mcp:triaje',
            severidad: 'error',
            mensaje: String(e?.message || e),
            stack: e?.stack || null,
            contexto: { herramienta: msg.params?.name || null },
          }),
          signal: AbortSignal.timeout(800),
        })
      } catch { /* hub apagado */ }
      return send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: `Error: ${String(e?.message || e)}` }] } })
    }
  }
  if (msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `método no soportado: ${msg.method}` } })
})
