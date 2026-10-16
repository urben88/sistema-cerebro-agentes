/**
 * Reparto del modo normal (spec 15): traduce la decisión del triaje —que puede nombrar
 * agentes de OpenCode— a un subagente de Claude con modelo y esfuerzo. Nunca OpenCode.
 *
 *   Opus 5.5  → la sesión principal (lo global y lo trivial), `arquitecto` (high) y `consultor` (low)
 *   Sonnet    → `resolutor` (el cómo de un área acotada; medium, high al depurar o si es delicado)
 *               y `retocador` (low: cambios pequeños con algo de criterio)
 *   Haiku     → explorador, redactor, analista, planificador, subdirector, ayudante
 */
export const CLAUDE_AGENTES = {
  explorador: { modelo: 'haiku', esfuerzo: 'low' },
  redactor: { modelo: 'haiku', esfuerzo: 'low' },
  ayudante: { modelo: 'haiku', esfuerzo: 'low' },
  analista: { modelo: 'haiku', esfuerzo: 'medium' },
  subdirector: { modelo: 'haiku', esfuerzo: 'medium' },
  planificador: { modelo: 'haiku', esfuerzo: 'medium' },
  retocador: { modelo: 'sonnet', esfuerzo: 'low' },
  resolutor: { modelo: 'sonnet', esfuerzo: 'medium' },
  consultor: { modelo: 'opus', esfuerzo: 'low' },
  arquitecto: { modelo: 'opus', esfuerzo: 'high' },
}

export const OC_A_CLAUDE = {
  'explorador-ds': 'explorador',
  'redactor-ds': 'redactor',
  local: 'ayudante',
  testeador: 'analista',
  revisor: 'analista',
  implementador: 'resolutor',
  debugger: 'resolutor',
  'local-codigo': 'resolutor',
}

const NOTAS = {
  retocador: 'cambio pequeño en 1–2 archivos con algo de criterio: archivos, qué y comprobación, y «Modo: PLAN|EJECUTAR»; si crece, para y lo dice',
  consultor: 'segunda opinión rápida (solo lectura, ≤10 líneas): pásale la decisión y las 2–3 opciones; lo difícil va al arquitecto',
  resolutor: 'área acotada: dile dónde profundizar, hipótesis, criterio de terminado y «Modo: PLAN|EJECUTAR»; va en medium, sube a high al depurar o si es delicado',
  ayudante: 'solo en EJECUTAR y con instrucciones exactas (archivos y cambio concreto)',
  arquitecto: 'decisión global con Opus: pásale el problema y las restricciones, no el hilo entero',
}

export function aClaude(j = {}) {
  const a = String(j.agente || '').toLowerCase()
  const dificil = j.escalar === true || j.riesgo === true || /alto|high/i.test(String(j.riesgo))
  let sub = CLAUDE_AGENTES[a] ? a : OC_A_CLAUDE[a]
  if (sub === 'analista' && dificil) sub = 'arquitecto'
  if (sub) {
    const nota = NOTAS[sub] || 'delegable; encargo acotado y salida breve'
    const ag = { ...CLAUDE_AGENTES[sub] }
    // El resolutor sube a high al depurar o en tareas delicadas.
    if (sub === 'resolutor' && (dificil || a === 'debugger')) ag.esfuerzo = 'high'
    return { subagente: sub, ...ag, nota: dificil ? `${nota} · tarea delicada: revisa tú el resultado` : nota }
  }
  // Decisión del cerebro (lo global o sin coincidencia): la toma la sesión principal (Opus).
  return { subagente: '(ninguno: hazlo tú en el hilo principal)', modelo: 'opus', esfuerzo: dificil ? 'high' : 'medium', nota: 'decisión o análisis global: lo haces tú (Opus); si se vuelve trabajo de un área, encárgalo al resolutor' }
}
