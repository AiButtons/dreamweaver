param(
  [int]$Port = 8001,
  [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $backendDir

if (-not (Test-Path ".env")) {
  throw "Missing dreamweaver-backend/.env. Create it before starting the backend."
}

Set-Item -Path Env:PYTHONIOENCODING -Value utf8
Set-Item -Path Env:PYTHONUTF8 -Value 1

if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv run uvicorn main:app --reload --host $BindHost --port $Port
  exit $LASTEXITCODE
}

python -m uvicorn main:app --reload --host $BindHost --port $Port
exit $LASTEXITCODE
