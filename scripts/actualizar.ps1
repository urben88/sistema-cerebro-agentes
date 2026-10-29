#Requires -Version 5.1
<#
.SYNOPSIS
  Actualiza sistema-cerebro-agentes: git pull + reinstalación (Windows).

.DESCRIPTION
  Al final ejecuta scripts\verificar.ps1 -Smoke y muestra el resultado (si falla, avisa pero no aborta).
  -SkipPull no hace git pull. -SinVerificar se salta la verificacion.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\actualizar.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipPull,
  [switch]$SinVerificar
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $RepoRoot

function Invoke-Cli([string]$File, [string[]]$Arguments) {
  # Quirk de PowerShell 5.1: stderr de comandos externos + EAP=Stop = error fatal.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& $File @Arguments 2>&1 | Out-String)
    $code   = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  return [pscustomobject]@{ Output = $output; Code = $code }
}

if (-not $SkipPull) {
  Write-Host '== git pull ==' -ForegroundColor Cyan
  $pull = Invoke-Cli 'git' @('pull', '--ff-only')
  Write-Host $pull.Output
  if ($pull.Code -ne 0) { throw 'git pull fallo' }
}

Write-Host '== Reinstalando ==' -ForegroundColor Cyan
$install = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoRoot 'install.ps1'), '-Force', '-SinVerificar')
Write-Host $install.Output
if ($install.Code -ne 0) { throw 'La instalacion fallo' }

Write-Host "`nActualizado a la version $((Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw).Trim())." -ForegroundColor Green

if (-not $SinVerificar) {
  Write-Host "`n== Verificando (smoke) ==" -ForegroundColor Cyan
  # El hub se reinicia al desplegar: esperar hasta 90 s a que estén listos para no dar un falso fallo.
  for ($i = 0; $i -lt 45; $i++) {
    try { $s = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:4597/api/salud'; if ($s.app -eq 'cerebro-hub') { break } } catch { }
    Start-Sleep -Seconds 2
  }
  $ver = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoRoot 'scripts\verificar.ps1'), '-Smoke')
  Write-Host $ver.Output
  if ($ver.Code -ne 0) {
    Write-Host 'AVISO: la verificacion ha fallado (la actualizacion ya esta instalada). Revisa los [X] de arriba.' -ForegroundColor Yellow
  } else {
    Write-Host 'Verificacion correcta.' -ForegroundColor Green
  }
}
