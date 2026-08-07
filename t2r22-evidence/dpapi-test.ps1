param([string]$BlobPath = "D:\Desktop\rongyi\t2r22-evidence\e1-blob.bin")
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DpapiHelper {
    [StructLayout(LayoutKind.Sequential)]
    public struct DATA_BLOB {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pEntropy,
        IntPtr pReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        ref DATA_BLOB pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LocalFree(IntPtr hMem);
}
"@

$bytes = [System.IO.File]::ReadAllBytes($BlobPath)
# skip Electron "v10" prefix (3 bytes)
$payload = $bytes[3..($bytes.Length - 1)]
$blob = New-Object DpapiHelper+DATA_BLOB
$blob.cbData = $payload.Length
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($payload.Length)
[System.Runtime.InteropServices.Marshal]::Copy($payload, 0, $ptr, $payload.Length)
$blob.pbData = $ptr

$out = New-Object DpapiHelper+DATA_BLOB
$ok = [DpapiHelper]::CryptUnprotectData([ref]$blob, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, 0, [ref]$out)
if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Host "UNPROTECT FAILED win32=$err"
} else {
    $outBytes = New-Object byte[] $out.cbData
    [System.Runtime.InteropServices.Marshal]::Copy($out.pbData, $outBytes, 0, $out.cbData)
    $utf8 = [System.Text.Encoding]::UTF8.GetString($outBytes)
    Write-Host "UNPROTECT OK len=$($outBytes.Length) head=$($utf8.Substring(0, [Math]::Min(20, $utf8.Length)))"
    [DpapiHelper]::LocalFree($out.pbData) | Out-Null
}
[DpapiHelper]::LocalFree($ptr) | Out-Null
