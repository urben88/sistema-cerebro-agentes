/**
 * Vigilante de trabajos: detecta atascos, permisos colgados y avisa.
 * Barato por diseño: solo mira estados y tiempos, no conversaciones.
 */
export function crearVigilante({ leerJobs, config, registrar }) {
  let alertas = []
  const enfriamiento = new Map() // clave -> timestamp de la última alerta emitida

  const MIN = 60 * 1000

  function revisar({ silencioso = false } = {}) {
    const ahora = Date.now()
    const limiteRecencia = ahora - (config.horasMaxJob || 24) * 60 * 60 * 1000
    const jobs = leerJobs(80).filter((j) => (j.updatedAt || 0) >= limiteRecencia)
    const candidatas = []
    for (const j of jobs) {
      if (j.status === 'running' || j.status === 'accepted') {
        const minutos = (ahora - (j.updatedAt || ahora)) / MIN
        if (minutos >= config.minutosAtasco) candidatas.push({ tipo: 'atascado', jobId: j.jobId, sessionId: j.sessionId, directory: j.directory, title: j.title, minutos: Math.round(minutos) })
      } else if (j.status === 'input_required') {
        const minutos = (ahora - (j.updatedAt || ahora)) / MIN
        if (minutos >= config.minutosPermiso) candidatas.push({ tipo: 'permiso-colgado', jobId: j.jobId, sessionId: j.sessionId, directory: j.directory, title: j.title, minutos: Math.round(minutos) })
      }
    }
    const emitidas = []
    for (const c of candidatas) {
      const clave = `${c.tipo}:${c.jobId}`
      const ultima = enfriamiento.get(clave) || 0
      if (ahora - ultima < config.minutosEnfriamiento * MIN) continue
      enfriamiento.set(clave, ahora)
      emitidas.push({ ...c, cuando: ahora })
      if (registrar) registrar(c)
    }
    // En el primer chequeo (arranque) no se pueblan las alertas vivas: solo se registra
    // el histórico en el log. A partir de ahí, las alertas nuevas sí se muestran.
    if (emitidas.length && !silencioso) alertas = [...emitidas, ...alertas].slice(0, 50)
    // limpiar alertas de trabajos ya terminados (salvo las de los últimos 10 min)
    const porJob = new Map(jobs.map((j) => [j.jobId, j.status]))
    alertas = alertas.filter((a) => {
      const estado = porJob.get(a.jobId)
      if (estado && estado !== 'running' && estado !== 'accepted' && estado !== 'input_required') return ahora - a.cuando < 10 * MIN
      return true
    })
  }

  /**
   * Inyecta una alerta externa (p. ej. del ledger de trabajos, R3) con el mismo
   * enfriamiento y el mismo registro que las que detecta el propio vigilante.
   * Devuelve `false` si el enfriamiento la descarta.
   */
  function agregar(a) {
    if (!a || !a.jobId) return false
    const ahora = Date.now()
    const clave = `${a.tipo || 'aviso'}:${a.jobId}`
    if (ahora - (enfriamiento.get(clave) || 0) < (config.minutosEnfriamiento || 30) * MIN) return false
    enfriamiento.set(clave, ahora)
    const completa = { ...a, cuando: ahora }
    alertas = [completa, ...alertas].slice(0, 50)
    if (registrar) registrar(completa)
    return true
  }

  function arrancar(intervaloMs = 60 * 1000) {
    revisar({ silencioso: true })
    const timer = setInterval(() => revisar(), intervaloMs)
    timer.unref?.()
    return timer
  }

  return { revisar, arrancar, alertas: () => alertas, limpiar: () => { alertas = [] }, agregar }
}
