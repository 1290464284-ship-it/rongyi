param(
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

# T2R-22 leftover 3: port 3199 falls inside the Windows reserved range
# (3170-3269, Hyper-V/WSL dynamic ports); binding it always fails with EACCES.
# Use a system-assigned free port instead of a hardcoded one.
function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}
$smokePort = Get-FreePort

$releaseDir = if ($env:V2_RELEASE_DIR) {
    $env:V2_RELEASE_DIR
} else {
    Join-Path $PSScriptRoot "..\release-v2"
}
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
  # E-5 裁剪（2026-08-17）：打包内仅携带 generated.sql（运行时首选），不再打包 .tables.ts
  (Join-Path $installDir "resources\legacy\schema\legacy-schema.generated.sql")
)
foreach ($file in $required) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Missing installed file: $file"
  }
}

$env:ELECTRON_RUN_AS_NODE = "1"
$env:V2_PORT = [string]$smokePort
$env:V2_DATA_DIR = Join-Path $installDir ".smoke-data"
$env:V2_BACKUP_DIR = Join-Path $env:V2_DATA_DIR "backups"
$env:V2_LOG_DIR = Join-Path $env:V2_DATA_DIR "logs"
$env:V2_LEGACY_DB_PATH = Join-Path $installDir "resources\legacy\dental.sqlite"
$env:V2_LEGACY_SCHEMA_DIR = Join-Path $installDir "resources\legacy\schema"
$env:V2_JWT_SECRET = "installer-smoke-secret-0123456789abcdef0123456789abcdef"
$env:V2_BACKUP_KEY = "installer-backup-key-0123456789abcdef"
$env:NODE_ENV = "development"

$apiScript = Join-Path $installDir "resources\app.asar\dist-electron\server.cjs"
# Round7 H3: capture API stdout/stderr so a failed smoke is diagnosable from CI logs.
$apiOut = Join-Path $env:TEMP ("v2-api-" + [guid]::NewGuid().ToString("N") + ".out.log")
$apiErr = Join-Path $env:TEMP ("v2-api-" + [guid]::NewGuid().ToString("N") + ".err.log")
$api = Start-Process -FilePath $appExe -ArgumentList "`"$apiScript`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
try {
  # 90s: first launch on a fresh runner includes Defender scan of the unsigned exe,
  # legacy import, full migration and search-index rebuild; 30s was too tight.
  $deadline = (Get-Date).AddSeconds(90)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$smokePort/api/v2/health" -TimeoutSec 2
      if ($health.data.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    if ($api -and -not $api.HasExited) {
      Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    Write-Host "=== API stdout tail ==="
    if (Test-Path -LiteralPath $apiOut) { Get-Content -LiteralPath $apiOut -Tail 80 }
    Write-Host "=== API stderr tail ==="
    if (Test-Path -LiteralPath $apiErr) { Get-Content -LiteralPath $apiErr -Tail 80 }
    throw "Installed API did not become healthy"
  }
  Write-Host "Installed API health check passed"
} finally {
  if ($api -and -not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $apiOut, $apiErr -Force -ErrorAction SilentlyContinue
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
