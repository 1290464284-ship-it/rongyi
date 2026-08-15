<#
.SYNOPSIS
  A-P0.2 证书信任链 smoke：离线验证内部安装包签名链回包内根证书。
.DESCRIPTION
  在 CI 的 internal release 流程中执行，验证「干净机导入包内证书后
  Authenticode 验签必过」的本地等价条件：
    1. 读取仓库内 build/internal-signing.pfx.cer 并计算指纹；
    2. Get-AuthenticodeSignature 校验安装包签名 Valid（120s 看门狗）；
    3. 签名者指纹必须等于包内 CER 指纹；
    4. 以包内 CER 为 CustomRootTrust 做离线 X509Chain 验证（禁用在线
       吊销查询）。
  不访问系统证书库：A-P0.1 实测 X509Store 与 certutil 在 CI runner 上
  均会挂起；实际导入用户证书库由应用首启（cert-trust.cjs）与
  deploy-fleet.ps1 负责，其逻辑有单测覆盖。
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

# 1. 校验安装包 Authenticode 签名。包一层 Start-Job 兜底：若签名检查
#    异常挂起，120s 后显式失败而不是无限卡住发布链。
$signatureJob = Start-Job -ScriptBlock {
  param($path)
  Get-AuthenticodeSignature -FilePath $path
} -ArgumentList $InstallerPath
if (-not (Wait-Job $signatureJob -Timeout 120)) {
  Stop-Job $signatureJob -ErrorAction SilentlyContinue
  Remove-Job $signatureJob -Force -ErrorAction SilentlyContinue
  throw "Authenticode signature check timed out"
}
$signature = Receive-Job $signatureJob
Remove-Job $signatureJob -Force -ErrorAction SilentlyContinue
if ($signature.Status -ne "Valid") {
  throw ("Installer signature is not Valid: " + $signature.Status + " " + $signature.StatusMessage)
}
$signer = $signature.SignerCertificate
if ($null -eq $signer) {
  throw "Installer has no signer certificate"
}

# 2. 签名者指纹必须等于包内信任锚点（internal-signing.pfx.cer）。
if ($signer.Thumbprint -ne $cert.Thumbprint) {
  throw ("Installer signer thumbprint mismatch: " + $signer.Thumbprint + " != " + $cert.Thumbprint)
}
Write-Step ("Installer signer thumbprint matches bundled certificate: " + $signer.Thumbprint)

# 3. 离线链验证：以包内 CER 为 CustomRootTrust，禁用在线吊销查询，
#    验证安装包签名确实链回该自签名根——等价于「干净机导入该证书后
#    Authenticode 验签通过」的本地证明。不访问系统证书库（X509Store 与
#    certutil 在 CI runner 上均实测挂起）。
$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
$chain.ChainPolicy.TrustMode = [System.Security.Cryptography.X509Certificates.X509ChainTrustMode]::CustomRootTrust
$chain.ChainPolicy.CustomTrustStore.Add($cert) | Out-Null
if (-not $chain.Build($signer)) {
  $statuses = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() + ':' + $_.StatusInformation })
  throw ("Installer signature chain failed: " + ($statuses -join '; '))
}
Write-Step "Installer signature chains to the bundled internal root (offline)"

Write-Step ("PASS: clean-machine cert trust chain verified for " + $InstallerPath)
