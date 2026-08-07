$ErrorActionPreference = "Stop"

$releaseDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\release-v2")
$installer = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $installer) {
  throw "Installer not found in $releaseDir"
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer
$cert = $signature.SignerCertificate
if (-not $cert) {
  throw "Installer is not signed"
}
Write-Host "Signature status: $($signature.Status)"
Write-Host "Certificate subject: $($cert.Subject)"
Write-Host "Certificate thumbprint: $($cert.Thumbprint)"
Write-Host "Certificate validity: $($cert.NotBefore) -> $($cert.NotAfter)"

if ($signature.Status -ne "Valid") {
  throw "Installer signature is not valid"
}

# Round7 M5：白名单优先——发布 workflow 通过 V2_EXPECTED_CERT_THUMBPRINT
# 注入可信签名证书指纹（仓库 Settings > Variables 配置）。与旧的 subject
# 黑名单不同，指纹白名单只有知道预期值才能通过，任何"恰好被信任"的
# 自签名/测试证书都会被拒绝。
$expected = $env:V2_EXPECTED_CERT_THUMBPRINT
if (-not [string]::IsNullOrWhiteSpace($expected)) {
  if ($cert.Thumbprint -ne $expected) {
    throw "Signer thumbprint mismatch: expected $expected, got $($cert.Thumbprint)"
  }
  if ($cert.NotAfter -lt (Get-Date)) {
    throw "Signing certificate is expired: $($cert.NotAfter)"
  }
  Write-Host "Trusted signature verification passed (pinned thumbprint): $installer"
  exit 0
}

# 未配置指纹时的兜底：信任链校验（拒绝自签名 + 有效期 + X509 链构建）。
$selfSigned = $cert.Issuer -eq $cert.Subject
if ($selfSigned) {
  throw "Self-signed certificate is not allowed; pin the trusted thumbprint via V2_EXPECTED_CERT_THUMBPRINT"
}
if ($cert.NotAfter -lt (Get-Date)) {
  throw "Signing certificate is expired: $($cert.NotAfter)"
}
$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
try {
  $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
  $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
  $chainBuilt = $chain.Build($cert)
  if (-not $chainBuilt) {
    $statuses = ($chain.ChainStatus | ForEach-Object { "$($_.Status): $($_.StatusInformation)" }) -join "; "
    throw "Certificate chain validation failed: $statuses"
  }
} finally {
  $chain.Dispose()
}

Write-Host "Trusted signature verification passed (chain validation): $installer"
