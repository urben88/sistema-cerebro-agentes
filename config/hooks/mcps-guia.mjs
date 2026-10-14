#!/usr/bin/env node
/**
 * Resumen de la guía de uso de MCPs para el briefing (spec 13 · N3).
 *
 * `resumenGuia(texto, limite)` extrae de `MCPS-GUIA.md` la tabla «Si necesitas X → usa Y»
 * y las 3 reglas, y devuelve un texto de como mucho `limite` (1200) caracteres. Si no hay
 * guía (texto vacío o solo espacios), devuelve cadena vacía. Sin dependencias (Node >= 22).
 */

export const LIMITE_RESUMEN = 1200

export function resumenGuia(texto, limite = LIMITE_RESUMEN) {
  const t = String(texto ?? '')
  if (!t.trim()) return ''
  const lineas = t.split(/\r?\n/)

  // Filas de la tabla `| … |` (se descartan las líneas separadoras `|---|---|`).
  const filas = lineas.filter((l) => {
    const s = l.trim()
    return s.startsWith('|') && !/^\|[\s:|-]+\|$/.test(s)
  })

  // Ítems de lista que siguen al encabezado `## Reglas`.
  const iReglas = lineas.findIndex((l) => /^##\s+reglas\b/i.test(l.trim()))
  const reglas = iReglas >= 0
    ? lineas.slice(iReglas + 1).map((l) => l.trim()).filter((l) => /^(\d+[.)]|[-*])\s+/.test(l))
    : []

  const partes = ['## MCPs · si necesitas X usa Y', '', ...filas]
  if (reglas.length) partes.push('', 'Reglas:', ...reglas)
  let salida = partes.join('\n').trim()

  if (salida.length > limite) {
    let corte = salida.slice(0, limite - 1)
    const salto = corte.lastIndexOf('\n')
    if (salto > limite * 0.5) corte = corte.slice(0, salto)
    salida = corte.trimEnd() + '…'
    if (salida.length > limite) salida = salida.slice(0, limite)
  }
  return salida
}
