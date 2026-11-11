# Perfiles de modelos y ficha de modelos en el panel web

Objetivo: cargar perfiles de modelos por agente (Claude y OpenCode) desde el panel web, y comparar modelos con un ranking y una gráfica.
Rama: `feat/perfiles-modelos` · Entrega: single-pr · Tests: `node scripts/test-*.mjs` (sin dependencias, Node >= 22).

## Specs

- **S1 Perfiles.** «en la página web pueden haber diferentes perfiles y yo puedo cargar diferentes perfiles de manera rápida y que se configure tanto en Cloud como en OpenCode».
  - Un perfil es un JSON en `config/perfiles/<id>.json`: `nombre`, `descripcion`, `claude: { <agente>: { model, effort } }`, `opencode: { <agente>: { model, variant } }`.
  - Un agente que no aparece en el perfil no se toca. Un agente del perfil cuyo fichero no existe es un error que se muestra, sin aplicar nada.
- **S2 Dos perfiles iniciales.** «Quiero que los perfiles que hayan sean el actual, el que hay hoy y la propuesta».
  - `actual`: exactamente los `model`/`effort`/`variant` que hay hoy en `config/claude/agents/*.md` y `config/opencode/agents/*.md` (todos los agentes).
  - `propuesta`: igual que `actual` salvo `consultor` → `fable` · `low` y `arquitecto` → `fable` · `high`.
- **S3 Aplicar.** «yo cambiaré para usar una propuesta o un perfil u otro y debe de funcionar».
  - Pestaña «Agentes» en `config/web`: tabla con cada agente (origen Claude/OpenCode, modelo, esfuerzo o variante), selector de perfil y botón «Aplicar».
  - Antes de aplicar se muestra qué cambia (agente: antes → después) y se pide confirmación en la propia página.
  - Aplicar reescribe solo las líneas `model:`, `effort:` y `variant:` del frontmatter, en el repo y en la copia instalada (`~/.claude/agents`, agentes de OpenCode instalados). El resto del fichero queda byte a byte igual.
  - Tras aplicar, la detección de cambios del instalador (spec 25) no debe dar esos ficheros como editados a mano: reutiliza sus funciones (`config/hub/lib/cambios.mjs`, `scripts/instalado.mjs`), no reimplementes el registro.
  - La página indica qué perfil coincide con lo instalado, o «personalizado» si ninguno.
  - Las escrituras solo se aceptan desde `127.0.0.1`, por POST con `Content-Type: application/json`, y rechazan peticiones con cabecera `Origin` ajena al propio panel.
- **S4 Tope de esfuerzo.** «no quiero superar del high a no ser que yo lo configure».
  - Un perfil con `effort` o `variant` `xhigh` o `max` en un modelo `fable` se rechaza al aplicar, salvo que el perfil lleve `"permitirMasDeHigh": true`. El rechazo no modifica ningún fichero.
  - Los valores que ya existen hoy (por ejemplo `revisor` de OpenCode con `variant: max` en DeepSeek) siguen siendo válidos.
- **S5 Ficha de modelos.** «un apartado que guarde información de cada modelo y los clasifique como un ranking» y «una misma gráfica de precio e inteligencia».
  - Datos en `config/web/public/modelos.json` (tabla de abajo, marcada como aproximada, fuente Artificial Analysis, 2026-11-11).
  - Pestaña «Modelos»: tabla ordenable por cualquier columna, con una columna de inteligencia por dólar, y una gráfica de dispersión inteligencia frente a coste por tarea (eje X logarítmico), en SVG sin dependencias, con color por proveedor, etiqueta por punto y los modelos que usa el sistema resaltados.
  - Debajo, las cuatro capturas originales de `config/web/public/capturas/` como fuente, plegadas por defecto.

### Datos de S5

