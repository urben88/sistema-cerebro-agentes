/**
 * Clasificador de errores para el panel y el vigilante (R5/R6).
 *
 * Convierte un texto de error crudo (el `error.message` de un job, un fallo de red,
 * etc.) en algo legible y accionable: tipo, título, una frase de causa y una de
 * acción concreta, conservando el texto original en `crudo`.
 *
 * Sin dependencias. Funciones puras, probadas al ejecutar este archivo directamente:
 *   node config/hub/lib/errores.mjs
 */
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Reglas ordenadas: la primera coincidencia gana. Los `re` se prueban sobre el texto
// en minúsculas; el `crudo` que se devuelve es el original sin tocar.
const REGLAS = [
  {
    tipo: 'timeout',
    titulo: 'Tiempo de espera agotado',
    causa: 'La operación tardó más de lo permitido y se cortó.',
    accion: 'Reintenta el trabajo o reduce el alcance de la tarea.',
    re: /timeout|timed out|etimedout|abort.?error|aborterror|temporizador|tiempo de espera/,
  },
  {
    tipo: 'permiso',
    titulo: 'Permiso denegado',
    causa: 'El sistema no autorizó la operación (archivo, carpeta o acción).',
    accion: 'Revisa los permisos del agente o del recurso y vuelve a lanzarlo.',
    re: /permission|permiso|denied|denegad|forbidden|not permitted|eacces|eperm|unauthor|401|403/,
  },
  {
    tipo: 'cuota',
    titulo: 'Cuota o límite alcanzado',
    causa: 'Se agotó la cuota, el saldo o el límite de peticiones del proveedor.',
    accion: 'Espera a que se reponga la cuota o revisa el saldo y el plan del proveedor.',
    re: /quota|cuota|l[ií]mite|rate.?limit|too many requests|429|insufficient|balance|sin saldo|payment|402|exceeded/,
  },
  {
    tipo: 'sin_servidor',
    titulo: 'Servidor no disponible',
    causa: 'No se pudo contactar con el servidor (hub u OpenCode) o está apagado.',
    accion: 'Arranca el hub/OpenCode y reintenta el trabajo.',
    re: /econnrefused|fetch failed|enotfound|eai_again|econnreset|socket hang up|servidor v1 no arrancado|no arrancado|hub no responde|connection refused/,
  },
  {
    tipo: 'modelo',
    titulo: 'Modelo o proveedor no disponible',
    causa: 'El modelo o proveedor configurado para el agente no está disponible.',
    accion: 'Revisa el modelo del agente y la conexión del proveedor en OpenCode.',
    re: /model|modelo|provider|proveedor|unknown model|no such model|unsupported model|invalid model/,
  },
  {
    tipo: 'cancelado',
    titulo: 'Trabajo cancelado',
    causa: 'El trabajo se canceló antes de terminar.',
    accion: 'Vuelve a lanzarlo si aún lo necesitas.',
    re: /cancel|abort|cancelado|cancelled|canceled/,
  },
]

const DESCONOCIDO_VACIO = {
  tipo: 'desconocido',
  titulo: 'Fallo sin detalle',
  causa: 'El trabajo falló pero no se registró un mensaje de error.',
  accion: 'Abre el trabajo en OpenCode o revisa los registros del hub.',
}

const DESCONOCIDO = {
  tipo: 'desconocido',
  titulo: 'Error no clasificado',
  causa: 'Ocurrió un error que el sistema no reconoce.',
  accion: 'Revisa el texto crudo del error y los registros del hub.',
}

/**
 * Clasifica un texto de error.
 * @param {unknown} texto
 * @returns {{ tipo: string, titulo: string, causa: string, accion: string, crudo: string }}
 */
export function clasificarError(texto) {
  const crudo = texto == null ? '' : String(texto)
  const t = crudo.toLowerCase()
  if (!t.trim()) return { ...DESCONOCIDO_VACIO, crudo }
  for (const r of REGLAS) {
    if (r.re.test(t)) {
      return { tipo: r.tipo, titulo: r.titulo, causa: r.causa, accion: r.accion, crudo }
    }
  }
  return { ...DESCONOCIDO, crudo }
}

