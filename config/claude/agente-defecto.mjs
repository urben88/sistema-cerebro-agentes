#!/usr/bin/env node
/**
 * Deja `cerebro-oc` como default_agent de OpenCode después de gentle-ai (spec 20 · L8).
 *
 * Uso: node agente-defecto.mjs [ruta-opencode.jsonc]   (por defecto ~/.config/opencode/opencode.jsonc)
 *
 * gentle-ai cambia default_agent a `gentle-orchestrator`. Aquí solo se revierte ese valor,
 * con un reemplazo de texto acotado (el archivo es JSONC: no se reescribe, para conservar
 * los comentarios) y solo si existe el agente cerebro-oc. No toca .gentle-ai-default-agent.json.
 * Salida 0 = hecho o ya estaba; 2 = no se pudo (se avisa y el instalador sigue).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ruta = process.argv[2] || path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc')
const NUESTRO = 'cerebro-oc'
const DE_GENTLE = 'gentle-orchestrator'
const aviso = (m) => { console.log(`Aviso: ${m}`); process.exit(2) }

if (!fs.existsSync(ruta)) aviso(`no existe ${ruta}; default_agent sin tocar.`)
if (!fs.existsSync(path.join(path.dirname(ruta), 'agents', `${NUESTRO}.md`))) aviso(`falta el agente ${NUESTRO}; default_agent sin tocar.`)

const texto = fs.readFileSync(ruta, 'utf8')
const lineas = texto.split(/\r?\n/)
const re = /"default_agent"\s*:\s*"([^"]*)"/
const coincidencias = lineas.filter((l) => !/^\s*\/\//.test(l) && re.test(l))
if (coincidencias.length !== 1) aviso(`default_agent aparece ${coincidencias.length} veces en ${ruta}; sin tocar (pon "${NUESTRO}" a mano).`)

const actual = re.exec(coincidencias[0])[1]
if (actual === NUESTRO) { console.log(`default_agent de OpenCode ya es ${NUESTRO}.`); process.exit(0) }
if (actual !== DE_GENTLE) { console.log(`default_agent de OpenCode es "${actual}" (elegido por ti); sin tocar.`); process.exit(0) }

const nuevo = texto.replace(`"default_agent": "${DE_GENTLE}"`, `"default_agent": "${NUESTRO}"`)
if (nuevo === texto) aviso(`formato inesperado de default_agent en ${ruta}; sin tocar.`)
fs.writeFileSync(ruta, nuevo)
console.log(`default_agent de OpenCode: ${DE_GENTLE} -> ${NUESTRO} (.gentle-ai-default-agent.json sin tocar).`)
