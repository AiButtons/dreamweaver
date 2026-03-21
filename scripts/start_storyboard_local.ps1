param(
  [switch]$SkipBackend,
  [switch]$IncludeConvex,
  [switch]$LangGraphTunnel,
  [int]$BackendPort = 8001,
  [int]$LangGraphPort = 8123,
  [int]$FrontendPort = 3002
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot ".runlogs"
New-Item -Path $logsDir -ItemType Directory -Force | Out-Null

function Assert-PortFree {
  param(
    [int]$Port,
    [string]$ServiceName
  )

  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $listeners = @(
      Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue `
      | Where-Object { $_.State -in @("Listen", "Bound", "Established") }
    )
    if ($listeners.Count -gt 0) {
      $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
      throw "Port $Port is already in use by pid(s): $owners. Cannot start $ServiceName."
    }
    return
  }

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
  } catch {
    throw "Port $Port is already in use. Cannot start $ServiceName."
  } finally {
    try {
      $listener.Stop()
    } catch {
      # Ignore cleanup failures.
    }
  }
}

function Start-DetachedService {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logsDir "$Name-$timestamp.out.log"
  $stderr = Join-Path $logsDir "$Name-$timestamp.err.log"

  $process = Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  return [pscustomobject]@{
    name = $Name
    pid = $process.Id
    cwd = $WorkingDirectory
    command = $Command
    stdout = $stdout
    stderr = $stderr
  }
}

$services = @()

if (-not $SkipBackend) {
  Assert-PortFree -Port $BackendPort -ServiceName "backend"
  $backendDir = Join-Path $repoRoot "dreamweaver-backend"
  $backendScript = Join-Path $backendDir "start_server.ps1"
  if (-not (Test-Path $backendScript)) {
    throw "Backend start script not found at $backendScript"
  }
  $services += Start-DetachedService `
    -Name "backend" `
    -WorkingDirectory $backendDir `
    -Command "& `"$backendScript`" -Port $BackendPort -BindHost 127.0.0.1"
}

$agentDir = Join-Path $repoRoot "storyboard-agent"
Assert-PortFree -Port $LangGraphPort -ServiceName "langgraph"
$langgraphCommand = @'
Set-Item -Path Env:PYTHONIOENCODING -Value utf8
Set-Item -Path Env:PYTHONUTF8 -Value 1
if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv run langgraph dev --no-browser --host 127.0.0.1 --port __LANGGRAPH_PORT__ __LANGGRAPH_TUNNEL__
} elseif (Get-Command langgraph -ErrorAction SilentlyContinue) {
  langgraph dev --no-browser --host 127.0.0.1 --port __LANGGRAPH_PORT__ __LANGGRAPH_TUNNEL__
} else {
  throw "Neither 'uv' nor 'langgraph' is available on PATH."
}
'@
$langgraphCommand = $langgraphCommand.Replace("__LANGGRAPH_PORT__", $LangGraphPort.ToString())
$langgraphCommand = $langgraphCommand.Replace("__LANGGRAPH_TUNNEL__", $(if ($LangGraphTunnel) { "--tunnel" } else { "" }))
$services += Start-DetachedService `
  -Name "langgraph" `
  -WorkingDirectory $agentDir `
  -Command $langgraphCommand

if ($IncludeConvex) {
  $frontendDir = Join-Path $repoRoot "dreamweaver-frontend"
  $services += Start-DetachedService `
    -Name "convex" `
    -WorkingDirectory $frontendDir `
    -Command "bun run convex:dev"
}

$frontendDir = Join-Path $repoRoot "dreamweaver-frontend"
$nextLock = Join-Path $frontendDir ".next\dev\lock"
if (Test-Path $nextLock) {
  throw "Next.js dev lock exists at $nextLock. Stop the existing frontend process or remove the stale lock."
}
Assert-PortFree -Port $FrontendPort -ServiceName "frontend"
$services += Start-DetachedService `
  -Name "frontend" `
  -WorkingDirectory $frontendDir `
  -Command "bunx next dev --port $FrontendPort"

$pidFile = Join-Path $logsDir "storyboard-local-processes.json"
$services | ConvertTo-Json -Depth 4 | Set-Content $pidFile

Write-Host ""
Write-Host "Started local storyboard stack:"
foreach ($service in $services) {
  Write-Host " - $($service.name): pid=$($service.pid)"
  Write-Host "   out: $($service.stdout)"
  Write-Host "   err: $($service.stderr)"
}
Write-Host ""
Write-Host "Endpoints:"
if (-not $SkipBackend) {
  Write-Host " - FastAPI backend: http://127.0.0.1:$BackendPort"
}
Write-Host " - LangGraph dev: http://127.0.0.1:$LangGraphPort"
Write-Host " - Next.js frontend: http://127.0.0.1:$FrontendPort"
Write-Host ""
Write-Host "Process metadata file: $pidFile"
