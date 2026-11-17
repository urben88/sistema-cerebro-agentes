#Requires -Version 5.1
<#
.SYNOPSIS
  Crea (o actualiza) el acceso directo de la consola del Cerebro en el Menu Inicio,
  para poder buscarla desde el buscador de Windows.

.DESCRIPTION
  Windows Search solo indexa accesos directos (.lnk) y aplicaciones del paquete
  (.appx) del Menu Inicio: un .cmd suelto NO aparece en el buscador. Por eso aqui se
  crea un .lnk que apunta a la consola.

  El acceso directo abre una ventana de consola normal (no se minimiza al bandeja):
  esa ventana es la consola, y al cerrarla se apaga todo.

.PARAMETER Destino
  Fichero .cmd al que apunta el acceso directo. Por defecto, la consola instalada.

.PARAMETER Nombre
  Nombre del acceso directo. Por defecto, "Cerebro".

.PARAMETER Quitar
  Borra el acceso directo en lugar de crearlo.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\acceso-directo.ps1
#>
[CmdletBinding()]
param(
  [string]$Destino,
  [string]$Nombre = 'Cerebro',
  [switch]$Quitar
)

$ErrorActionPreference = 'Stop'

$SystemDir = Join-Path $env:USERPROFILE '.sistema-cerebro-agentes'
if (-not $Destino) { $Destino = Join-Path $SystemDir 'consola.cmd' }

$programas = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$acceso    = Join-Path $programas "$Nombre.lnk"

function Write-Ok([string]$m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Note([string]$m) { Write-Host "  [info] $m" -ForegroundColor DarkGray }

if ($Quitar) {
  if (Test-Path -LiteralPath $acceso) {
    Remove-Item -LiteralPath $acceso -Force
    Write-Ok "Acceso directo eliminado: $acceso"
  } else {
    Write-Note 'No habia ningun acceso directo.'
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $Destino)) {
  Write-Error "No se encuentra la consola en $Destino. Ejecuta install.ps1 primero."
  exit 1
}

New-Item -ItemType Directory -Force -Path $programas | Out-Null

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($acceso)
$lnk.TargetPath       = $Destino
$lnk.WorkingDirectory = $SystemDir
$lnk.Description      = 'Cerebro: arranca el hub y el panel; al cerrar la ventana, se apaga todo'
# Icono propio del sistema (una consola), para que no parezca un .cmd suelto.
$lnk.IconLocation    = "$env:SystemRoot\System32\shell32.dll,13"
# 1 = ventana normal (la consola tiene que verse: al cerrarla, se apaga todo).
$lnk.WindowStyle      = 1
$lnk.Save()

Write-Ok "Acceso directo creado: $acceso"
Write-Note "Buscalo en Windows como '$Nombre' (puede tardar unos segundos en indexarse)."

exit 0
