<#
.SYNOPSIS
    Generate a self-signed code signing certificate and export as .pfx file.
.DESCRIPTION
    For development/testing phase installer signing.
    Self-signed certificates cannot eliminate SmartScreen warnings,
    but can verify the signing flow works correctly.
    To officially eliminate warnings, purchase a CA-issued code signing certificate.
.EXAMPLE
    .\scripts\generate-signing-cert.ps1
#>

$ErrorActionPreference = 'Stop'

# Ensure certificate directory exists
$certsDir = Join-Path $PSScriptRoot '..\certs'
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir | Out-Null
    Write-Host "Created directory: $certsDir"
}

$pfxPath = Join-Path $certsDir 'signing-cert.pfx'
if (Test-Path $pfxPath) {
    Write-Warning "Certificate file already exists: $pfxPath"
    $overwrite = Read-Host "Overwrite? (y/N)"
    if ($overwrite -ne 'y' -and $overwrite -ne 'Y') {
        Write-Host "Cancelled"
        exit 0
    }
}

# Generate self-signed code signing certificate
Write-Host "Generating self-signed code signing certificate..."
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Dental Clinic Dev" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -HashAlgorithm sha256 `
    -KeyLength 2048

# Set certificate password
$password = Read-Host "Set certificate password (empty for default 'dental-dev')"
if ([string]::IsNullOrEmpty($password)) {
    $password = 'dental-dev'
}

# Export as .pfx
$securePassword = ConvertTo-SecureString -String $password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null

Write-Host ""
Write-Host "===== Certificate Generated =====" -ForegroundColor Green
Write-Host "File path: $pfxPath"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Store location: Cert:\CurrentUser\My\$($cert.Thumbprint)"
Write-Host ""
Write-Host "Build usage:" -ForegroundColor Cyan
Write-Host "  .\scripts\build-installer.ps1 -CertPassword '$password'"
Write-Host ""
Write-Host "Or manually set environment variables:" -ForegroundColor Cyan
Write-Host "  `$env:WIN_CSC_LINK = 'certs/signing-cert.pfx'"
Write-Host "  `$env:WIN_CSC_KEY_PASSWORD = '$password'"
Write-Host ""
Write-Host "Note: Self-signed certificates cannot eliminate SmartScreen warnings." -ForegroundColor Yellow
Write-Host "      To officially eliminate warnings, purchase a CA-issued certificate." -ForegroundColor Yellow
