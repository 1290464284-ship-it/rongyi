[CmdletBinding()]
param(
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [switch]$SkipInstallerSmoke
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$appRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$generatedCertificatePath = ""

function Invoke-OrFail {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandLine
    )

    & ([scriptblock]::Create($CommandLine))
    if ($LASTEXITCODE -ne 0) {
        throw "$CommandLine failed with exit code $LASTEXITCODE"
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($env:CSC_LINK)) {
        if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
            $passwordBytes = New-Object byte[] 24
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $rng.GetBytes($passwordBytes)
            } finally {
                $rng.Dispose()
            }
            $CertificatePassword = [Convert]::ToBase64String($passwordBytes)
            $generatedCertificatePath = Join-Path `
                ([System.IO.Path]::GetTempPath()) `
                "dental-v2-internal-$([guid]::NewGuid().ToString('N')).pfx"

            $cert = New-SelfSignedCertificate `
                -Type CodeSigningCert `
                -Subject "CN=Dental Clinic V2 Internal" `
                -KeyAlgorithm RSA `
                -KeyLength 2048 `
                -HashAlgorithm SHA256 `
                -CertStoreLocation "Cert:\CurrentUser\My" `
                -NotAfter (Get-Date).AddYears(1)

            try {
                $securePassword = ConvertTo-SecureString `
                    -String $CertificatePassword `
                    -Force `
                    -AsPlainText
                Export-PfxCertificate `
                    -Cert $cert `
                    -FilePath $generatedCertificatePath `
                    -Password $securePassword | Out-Null
            } finally {
                Remove-Item `
                    -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
                    -Force `
                    -ErrorAction SilentlyContinue
            }

            $env:CSC_LINK = $generatedCertificatePath
            $env:CSC_KEY_PASSWORD = $CertificatePassword
        } else {
            $env:CSC_LINK = (Resolve-Path -LiteralPath $CertificatePath).Path
            $env:CSC_KEY_PASSWORD = $CertificatePassword
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:CSC_LINK)) {
        throw "CSC_LINK is still empty; provide -CertificatePath or set CSC_LINK before running this script."
    }

    Push-Location -LiteralPath $appRoot
    $pkgJsonPath = Join-Path $appRoot "package.json"
    $originalPkgJson = [System.IO.File]::ReadAllText($pkgJsonPath)
    $internalVersion = ""
    try {
        # 内部构建版本号策略（审计中危项）：内部版与公开版同版本号且非
        # prerelease 时，electron-updater 永远认为"已是最新"，内部 feed 更新
        # 永不生效。这里在打包前把版本临时改写为 <base>-internal.<UTC时间戳>，
        # 同基线版本下每次内部构建严格递增；打包完成后精确还原 package.json。
        $baseVersion = ($originalPkgJson | ConvertFrom-Json).version
        $buildStamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
        $internalVersion = "$baseVersion-internal.$buildStamp"
        $patchedPkgJson = [regex]::Replace(
            $originalPkgJson,
            '("version"\s*:\s*")[^"]+(")',
            ('${1}' + $internalVersion + '${2}'),
            1
        )
        [System.IO.File]::WriteAllText(
            $pkgJsonPath,
            $patchedPkgJson,
            [System.Text.UTF8Encoding]::new($false)
        )
        Write-Host "Internal build version: $internalVersion"
        Invoke-OrFail "pnpm electron:dist"
        Invoke-OrFail "pnpm run verify:package"
        Invoke-OrFail "pnpm run update:metadata"
        Invoke-OrFail "pnpm run verify:update"
        if (-not $SkipInstallerSmoke) {
            Invoke-OrFail "pnpm run installer:smoke"
        }
    } finally {
        [System.IO.File]::WriteAllBytes($pkgJsonPath, [System.Text.Encoding]::UTF8.GetBytes($originalPkgJson))
        Pop-Location
    }

    $installer = Get-ChildItem `
        -LiteralPath (Join-Path $appRoot "release-v2") `
        -Filter "*.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if (-not $installer) {
        throw "Installer was not produced under apps/v2/release-v2"
    }

    Write-Host "Internal installer ready: $installer"
    Write-Host "This build uses an untrusted self-signed certificate."
    Write-Host "Use it only on machines you control; SmartScreen will require 'More info > Run anyway'."
} finally {
    if (
        $generatedCertificatePath -and
        (Test-Path -LiteralPath $generatedCertificatePath)
    ) {
        Remove-Item -LiteralPath $generatedCertificatePath -Force
    }
}
