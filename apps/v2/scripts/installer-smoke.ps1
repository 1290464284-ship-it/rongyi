param(
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

$releaseDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\release-v2")
if (-not $InstallerPath) {
  $InstallerPath = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath)) {
  throw "Installer not found"
}

$installDir = Join-Path $env:TEMP ("v2-installer-smoke-" + [guid]::NewGuid().ToString("N"))
if (Test-Path -LiteralPath $installDir) {
  [System.IO.Directory]::Delete($installDir, $true)
}

Write-Host "Installing $InstallerPath -> $installDir"
$install = Start-Process -FilePath $InstallerPath -ArgumentList "/S", "/D=$installDir" -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) {
  throw "Installer exited with code $($install.ExitCode)"
}

$appExe = Join-Path $installDir "Dental Clinic V2.exe"
$required = @(
  $appExe,
  (Join-Path $installDir "resources\app.asar"),
  (Join-Path $installDir "resources\legacy\dental.sqlite"),
  (Join-Path $installDir "resources\legacy\schema\system.tables.ts")
)
foreach ($file in $required) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Missing installed file: $file"
  }
}

$env:ELECTRON_RUN_AS_NODE = "1"
$env:V2_PORT = "3199"
$env:V2_DATA_DIR = Join-Path $installDir ".smoke-data"
$env:V2_BACKUP_DIR = Join-Path $env:V2_DATA_DIR "backups"
$env:V2_LOG_DIR = Join-Path $env:V2_DATA_DIR "logs"
$env:V2_LEGACY_DB_PATH = Join-Path $installDir "resources\legacy\dental.sqlite"
$env:V2_LEGACY_SCHEMA_DIR = Join-Path $installDir "resources\legacy\schema"
$env:V2_JWT_SECRET = "installer-smoke-secret-0123456789abcdef0123456789abcdef"
$env:V2_BACKUP_KEY = "installer-backup-key-0123456789abcdef"
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
    throw "Installed API did not become healthy"
  }
  Write-Host "Installed API health check passed"
} finally {
  if ($api -and -not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}

$uninstaller = Get-ChildItem -LiteralPath $installDir -Filter "Uninstall*.exe" |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $uninstaller) {
  throw "Uninstaller not found"
}

Write-Host "Uninstalling from $installDir"
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $appExe) {
  throw "Uninstall did not remove the application executable"
}

if (Test-Path -LiteralPath $installDir) {
  [System.IO.Directory]::Delete($installDir, $true)
}

Write-Host "Installer smoke passed: $InstallerPath"
