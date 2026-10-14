#!/usr/bin/env node
/**
 * Pruebas del resumen propio de contexto (R7 de `docs/specs/10-patrones-de-hermes.md`).
 *
 * Patrón inspirado en NousResearch/hermes-agent (MIT), reimplementado.
 *
 * Sin dependencias: solo `node:assert`. Monta directorios temporales (nunca toca el
 * `hub-data` real), INYECTA un reloj y un lanzador FALSOS (jamás lanza jobs reales) y
 * comprueba:
 *   · bajo umbral no hace nada;
 *   · sobre umbral archiva lo intermedio, conserva 3 primeros y 20 últimos y crea
 *     `BITACORA-archivo/` con el original ÍNTEGRO;
 *   · la poda determinista corta volcados largos a `[volcado de N chars omitido]`;
 *   · el texto VERBATIM del usuario (`Usuario:` / `> `) y las decisiones se conservan;
 *   · con el resumidor caído → fallback determinista ≤ 8000 chars y secretos redactados;
 *   · el resumen que devuelve `redactor-ds` también se redacta antes de escribirlo;
 *   · carrera: un apunte nuevo añadido durante el resumen NO se pierde; si el tramo
 *     archivado cambia durante la espera → aborta sin tocar `BITACORA.md`;
 *   · fail-closed: si no se puede escribir/verificar `BITACORA-archivo` → `BITACORA.md`
 *     intacta y sin `ultima`;
 *   · cabeceras con fecha dentro de un bloque ``` no cuentan como apunte ni se parten;
 *   · dos compresiones simultáneas del mismo proyecto → la segunda se omite (`en_curso`);
 *   · episódica: segunda llamada el mismo día → `ya_comprimido_hoy`; al día siguiente vuelve;
 *   · un slug con `../` se rechaza.
 *
 * Uso: node scripts/test-compresion.mjs  (sale 0 si todo pasa)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { crearMemoria } from '../config/hub/lib/memoria.mjs'
import { crearCompresion, podarVolcados, resumenDeterminista, MAX_FALLBACK } from '../config/hub/lib/compresion.mjs'

let fallos = 0
async function prueba(nombre, fn) {
  try {
    await fn()
    console.log(`PASA  ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FALLA ${nombre}`)
    console.log(`      ${String(e?.message || e).split('\n')[0]}`)
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compresion-'))
console.log(`=== Pruebas de compresión de bitácora (R7) ===`)
console.log(`Temporal: ${raiz}\n`)

const UMBRAL = 800
const RES_MARKDOWN = [
  '## Objetivo', 'Terminar la feature.',
  '', '## Restricciones y preferencias', 'Sin dependencias.',
  '', '## Hecho', 'Se implementó X.',
  '', '## Estado activo', 'Revisión pendiente.',
  '', '## Bloqueos', 'Ninguno.',
  '', '## Decisiones clave', 'Usar Node puro.',
  '', '## Archivos relevantes', 'config/hub/lib/compresion.mjs',
].join('\n')

/** Lanzador falso: nunca lanza jobs reales. Captura los prompts que recibe. */
function lanzadorFalso({ falla = false, texto = RES_MARKDOWN } = {}) {
  const launches = []
  return {
    launches,
    async lanzarJob(job) {
      launches.push(job)
      if (falla) return { ok: false, codigo: 'servidor_inalcanzable', error: 'servidor V1 no arrancado' }
      return { ok: true, sessionId: `s_${launches.length}`, messageId: `m_${launches.length}` }
    },
    async esperarJob({ sessionId }) {
      if (falla) return { ok: false, codigo: 'timeout', error: 'no terminó' }
      return { ok: true, sessionId, estado: 'completado', texto, coste: 0 }
    },
  }
}

/** Bitácora de `n` apuntes, cada uno con `marca-<i>` y un cuerpo opcional. */
function construirBitacora(n, cuerpos = {}) {
  const partes = ['# BITÁCORA']
  for (let i = 0; i < n; i++) {
    const dd = String(i).padStart(2, '0')
    partes.push(`## 2026-05-${dd} 10:00 — apunte ${i}\nmarca-${i}\n${cuerpos[i] || ''}`.trimEnd())
  }
  return partes.join('\n') + '\n'
}

