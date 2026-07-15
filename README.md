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

## Studio performance

Studio defaults to **Auto** performance mode. It measures pose-processing cost
and switches between Quality, Balanced, and Eco settings for the current
device. Users can override this from the Studio toolbar; the preference is
stored only on that device.

Normal Student Studio keeps Face Mesh and ONNX disabled. The ONNX runtime is
loaded only after an administrator explicitly enables the ACP research layer.

## Azure deployment

Production deployment is intentionally deferred until development and billing
configuration are complete. The Azure architecture, environment settings,
release checks, container file, App Service startup script, and Static Web Apps
configuration are documented in [azure/README.md](azure/README.md).
