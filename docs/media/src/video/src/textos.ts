// Todos los textos del vídeo, en un solo sitio.
//   en = versión principal · es = misma pieza en español
// Ningún dato personal: sin rutas de usuario, correos, claves ni proyectos privados.

import { TOTAL_DIA } from './datos';

export type Idioma = 'en' | 'es';

/** Formatea un coste con el símbolo y el separador decimal de cada idioma. */
export const formatoCoste = (valor: number, idioma: Idioma, decimales = 2): string => {
  const cifra = valor.toFixed(decimales);
  return idioma === 'en' ? `$${cifra}` : `${cifra.replace('.', ',')} $`;
};

export const en = {
  /** Escena 1 · Problema */
  problema: {
    cuota: 'Quota',
    coste: 'Cost',
    subtitulo1: 'Using the top model for everything is expensive…',
    subtitulo2: '…and your quota runs out mid-day.',
  },

  /** Escena 2 · La idea (se muestran de arriba abajo) */
  idea: {
    niveles: [
      { nombre: 'Opus', rol: 'decides' },
      { nombre: 'Sonnet', rol: 'solves one area' },
      { nombre: 'Haiku', rol: 'searches, writes and verifies' },
      { nombre: 'DeepSeek', rol: 'writes the code' },
    ],
    subtitulo: 'One brain decides. Cheaper agents do the work.',
  },

  /** Escena 3 · Un día de trabajo */
  dia: {
    columnas: { tarea: 'Task', agente: 'Agent', jobs: 'Jobs', coste: 'Cost' },
    total: 'Day total',
    subtitulo: 'A real day of work, task by task.',
  },

  /** Escena 4 · Resultado */
  resultado: {
    equipo: 'This team',
    opus: 'Opus for everything',
    subtitulo: `${formatoCoste(TOTAL_DIA, 'en')} for the whole day.`,
  },

  /** Escena 5 · Instalar */
  instalar: {
    subtitulo: 'Install it in one command.',
    windows: 'Windows',
    unix: 'macOS / Linux',
    comandos: [
      'git clone https://github.com/urben88/sistema-cerebro-agentes.git',
      'powershell -ExecutionPolicy Bypass -File .\\install.ps1',
      'bash install.sh',
    ],
  },

  /** Marcas y notas compartidas entre escenas */
  estimacion: 'estimate',
  notaCoste:
    'Real DeepSeek cost from hub metrics. Claude (Opus/Haiku) usage runs on your subscription and is not included.',
};

export type Textos = typeof en;

export const es: Textos = {
  /** Escena 1 · Problema */
  problema: {
    cuota: 'Cuota',
    coste: 'Coste',
    subtitulo1: 'Usar el modelo top para todo es caro…',
    subtitulo2: '…y la cuota se agota a media jornada.',
  },

  /** Escena 2 · La idea (se muestran de arriba abajo) */
  idea: {
    niveles: [
      { nombre: 'Opus', rol: 'decide' },
      { nombre: 'Sonnet', rol: 'resuelve un área' },
      { nombre: 'Haiku', rol: 'busca, redacta y verifica' },
      { nombre: 'DeepSeek', rol: 'escribe el código' },
    ],
    subtitulo: 'Un cerebro decide. Agentes más baratos hacen el trabajo.',
  },

  /** Escena 3 · Un día de trabajo */
  dia: {
    columnas: { tarea: 'Tarea', agente: 'Agente', jobs: 'Jobs', coste: 'Coste' },
    total: 'Total del día',
    subtitulo: 'Un día real de trabajo, tarea a tarea.',
  },

  /** Escena 4 · Resultado */
  resultado: {
    equipo: 'Este equipo',
    opus: 'Opus para todo',
    subtitulo: `${formatoCoste(TOTAL_DIA, 'es')} por todo el día.`,
  },

  /** Escena 5 · Instalar */
  instalar: {
    subtitulo: 'Instálalo con un comando.',
    windows: 'Windows',
    unix: 'macOS / Linux',
    comandos: [
      'git clone https://github.com/urben88/sistema-cerebro-agentes.git',
      'powershell -ExecutionPolicy Bypass -File .\\install.ps1',
      'bash install.sh',
    ],
  },

  /** Marcas y notas compartidas entre escenas */
  estimacion: 'estimación',
  notaCoste:
    'Coste real de DeepSeek según las métricas del hub. El uso de Claude (Opus/Haiku) va en tu suscripción y no está incluido.',
};

export const textos: Record<Idioma, Textos> = { en, es };
