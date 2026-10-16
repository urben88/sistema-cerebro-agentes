// Datos y constantes visuales del vídeo.
//
// Todas las cifras son reales y salen de las métricas del hub:
//   GET /api/metricas  →  eventos { tipo: "job" }
// medidos el 2026-10-15/16. Los costes son de DeepSeek, los únicos jobs
// que registran coste (Claude va en suscripción y no se puede medir aquí).

/** Formato del vídeo: 1920×1080, 30 fps, 2250 frames (75 s). */
export const FORMATO = {
  ancho: 1920,
  alto: 1080,
  fps: 30,
  duracionFrames: 2250,
} as const;

/** Duración de cada escena en frames, según el guion. La suma es 2250. */
export const ESCENAS = {
  problema: 360,
  idea: 450,
  dia: 840,
  resultado: 360,
  instalar: 240,
} as const;

/** Un día real de trabajo: 38 jobs de DeepSeek con coste registrado (2026-10-15/16). */
export type FilaDia = {
  tarea: { en: string; es: string };
  agente: string;
  jobs: number;
  coste: number;
};

export const FILAS_DIA: FilaDia[] = [
  { tarea: { en: 'Explore a repo', es: 'Explorar un repo' }, agente: 'explorador-ds', jobs: 1, coste: 0.04 },
  { tarea: { en: 'Write the docs', es: 'Escribir la documentación' }, agente: 'redactor-ds', jobs: 1, coste: 0.03 },
  { tarea: { en: 'Ship features & fixes', es: 'Features y arreglos' }, agente: 'implementador', jobs: 23, coste: 1.59 },
  { tarea: { en: 'Review every change', es: 'Revisar cada cambio' }, agente: 'revisor', jobs: 11, coste: 0.27 },
  { tarea: { en: 'Run the tests', es: 'Pasar los tests' }, agente: 'testeador', jobs: 1, coste: 0.01 },
];

/** Total del día según las métricas del hub: 1,94 $, incluidos 0,005 $ de una prueba. */
export const TOTAL_DIA = 1.94;

/** Jobs contados ese día en las métricas del hub (incluye el job de la prueba). */
export const JOBS_DIA = 38;

/**
 * Estimación: ratio aproximado de tarifa por token Opus vs DeepSeek.
 * Pendiente de confirmar; en pantalla se marca siempre como «estimate»/«estimación».
 */
export const OPUS_FACTOR = 30;

/** Coste estimado de hacer todo el día con Opus: total × factor, redondeado (58 $). */
export const COSTE_OPUS_ESTIMADO = Math.round(TOTAL_DIA * OPUS_FACTOR);

/** Paleta del vídeo: fondo oscuro, texto de alto contraste y un acento por modelo. */
export const COLORES = {
  fondo: '#0d1117',
  panel: '#161b22',
  panelOscuro: '#010409',
  borde: '#30363d',
  texto: '#e6edf3',
  textoSuave: '#8b949e',
  opus: '#a371f7',
  sonnet: '#f0883e',
  haiku: '#3fb950',
  deepseek: '#4493f8',
  rojo: '#f85149',
  aviso: '#d29922',
} as const;

/** Tipografías del sistema: nada que descargar. */
export const FUENTE_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FUENTE_MONO =
  'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';
