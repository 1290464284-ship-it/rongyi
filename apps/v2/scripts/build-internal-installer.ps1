[CmdletBinding()]
param(
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [switch]$SkipInstallerSmoke
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$appRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$releaseDir = Join-Path $appRoot "release-v2-internal"
$env:V2_RELEASE_DIR = $releaseDir
$generatedCertificatePath = ""
$manualSignCertPath = ""
$manualSignCertPassword = ""

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
            $CertificatePath = "certs\internal-signing.pfx"
            $passwordPath = Join-Path $appRoot "certs\internal-signing.pfx-password.txt"
            if (-not (Test-Path -LiteralPath (Join-Path $appRoot $CertificatePath)) -or -not (Test-Path -LiteralPath $passwordPath)) {
                & (Join-Path $PSScriptRoot "create-internal-signing-cert.ps1")
            }
            $CertificatePassword = Get-Content -LiteralPath $passwordPath -Raw
        }
        $manualSignCertPath = (Resolve-Path -LiteralPath (Join-Path $appRoot $CertificatePath)).Path
        $manualSignCertPassword = $CertificatePassword
        $buildCertDir = Join-Path $appRoot "build"
        New-Item -ItemType Directory -Path $buildCertDir -Force | Out-Null
        Copy-Item `
            -LiteralPath "$manualSignCertPath.cer" `
            -Destination (Join-Path $buildCertDir "internal-signing.pfx.cer") `
            -Force
    } else {
        $manualSignCertPath = $env:CSC_LINK
        $manualSignCertPassword = $env:CSC_KEY_PASSWORD
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
        if ($manualSignCertPath) {
            & (Join-Path $PSScriptRoot "inject-publisher-name.ps1") `
                -PackageJson $pkgJsonPath `
                -CertificatePath $manualSignCertPath `
                -CertificatePassword $manualSignCertPassword
        }
        if ($manualSignCertPath) {
            # 让 electron-builder 在打包阶段签名，app-update.yml 才会写入
            # publisherName，electron-updater 运行时才能强制校验发布者。
            $env:CSC_LINK = $manualSignCertPath
            $env:CSC_KEY_PASSWORD = $manualSignCertPassword
        }
        Invoke-OrFail "pnpm build"
        Invoke-OrFail "pnpm electron:compile"
        Invoke-OrFail "electron-builder --publish never --config.directories.output=$releaseDir"
        if ($manualSignCertPath) {
            $signCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
                $manualSignCertPath,
                $manualSignCertPassword
            )
            $installerBeforeVerify = Get-ChildItem `
                -LiteralPath $releaseDir `
                -Filter "*.exe" |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1 -ExpandProperty FullName
            $signTargets = @(
                (Join-Path $releaseDir "win-unpacked\Dental Clinic V2.exe"),
                (Join-Path $releaseDir "win-unpacked\resources\elevate.exe"),
                $installerBeforeVerify
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) }
            foreach ($target in $signTargets) {
                Set-AuthenticodeSignature `
                    -FilePath $target `
                    -Certificate $signCert `
                    -HashAlgorithm SHA256 | Out-Null
                Write-Host "Signed: $target"
            }
        }
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
        -LiteralPath $releaseDir `
        -Filter "*.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if (-not $installer) {
        throw "Installer was not produced under $releaseDir"
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
