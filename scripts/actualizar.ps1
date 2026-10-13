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

if (-not $SkipPull) {
  Write-Host '== git pull ==' -ForegroundColor Cyan
  git pull --ff-only
}

Write-Host '== Reinstalando ==' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'install.ps1') -Force

Write-Host "`nActualizado a la version $((Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw).Trim())." -ForegroundColor Green
