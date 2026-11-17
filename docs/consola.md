# Consola del Cerebro

Una ventana de consola que **enciende todo** y que, al cerrarla, **lo apaga**.

Sirve para el uso diario: en lugar de Several comandos sueltos (Docker, panel, navegador), haces doble clic en un fichero, te abre una consola con el sistema en marcha, y cuando terminas cierras la ventana y todo se apaga solo.

## Arrancar (doble clic)

| Sistema | Doble clic en |
|---|---|
| Windows | `Cerebro.cmd` |
| macOS / Linux | `scripts/consola.sh` |

### Como una aplicación (búsqueda de Windows)

Tras instalar, el instalador crea un **acceso directo en el Menú Inicio** llamado **Cerebro**.|Windows Search lo indexa, así que:

- pulsas la tecla Windows, escribes **Cerebro** y lo lanzas;
- o pulsas **Win + S** y buscas «Cerebro»;
- o pulsas **Win + R**, escribes `shell:programs` y lo encuentras en la lista.

> Windows Search solo indexa accesos directos (`.lnk`), no ficheros `.cmd` sueltos: por eso se crea un `.lnk` en el Menú Inicio y no solo se copia el `.cmd`.

El acceso directo abre la **ventana de consola** (no se minimiza a la bandeja): esa ventana es la consola, y al cerrarla se apaga todo.

Para quitarlo: `powershell -File ~/.sistema-cerebro-agentes/acceso-directo.ps1 -Quitar` (o `uninstall.ps1`, que lo retira).

### En Windows, a mano

El lanzador queda en:

```
C:\Users\<tu-usuario>\.sistema-cerebro-agentes\consola.cmd
```

Si quieres tenerlo a mano, **copia ese `.cmd` al Escritorio** (o crea un acceso directo).

### En macOS

El instalador deja `~/Applications/Cerebro.command`, que Spotlight indexa: busca «Cerebro» en el Buscador y ábrelo con doble clic (la primera vez macOS pide permiso para abrirlo con Terminal).

### En Linux

`bash scripts/consola.sh` (o `~/.sistema-cerebro-agentes/consola.sh`).

## Qué hace

1. Levanta el **Cerebro Hub** (Docker; si no hay Docker, lo levanta en nativo).
2. Levanta el **panel web** de actividad (el de los bots).
3. Abre el **navegador** en el panel del hub.
4. Se queda en primer plano mostrando el estado.

## Qué pasa al cerrar la consola

Se apaga **todo lo que encendió esa consola**:

- el contenedor del hub,
- el panel web,
- el servidor OpenCode V1 (solo si lo levantó la consola).

Windows mata el proceso de PowerShell al cerrar la ventana, así que el bloque `finally` no llega a ejecutarse. Por eso la consola lanza un **vigilante** en segundo plano: detecta que la consola murió (el proceso padre desaparece, o el latido deja de actualizarse) y hace la misma parada.

Puedes probarlo: abre la consola, cierra la ventana y mira cómo el panel deja de responder.

## La configuración y los datos se conservan

Apagar **no borra nada**:

| Qué | Dónde vive | Qué pasa al apagar |
|---|---|---|
| Memoria, trabajos, índice del hub | `~/.sistema-cerebro-agentes/hub-data` (volumen montado) | intacto |
| Configuración del hub, perfiles de modelos | repo `config/` + `~/.sistema-cerebro-agentes` | intacto |
| Ajustes de la consola | `~/.sistema-cerebro-agentes/consola.json` | intacto |
| Contenedor del hub | Docker | **se detiene**, no se borra (`compose stop`, no `down`) |

El contenedor queda parado pero ahí; la próxima vez que enciendas la consola vuelve a levantarse con lo mismo.

## Ajustes

Los ajustes se guardan en `~/.sistema-cerebro-agentes/consola.json` y se conservan entre ejecuciones.

```powershell
# Ver los ajustes actuales
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -Accion config

# No levantar el panel, y que sea la norma de aqui en adelante
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -SinPanel -Guardar

# Levantar tambien el servidor OpenCode V1 (por defecto lo arranca el MCP solo)
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -ConServidor -Guardar

# Volver a los valores de fabrica
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -SinPanel -Guardar   # y quitar el flag
```

Los indicadores (`-SinHub`, `-SinPanel`, `-SinNavegador`, `-ConServidor`) solo duran esa ejecución salvo que añadas `-Guardar`.

## Otros comandos

```powershell
# Estado (sin cambiar nada)
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -Accion estado

# Apagar lo que haya en marcha (equivale a cerrar la consola)
powershell -File ~\.sistema-cerebro-agentes\consola.ps1 -Accion parar
```

En macOS / Linux: `bash ~/.sistema-cerebro-agentes/consola.sh --estado`, `--parar`, `--config`.

## Detalles que importan

- **Dos consolas a la vez no se pisan**: cada una tiene su fichero de estado (`consola-estado-<pid>.json`). Si hay otra consola viva, al cerrar esta **no se apagan** el hub ni el panel (son compartidos): se avisa y se deja. Un vigilante de una consola vieja tampoco puede tocar los servicios de una nueva.
- **Si el hub en Docker no responde, se levanta el nativo**: mismo hub, pero en el host. Es la red de seguridad cuando el contenedor se queda colgado o el daemon no responde.
- **El hub tarda unos segundos en responder** tras `docker compose up -d` (el contenedor tiene que pasar a *healthy*). Por eso la consola no se conforma con una respuesta: exige que el hub conteste **varias veces seguidas y rápido**. Si no, cae al nativo.
- **El vigilante no es un servicio**: muere con la maquina y no sobrevive a un reinicio. Tras reiniciar, el hub vuelve con el autoarranque que registra el instalador.
- **El panel se guarda en `~/.sistema-cerebro-agentes/web-port.txt`**, como el resto de puertos del sistema.
- El `.ps1` llevan BOM a proposito: PowerShell 5.1 los lee como ANSI sin BOM y destroza los acentos.
- Si cierras la consola y el hub sigue en marcha, el autoarranque de Windows lo relanzara al iniciar sesion. Para que no pase, desactiva la tarea programada «Cerebro Hub» (`schtasks /Change /TN "Cerebro Hub" /DISABLE`).

## Pruebas

```bash
node scripts/test-consola.mjs
```

Se ejecuta dentro de `verificar` (Windows y macOS/Linux).
