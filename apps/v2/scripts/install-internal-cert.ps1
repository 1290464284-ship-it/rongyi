[CmdletBinding()]
param(
    [string]$CertificatePath = "certs/internal-signing.pfx.cer",
    [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
$appRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$certFile = Join-Path $appRoot $CertificatePath
if (-not (Test-Path -LiteralPath $certFile)) {
    throw "Certificate not found: $certFile"
}

$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certFile)

if (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
    if (Test-Path -LiteralPath $InstallerPath) {
        Unblock-File -LiteralPath $InstallerPath -ErrorAction SilentlyContinue
        Write-Host "Unblocked: $InstallerPath"
    } else {
        Write-Host "Installer not found, skipped Unblock-File: $InstallerPath"
    }
}

$isAdmin = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$locations = @(
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
if ($isAdmin) {
    $locations = @(
        [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
    )
}

foreach ($storeName in @("Root", "TrustedPublisher")) {
    foreach ($location in $locations) {
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, $location)
        try {
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            $exists = $false
            foreach ($c in $store.Certificates) {
                if ($c.Thumbprint -eq $cert.Thumbprint) {
                    $exists = $true
                    break
                }
            }
            if (-not $exists) {
                $store.Add($cert)
                Write-Host "Installed $($cert.Subject) into $location\$storeName"
            } else {
                Write-Host "$($cert.Subject) already present in $location\$storeName"
            }
        } finally {
            $store.Close()
        }
    }
}

Write-Host ""
Write-Host "Trust installed. Admin mode covers all users; otherwise it covers the current user."
Write-Host "Reboot or re-run the installer if SmartScreen still prompts."
