<#
.SYNOPSIS
  A-P4.1 一键部署脚本：静默安装 → 信任内部签名证书 → 预置 userData →
  写入无人值守环境变量 → 可选启动应用。
.DESCRIPTION
  目标机器（干净 Windows 10/11 x64）上执行一次即可完成无人维护部署：
    1. NSIS 安装包 /S 静默安装到指定目录；
    2. 把包内 internal-signing.pfx.cer 导入 CurrentUser Root +
       TrustedPublisher（应用首启也会自动做，这里提前做保证首启即可验签升级）；
    3. 把 -UserDataSeedDir 预置到 %APPDATA%\Dental Clinic V2；
    4. 写入 User 级环境变量（备份密钥/JWT/镜像目录/磁盘阈值/更新开关）；
    5. 校验安装产物，落 deploy-fleet.json 报告。
  兼容 PowerShell 5.1（无 ?? / 三元 / ForEach-Object -Parallel）。
.PARAMETER InstallerPath
  Dental Clinic V2 内部版安装包（*.exe）的完整路径（必填）。
.PARAMETER InstallDir
  安装目录。缺省 %LOCALAPPDATA%\Programs\Dental Clinic V2。
.PARAMETER UserDataSeedDir
  可选：预置数据目录，内容会被完整复制到 %APPDATA%\Dental Clinic V2。
.PARAMETER MirrorDir
  可选：异地备份镜像目录（网络共享/NAS/USB），写入 V2_BACKUP_MIRROR_DIR。
.PARAMETER MirrorKeep
  镜像目录保留份数，缺省 30。
.PARAMETER BackupKey
  备份加密密钥。缺省复用既有 User 级 V2_BACKUP_KEY；仍无则随机生成并
  同时写入 User 环境变量与 userData\logs\deploy-fleet-credentials.txt。
  密钥丢失 = 备份数据不可恢复，必须离线保管。
.PARAMETER JwtSecret
  API JWT 密钥。缺省复用既有 User 级 V2_JWT_SECRET；仍无则随机生成。
.PARAMETER DiskThresholdBytes
  可选：磁盘告警阈值字节数，写入 V2_DISK_THRESHOLD_BYTES。
.PARAMETER DisableAutoUpdate
  设置 V2_DISABLE_AUTO_UPDATE=1，关闭自动更新。
.PARAMETER RefreshCertTrust
  导入新证书前，从 CurrentUser Root/TrustedPublisher 移除同一 Subject 的旧证书。
.PARAMETER NoStart
  安装完成后不启动应用（由登录自动启动或运维手动启动）。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [string]$InstallDir = "",

  [string]$UserDataSeedDir = "",

  [string]$MirrorDir = "",

  [int]$MirrorKeep = 30,

  [string]$BackupKey = "",

  [string]$JwtSecret = "",

  [string]$DiskThresholdBytes = "",

  [switch]$DisableAutoUpdate,

  [switch]$RefreshCertTrust,

  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ("[deploy-fleet] " + $Message)
}

function New-RandomHex {
  param([int]$Length = 64)
  $byteCount = [math]::Ceiling($Length / 2)
  $bytes = New-Object byte[] $byteCount
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  return $hex.Substring(0, $Length)
}

function Set-UserEnvironmentVariable {
  param([string]$Name, [string]$Value)
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  Write-Step ("User env " + $Name + " configured")
}

