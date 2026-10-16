import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COLORES, FUENTE_MONO } from '../datos';
import { Idioma, Textos } from '../textos';
import { Subtitulo } from '../Subtitulo';

/** Frame en el que empieza a escribirse cada comando. */
const INICIOS = [10, 80, 140];
/** Frames por carácter (efecto de terminal). */
const VELOCIDAD = 0.8;
/** Etiqueta de plataforma de cada comando (el primero vale para todas). */
const PLATAFORMAS: Array<'windows' | 'unix' | null> = [null, 'windows', 'unix'];

/**
 * Escena 5 · Instalar (frames 2010–2250)
 * Terminal con el clonado del repositorio y el instalador en un solo comando.
 */
export const Instalar: React.FC<{ t: Textos; idioma: Idioma }> = ({ t }) => {
  const frame = useCurrentFrame();

  const escribir = (texto: string, i: number) => {
    const fin = INICIOS[i] + Math.ceil(texto.length * VELOCIDAD);
    return texto.slice(
      0,
      Math.round(
        interpolate(frame, [INICIOS[i], fin], [0, texto.length], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      ),
    );
  };

  // Etiqueta de plataforma: aparece cuando el comando ya se ha escrito.
  const opacidadEtiqueta = (i: number) => {
    const texto = t.instalar.comandos[i];
    const fin = INICIOS[i] + Math.ceil(texto.length * VELOCIDAD);
    return interpolate(frame, [fin, fin + 12], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  };

  const cursor = frame % 24 < 14 ? 1 : 0;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 150 }}>
      <div
        style={{
          width: 1560,
          borderRadius: 18,
          overflow: 'hidden',
          backgroundColor: COLORES.panelOscuro,
          border: `2px solid ${COLORES.borde}`,
        }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingLeft: 26,
            backgroundColor: COLORES.panel,
            borderBottom: `2px solid ${COLORES.borde}`,
          }}
        >
          {[COLORES.rojo, COLORES.aviso, COLORES.haiku].map((color) => (
            <span
              key={color}
              style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color }}
            />
          ))}
        </div>

        <div
          style={{
            padding: '44px 52px',
            fontFamily: FUENTE_MONO,
            fontSize: 30,
            lineHeight: 1.9,
          }}
        >
          {t.instalar.comandos.map((texto, i) => {
            const plataforma = PLATAFORMAS[i];
            const ultima = i === t.instalar.comandos.length - 1;

            return (
              <div key={texto} style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                <span style={{ color: COLORES.haiku }}>$</span>
                <span style={{ color: COLORES.texto }}>
                  {escribir(texto, i)}
                  {ultima ? (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 16,
                        height: 30,
                        marginLeft: 6,
                        verticalAlign: 'middle',
                        backgroundColor: COLORES.texto,
                        opacity: cursor,
                      }}
                    />
                  ) : null}
                </span>
                {plataforma ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 24,
                      color: COLORES.textoSuave,
                      opacity: opacidadEtiqueta(i),
                    }}
                  >
                    {t.instalar[plataforma]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <Subtitulo>{t.instalar.subtitulo}</Subtitulo>
    </AbsoluteFill>
  );
};
