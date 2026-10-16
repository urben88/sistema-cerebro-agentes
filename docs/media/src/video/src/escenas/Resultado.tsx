import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORES, COSTE_OPUS_ESTIMADO, TOTAL_DIA } from '../datos';
import { formatoCoste, Idioma, Textos } from '../textos';
import { Subtitulo } from '../Subtitulo';

const ANCHO_MAX = 1300;
/** Píxeles de barra por dólar: la barra de Opus (estimada) es la que marca la escala. */
const PX_POR_DOLAR = ANCHO_MAX / COSTE_OPUS_ESTIMADO;

const Barra: React.FC<{
  etiqueta: string;
  valor: string;
  marca?: string;
  color: string;
  ancho: number;
  opacidad: number;
}> = ({ etiqueta, valor, marca, color, ancho, opacidad }) => (
  <div style={{ marginBottom: 84, opacity: opacidad }}>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 14,
      }}
    >
      <span style={{ fontSize: 40, color: COLORES.texto }}>{etiqueta}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 54, fontWeight: 700, color }}>{valor}</span>
        {marca ? <span style={{ fontSize: 30, color: COLORES.textoSuave }}>({marca})</span> : null}
      </span>
    </div>
    <div
      style={{
        height: 92,
        borderRadius: 14,
        backgroundColor: COLORES.panel,
        border: `2px solid ${COLORES.borde}`,
      }}
    >
      <div style={{ width: ancho, height: '100%', borderRadius: 14, backgroundColor: color }} />
    </div>
  </div>
);

/**
 * Escena 4 · Resultado (frames 1650–2010)
 * Dos barras: «This team» (coste real medido) contra «Opus for everything»
 * (estimación marcada), con la misma escala.
 */
export const Resultado: React.FC<{ t: Textos; idioma: Idioma }> = ({ t, idioma }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const avanceEquipo = spring({
    frame: frame - 30,
    fps,
    durationInFrames: 45,
    config: { damping: 200 },
  });
  const anchoEquipo = interpolate(avanceEquipo, [0, 1], [0, TOTAL_DIA * PX_POR_DOLAR]);

  const avanceOpus = spring({
    frame: frame - 80,
    fps,
    durationInFrames: 55,
    config: { damping: 200 },
  });
  const anchoOpus = interpolate(avanceOpus, [0, 1], [0, ANCHO_MAX]);

  const opacidadNota = interpolate(frame, [140, 165], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 300 }}>
      <div style={{ width: 1560, display: 'flex', flexDirection: 'column' }}>
        <Barra
          etiqueta={t.resultado.equipo}
          valor={formatoCoste(TOTAL_DIA, idioma)}
          color={COLORES.deepseek}
          ancho={anchoEquipo}
          opacidad={avanceEquipo}
        />
        <Barra
          etiqueta={t.resultado.opus}
          valor={`≈ ${formatoCoste(COSTE_OPUS_ESTIMADO, idioma, 0)}`}
          marca={t.estimacion}
          color={COLORES.opus}
          ancho={anchoOpus}
          opacidad={avanceOpus}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 190,
          padding: '0 160px',
          fontSize: 26,
          lineHeight: 1.4,
          textAlign: 'center',
          color: COLORES.textoSuave,
          opacity: opacidadNota,
        }}
      >
        {t.notaCoste}
      </div>

      <Subtitulo>{t.resultado.subtitulo}</Subtitulo>
    </AbsoluteFill>
  );
};