function Import-CurrentUserCert {
  param([string]$CertPath, [bool]$Refresh = $false)
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
  $cert.Import($CertPath)
  foreach ($storeName in @("Root", "TrustedPublisher")) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "CurrentUser")
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
      if ($Refresh) {
        $stale = @()
        foreach ($existing in $store.Certificates) {
          if (($existing.Subject -eq $cert.Subject) -and ($existing.Thumbprint -ne $cert.Thumbprint)) {
            $stale += $existing
          }
        }
        foreach ($existing in $stale) {
          $store.Remove($existing) | Out-Null
          Write-Step ("Removed stale certificate " + $existing.Thumbprint + " from CurrentUser " + $storeName)
        }
      }
      $alreadyTrusted = $false
      foreach ($existing in $store.Certificates) {
        if ($existing.Thumbprint -eq $cert.Thumbprint) {
          $alreadyTrusted = $true
          break
        }
      }
      if (-not $alreadyTrusted) {
        $store.Add($cert)
        Write-Step ("Certificate " + $cert.Thumbprint + " added to CurrentUser " + $storeName)
      } else {
        Write-Step ("Certificate " + $cert.Thumbprint + " already trusted in CurrentUser " + $storeName)
      }
    } finally {
      $store.Close()
    }
  }
}

function Test-NonEmpty {
  param([string]$Value)
  return (-not [string]::IsNullOrWhiteSpace($Value))
}

$startedAt = Get-Date

if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw ("Installer not found: " + $InstallerPath)
}
if ([System.IO.Path]::GetExtension($InstallerPath).ToLowerInvariant() -ne ".exe") {
  throw "InstallerPath must point to a .exe installer"
}

if (-not (Test-NonEmpty $InstallDir)) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Dental Clinic V2"
}
$userDataDir = Join-Path $env:APPDATA "Dental Clinic V2"
$userLogDir = Join-Path $userDataDir "logs"
$userBackupDir = Join-Path $userDataDir "backups"

Write-Step ("Installer: " + $InstallerPath)
Write-Step ("InstallDir: " + $InstallDir)
Write-Step ("UserData:   " + $userDataDir)

# 1. 静默安装（/S，per-user；/D 必须是最后一个参数）。
if (Test-Path -LiteralPath $InstallDir) {
  throw ("InstallDir already exists, aborting to avoid overwriting a live install: " + $InstallDir)
}
New-Item -ItemType Directory -Path (Split-Path -Parent $InstallDir) -Force | Out-Null
$installArgs = @("/S", "/D=" + $InstallDir)
Write-Step "Running silent installer (/S)..."
$install = Start-Process -FilePath $InstallerPath -ArgumentList $installArgs -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) {
  throw ("Installer exited with code " + $install.ExitCode)
}

# 2. 校验安装产物。
$appExe = Join-Path $InstallDir "Dental Clinic V2.exe"
$requiredFiles = @(
  $appExe,
  (Join-Path $InstallDir "resources\app.asar"),
  (Join-Path $InstallDir "resources\legacy\dental.sqlite"),
  (Join-Path $InstallDir "resources\legacy\schema\system.tables.ts")
)
foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw ("Missing installed file: " + $file)
  }
}
Write-Step "Installed files verified"

# 3. 信任内部签名证书（应用首启前完成，首启即可验签自动更新）。
$cerPath = Join-Path $InstallDir "resources\app.asar.unpacked\build\internal-signing.pfx.cer"
if (Test-Path -LiteralPath $cerPath) {
  Import-CurrentUserCert -CertPath $cerPath -Refresh $RefreshCertTrust.IsPresent
  Write-Step "Internal signing certificate trusted"
} else {
  Write-Warning ("Bundled signing certificate not found at " + $cerPath + "; the app will trust it on first run")
}

# 4. 预置 userData（先建目录，再覆盖复制种子内容）。
New-Item -ItemType Directory -Path $userDataDir, $userLogDir, $userBackupDir -Force | Out-Null
if (Test-NonEmpty $UserDataSeedDir) {
  if (-not (Test-Path -LiteralPath $UserDataSeedDir)) {
    throw ("UserDataSeedDir not found: " + $UserDataSeedDir)
  }
  Copy-Item -Path (Join-Path $UserDataSeedDir "*") -Destination $userDataDir -Recurse -Force
  Write-Step "UserData seeded from " + $UserDataSeedDir
}