/** Proyecto nuevo con su BITACORA.md. Devuelve {memoria, slug, rutaBitacora}. */
function proyecto(nombre, texto) {
  const dir = path.join(raiz, nombre)
  fs.mkdirSync(dir, { recursive: true })
  const memoria = crearMemoria(dir)
  memoria.inicializar()
  const p = memoria.crearProyecto(`C:/repo/${nombre}`)
  const rutaBitacora = path.join(memoria.rutaProyecto(p.slug), 'BITACORA.md')
  fs.writeFileSync(rutaBitacora, texto, 'utf8')
  const leer = () => fs.readFileSync(rutaBitacora, 'utf8')
  return { memoria, slug: p.slug, rutaBitacora, leer, dir }
}

let reloj = Date.parse('2026-06-01T10:00:00Z')
const ahora = () => reloj

// 1 · Bajo umbral: no hace nada.
await prueba('bajo umbral no archiva ni toca la bitácora', async () => {
  const proy = proyecto('bajo', construirBitacora(5))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  assert.equal(comp.necesitaComprimir(proy.slug), false)
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true)
  assert.equal(r.omitido, 'bajo_umbral')
  assert.equal(r.archivado, 0)
  assert.ok(!fs.existsSync(path.join(proy.memoria.rutaProyecto(proy.slug), 'BITACORA-archivo')))
  assert.equal(proy.leer().includes('marca-0'), true)
})

// 2 · Sobre umbral: archiva lo intermedio y conserva 3 primeros + 20 últimos.
await prueba('sobre umbral: archiva lo intermedio y conserva 3 primeros y 20 últimos', async () => {
  const proy = proyecto('medio', construirBitacora(30, { 5: 'x'.repeat(1200) }))
  const lan = lanzadorFalso()
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lan, reglas: { bitacora_max_chars: UMBRAL }, ahora })
  assert.equal(comp.necesitaComprimir(proy.slug), true)
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.modo, 'redactor-ds')
  assert.equal(r.archivado, 7, `esperaba 7 apuntes archivados, hubo ${r.archivado}`)
  assert.ok(r.despues < r.antes)
  const nueva = proy.leer()
  // Conservados: 0,1,2 y 10..29.
  for (const i of [0, 1, 2, 10, 15, 29]) assert.ok(nueva.includes(`marca-${i}`), `debe conservar marca-${i}`)
  // Archivados: 3..9 fuera de la bitácora.
  for (const i of [3, 4, 5, 6, 7, 8, 9]) assert.ok(!nueva.includes(`marca-${i}`), `no debe quedar marca-${i}`)
  assert.ok(nueva.includes('## Resumen (comprimido '), 'debe quedar un bloque de resumen')
  // Archivo con el ORIGINAL íntegro.
  const dirArch = path.join(proy.memoria.rutaProyecto(proy.slug), 'BITACORA-archivo')
  const ficheros = fs.readdirSync(dirArch).filter((f) => f.endsWith('.md'))
  assert.equal(ficheros.length, 1)
  const archivo = fs.readFileSync(path.join(dirArch, ficheros[0]), 'utf8')
  for (const i of [3, 5, 9]) assert.ok(archivo.includes(`marca-${i}`), `el archivo debe conservar marca-${i}`)
  assert.ok(archivo.includes('x'.repeat(1200)), 'el archivo conserva el volcado íntegro')
  assert.ok(!archivo.includes('marca-10'), 'el archivo solo tiene lo intermedio')
})

// 3 · Poda determinista de volcados largos (y en el prompt del resumidor).
await prueba('poda: volcados > 1500 chars se cortan a placeholder', async () => {
  const dump = '```\n' + 'y'.repeat(3000) + '\n```'
  const podado = podarVolcados(`intro\n\n${dump}`)
  assert.ok(/\[volcado de \d+ chars omitido\]/.test(podado), podado)
  assert.ok(!podado.includes('y'.repeat(100)), 'el volcado no debe sobrevivir a la poda')

  const proy = proyecto('poda', construirBitacora(30, { 5: dump }))
  const lan = lanzadorFalso()
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lan, reglas: { bitacora_max_chars: UMBRAL }, ahora })
  await comp.comprimir(proy.slug)
  assert.equal(lan.launches.length, 1)
  assert.ok(lan.launches[0].agente === 'redactor-ds')
  assert.ok(/\[volcado de \d+ chars omitido\]/.test(lan.launches[0].prompt), 'el prompt debe llevar el texto podado')
})

// 4 · Verbatim del usuario conservado.
await prueba('verbatim: lo del usuario y las decisiones se conservan literales', async () => {
  const cuerpo = 'Usuario: quiero que esto sea verbatim\n> nota del usuario\n**Decisión** usar Node puro\nDECISIÓN: sin dependencias'
  const proy = proyecto('verbatim', construirBitacora(30, { 4: cuerpo }))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  const nueva = proy.leer()
  assert.ok(nueva.includes('## Verbatim'), 'debe haber sección Verbatim')
  assert.ok(nueva.includes('Usuario: quiero que esto sea verbatim'))
  assert.ok(nueva.includes('> nota del usuario'))
  assert.ok(nueva.includes('**Decisión** usar Node puro'))
  assert.ok(nueva.includes('DECISIÓN: sin dependencias'))
})

