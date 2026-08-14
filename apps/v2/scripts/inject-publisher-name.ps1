[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageJson,
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [Parameter(Mandatory = $true)][string]$CertificatePassword
)

$ErrorActionPreference = "Stop"

$certFile = ""
$tempDir = $env:TEMP
$wasTempFile = $false
Get-ChildItem -LiteralPath $tempDir -Filter 'v2-signing-cert-*.pfx' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-24) } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $CertificatePath) {
  $certFile = (Resolve-Path -LiteralPath $CertificatePath).Path
} elseif ($CertificatePath -match '^[A-Za-z0-9+/=]+$') {
  $certFile = Join-Path $tempDir ("v2-signing-cert-" + [guid]::NewGuid().ToString("N") + ".pfx")
  [System.IO.File]::WriteAllBytes($certFile, [System.Convert]::FromBase64String($CertificatePath))
  $wasTempFile = $true
} else {
  throw "CSC_LINK is neither an existing file nor base64"
}

try {
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certFile, $CertificatePassword)
  $publisherName = $cert.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  $escaped = $publisherName.Replace('\', '\\').Replace('"', '\"')
  $json = Get-Content -LiteralPath $PackageJson -Raw

  if ($json -match '"publisherName"\s*:\s*"[^"]*"') {
    $json = [regex]::Replace($json, '"publisherName"\s*:\s*"[^"]*"', {
        param($match)
        '"publisherName": "' + $escaped + '"'
      }, 1)
  } elseif ($json -match '"signtoolOptions"\s*:\s*\{') {
    $json = [regex]::Replace($json, '"signtoolOptions"\s*:\s*\{', {
        param($match)
        $match.Value + '"publisherName": "' + $escaped + '", '
      }, 1)
  } elseif ($json -match '"win"\s*:\s*\{') {
    $json = [regex]::Replace($json, '"win"\s*:\s*\{', {
        param($match)
        $match.Value + '"signtoolOptions": { "publisherName": "' + $escaped + '" }, '
      }, 1)
  } else {
    throw "package.json build.win section is missing"
  }

  [System.IO.File]::WriteAllText($PackageJson, $json, [System.Text.UTF8Encoding]::new($false))
  Write-Host "publisherName set to $publisherName"
} finally {
  if ($wasTempFile -and (Test-Path -LiteralPath $certFile)) {
    Remove-Item -LiteralPath $certFile -Force -ErrorAction SilentlyContinue
  }
}
