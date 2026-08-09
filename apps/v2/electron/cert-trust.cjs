const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function certFilePath() {
  return path.join(__dirname, '..', 'build', 'internal-signing.pfx.cer');
}

/**
 * Installs the bundled internal signing certificate into the CurrentUser
 * Root and TrustedPublisher stores so controlled machines trust the app
 * without paying for a CA certificate. Non-fatal: callers should ignore
 * failures in production.
 */
function ensureInternalCertTrusted() {
  if (process.env.V2_DISABLE_CERT_TRUST === '1') {
    return { ok: false, reason: 'disabled' };
  }
  const file = certFilePath();
  if (!fs.existsSync(file)) return { ok: false, reason: 'cert-missing' };
  const escapedPath = String(file).replaceAll("'", "''");
  const psCommand = `
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('${escapedPath}');
foreach ($storeName in @('Root','TrustedPublisher')) {
  foreach ($location in @([System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)) {
    try {
      $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, $location);
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite);
      $exists = $false;
      foreach ($c in $store.Certificates) {
        if ($c.Thumbprint -eq $cert.Thumbprint) { $exists = $true; break }
      }
      if (-not $exists) { $store.Add($cert) }
      $store.Close();
      break
    } catch {
      try { $store.Close() } catch {}
    }
  }
}`;
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'powershell-store-add',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = { ensureInternalCertTrusted };
