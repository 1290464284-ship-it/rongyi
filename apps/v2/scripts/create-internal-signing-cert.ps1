[CmdletBinding()]
param(
    [string]$CertificatePath = "certs/internal-signing.pfx",
    [string]$CommonName = "Dental Clinic V2 Internal",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$appRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$certDir = Join-Path $appRoot "certs"
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

$pfxPath = Join-Path $appRoot $CertificatePath
$passwordPath = "$pfxPath-password.txt"
if (-not $Force -and (Test-Path -LiteralPath $pfxPath) -and (Test-Path -LiteralPath $passwordPath)) {
    Write-Host "Reusing existing internal signing certificate: $pfxPath"
    exit 0
}

$passwordBytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($passwordBytes)
} finally {
    $rng.Dispose()
}
$password = [Convert]::ToBase64String($passwordBytes)

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$CommonName" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5)

try {
    $securePassword = ConvertTo-SecureString -String $password -Force -AsPlainText
    $cerPath = "$pfxPath.cer"
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
    Set-Content -LiteralPath $passwordPath -Value $password -NoNewline

    Write-Host "Free internal signing certificate created:"
    Write-Host "  PFX:      $pfxPath"
    Write-Host "  Public:   $cerPath"
    Write-Host "  Password: $passwordPath"
    Write-Host ""
    Write-Host "Build with:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/build-internal-installer.ps1 -CertificatePath $CertificatePath -CertificatePassword (Get-Content $passwordPath)"
    Write-Host ""
    Write-Host "To suppress SmartScreen on controlled machines, install $cerPath into"
    Write-Host "Trusted Root Certification Authorities and Trusted Publishers."
} finally {
    Remove-Item `
        -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
        -Force `
        -ErrorAction SilentlyContinue
}
