<#
.SYNOPSIS
  A-P0.2 证书信任链 smoke：模拟干净机器验证内部签名证书信任链。
.DESCRIPTION
  在 CI 的 internal release 流程中执行，验证「受控机器上自签名证书
  信任 → Authenticode 验签」整条链：
    1. 读取仓库内 build/internal-signing.pfx.cer 并计算指纹；
    2. 清空 CurrentUser Root + TrustedPublisher 中同一 Subject 的旧证书
       （模拟干净机器），再导入当前证书；
    3. 校验安装包 Get-AuthenticodeSignature 为 Valid，且签名者指纹与
       当前证书一致；
    4. 全部通过才输出 PASS（任一步失败抛错，使 CI 失败）。
  兼容 PowerShell 5.1（无 ?? / 三元 / ForEach-Object -Parallel）。
.PARAMETER InstallerPath
  已签名的内部版安装包完整路径（必填）。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$certPath = Join-Path $scriptRoot "..\build\internal-signing.pfx.cer"

function Write-Step {
  param([string]$Message)
  Write-Host ("[cert-trust-smoke] " + $Message)
}

if (-not (Test-Path -LiteralPath $certPath)) {
  throw ("Bundled signing certificate not found: " + $certPath)
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw ("Installer not found: " + $InstallerPath)
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
$cert.Import($certPath)
Write-Step ("Certificate thumbprint: " + $cert.Thumbprint)

# 1. 模拟干净机：移除 CurrentUser Root/TrustedPublisher 中同 Subject 的
#    旧证书（含不同指纹的历史证书），再把当前证书导入两个 store。
foreach ($storeName in @("Root", "TrustedPublisher")) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "CurrentUser")
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try {
    $stale = @()
    foreach ($existing in $store.Certificates) {
      if ($existing.Subject -eq $cert.Subject) {
        $stale += $existing
      }
    }
    foreach ($existing in $stale) {
      $store.Remove($existing) | Out-Null
      Write-Step ("Removed existing " + $storeName + " certificate " + $existing.Thumbprint)
    }
    $store.Add($cert)
    Write-Step ("Imported certificate into CurrentUser " + $storeName)
  } finally {
    $store.Close()
  }
}

# 2. 复查导入结果：两个 store 都必须包含当前指纹。
foreach ($storeName in @("Root", "TrustedPublisher")) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "CurrentUser")
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
  try {
    $found = $false
    foreach ($existing in $store.Certificates) {
      if ($existing.Thumbprint -eq $cert.Thumbprint) {
        $found = $true
        break
      }
    }
    if (-not $found) {
      throw ("Certificate missing from CurrentUser " + $storeName + " after import")
    }
  } finally {
    $store.Close()
  }
}
Write-Step "Certificate present in CurrentUser Root and TrustedPublisher"

# 3. 安装包签名必须受信，且签名者指纹必须等于当前信任的证书指纹。
$signature = Get-AuthenticodeSignature -FilePath $InstallerPath
if ($signature.Status -ne "Valid") {
  throw ("Installer signature is not Valid: " + $signature.Status + " " + $signature.StatusMessage)
}
$signer = $signature.SignerCertificate
if ($null -eq $signer) {
  throw "Installer has no signer certificate"
}
if ($signer.Thumbprint -ne $cert.Thumbprint) {
  throw ("Installer signer thumbprint mismatch: " + $signer.Thumbprint + " != " + $cert.Thumbprint)
}
Write-Step ("Installer signature valid (thumbprint " + $signer.Thumbprint + ")")

Write-Step ("PASS: clean-machine cert trust chain verified for " + $InstallerPath)
