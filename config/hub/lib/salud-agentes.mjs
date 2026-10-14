/**
 * Salud por agente y degradación automática con reintento (spec 12 · L2/L3).
 *
 * Deriva el estado de cada agente **del ledger de trabajos** (sin fichero propio, así
 * sobrevive a reinicios): sobre sus últimos `ventana` trabajos terminales (excluye
 * `cancelado`) calcula la tasa de fallo (`fallido` + `atascado`) y los fallos seguidos.
 * Si hay ≥ `minimoMuestras` y (tasa > `maxTasaFallo` o fallos seguidos ≥ `maxFallosSeguidos`),
 * `resolver(agente)` lo **degrada** al sustituto configurado (`a`). Pasado `enfriamientoMin`
 * desde el último fallo permite **una prueba** (`prueba:true`): si acierta, el contador se
 * limpia solo; si falla, empieza otro enfriamiento.
 *
 * Configuración en `reglas.json` → `respaldo`:
 *   { "local-codigo": { "a": "implementador", "ventana": 6, "minimoMuestras": 3,
 *     "maxTasaFallo": 0.5, "maxFallosSeguidos": 2, "enfriamientoMin": 60 } }
 *
 * Sin dependencias (Node >= 22).
 */

/** Estados que no cuentan como muestra: aún no han terminado, o se cancelaron a propósito. */
const NO_TERMINALES = new Set(['pendiente', 'en_curso', 'cancelado', 'desconocido'])
/** Estados que cuentan como fallo del agente. */
const FALLOS = new Set(['fallido', 'atascado'])

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number(v) || 0))
const cfgNum = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def)

/**
 * Crea el medidor de salud. `ledger` es el de `lib/ledger.mjs` (basta con `leer()`);
 * `ahora` se puede inyectar en pruebas.
 *
 *   estado(agente)   · métricas actuales (muestras, tasa, fallos seguidos, degradado…).
 *   resolver(agente) · decisión de respaldo: `{agente, degradado?}` o `{agente, prueba:true}`.
 */
export function crearSaludAgentes({ ledger, reglas = {}, ahora = () => Date.now() } = {}) {
  // Pruebas concedidas (en memoria): una por agente y fallo base; caducan solas (TTL) por si
  // el job de prueba nunca llega al ledger. Tras un reinicio se puede conceder una más: sin riesgo.
  const pruebas = new Map()
  const TTL_PRUEBA_MS = 10 * 60 * 1000
  const respaldos = reglas && typeof reglas.respaldo === 'object' && reglas.respaldo ? reglas.respaldo : {}

  /** Toma de los últimos `ventana` trabajos terminales del agente (más reciente primero). */
  function muestrasDe(agente, cfg) {
    const ventana = cfgNum(cfg.ventana, 6)
    const lista = Array.isArray(ledger?.leer?.()) ? ledger.leer() : []
    return lista
      .filter((e) => e && e.agente === agente && !NO_TERMINALES.has(e.estado))
      .sort((a, b) => num(b.actualizado) - num(a.actualizado))
      .slice(0, ventana)
  }

  function estado(agente) {
    const cfg = respaldos[agente]
    if (!cfg) return { agente, respaldo: false, muestras: 0, fallos: 0, tasaFallo: 0, fallosSeguidos: 0, degradado: false, proximaPrueba: null, candidatoDegradar: false, pruebable: false }

    const entradas = muestrasDe(agente, cfg)
    const muestras = entradas.length
    const fallos = entradas.filter((e) => FALLOS.has(e.estado)).length
    const tasaFallo = muestras ? fallos / muestras : 0
    let fallosSeguidos = 0
    for (const e of entradas) {
      if (!FALLOS.has(e.estado)) break
      fallosSeguidos++
    }

    const min = cfgNum(cfg.minimoMuestras, 3)
    const maxTasa = cfgNum(cfg.maxTasaFallo, 0.5)
    const maxSeg = cfgNum(cfg.maxFallosSeguidos, 2)
    const enfriamientoMs = cfgNum(cfg.enfriamientoMin, 60) * 60 * 1000
    const ultimoFallo = entradas.find((e) => FALLOS.has(e.estado)) || null

    // Solo se degrada si hay base suficiente, el último trabajo es un fallo (así un acierto
    // limpia el estado) y se supera uno de los dos umbrales.
    const candidatoDegradar = muestras >= min && fallosSeguidos > 0 && (tasaFallo > maxTasa || fallosSeguidos >= maxSeg)
    const proximaPruebaTs = candidatoDegradar && ultimoFallo ? num(ultimoFallo.actualizado) + enfriamientoMs : null
    const base = ultimoFallo ? num(ultimoFallo.actualizado) : null
    const concedida = pruebas.get(agente)
    const pruebaViva = Boolean(concedida && concedida.base === base && ahora() < concedida.ts + TTL_PRUEBA_MS)
    const pruebable = candidatoDegradar && proximaPruebaTs != null && ahora() >= proximaPruebaTs && !pruebaViva
    const degradado = candidatoDegradar && !pruebable

    return {
      agente,
      respaldo: true,
      a: cfg.a || null,
      muestras,
      fallos,
      tasaFallo,
      fallosSeguidos,
      degradado,
      proximaPrueba: degradado ? (pruebaViva ? concedida.ts + TTL_PRUEBA_MS : proximaPruebaTs) : null,
      enPrueba: pruebaViva,
      base,
      candidatoDegradar,
      pruebable,
    }
  }

  function resolver(agente) {
    const e = estado(agente)
    if (!e.respaldo || !e.a) return { agente, degradado: false }
    if (e.degradado) {
      return {
        agente: e.a,
        agenteOriginal: agente,
        degradado: true,
        proximaPrueba: e.proximaPrueba,
        motivo: `${agente} degradado a ${e.a}: ${e.fallos} de ${e.muestras} fallaron`,
      }
    }
    if (e.pruebable) {
      pruebas.set(agente, { base: e.base, ts: ahora() })
      return {
        agente,
        degradado: false,
        prueba: true,
        motivo: `${agente}: prueba tras el enfriamiento (${e.fallos} de ${e.muestras} fallaron)`,
      }
    }
    return { agente, degradado: false }
  }

  return { estado, resolver }
}
