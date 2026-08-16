param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Stop-ForgePilotDevProcesses {
  $patterns = @(
    "dev-electron-vite",
    "electron-vite",
    "dev:mock-cloud",
    "tools/mock-cloud",
    "tools\\mock-cloud"
  )

  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      if ($_.Name -eq "electron.exe") {
        return $true
      }

      if ($_.Name -ne "node.exe") {
        return $false
      }

      $commandLine = ""
      if ($null -ne $_.CommandLine) {
        $commandLine = $_.CommandLine
      }

      foreach ($pattern in $patterns) {
        if ($commandLine -like "*$pattern*") {
          return $true
        }
      }

      return $false
    }

  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connection) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

Write-Host "Stopping ForgePilot dev processes..."
Stop-ForgePilotDevProcesses
Start-Sleep -Seconds 2

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tempRoot = [System.IO.Path]::GetTempPath()
$env:FORGEPILOT_MOCK_CLOUD_STATE_FILE = Join-Path $tempRoot "forgepilot-mock-cloud-state-$timestamp.json"
$mockOut = Join-Path $tempRoot "forgepilot-mock-cloud-$timestamp.out.log"
$mockErr = Join-Path $tempRoot "forgepilot-mock-cloud-$timestamp.err.log"
$devOut = Join-Path $tempRoot "forgepilot-dev-$timestamp.out.log"
$devErr = Join-Path $tempRoot "forgepilot-dev-$timestamp.err.log"

Write-Host "Starting mock cloud..."
$mock = Start-Process `
  -FilePath "corepack" `
  -ArgumentList @("pnpm", "dev:mock-cloud") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $mockOut `
  -RedirectStandardError $mockErr `
  -PassThru

if (-not (Wait-ForPort -Port 4317 -TimeoutSeconds 20)) {
  Write-Error "Mock cloud did not start on port 4317. See $mockOut and $mockErr"
}

Write-Host "Starting ForgePilot..."
$dev = Start-Process `
  -FilePath "corepack" `
  -ArgumentList @("pnpm", "dev") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $devOut `
  -RedirectStandardError $devErr `
  -PassThru

if (-not (Wait-ForPort -Port 5173 -TimeoutSeconds 30)) {
  Write-Error "Renderer dev server did not start on port 5173. See $devOut and $devErr"
}

Start-Sleep -Seconds 3
$electron = Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -eq "ForgePilot" } |
  Select-Object -First 1

Write-Host ""
Write-Host "ForgePilot restarted from scratch."
Write-Host "Mock cloud process: $($mock.Id)"
Write-Host "Dev launcher process: $($dev.Id)"
Write-Host "Mock cloud: http://localhost:4317"
Write-Host "Renderer: http://localhost:5173"
Write-Host "Fresh mock state: $env:FORGEPILOT_MOCK_CLOUD_STATE_FILE"
Write-Host "Mock logs: $mockOut / $mockErr"
Write-Host "Dev logs: $devOut / $devErr"

if ($electron) {
  Write-Host "Electron window: open"
} else {
  Write-Warning "Electron process is running, but the ForgePilot window was not detected yet."
}
