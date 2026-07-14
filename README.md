# Martial Art AI

## Development

Start the backend from PowerShell:

```powershell
.\backend\start.ps1
```

This intentionally runs without Uvicorn auto-reload. On Windows, `--reload` scans
the backend virtual environment and can exhaust system resources. Restart the
command after changing backend Python files. Access logging is also disabled so
the WebSocket authentication token is not printed as part of its connection URL.

Start the frontend in another terminal:

```powershell
Set-Location frontend
npm run dev
```