| Modelo | Proveedor | Índice | $/tarea | Min/tarea | Engineering |
|---|---|---|---|---|---|
| DeepSeek V4.1 Flash (high) | DeepSeek | 28.5 | 0.46 | 12.6 | 34 |
| DeepSeek V4.1 Flash (max) | DeepSeek | 32.5 | 0.60 | 16.3 | 38 |
| GPT-6.1 Sol (xhigh) | OpenAI | 52.5 | 0.76 | 9.2 | 57 |
| GPT-6.1 Sol (max) | OpenAI | 54.7 | 1.27 | 20.4 | 60 |
| Claude Fable 5.2 (low) | Anthropic | 54 | 3.10 | 6.3 | 62 |
| GPT-6 Astra (high) | OpenAI | 55 | 3.24 | 9.7 | 59 |
| GPT-6 Astra (xhigh) | OpenAI | 55.3 | 3.66 | 11.3 | 60 |
| Claude Fable 5.2 (medium) | Anthropic | 56.3 | 3.80 | 7.7 | 65 |
| Claude Opus 5.5 (xhigh) | Anthropic | 57.5 | 6.05 | 15.7 | 63 |
| GPT-6 Astra (max) | OpenAI | 57 | 6.24 | 23.0 | 62 |
| Gemini 4 Carbon (medium) | Google | 58.5 | 6.59 | 23.8 | 64 |
| Gemini 4 Carbon (low) | Google | 54.3 | 7.19 | 23.3 | 60 |
| Gemini 4 Carbon (high) | Google | 60.2 | 7.76 | 26.1 | 65 |
| Claude Fable 5.2 (high) | Anthropic | 62 | 9.08 | 16.9 | 70 |
| Claude Sonnet 5.5 (max) | Anthropic | 54.6 | 10.02 | 32.7 | 58 |
| Claude Opus 5.5 (max) | Anthropic | 59 | 10.04 | 25.0 | 65 |
| Claude Fable 5.2 (xhigh) | Anthropic | 62.3 | 14.83 | 25.8 | 70 |
| Claude Fable 5.2 (max) | Anthropic | 64.5 | 26.54 | 45.0 | 73 |

Los valores de «Índice» están leídos a ojo de una gráfica; el resto son cifras impresas en las capturas.

## Tasks

- [ ] T1 · S1, S2, S4 · lógica de perfiles (leer, validar, comparar, aplicar) en un módulo propio con tests · delegado (resolutor)
- [ ] T2 · S3 · endpoints y pestaña «Agentes» · delegado (resolutor)
- [ ] T3 · S5 · `modelos.json` y pestaña «Modelos» · delegado (resolutor)
- [ ] T4 · docs: sección breve en `docs/` sobre perfiles · delegado (resolutor)

Ruta: delegado por coste (regla del usuario: el hilo principal en Fable tiene cuota semanal propia y limitada).

## Log

- L1 (2026-11-11), petición del usuario: «vale no puedo usar todo fable porque es como puedes ver acaba de salir fable y no puedo usarlo para todo porque tiene un límite diferente y no quiero superar del high a no ser que yo lo configure porque puede consumir mucho por lo tanto lo que quiero es que en la página web pueden haber diferentes perfiles y yo puedo cargar diferentes perfiles de manera rápida y que se configure tanto en Cloud como en OpenCode. Quiero perfiles y los puedo cargar en cada momento. Quiero que los perfiles que hayan sean el actual, el que hay hoy y la propuesta, generos estos dos perfiles y yo cambiaré para usar una propuesta o un perfil u otro y debe de funcionar. Además quiero también tener un apartado que guarde información de cada modelo y los clasifique como un ranking. Es decir, quiero una especie de gráfica, quiero una misma gráfica de precio e inteligencia que te pasan las capturas. Es decir, mismamente quiero que pegues esas capturas y que generes una gráfica por tu cuenta. Así que tengo un apartado que sea de información, que pueda comparar esos modelos para a la hora de elegirlos hacerme una idea de por qué elegir cada uno.»
- L2: la propuesta se recorta respecto al estudio inicial. Una sola petición gastó el 3 % de la cuota semanal de Fable, así que Fable queda solo en `consultor` (low) y `arquitecto` (high); hilo principal, `cerebro` y `resolutor` no cambian.
- L3 (supuesto): el modelo del hilo principal (`/model`) queda fuera de los perfiles; solo se gestionan agentes.
- L4: el panel `config/web` deja de ser de solo lectura. Riesgo: ítem 2 (guardas del servidor local) e ítem 5 (toca ficheros instalados).
