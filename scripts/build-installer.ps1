<#
.SYNOPSIS
    One-click NSIS installer build for Dental Clinic Manager (with optional code signing).
.DESCRIPTION
    Runs: pnpm build (shared + api + web) -> electron:compile -> electron-builder
    If CertPassword is provided, signs the installer with WIN_CSC_LINK .pfx file.
.EXAMPLE
    .\scripts\build-installer.ps1

    .\scripts\build-installer.ps1 -CertPassword "your-password"
#>
param(
    [string]$CertPassword = ""
)

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path -Parent $PSScriptRoot

Write-Host "===== Dental Clinic Installer Build =====" -ForegroundColor Cyan
Write-Host ""

# Configure code signing certificate (optional)
if ($CertPassword) {
    $pfxPath = Join-Path $rootDir 'certs\signing-cert.pfx'
    if (-not (Test-Path $pfxPath)) {
        Write-Error "Certificate file not found: $pfxPath"
        Write-Host "Please run first: .\scripts\generate-signing-cert.ps1" -ForegroundColor Yellow
        exit 1
    }
    $env:WIN_CSC_LINK = $pfxPath
    $env:WIN_CSC_KEY_PASSWORD = $CertPassword
    Write-Host "[Signing] Code signing certificate configured" -ForegroundColor Green
} else {
    Write-Host "[Signing] No certificate password provided, skipping code signing" -ForegroundColor Yellow
    Write-Host "        Usage: .\scripts\build-installer.ps1 -CertPassword 'password'" -ForegroundColor Gray
}

Write-Host ""

# Change to project root directory
Push-Location $rootDir
try {
    Write-Host "[1/3] Building shared + api + web..." -ForegroundColor Cyan
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }

    Write-Host ""
    Write-Host "[2/3] Compiling Electron main process..." -ForegroundColor Cyan
    pnpm --filter @dental/web electron:compile
    if ($LASTEXITCODE -ne 0) { throw "electron:compile failed" }

    Write-Host ""
    Write-Host "[3/3] Packaging NSIS installer..." -ForegroundColor Cyan
    pnpm --filter @dental/web exec electron-builder --win nsis --publish never
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

    Write-Host ""
    Write-Host "===== Build Successful =====" -ForegroundColor Green
    $releaseDir = Join-Path $rootDir 'release-v2'
    Write-Host "Output directory: $releaseDir"

    # List generated files
    if (Test-Path $releaseDir) {
        Write-Host ""
        Write-Host "Generated files:" -ForegroundColor Cyan
        Get-ChildItem $releaseDir -File | ForEach-Object {
            $sizeMB = [math]::Round($_.Length / 1MB, 1)
            $name = $_.Name
            Write-Host "  $name ($sizeMB MB)"
        }
    }
} finally {
    Pop-Location
    # Clean up environment variables
    Remove-Item Env:\WIN_CSC_LINK -ErrorAction SilentlyContinue
    Remove-Item Env:\WIN_CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
}
