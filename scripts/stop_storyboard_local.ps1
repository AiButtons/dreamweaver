$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $repoRoot ".runlogs\storyboard-local-processes.json"

if (-not (Test-Path $pidFile)) {
  Write-Host "No process metadata file found at $pidFile"
  exit 0
}

$entries = Get-Content $pidFile | ConvertFrom-Json
if ($entries -isnot [System.Array]) {
  $entries = @($entries)
}

function Get-DescendantProcessIds {
  param(
    [int]$RootProcessId
  )

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootProcessId" -ErrorAction SilentlyContinue)
  $result = @()
  foreach ($child in $children) {
    $childId = [int]$child.ProcessId
    $result += $childId
    $result += Get-DescendantProcessIds -RootProcessId $childId
  }
  return $result
}

foreach ($entry in $entries) {
  $rootProcId = [int]$entry.pid
  $name = [string]$entry.name

  $tree = @($rootProcId) + @(Get-DescendantProcessIds -RootProcessId $rootProcId)
  $tree = $tree | Select-Object -Unique | Sort-Object -Descending

  $stoppedAny = $false
  foreach ($id in $tree) {
    try {
      $proc = Get-Process -Id $id -ErrorAction Stop
      Stop-Process -Id $id -Force
      $stoppedAny = $true
    } catch {
      # Ignore missing PIDs.
    }
  }

  if ($stoppedAny) {
    Write-Host "Stopped $name process tree (root pid=$rootProcId)"
  } else {
    Write-Host "Process tree not running: $name (root pid=$rootProcId)"
  }

  $command = [string]$entry.command
  $portMatches = [regex]::Matches($command, '(?:--port|-Port)\s+(\d+)')
  foreach ($match in $portMatches) {
    $port = [int]$match.Groups[1].Value
    $listeners = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
      $owner = [int]$listener.OwningProcess
      try {
        Stop-Process -Id $owner -Force
        Write-Host "Stopped lingering listener on port $port (pid=$owner)"
      } catch {
        # Ignore failures.
      }
    }
  }
}
