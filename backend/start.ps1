$ErrorActionPreference = "Stop"
$backendRoot = $PSScriptRoot
$python = Join-Path $backendRoot "venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Backend virtual environment not found at $python"
}

& $python -m uvicorn main:app --app-dir $backendRoot --host 127.0.0.1 --port 8000 --no-access-log
exit $LASTEXITCODE
