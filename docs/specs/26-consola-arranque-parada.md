# Spec 26 · Consola de arranque y parada

## Objetivo

Una herramienta que, desde el explorador de archivos, arranque todo el Cerebro en una ventana de consola y lo apague cuando esa ventana se cierre, conservando la configuracion y los datos.

Peticion del usuario: «quiero que uses un script que desde el explorador de carpetas pueda arrancarlo todo y apagarlo, como una herramienta que se abre una consola que lo arranca y luego si cierre la consola pues que se apague. Pero obviamente si lo he configurado mantiene la configuracion y se guarda configuracion».

Rama: `feat/perfiles-modelos` (continua) · Pruebas: `node scripts/test-consola.mjs` dentro de `verificar`. Riesgo: item 3 (contrato: nueva superficie de CLI) e item 5 (toca el instalador).

## Requisitos

- **S1 · Doble clic.** Un fichero ejecutable desde el explorador de archivos (`Cerebro.cmd` en Windows, `scripts/consola.sh` en macOS/Linux) abre una consola con el sistema en marcha. Tras `install`, el lanzador queda en `~/.sistema-cerebro-agentes/`.
- **S2 · Que levanta.** La consola levanta el hub (Docker; si no hay Docker, en nativo) y el panel web, y abre el navegador en el panel del hub.
- **S3 · Que apaga al cerrar.** Al cerrar la ventana de la consola se apaga todo lo que esa consola encendio: el contenedor del hub, el panel web y (si lo levanto) el servidor OpenCode V1.
- **S4 · Que no se pierde nada.** Apagar no borra configuracion ni datos: el compose se detiene (`stop`, no `down`), el contenedor y sus volumenes siguen ahi, `hub-data` intacto y los ajustes de la consola intactos.
- **S5 · Configuracion persistente.** Los ajustes (que componentes levantar, puertos) se guardan en `~/.sistema-cerebro-agentes/consola.json` y se conservan entre ejecuciones. Se cambian con indicadores y `-Guardar`.
- **S6 · Estado por instancia.** El estado de la consola en marcha se guarda con el PID en el nombre: dos consolas simultaneas no se pisan.
- **S7 · Paridad.** `consola.sh` y `consola-vigilante.sh` hacen lo mismo que sus versiones de Windows. `install.sh` instala el componente `consola` igual que `install.ps1`.
- **S8 · Otros comandos.** `-Accion estado` (consulta, no cambia nada), `-Accion parar` (apaga lo que haya en marcha), `-Accion config` (muestra los ajustes).
- **S9 · Como una app del sistema.** Un acceso directo en el Menú Inicio (`Cerebro.lnk`) que se pueda buscar y lanzar desde el buscador de Windows. En macOS, `~/Applications/Cerebro.command` (Spotlight).

## Tareas

| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| T1 | S5 | inline (`scripts/consola-config.mjs`) | hecho | ver Log L4 |
| T2 | S1-S4, S6 | inline (`scripts/consola.ps1`, `consola-vigilante.ps1`) | hecho | ver Log L4 |
| T3 | S7 | inline (`scripts/consola.sh`, `consola-vigilante.sh`) | hecho | ver Log L4 |
| T4 | S1, S7 | inline (`install.ps1`, `install.sh`, `consola.cmd`) | hecho | ver Log L4 |
| T5 | S5-S8 | inline (`scripts/test-consola.mjs`, `verificar.ps1`, `verificar.sh`) | hecho | ver Log L4 |
| T6 | S9 | inline (`scripts/acceso-directo.ps1`, `consola.command`) | hecho | ver Log L6 |
| T7 | todos | verificador independiente | pendiente | ver Log L7 |

## Log

- **L1 (2026-11-11, usuario):** «Vale, quiero que uses un script que desde el explorador de carpetas pueda arrancarlo todo y apagarlo, como una herramienta que se abre una consola que lo arranca y luego si cierre la consola pues que se apague. Pero obviamente si lo he configurado mantiene la configuracion y se guarda configuracion.»
- **L2:** Estado real del sistema al arrancar: el hub ya corria en Docker (`cerebro-hub`, 4597) y el panel antiguo (4598) apagado. Hay dos "webs": el panel del hub (4597, backend + panel) y el panel de actividad (4598, bots). La consola levanta las dos.
- **L3:** «Cerrar la consola apaga todo» es la parte dificil: al cerrar la ventana, Windows mata el proceso de PowerShell y el `finally` no se ejecuta. Solucion: un vigilante detached que vigila el PID padre y un fichero de latido, y que al morir la consola llama a `consola.ps1 -Accion parar`.
- **L4:** Hecho T1-T5. Ciclo completo verificado con la consola **instalada** (`~/.sistema-cerebro-agentes/consola.ps1`): arranca -> hub y panel responden -> kill del proceso (como al cerrar la ventana) -> el vigilante apaga hub, panel y contenedor -> sin ficheros residuales -> `hub-data/indice.db` y `trabajos.json` intactos. Pruebas `scripts/test-consola.mjs` 22/22. `install.ps1 -Check` reconoce el componente `consola`; instalacion real OK. Corregidos durante las pruebas: (a) `SetLastWriteTime` no crea ficheros, asi que el latido no existia y el vigilante apagaba todo a los 20 s; (b) el fichero de latido se crea antes de lanzar el vigilante; (c) estado por PID para que dos consolas no se pisen; (d) los `.ps1` necesitan BOM (PowerShell 5.1 los lee como ANSI sin BOM y destroza los acentos) y la salida de consola va en ASCII (cp850).
- **L5 (2026-11-11):** T6 verificador independiente (pendiente). La revisión nativa de Gentle AI la pidió el usuario y la declino (`declined_this_candidate`); en su lugar se hizo una verificación propia con checklist S1-S8 y focos de riesgo, y pruebas end-to-end.
- **L6 (2026-11-11):** T6 (spec S9). Acceso directo `Cerebro.lnk` en el Menú Inicio (`scripts/acceso-directo.ps1`), creado y recreado por `install`; en macOS `~/Applications/Cerebro.command`. `uninstall.ps1` lo retira. `verificar` comprueba que exista. Motivo de usar `.lnk`: Windows Search solo indexa accesos directos y `.appx`, no ficheros `.cmd` sueltos.
- **L7 (2026-11-11):** Defectos encontrados y corregidos durante las pruebas del acceso directo:
  (a) **Un vigilante de una consola vieja mataba los servicios de una consola nueva.** Ahora el vigilante solo para si es la sesion vigente (su fichero de estado sigue siendo el suyo) y `Stop-Todo` ignora los estados con el mismo PID (un PID puede reutilizarse).
  (b) **El `.cmd` hacia `pause` con cualquier codigo != 0**, dejando la ventana colgada al matar el PowerShell. Ahora solo pausa ante error fatal de arranque (codigo 2).
  (c) **El hub en Docker puede quedar colgado** tras arrancar: el healthcheck lo da por bueno y luego el event loop se bloquea. La consola ahora exige que el hub responda varias veces seguidas y rápido (`Test-HubEstable`) y, si no, levanta el hub **nativo** en el host (mismo hub, mismo puerto). El `verificar` tambien reintenta la comprobacion del hub.
  (d) Al parar el hub se espera a que el contenedor este `running`: pararlo mientras arranca lo dejaba en mal estado.
  Verificado con dos ciclos consecutivos por el acceso directo: arranque -> hub y panel responden -> cierre -> todo apagado -> datos conservados -> sin ficheros residuales.
