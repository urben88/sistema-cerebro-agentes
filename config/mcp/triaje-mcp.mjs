#!/usr/bin/env node
/**
 * MCP de triaje — expone la decisión local del Cerebro Hub (Laya + reglas) como
 * herramienta MCP para Claude Code y OpenCode. Sin dependencias.
 *
 * Herramienta: triaje_decidir { tarea, contexto? }
 *   → devuelve { capa, agente, esfuerzo, escalar, riesgo, confianza, fuente, motivo }
 *
 * Variables: HUB_URL (por defecto http://127.0.0.1:4597)
 */
import readline from 'node:readline'

const HUB = process.env.HUB_URL || 'http://127.0.0.1:4597'
const VERSION = '0.2.0'

const TOOLS = [
  {
    name: 'triaje_decidir',
    description: 'Decide qué agente y esfuerzo debe hacer una tarea (modelo local Laya + reglas). Úsalo antes de delegar si dudas de a quién mandar el trabajo. Devuelve la capa (claude/opencode), agente, esfuerzo, si conviene escalar, si hay riesgo y el motivo.',
    inputSchema: {
      type: 'object',
      properties: {
        tarea: { type: 'string', description: 'Descripción breve de la tarea (una o dos frases).' },
        contexto: { type: 'string', description: 'Contexto opcional: proyecto, ficheros, complejidad.' },
      },
      required: ['tarea'],
    },
  },
]

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

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
      if (nombre !== 'triaje_decidir') throw new Error(`herramienta desconocida: ${nombre}`)
      const r = await fetch(`${HUB}/api/triaje`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarea: String(args.tarea || ''), contexto: String(args.contexto || '') }),
        signal: AbortSignal.timeout(20000),
      })
      const j = await r.json()
      const texto = j.ok
        ? `capa: ${j.capa}\nagente: ${j.agente}\nesfuerzo: ${j.esfuerzo ?? '(el del agente)'}\nescalar: ${j.escalar}\nriesgo: ${j.riesgo}\nconfianza: ${typeof j.confianza === 'number' ? j.confianza.toFixed(2) : j.confianza}\nfuente: ${j.fuente}\nmotivo: ${j.motivo}`
        : `Error del hub: ${j.error || 'desconocido'}`
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: texto }] } })
    } catch (e) {
      return send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: `Error: ${String(e?.message || e)}` }] } })
    }
  }
  if (msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `método no soportado: ${msg.method}` } })
})
