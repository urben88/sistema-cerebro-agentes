import React from 'react';
import { COLORES } from './datos';

/**
 * Subtítulo del vídeo: franja inferior fija, tipografía grande (60 px) y
 * alto contraste sobre un fondo casi opaco, para que se lea siempre.
 */
export const Subtitulo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 150,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 80px',
      backgroundColor: 'rgba(1, 4, 9, 0.94)',
      borderTop: `2px solid ${COLORES.borde}`,
    }}
  >
    <div
      style={{
        fontSize: 60,
        lineHeight: 1.2,
        fontWeight: 700,
        letterSpacing: -0.5,
        textAlign: 'center',
        width: '100%',
      }}
    >
      {children}
    </div>
  </div>
);

/**
 * Variante para escenas con dos subtítulos seguidos (uno entra cuando el otro
 * se va). Los hijos deben llegar ya con su propia opacidad animada.
 */
export const SubtituloDoble: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', width: '100%', height: 72 }}>{children}</div>
);

/** Capa de un subtítulo dentro de `SubtituloDoble`. */
export const LineaSubtitulo: React.FC<{ opacidad: number; children: React.ReactNode }> = ({
  opacidad,
  children,
}) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: opacidad }}>
    {children}
  </div>
);
