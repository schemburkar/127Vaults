param(
    [Parameter(Mandatory = $true)][string] $CertificatePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string] $ExpectedSha256,
    [switch] $CheckOnly
)
$ErrorActionPreference = 'Stop'
$file = Get-Item -LiteralPath $CertificatePath
if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 16384) { throw 'Select a regular public CA file, at most 16 KiB.' }
$bytes = [IO.File]::ReadAllBytes($file.FullName)
$sha = [Security.Cryptography.SHA256]::Create()
try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
if ($actual -cne $ExpectedSha256) { throw 'CA file changed or its fingerprint does not match. No trust was added.' }
$pem = [Text.Encoding]::UTF8.GetString($bytes)
$match = [regex]::Match($pem, '\A-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END CERTIFICATE-----\s*\z')
if (-not $match.Success) { throw 'Use one public CA certificate. Private keys and certificate bundles are not accepted.' }
$der = [Convert]::FromBase64String(($match.Groups[1].Value -replace '\s', ''))
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$der)
try {
    $constraints = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
    $usage = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' }
    if (-not $constraints -or -not $constraints.CertificateAuthority -or -not $usage -or -not ($usage.KeyUsages -band [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign)) { throw 'The file is not a certificate-signing CA. No trust was added.' }
    if ([DateTime]::UtcNow -lt $certificate.NotBefore.ToUniversalTime() -or [DateTime]::UtcNow -ge $certificate.NotAfter.ToUniversalTime()) { throw 'The CA is expired or not yet valid. No trust was added.' }
    if ($CheckOnly) { Write-Output 'Public CA fingerprint, signing purpose and validity verified. Trust store unchanged.'; return }
    $store = New-Object Security.Cryptography.X509Certificates.X509Store -ArgumentList 'Root', 'CurrentUser'
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        if (-not ($store.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint })) { $store.Add($certificate) }
        if (-not ($store.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint })) { throw 'Windows did not retain the public CA. Follow your organization certificate policy.' }
        Write-Output 'Verified CA is in Current User / Trusted Root Certification Authorities. Restart your browser and verify the server address has no certificate warning.'
    } finally { $store.Close() }
} finally { $certificate.Dispose() }
