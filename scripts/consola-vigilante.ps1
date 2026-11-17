#Requires -Version 5.1
<#
.SYNOPSIS
  Vigilante de la consola del Cerebro: apaga todo cuando la consola se cierra.

.DESCRIPTION
  Al cerrar la ventana de la consola, Windows mata el proceso de PowerShell y el
  bloque `finally` no llega a ejecutarse: el hub y el panel se quedarian encendidos.

  Este vigilante se lanza detached (ventana oculta propia, sobrevive al cierre de la
  consola) y vigila dos senales:
    - el proceso padre (PID) deja de existir  -> la consola se cerro de golpe
    - el fichero de latido deja de actualizarse -> la consola esta colgada o murio

  Cuando cualquiera de las dos ocurre, llama a `consola.ps1 -Accion parar` con el
  fichero de estado, que apaga exactamente lo que encendio esa consola. Los datos y la
  configuracion no se tocan.

  Si el fichero de latido aun no existe, se espera: su ausencia no significa por si
  sola que la consola haya muerto (la senal fiable es el proceso padre).

  No es un servicio: muere con la maquina y no sobrevive a un reinicio.
#>
param(
  [Parameter(Mandatory = $true)][int]$Padre,
  [Parameter(Mandatory = $true)][string]$Latido,
  [Parameter(Mandatory = $true)][string]$Estado,
  [Parameter(Mandatory = $true)][string]$Consola
)

$ErrorActionPreference = 'Continue'

# Segundos sin latido antes de dar la consola por muerta.
$MargenLatido = 20
$Intervalo    = 2

function Test-PadreVivo([int]$pidPadre) {
  try {
    $null = Get-Process -Id $pidPadre -ErrorAction Stop
    return $true
  } catch { return $false }
}

# Devuelve los segundos desde el ultimo latido, o -1 si el fichero aun no existe.
function Get-AntiguedadLatido([string]$ruta) {
  if (-not (Test-Path -LiteralPath $ruta)) { return -1 }
  try {
    return ((Get-Date) - (Get-Item -LiteralPath $ruta).LastWriteTime).TotalSeconds
  } catch { return -1 }
}

$inicio = Get-Date

# La sesion es la DUEÑA de lo que este watcher vigila. Si otra consola mas
# reciente tomo el relevo (habria otra consola viva con su propio estado), este
# watcher se retira sin tocar nada: el hub y el panel son compartidos.
function Test-SesionVigente {
  if (-not (Test-Path -LiteralPath $Estado)) { return $false }
  try {
    $e = Get-Content -LiteralPath $Estado -Raw | ConvertFrom-Json
    if (-not $e -or -not $e.pid) { return $false }
    # Si el PID de este estado ya no es el padre, esta sesion fue sustituida.
    return ([int]$e.pid -eq $Padre)
  } catch { return $false }
}

while ($true) {
  # Si el padre ya no esta, la consola se cerro: a apagar.
  if (-not (Test-PadreVivo $Padre)) { break }

  $edad = Get-AntiguedadLatido $Latido
  if ($edad -ge 0 -and $edad -gt $MargenLatido) { break }

  # Sin fichero de latido todavia: se espera mientras el padre siga vivo.
  if ($edad -lt 0) {
    $esperado = ((Get-Date) - $inicio).TotalSeconds
    if ($esperado -gt $MargenLatido) { break }
  }

  # Si el estado ya no existe, la consola termino sola: no hay nada que hacer.
  if (-not (Test-Path -LiteralPath $Estado)) { exit 0 }

  Start-Sleep -Seconds $Intervalo
}

# La consola se cerro. Se apaga lo que encendio, salvo que otra consola
# reciente se haya hecho cargo (el hub y el panel los comparten).
$otras = @(Get-ChildItem -LiteralPath (Split-Path -Parent $Estado) -Filter 'consola-estado*.json' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -ne $Estado } |
  Where-Object {
    try {
      $e = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      $e -and $e.pid -and (Get-Process -Id ([int]$e.pid) -ErrorAction SilentlyContinue)
    } catch { $false }
  })

if ($otras.Count -eq 0 -and (Test-Path -LiteralPath $Estado)) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $Consola -Accion parar -Estado $Estado -Silencioso | Out-Null
}
# El fichero de latido se borra tambien en este camino (la consola ya no esta para borrarlo).
Remove-Item -LiteralPath $Latido -ErrorAction SilentlyContinue
exit 0
