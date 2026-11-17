@echo off
rem ---------------------------------------------------------------------------
rem  Cerebro - consola (Windows)
rem
rem  Doble clic en este fichero desde el explorador de archivos:
rem    - arranca el hub y el panel web y abre el navegador
rem    - se queda en primer plano mostrando el estado
rem    - al cerrar esta ventana (o pulsar Ctrl+C) se apaga todo
rem
rem  La configuracion y los datos se conservan: el contenedor del hub solo se
rem  detiene (no se borra) y sus datos viven en %USERPROFILE%\.sistema-cerebro-agentes.
rem ---------------------------------------------------------------------------
setlocal
set "AQUI=%~dp0"
set "PS1=%AQUI%consola.ps1"

if not exist "%PS1%" (
  echo No se encuentra consola.ps1 junto a este fichero.
  echo Busca %USERPROFILE%\.sistema-cerebro-agentes\consola.ps1
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "CODIGO=%ERRORLEVEL%"

rem Solo se pausa ante un error fatal de arranque (codigo 2), para poder leerlo.
rem Con otro codigo (la consola se cerro de golpe) la ventana se cierra sola.
if "%CODIGO%"=="2" (
  echo.
  echo La consola no pudo arrancar.
  pause
)
exit /b %CODIGO%
