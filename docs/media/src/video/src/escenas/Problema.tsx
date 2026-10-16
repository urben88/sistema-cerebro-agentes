import React from 'react';
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from 'remotion';
import { COLORES, COSTE_OPUS_ESTIMADO } from '../datos';
import { formatoCoste, Idioma, Textos } from '../textos';
import { LineaSubtitulo, Subtitulo, SubtituloDoble } from '../Subtitulo';

/**
 * Escena 1 · Problema (frames 0–360)
 * Barra de cuota que se llena hasta el 100 % en rojo y contador de coste subiendo
 * hasta la estimación de un día entero con Opus (marcada como estimación).
 */
export const Problema: React.FC<{ t: Textos; idioma: Idioma }> = ({ t, idioma }) => {
  const frame = useCurrentFrame();

  // La barra se llena entre los frames 20 y 210 y pasa de ámbar a rojo.
  const relleno = interpolate(frame, [20, 210], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const porcentaje = Math.round(relleno * 100);
  const colorBarra = interpolateColors(relleno, [0, 1], [COLORES.aviso, COLORES.rojo]);

  // El contador sube hasta el coste estimado del día con Opus.
  const coste = interpolate(frame, [30, 260], [0, COSTE_OPUS_ESTIMADO], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Al llegar al 100 % el número late un poco para remarcarlo.
  const latido = frame > 215 ? 1 + 0.03 * Math.sin((frame - 215) / 9) : 1;

  // Dos subtítulos seguidos: primero la frase, después el remate.
  const opacidad1 = interpolate(frame, [170, 186], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacidad2 = interpolate(frame, [186, 202], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const etiqueta: React.CSSProperties = {
    fontSize: 34,
    color: COLORES.textoSuave,
    textTransform: 'uppercase',
    letterSpacing: 3,
  };

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 150 }}
    >
      <div style={{ width: 1400, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 16,
          }}
        >
          <span style={etiqueta}>{t.problema.cuota}</span>
          <span style={{ fontSize: 52, fontWeight: 700, color: colorBarra }}>
            {porcentaje}%
          </span>
        </div>

        <div
          style={{
            height: 48,
            borderRadius: 24,
            backgroundColor: COLORES.panel,
            border: `2px solid ${COLORES.borde}`,
          }}
        >
          <div
            style={{
              width: `${relleno * 100}%`,
              height: '100%',
              borderRadius: 24,
              backgroundColor: colorBarra,
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 110 }}>
          <span style={etiqueta}>{t.problema.coste}</span>
          <span style={{ fontSize: 30, color: COLORES.textoSuave }}>({t.estimacion})</span>
        </div>

        <div
          style={{
            fontSize: 180,
            fontWeight: 800,
            lineHeight: 1.05,
            color: COLORES.rojo,
            transform: `scale(${latido})`,
            transformOrigin: 'left center',
          }}
        >
          {formatoCoste(coste, idioma)}
        </div>
      </div>

      <Subtitulo>
        <SubtituloDoble>
          <LineaSubtitulo opacidad={opacidad1}>{t.problema.subtitulo1}</LineaSubtitulo>
          <LineaSubtitulo opacidad={opacidad2}>{t.problema.subtitulo2}</LineaSubtitulo>
        </SubtituloDoble>
      </Subtitulo>
    </AbsoluteFill>
  );
};
