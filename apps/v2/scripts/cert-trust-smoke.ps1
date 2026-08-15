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

# 1. 导入到 CurrentUser Root/TrustedPublisher。A-P0.1 实测 X509Store
#    枚举在 windows runner 上会挂起，certutil 无此问题；-f 幂等覆盖。
foreach ($storeName in @("Root", "TrustedPublisher")) {
  $addOutput = (& certutil.exe -user -addstore -f $storeName $certPath 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $addOutput -notmatch 'command completed successfully') {
    throw ("certutil addstore " + $storeName + " failed: " + $addOutput)
  }
  Write-Step ("Imported certificate into CurrentUser " + $storeName)
}

# 2. 复查导入结果：两个 store 都必须包含当前指纹。
foreach ($storeName in @("Root", "TrustedPublisher")) {
  $verifyOutput = (& certutil.exe -user -store $storeName $cert.Thumbprint 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $verifyOutput -notmatch 'command completed successfully') {
    throw ("certificate missing from CurrentUser " + $storeName + ": " + $verifyOutput)
  }
}
Write-Step "Certificate present in CurrentUser Root and TrustedPublisher"

# 3. 安装包签名必须受信，且签名者指纹必须等于当前信任的证书指纹。
#    包一层 Start-Job 兜底：签名校验若异常挂起，120s 后显式失败而非卡死。
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
if ($signer.Thumbprint -ne $cert.Thumbprint) {
  throw ("Installer signer thumbprint mismatch: " + $signer.Thumbprint + " != " + $cert.Thumbprint)
}
Write-Step ("Installer signature valid (thumbprint " + $signer.Thumbprint + ")")

Write-Step ("PASS: clean-machine cert trust chain verified for " + $InstallerPath)
