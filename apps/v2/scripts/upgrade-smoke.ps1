param(
  [string]$CurrentInstallerPath = "",
  [string]$PreviousInstallerPath = ""
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

function Wait-ApiHealthy {
  param([int]$Port)
  $deadline = (Get-Date).AddSeconds(30)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v2/health" -TimeoutSec 2
      if ($health.data.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    throw "API did not become healthy on port $Port"
  }
}

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
$previousVersion = (Get-Item -LiteralPath (Join-Path $installDir "Dental Clinic V2.exe")).VersionInfo.ProductVersion
Write-Host "Previous installed version: $previousVersion"

$env:ELECTRON_RUN_AS_NODE = "1"
$env:V2_PORT = [string]$smokePort
$env:V2_DATA_DIR = Join-Path $appDataRoot "data"
$env:V2_BACKUP_DIR = Join-Path $env:V2_DATA_DIR "backups"
$env:V2_LOG_DIR = Join-Path $env:V2_DATA_DIR "logs"
$env:V2_LEGACY_DB_PATH = Join-Path $installDir "resources\legacy\dental.sqlite"
$env:V2_LEGACY_SCHEMA_DIR = Join-Path $installDir "resources\legacy\schema"
$env:V2_JWT_SECRET = "upgrade-smoke-secret-0123456789abcdef0123456789abcdef"
$env:V2_BACKUP_KEY = "upgrade-backup-key-0123456789abcdef"
$env:NODE_ENV = "development"
if (-not $env:V2_ADMIN_PASSWORD) {
  throw "V2_ADMIN_PASSWORD must be set to run the upgrade smoke"
}

$apiScript = Join-Path $installDir "resources\app.asar\dist-electron\server.cjs"
$previousApi = Start-Process -FilePath (Join-Path $installDir "Dental Clinic V2.exe") -ArgumentList "`"$apiScript`"" -PassThru -WindowStyle Hidden
$patientId = $null
try {
  Wait-ApiHealthy -Port $smokePort
  $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$smokePort/api/v2/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = $env:V2_ADMIN_PASSWORD } | ConvertTo-Json)
  $headers = @{ Authorization = "Bearer $($login.data.token)" }
  # 升级前写入一条患者记录，升级后必须能通过同一数据库读回，才能证明
  # userData 数据库真的在升级后被复用，而不是启动了一份全新数据。
  $patientBody = @{
    code = "UPGRADE-SMOKE-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    name = "Upgrade Smoke Patient"
    gender = "UNKNOWN"
    phone = "1390000$(Get-Random -Minimum 1000 -Maximum 9999)"
    source = "WALK_IN"
  } | ConvertTo-Json
  $createdPatient = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$smokePort/api/v2/resources/patients" -Headers $headers -ContentType "application/json" -Body $patientBody
  $patientId = [string]$createdPatient.data.id
  if (-not $patientId) {
    throw "Failed to create the pre-upgrade patient marker"
  }
  $backup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$smokePort/api/v2/backups" -Headers $headers -ContentType "application/json" -Body "{}"
  $filename = [uri]::EscapeDataString([string]$backup.data.filename)
  $verify = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$smokePort/api/v2/backups/$filename/verify" -Headers $headers
  if ([string]$verify.data.integrity -ne "ok") {
    throw "Backup verification failed before upgrade"
  }
  $restore = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$smokePort/api/v2/backups/$filename/restore" -Headers $headers -ContentType "application/json" -Body "{}"
  if (-not $restore.data.stagedPath) {
    throw "Backup restore staging failed before upgrade"
  }
  Write-Host "Backup restore staged before upgrade"
} finally {
  if ($previousApi -and -not $previousApi.HasExited) {
    Stop-Process -Id $previousApi.Id -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Upgrading with $CurrentInstallerPath"
$current = Start-Process -FilePath $CurrentInstallerPath -ArgumentList "/S", "/D=$installDir" -Wait -PassThru -WindowStyle Hidden
if ($current.ExitCode -ne 0) {
  throw "Current installer exited with code $($current.ExitCode)"
}

$currentVersion = (Get-Item -LiteralPath (Join-Path $installDir "Dental Clinic V2.exe")).VersionInfo.ProductVersion
Write-Host "Current installed version: $currentVersion"
if ($currentVersion -and $previousVersion) {
  if ($currentVersion -le $previousVersion) {
    throw "Upgrade smoke did not increase the installed version: $previousVersion -> $currentVersion"
  }
} elseif ($currentVersion -eq $previousVersion) {
  throw "Upgrade smoke could not prove a version increase (both empty)"
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

$api = Start-Process -FilePath $appExe -ArgumentList "`"$apiScript`"" -PassThru -WindowStyle Hidden
try {
  Wait-ApiHealthy -Port $smokePort
  $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$smokePort/api/v2/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = $env:V2_ADMIN_PASSWORD } | ConvertTo-Json)
  $headers = @{ Authorization = "Bearer $($login.data.token)" }
  $patient = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$smokePort/api/v2/resources/patients/$patientId" -Headers $headers
  if ([string]$patient.data.id -ne $patientId) {
    throw "Pre-upgrade patient data was not preserved across upgrade"
  }
  Write-Host "Pre-upgrade patient data preserved after upgrade"
  Write-Host "Upgraded API health check passed"
} finally {
  if ($api -and -not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}

$env:V2_DB_PATH = Join-Path $env:V2_DATA_DIR "v2.sqlite"
& node (Join-Path $PSScriptRoot "verify-database.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Upgraded database integrity verification failed"
}
Write-Host "Upgraded database integrity ok"

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