// 5 · Fallback determinista con secretos redactados.
await prueba('resumidor caído → fallback determinista ≤ 8000 y secretos redactados', async () => {
  const secreto = 'sk-abcdefghijklmnop0123'
  const cuerpo = `Usuario: despliega con ${secreto}\n- acción hecha en C:/x/y.mjs\nerror: fallo de red`
  const proy = proyecto('fallback', construirBitacora(30, { 6: cuerpo }))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso({ falla: true }), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.modo, 'determinista')
  const nueva = proy.leer()
  assert.ok(!nueva.includes(secreto), 'el secreto no debe aparecer sin redactar')
  assert.ok(nueva.includes('sk-***'), 'el secreto debe quedar redactado')
  assert.ok(nueva.includes('## Verbatim'), 'el verbatim del usuario sigue ahí')
  // El resumen determinista nunca supera el tope.
  assert.ok(resumenDeterminista('Usuario: x\n' + 'y'.repeat(20000)).length <= MAX_FALLBACK)
})

// 6 · Episódica: segunda llamada el mismo día.
await prueba('episódica: segunda compresión el mismo día se omite', async () => {
  const proy = proyecto('episodica', construirBitacora(30))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r1 = await comp.comprimir(proy.slug)
  assert.equal(r1.ok, true, r1.error)
  const r2 = await comp.comprimir(proy.slug)
  assert.equal(r2.ok, true)
  assert.equal(r2.omitido, 'ya_comprimido_hoy')
})

// 7 · Al día siguiente vuelve a permitir (reloj inyectable).
await prueba('episódica: al día siguiente (reloj inyectable) vuelve a comprimir', async () => {
  const proy = proyecto('diario', construirBitacora(30))
  let t = Date.parse('2026-06-10T10:00:00Z')
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora: () => t })
  const r1 = await comp.comprimir(proy.slug)
  assert.equal(r1.ok, true, r1.error)
  // Nuevo día y bitácora otra vez larga.
  t += 24 * 60 * 60 * 1000
  fs.writeFileSync(proy.rutaBitacora, construirBitacora(30), 'utf8')
  const r2 = await comp.comprimir(proy.slug)
  assert.equal(r2.ok, true, r2.error)
  assert.notEqual(r2.omitido, 'ya_comprimido_hoy')
  assert.equal(r2.modo, 'redactor-ds')
})

// 8 · Slug con traversal rechazado.
await prueba('slug con ../ rechazado', async () => {
  const proy = proyecto('traversal', construirBitacora(30))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  assert.equal(comp.necesitaComprimir('../escape'), false)
  const r = await comp.comprimir('../escape')
  assert.equal(r.ok, false)
  const e = comp.estado('../../etc')
  assert.equal(e.ok, false)
})

// 9 · Carrera: apunte nuevo añadido durante el resumen debe conservarse.
await prueba('carrera: un apunte nuevo durante el resumen se conserva', async () => {
  const proy = proyecto('carrera-nuevo', construirBitacora(30))
  const lan = lanzadorFalso()
  const origLanzar = lan.lanzarJob.bind(lan)
  lan.lanzarJob = async (job) => {
    fs.appendFileSync(proy.rutaBitacora, '\n## 2026-06-02 12:00 — apunte nuevo\nmarca-NUEVO\n', 'utf8')
    return origLanzar(job)
  }
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lan, reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  const nueva = proy.leer()
  assert.ok(nueva.includes('marca-NUEVO'), 'el apunte nuevo debe seguir en BITACORA.md')
  assert.ok(nueva.includes('## Resumen (comprimido '), 'y el resumen debe quedar')
  for (const i of [3, 4, 5, 6, 7, 8, 9]) assert.ok(!nueva.includes(`marca-${i}`), `marca-${i} debe archivarse`)
})

