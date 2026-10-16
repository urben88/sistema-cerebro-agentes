import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORES } from '../datos';
import { Idioma, Textos } from '../textos';
import { Subtitulo } from '../Subtitulo';

/** Acento por modelo: Opus morado, Sonnet naranja, Haiku verde, DeepSeek azul. */
const ACENTOS = [COLORES.opus, COLORES.sonnet, COLORES.haiku, COLORES.deepseek];

/**
 * Escena 2 · La idea (frames 360–810)
 * Los 4 niveles aparecen de arriba abajo: Opus decide · Sonnet resuelve un área ·
 * Haiku busca, redacta y verifica · DeepSeek escribe el código.
 */
export const Idea: React.FC<{ t: Textos; idioma: Idioma }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 150 }}>
      <div style={{ width: 1440, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {t.idea.niveles.map((nivel, i) => {
          const entrada = spring({
            frame: frame - (40 + i * 75),
            fps,
            durationInFrames: 28,
            config: { damping: 200 },
          });
          const desplazamiento = interpolate(entrada, [0, 1], [-70, 0]);

          return (
            <div
              key={nivel.nombre}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 30,
                marginLeft: i * 36,
                height: 126,
                paddingLeft: 28,
                borderRadius: 14,
                backgroundColor: COLORES.panel,
                border: `2px solid ${COLORES.borde}`,
                borderLeft: `12px solid ${ACENTOS[i]}`,
                opacity: entrada,
                transform: `translateY(${desplazamiento}px)`,
              }}
            >
              <span style={{ fontSize: 36, color: COLORES.textoSuave, width: 44 }}>
                {i + 1}
              </span>
              <span
                style={{
                  fontSize: 68,
                  fontWeight: 800,
                  letterSpacing: -1,
                  color: ACENTOS[i],
                  width: 360,
                }}
              >
                {nivel.nombre}
              </span>
              <span style={{ fontSize: 46, color: COLORES.texto }}>{nivel.rol}</span>
            </div>
          );
        })}
      </div>

      <Subtitulo>{t.idea.subtitulo}</Subtitulo>
    </AbsoluteFill>
  );
};
