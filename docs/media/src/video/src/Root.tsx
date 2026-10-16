import React from 'react';
import {
  AbsoluteFill,
  Composition,
  interpolate,
  Series,
  useCurrentFrame,
} from 'remotion';
import { COLORES, ESCENAS, FORMATO, FUENTE_SANS } from './datos';
import { Idioma, textos } from './textos';
import { Problema } from './escenas/Problema';
import { Idea } from './escenas/Idea';
import { Dia } from './escenas/Dia';
import { Resultado } from './escenas/Resultado';
import { Instalar } from './escenas/Instalar';

/** Longitud del fundido de entrada y salida de cada escena. */
const FUNDIDO = 10;

const Fundido: React.FC<{ duracion: number; children: React.ReactNode }> = ({
  duracion,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, FUNDIDO, duracion - FUNDIDO, duracion],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/**
 * Misma pieza para los dos idiomas: las cinco escenas del guion, encadenadas con
 * `<Series>` y un fundido corto entre ellas.
 */
export const Video: React.FC<{ idioma: Idioma }> = ({ idioma }) => {
  const t = textos[idioma];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORES.fondo,
        color: COLORES.texto,
        fontFamily: FUENTE_SANS,
      }}
    >
      <Series>
        <Series.Sequence durationInFrames={ESCENAS.problema}>
          <Fundido duracion={ESCENAS.problema}>
            <Problema t={t} idioma={idioma} />
          </Fundido>
        </Series.Sequence>

        <Series.Sequence durationInFrames={ESCENAS.idea}>
          <Fundido duracion={ESCENAS.idea}>
            <Idea t={t} idioma={idioma} />
          </Fundido>
        </Series.Sequence>

        <Series.Sequence durationInFrames={ESCENAS.dia}>
          <Fundido duracion={ESCENAS.dia}>
            <Dia t={t} idioma={idioma} />
          </Fundido>
        </Series.Sequence>

        <Series.Sequence durationInFrames={ESCENAS.resultado}>
          <Fundido duracion={ESCENAS.resultado}>
            <Resultado t={t} idioma={idioma} />
          </Fundido>
        </Series.Sequence>

        <Series.Sequence durationInFrames={ESCENAS.instalar}>
          <Fundido duracion={ESCENAS.instalar}>
            <Instalar t={t} idioma={idioma} />
          </Fundido>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="DemoEN"
      component={Video}
      durationInFrames={FORMATO.duracionFrames}
      fps={FORMATO.fps}
      width={FORMATO.ancho}
      height={FORMATO.alto}
      defaultProps={{ idioma: 'en' as Idioma }}
    />
    <Composition
      id="DemoES"
      component={Video}
      durationInFrames={FORMATO.duracionFrames}
      fps={FORMATO.fps}
      width={FORMATO.ancho}
      height={FORMATO.alto}
      defaultProps={{ idioma: 'es' as Idioma }}
    />
  </>
);
