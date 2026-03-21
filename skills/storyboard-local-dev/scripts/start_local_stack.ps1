param(
  [switch]$SkipBackend,
  [switch]$IncludeConvex
)

$skillScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $skillScriptsDir "..\..\..")
$launcher = Join-Path $repoRoot "scripts\start_storyboard_local.ps1"

if (-not (Test-Path $launcher)) {
  throw "Missing stack launcher at $launcher"
}

& $launcher @PSBoundParameters