# 5. 无人值守环境变量（User 级，应用重启后生效）。
if (Test-NonEmpty $MirrorDir) {
  Set-UserEnvironmentVariable -Name "V2_BACKUP_MIRROR_DIR" -Value $MirrorDir
  Set-UserEnvironmentVariable -Name "V2_BACKUP_MIRROR_KEEP" -Value ([string]$MirrorKeep)
}
if (Test-NonEmpty $DiskThresholdBytes) {
  $parsedDiskThreshold = [int64]0
  if (-not [int64]::TryParse($DiskThresholdBytes, [ref]$parsedDiskThreshold) -or $parsedDiskThreshold -le 0) {
    throw "DiskThresholdBytes must be a positive 64-bit integer"
  }
  Set-UserEnvironmentVariable -Name "V2_DISK_THRESHOLD_BYTES" -Value ([string]$parsedDiskThreshold)
}
if ($DisableAutoUpdate.IsPresent) {
  Set-UserEnvironmentVariable -Name "V2_DISABLE_AUTO_UPDATE" -Value "1"
}

$resolvedBackupKey = $BackupKey
if (-not (Test-NonEmpty $resolvedBackupKey)) {
  $resolvedBackupKey = [Environment]::GetEnvironmentVariable("V2_BACKUP_KEY", "User")
}
$backupKeyGenerated = $false
if (-not (Test-NonEmpty $resolvedBackupKey)) {
  $resolvedBackupKey = New-RandomHex -Length 64
  $backupKeyGenerated = $true
}
Set-UserEnvironmentVariable -Name "V2_BACKUP_KEY" -Value $resolvedBackupKey

$resolvedJwtSecret = $JwtSecret
if (-not (Test-NonEmpty $resolvedJwtSecret)) {
  $resolvedJwtSecret = [Environment]::GetEnvironmentVariable("V2_JWT_SECRET", "User")
}
if (-not (Test-NonEmpty $resolvedJwtSecret)) {
  $resolvedJwtSecret = New-RandomHex -Length 64
}
Set-UserEnvironmentVariable -Name "V2_JWT_SECRET" -Value $resolvedJwtSecret

# 6. 部署报告与密钥保管提醒（密钥丢失 = 备份数据不可恢复）。
$report = [ordered]@{
  deployedAt   = $startedAt.ToString("o")
  installer    = $InstallerPath
  installDir   = $InstallDir
  userDataDir  = $userDataDir
  mirrorDir    = $MirrorDir
  mirrorKeep   = $MirrorKeep
  autoUpdate   = if ($DisableAutoUpdate.IsPresent) { "disabled" } else { "enabled" }
  backupKeyGenerated = $backupKeyGenerated
  jwtGenerated = [string]::IsNullOrWhiteSpace($JwtSecret)
}
$reportPath = Join-Path $userLogDir "deploy-fleet.json"
$report | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Step ("Deploy report written to " + $reportPath)

if ($backupKeyGenerated) {
  $credentialPath = Join-Path $userLogDir "deploy-fleet-credentials.txt"
  $credentialContent = @"
Dental Clinic V2 deployment credentials
=======================================
V2_BACKUP_KEY=$resolvedBackupKey
V2_JWT_SECRET=$resolvedJwtSecret

警告：V2_BACKUP_KEY 丢失后所有加密备份不可恢复。请立即把本文件
离线保存到密码管理器/保险箱，并从日常用户目录中删除。
"@
  Set-Content -LiteralPath $credentialPath -Value $credentialContent -Encoding UTF8
  Write-Warning ("Generated V2_BACKUP_KEY and saved it to " + $credentialPath + " - store it off-machine immediately")
}

# 7. 可选启动应用（首次运行自动开启开机自启，A-P1.2）。
if (-not $NoStart.IsPresent) {
  Write-Step "Starting application"
  Start-Process -FilePath $appExe -WindowStyle Normal
}

Write-Step "Deploy complete: $InstallDir"