/**
 * Clasifica una alerta del vigilante con la misma forma que `clasificarError`.
 * Las alertas no traen texto de error: se describe la situación observada.
 * @param {{ tipo?: string, minutos?: number, title?: string }} alerta
 */
export function clasificarAlerta(alerta) {
  const minutos = Number.isFinite(alerta?.minutos) ? alerta.minutos : null
  const cuando = minutos != null ? `lleva ${minutos} min` : 'lleva demasiado tiempo'
  const crudo = alerta?.title ? String(alerta.title) : ''
  if (alerta?.tipo === 'permiso-colgado') {
    return {
      tipo: 'permiso',
      titulo: 'Permiso pendiente',
      causa: `El trabajo ${cuando} esperando autorización.`,
      accion: 'Responde al permiso en OpenCode o cancélalo desde el panel.',
      crudo,
    }
  }
  if (alerta?.tipo === 'atascado') {
    return {
      tipo: 'atasco',
      titulo: 'Trabajo atascado',
      causa: `El trabajo ${cuando} sin avanzar.`,
      accion: 'Revisa el último paso del trabajo o cancélalo desde el panel.',
      crudo,
    }
  }
  return {
    tipo: 'desconocido',
    titulo: 'Alerta del vigilante',
    causa: 'El vigilante emitió una alerta sobre un trabajo.',
    accion: 'Revisa el trabajo en el panel.',
    crudo,
  }
}

// ---------------------------------------------------------------- pruebas (R5)
// Lógica pura: solo se ejecutan al lanzar este archivo directamente, nunca al importarlo.
//   node config/hub/lib/errores.mjs
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let fallos = 0
  const af = (cond, msg) => { if (cond) console.log(`  OK: ${msg}`); else { fallos++; console.error(`  FALLO: ${msg}`) } }

  console.log('R5 · clasificarError (al menos 6 tipos, CA3)')
  const casos = [
    ['Timeout esperando al servidor local', 'timeout'],
    ['Permission denied: no se puede escribir en el archivo', 'permiso'],
    ['HTTP 429 Too Many Requests', 'cuota'],
    ['servidor V1 no arrancado (falta server-port.txt)', 'sin_servidor'],
    ['Unknown model: deepseek/nope', 'modelo'],
    ['Cerebro: cancelado (sesión cerrada)', 'cancelado'],
    ['Algo raro pasó', 'desconocido'],
  ]
  for (const [texto, esperado] of casos) {
    const r = clasificarError(texto)
    af(r.tipo === esperado, `«${texto}» → ${esperado} (obtenido: ${r.tipo})`)
  }

  console.log('R5 · forma del resultado')
  const r = clasificarError('fetch failed')
  af(typeof r.titulo === 'string' && r.titulo.length > 0, 'titulo no vacío')
  af(typeof r.causa === 'string' && r.causa.length > 0, 'causa no vacía')
  af(typeof r.accion === 'string' && r.accion.length > 0, 'accion no vacía')
  af(r.crudo === 'fetch failed', 'crudo conserva el texto original')
  const vacio = clasificarError('')
  af(vacio.tipo === 'desconocido' && vacio.crudo === '', 'texto vacío → desconocido con crudo vacío')
  const nulo = clasificarError(null)
  af(nulo.tipo === 'desconocido', 'null → desconocido')

  console.log('R6 · clasificarAlerta')
  af(clasificarAlerta({ tipo: 'atascado', minutos: 15 }).tipo === 'atasco', 'atascado → atasco')
  af(clasificarAlerta({ tipo: 'permiso-colgado', minutos: 25 }).tipo === 'permiso', 'permiso-colgado → permiso')
  af(clasificarAlerta({ tipo: 'otro' }).titulo.length > 0, 'alerta desconocida tiene título')

  console.log(fallos === 0 ? '\nPRUEBAS errores.mjs: TODO OK' : `\nPRUEBAS errores.mjs: ${fallos} fallo(s)`)
  process.exitCode = fallos === 0 ? 0 : 1
}
