import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORES, FILAS_DIA, JOBS_DIA, TOTAL_DIA } from '../datos';
import { formatoCoste, Idioma, Textos } from '../textos';
import { Subtitulo } from '../Subtitulo';

/** Frame en el que entra cada fila (una cada 120 frames = 4 s). */
const inicioFila = (i: number) => 40 + i * 120;

/** Suma acumulada de las filas hasta la posición `i`. */
const sumaHasta = (i: number) => FILAS_DIA.slice(0, i + 1).reduce((total, fila) => total + fila.coste, 0);

const COLUMNAS = '1.55fr 0.95fr 0.35fr 0.45fr';

/**
 * Escena 3 · Un día de trabajo (frames 810–1650)
 * Cinco filas que entran una a una (tarea → agente → coste) y un total acumulado
 * que sube con cada fila.
 */
export const Dia: React.FC<{ t: Textos; idioma: Idioma }> = ({ t, idioma }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Total acumulado: cada fila que entra suma su coste al marcador.
  let acumulado = 0;
  for (let i = 0; i < FILAS_DIA.length; i++) {
    const desde = inicioFila(i) + 40;
    if (frame < desde) {
      break;
    }
    const anterior = i === 0 ? 0 : sumaHasta(i - 1);
    acumulado = interpolate(frame, [desde, desde + 30], [anterior, sumaHasta(i)], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  const totalVisible = spring({
    frame: frame - 60,
    fps,
    durationInFrames: 26,
    config: { damping: 200 },
  });

  const opacidadNota = interpolate(frame, [640, 670], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cabecera: React.CSSProperties = {
    fontSize: 26,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: COLORES.textoSuave,
  };

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 300 }}>
      <div style={{ width: 1560, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLUMNAS,
            gap: 24,
            padding: '0 26px 14px',
          }}
        >
          <span style={cabecera}>{t.dia.columnas.tarea}</span>
          <span style={cabecera}>{t.dia.columnas.agente}</span>
          <span style={{ ...cabecera, textAlign: 'right' }}>{t.dia.columnas.jobs}</span>
          <span style={{ ...cabecera, textAlign: 'right' }}>{t.dia.columnas.coste}</span>
        </div>

        {FILAS_DIA.map((fila, i) => {
          const entrada = spring({
            frame: frame - inicioFila(i),
            fps,
            durationInFrames: 26,
            config: { damping: 200 },
          });

          return (
            <div
              key={fila.agente + i}
              style={{
                display: 'grid',
                gridTemplateColumns: COLUMNAS,
                alignItems: 'center',
                gap: 24,
                height: 78,
                marginBottom: 14,
                padding: '0 26px',
                borderRadius: 12,
                backgroundColor: COLORES.panel,
                border: `2px solid ${COLORES.borde}`,
                opacity: entrada,
                transform: `translateX(${interpolate(entrada, [0, 1], [60, 0])}px)`,
              }}
            >
              <span style={{ fontSize: 40, color: COLORES.texto }}>{fila.tarea[idioma]}</span>
              <span style={{ fontSize: 36, color: COLORES.deepseek }}>{fila.agente}</span>
              <span style={{ fontSize: 36, color: COLORES.textoSuave, textAlign: 'right' }}>
                {fila.jobs}
              </span>
              <span
                style={{
                  fontSize: 40,
                  fontWeight: 600,
                  color: COLORES.texto,
                  textAlign: 'right',
                }}
              >
                {formatoCoste(fila.coste, idioma)}
              </span>
            </div>
          );
        })}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLUMNAS,
            alignItems: 'center',
            gap: 24,
            height: 104,
            padding: '0 26px',
            marginTop: 18,
            borderRadius: 12,
            backgroundColor: COLORES.panelOscuro,
            border: `2px solid ${COLORES.deepseek}`,
            opacity: totalVisible,
            transform: `translateY(${interpolate(totalVisible, [0, 1], [30, 0])}px)`,
          }}
        >
          <span style={{ fontSize: 44, fontWeight: 700, color: COLORES.texto }}>
            {t.dia.total}
          </span>
          <span />
          <span style={{ fontSize: 40, color: COLORES.textoSuave, textAlign: 'right' }}>
            {JOBS_DIA}
          </span>
          <span
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: COLORES.deepseek,
              textAlign: 'right',
            }}
          >
            {formatoCoste(Math.min(acumulado, TOTAL_DIA), idioma)}
          </span>
        </div>
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

      <Subtitulo>{t.dia.subtitulo}</Subtitulo>
    </AbsoluteFill>
  );
};
