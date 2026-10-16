# Spec 18 · Documentación de GitHub, GIFs y vídeo explicativo

Estado: **propuesta** (modo PLAN; sin implementar).

## Objetivo
Que alguien que llega al repo en GitHub entienda en 30 s **por qué usarlo** (resultados de modelo potente gastando mucho menos) y pueda instalarlo en 5 min.

## Decisiones del usuario (2026-10-16)
- **Idioma:** inglés principal (`README.md`) + `README.es.md` (español), enlazados arriba.
- **GIFs:** guionizados con **VHS** (reproducibles, sin gastar tokens) + GIF del panel del hub con el navegador.
- **Vídeo:** 60–90 s animado con código (**Remotion** vía npx + ffmpeg), **sin voz, con subtítulos grandes**.
- **Ejemplo práctico:** **un día de trabajo resumido**: varias tareas cortas (buscar, documentar, arreglar un bug, una feature pequeña) repartidas entre agentes, con el gasto del día.

## Supuestos por defecto
- Recursos en `docs/media/` (gif, mp4, png) y fuentes en `docs/media/src/` (tapes de VHS y proyecto Remotion), regenerables con `scripts/media.ps1`.
- Cifras **reales** sacadas de tus métricas (`opencode.db`, métricas del hub, `/usage`), nunca inventadas; si un número es estimado, se marca como tal.
- Vídeo en `docs/media/demo.mp4` (≤ 10 MB, 1080p) + póster PNG; en el README, póster que enlaza al vídeo (GitHub reproduce mp4 subidos a una issue/release; alternativa: GIF corto).
- Datos de la demo anonimizados (sin rutas personales, emails ni claves).

## Plan
1. **README (inglés) nuevo**, estructura:
   - Gancho (1 frase) + GIF hero (barra de estado + agentes trabajando).
   - «Why»: el problema (Opus para todo = caro y cuota agotada) y la solución (Opus decide, Haiku/Sonnet/DeepSeek ejecutan, advisor en los puntos clave).
   - Tabla de resultados del «día de trabajo»: tarea → agente/modelo → coste.
   - Cómo funciona (diagrama simple de los 4 niveles) · modo normal vs cerebro.
   - Quick start (Windows / macOS-Linux) · uso diario · enlaces a `docs/`.
   - Funciones con GIF corto cada una: barra (punta/valle DeepSeek), `/agentes`, freno de errores, panel del hub.
2. **`README.es.md`**: traducción fiel; el README actual se reaprovecha.
3. **GIFs (VHS)**: instalar VHS (`winget install charmbracelet.vhs`); tapes:
   `instalar.tape`, `barra.tape`, `agentes.tape`, `errores.tape` (simulados con scripts de demo, sin llamar a modelos). GIF del panel: Claude in Chrome + gif_creator.
4. **Vídeo (Remotion)**: escenas
   1. Problema (cuota y coste) · 2. La idea (el equipo por niveles) · 3. Un día de trabajo (4–5 tareas, quién hace cada una, coste acumulado) · 4. Resultado (gasto del día vs todo con Opus, estimación marcada) · 5. Instalar en 1 comando.
5. **`docs/`**: revisar que los enlaces del README apuntan bien; añadir `docs/media/README.md` con cómo regenerar.
6. Verificar: enlaces e imágenes en la vista de GitHub, peso de los recursos, sin datos personales.

## Criterios de aceptación
- README en inglés y español enlazados, con ≥ 4 GIFs y el vídeo enlazado.
- Todos los recursos se regeneran con un comando.
- Cifras con fuente; nada inventado.
- Nada personal en las grabaciones.

## Reparto propuesto
- Guion del vídeo y textos: Opus (sesión principal) + `redactor` (traducción ES).
- Tapes VHS, proyecto Remotion y script de media: `resolutor` (Sonnet).
- Revisión final contra estos criterios: `analista` (Haiku).
