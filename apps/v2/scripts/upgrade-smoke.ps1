param(
  [string]$CurrentInstallerPath = "",
  [string]$PreviousInstallerPath = ""
)

$ErrorActionPreference = "Stop"

$releaseDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\release-v2")
if (-not $CurrentInstallerPath) {
  $CurrentInstallerPath = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

foreach ($installer in @($CurrentInstallerPath, $PreviousInstallerPath)) {
  if (-not $installer -or -not (Test-Path -LiteralPath $installer)) {
    throw "Installer not found: $installer"
  }
}

$installDir = Join-Path $env:TEMP ("v2-upgrade-smoke-" + [guid]::NewGuid().ToString("N"))
$appDataRoot = Join-Path $env:TEMP ("v2-upgrade-userdata-" + [guid]::NewGuid().ToString("N"))
if (Test-Path -LiteralPath $installDir) {
  [System.IO.Directory]::Delete($installDir, $true)
}
if (Test-Path -LiteralPath $appDataRoot) {
  [System.IO.Directory]::Delete($appDataRoot, $true)
}

$env:APPDATA = $appDataRoot
foreach ($markerDir in @((Join-Path $appDataRoot "Dental Clinic V2"), (Join-Path $appDataRoot "dental-clinic-v2"))) {
  [System.IO.Directory]::CreateDirectory($markerDir) | Out-Null
  Set-Content -LiteralPath (Join-Path $markerDir "upgrade-marker.txt") -Value "preserve-me" -Encoding ascii
}

Write-Host "Installing previous $PreviousInstallerPath"
$previous = Start-Process -FilePath $PreviousInstallerPath -ArgumentList "/S", "/D=$installDir" -Wait -PassThru -WindowStyle Hidden
if ($previous.ExitCode -ne 0) {
  throw "Previous installer exited with code $($previous.ExitCode)"
}

Write-Host "Upgrading with $CurrentInstallerPath"
$current = Start-Process -FilePath $CurrentInstallerPath -ArgumentList "/S", "/D=$installDir" -Wait -PassThru -WindowStyle Hidden
if ($current.ExitCode -ne 0) {
  throw "Current installer exited with code $($current.ExitCode)"
}

$appExe = Join-Path $installDir "Dental Clinic V2.exe"
if (-not (Test-Path -LiteralPath $appExe)) {
  throw "Upgraded executable not found"
}

$markers = Get-ChildItem -LiteralPath $appDataRoot -Recurse -Filter "upgrade-marker.txt" -ErrorAction SilentlyContinue
if (-not $markers) {
  throw "User data marker was not preserved across upgrade"
}
Write-Host "User data preserved after upgrade"

$env:ELECTRON_RUN_AS_NODE = "1"
$env:V2_PORT = "3199"
$env:V2_DATA_DIR = Join-Path $appDataRoot "data"
$env:V2_BACKUP_DIR = Join-Path $env:V2_DATA_DIR "backups"
$env:V2_LOG_DIR = Join-Path $env:V2_DATA_DIR "logs"
$env:V2_LEGACY_DB_PATH = Join-Path $installDir "resources\legacy\dental.sqlite"
$env:V2_LEGACY_SCHEMA_DIR = Join-Path $installDir "resources\legacy\schema"
$env:V2_JWT_SECRET = "upgrade-smoke-secret-0123456789abcdef0123456789abcdef"
$env:V2_BACKUP_KEY = "upgrade-backup-key-0123456789abcdef"
$env:NODE_ENV = "development"

$apiScript = Join-Path $installDir "resources\app.asar\dist-electron\server.cjs"
$api = Start-Process -FilePath $appExe -ArgumentList "`"$apiScript`"" -PassThru -WindowStyle Hidden
try {
  $deadline = (Get-Date).AddSeconds(30)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:3199/api/v2/health" -TimeoutSec 2
      if ($health.data.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    throw "Upgraded API did not become healthy"
  }
  Write-Host "Upgraded API health check passed"
} finally {
  if ($api -and -not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}

$uninstaller = Get-ChildItem -LiteralPath $installDir -Filter "Uninstall*.exe" |
  Select-Object -First 1 -ExpandProperty FullName
if ($uninstaller) {
  Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
}

if (Test-Path -LiteralPath $installDir) {
  [System.IO.Directory]::Delete($installDir, $true)
}
if (Test-Path -LiteralPath $appDataRoot) {
  [System.IO.Directory]::Delete($appDataRoot, $true)
}

Write-Host "Upgrade smoke passed: $PreviousInstallerPath -> $CurrentInstallerPath"