// 10 · Carrera: tramo archivado modificado durante la espera → aborta sin tocar la bitácora.
await prueba('carrera: tramo archivado modificado durante la espera → aborta', async () => {
  const proy = proyecto('carrera-cambio', construirBitacora(30))
  const antes = proy.leer()
  const lan = lanzadorFalso()
  const origLanzar = lan.lanzarJob.bind(lan)
  lan.lanzarJob = async (job) => {
    fs.writeFileSync(proy.rutaBitacora, antes.replace('marca-5', 'marca-5-CAMBIADO'), 'utf8')
    return origLanzar(job)
  }
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lan, reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'bitacora_cambio')
  const nueva = proy.leer()
  assert.ok(nueva.includes('marca-5-CAMBIADO'), 'BITACORA.md intacta con el cambio externo')
  assert.ok(!nueva.includes('## Resumen (comprimido '), 'no debe insertarse resumen')
  assert.ok(nueva.includes('marca-10') && nueva.includes('marca-29'), 'no se reescribe nada')
  assert.ok(!fs.existsSync(path.join(proy.memoria.rutaProyecto(proy.slug), '.compresion.json')), 'sin ultima grabada')
})

// 11 · Fail-closed: no se puede escribir/verificar el archivo → BITACORA.md intacta y sin ultima.
await prueba('fail-closed: archivo no escribible → BITACORA intacta y sin ultima', async () => {
  const proy = proyecto('fail-archivo', construirBitacora(30))
  fs.writeFileSync(path.join(proy.memoria.rutaProyecto(proy.slug), 'BITACORA-archivo'), 'soy un fichero, no una carpeta', 'utf8')
  const antes = proy.leer()
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'archivo_no_verificado')
  assert.equal(proy.leer(), antes, 'BITACORA.md debe quedar intacta')
  assert.ok(!fs.existsSync(path.join(proy.memoria.rutaProyecto(proy.slug), '.compresion.json')), 'sin ultima grabada')
})

// 12 · Fences: una cabecera con fecha dentro de ``` no cuenta ni parte el apunte.
await prueba('fences: cabecera con fecha dentro de ``` no cuenta ni parte el apunte', async () => {
  const fence = '```\ncodigo linea\n## 2026-05-15 10:00 — falso apunte\nmas codigo\n```'
  const proy = proyecto('fences', construirBitacora(30, { 5: fence }))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso(), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.archivado, 7, `la cabecera del fence no debe contar como apunte (hubo ${r.archivado})`)
  const nueva = proy.leer()
  assert.ok(!nueva.includes('## 2026-05-15 10:00 — falso apunte'), 'la cabecera del fence no queda suelta en la bitácora')
  const dirArch = path.join(proy.memoria.rutaProyecto(proy.slug), 'BITACORA-archivo')
  const f = fs.readdirSync(dirArch).find((x) => x.endsWith('.md'))
  const archivo = fs.readFileSync(path.join(dirArch, f), 'utf8')
  assert.ok(archivo.includes(fence), 'el fence íntegro (con su cabecera) va al archivo')
})

// 13 · Secretos: el resumen devuelto por el redactor se redacta antes de escribirlo.
await prueba('secretos: el resumen del redactor se redacta', async () => {
  const secreto = 'sk-abcdefghijklmnop0123'
  const texto = `${RES_MARKDOWN}\n\n## Notas\nusar ${secreto}`
  const proy = proyecto('secreto-res', construirBitacora(30))
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lanzadorFalso({ texto }), reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const r = await comp.comprimir(proy.slug)
  assert.equal(r.ok, true, r.error)
  const nueva = proy.leer()
  assert.ok(!nueva.includes(secreto), 'el secreto del resumen no debe quedar')
  assert.ok(nueva.includes('sk-***'), 'debe quedar redactado')
})

// 14 · Lock: dos compresiones simultáneas del mismo proyecto → solo una actúa.
await prueba('lock: dos compresiones simultáneas → la segunda se omite (en_curso)', async () => {
  const proy = proyecto('lock', construirBitacora(30))
  const lan = lanzadorFalso()
  const origEsperar = lan.esperarJob.bind(lan)
  lan.esperarJob = async (job) => { await new Promise((res) => setTimeout(res, 20)); return origEsperar(job) }
  const comp = crearCompresion({ memoria: proy.memoria, lanzador: lan, reglas: { bitacora_max_chars: UMBRAL }, ahora })
  const p1 = comp.comprimir(proy.slug)
  const p2 = comp.comprimir(proy.slug)
  const r2 = await p2
  assert.equal(r2.ok, true)
  assert.equal(r2.omitido, 'en_curso')
  const r1 = await p1
  assert.equal(r1.ok, true, r1.error)
  assert.equal(r1.archivado, 7)
})

// Limpieza.
try { fs.rmSync(raiz, { recursive: true, force: true }) } catch { /* nada */ }
console.log(`\nResultado: ${fallos === 0 ? 'PASA' : `FALLA (${fallos})`}`)
process.exit(fallos === 0 ? 0 : 1)
