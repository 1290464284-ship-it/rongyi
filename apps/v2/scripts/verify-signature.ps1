$ErrorActionPreference = "Stop"

$releaseDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\release-v2")
$installer = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $installer) {
  throw "Installer not found in $releaseDir"
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer
$subject = $signature.SignerCertificate.Subject
Write-Host "Signature status: $($signature.Status)"
Write-Host "Certificate subject: $subject"

if ($signature.Status -ne "Valid") {
  throw "Installer signature is not valid"
}
if ($subject -match "Dental Clinic Dev" -or $subject -match "self-signed" -or $signature.SignerCertificate.Issuer -eq $signature.SignerCertificate.Subject) {
  throw "Self-signed development certificate is not allowed for release"
}

Write-Host "Trusted signature verification passed: $installer"
