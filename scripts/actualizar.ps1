#Requires -Version 5.1
<#
.SYNOPSIS
  Actualiza sistema-cerebro-agentes: git pull + reinstalación (Windows).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\actualizar.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipPull
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
$install = Invoke-Cli 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoRoot 'install.ps1'), '-Force')
Write-Host $install.Output
if ($install.Code -ne 0) { throw 'La instalacion fallo' }

Write-Host "`nActualizado a la version $((Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw).Trim())." -ForegroundColor Green
