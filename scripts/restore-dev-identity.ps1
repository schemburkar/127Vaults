param(
    [string] $PackageDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.tools/dev-identity-recovery-20261020'),
    [string] $Destination,
    [switch] $CheckOnly,
    [switch] $RestoreOnly
)
# Runs in the invoking user's filesystem. Never overwrites an identity or creates a CA.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$repoRoot = Split-Path -Parent $PSScriptRoot
$packageRoot = [IO.Path]::GetFullPath($PackageDirectory)
$receipt = Get-Content -LiteralPath (Join-Path $packageRoot 'receipt.json') -Raw | ConvertFrom-Json
if ($receipt.format -ne 1 -or $receipt.installationId -notmatch '^[0-9a-f-]{36}$') { throw 'Unsupported identity recovery package.' }
$profile = Join-Path $env:APPDATA '127Vaults'
$binding = Get-Content -LiteralPath (Join-Path $profile 'tenant-binding.json') -Raw | ConvertFrom-Json
if ($binding.tenant_id -ne $receipt.installationId) { throw 'Recovery package belongs to a different desktop installation.' }
$pin = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (Join-Path $profile 'installation-ca.pem')
try { if ($pin.Thumbprint -ne $receipt.caFingerprint) { throw 'Recovery package CA differs from the desktop trust pin.' } } finally { $pin.Dispose() }
foreach ($entry in @(@('identity.127vbak', $receipt.identitySha256), @('key.dpapi', $receipt.protectedKeySha256))) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $packageRoot $entry[0]) -Algorithm SHA256).Hash
    if ($actual -ne $entry[1]) { throw 'Recovery package integrity check failed.' }
}
$envPath = Join-Path $repoRoot '.env'
$originalEnv = [IO.File]::ReadAllText($envPath)
if (!$Destination) {
    $match = [regex]::Match($originalEnv, '(?m)^VAULTS_TLS_DIR=([^\r\n]+)')
    if (!$match.Success) { throw 'VAULTS_TLS_DIR is missing from .env.' }
    $Destination = $match.Groups[1].Value
}
if (![IO.Path]::IsPathRooted($Destination)) { throw 'Restore destination must be absolute.' }
$target = [IO.Path]::GetFullPath($Destination)
$workspacePrefix = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
if ($target.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Identity keys must be restored outside the repository.' }
if (!$CheckOnly -and (Test-Path -LiteralPath $target)) { throw "Restore destination already exists; nothing was overwritten: $target" }
$temporary = Join-Path $env:TEMP ('127vaults-recovery-key-' + [guid]::NewGuid().ToString('N'))
$key = $null
Push-Location $repoRoot
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $temporary '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict recovery-key directory permissions.' }
    $key = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $packageRoot 'key.dpapi')), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ($key.Length -ne 32) { throw 'Recovery key has an invalid length.' }
    $keyPath = Join-Path $temporary 'backup.key'
    [IO.File]::WriteAllBytes($keyPath, $key)
    $archive = Join-Path $packageRoot 'identity.127vbak'
    & node server.mjs envelope verify --input $archive --key-file $keyPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Encrypted identity authentication failed.' }
    if ($CheckOnly) { Write-Host 'Encrypted package verified for this Windows account and desktop trust pin. No identity or configuration changed.'; return }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    & node server.mjs identity restore --input $archive --key-file $keyPath --output-dir $target --server-id $receipt.installationId
    if ($LASTEXITCODE -ne 0) { throw 'Identity restore failed; configuration was not changed.' }
    & node scripts/verify-dev-identity.mjs $target $profile $receipt.installationId
    if ($LASTEXITCODE -ne 0) { throw 'Restored identity verification failed; configuration was not changed.' }
    if ($RestoreOnly) { Write-Host 'Restore rehearsal complete. Development configuration was not changed.'; return }
    # Retain the prior configuration outside Git before changing paths.
    [IO.File]::WriteAllText((Join-Path $target 'output/pre-recovery.env'), $originalEnv, (New-Object Text.UTF8Encoding($false)))
    $next = [regex]::Replace($originalEnv, '(?m)^VAULTS_TLS_DIR=[^\r\n]*', ('VAULTS_TLS_DIR=' + $target.Replace('\', '/')))
    if ($next -match '(?m)^VAULTS_CA_CERT_FILE=') { $next = [regex]::Replace($next, '(?m)^VAULTS_CA_CERT_FILE=[^\r\n]*', 'VAULTS_CA_CERT_FILE=ca.crt') }
    else { $next = $next.TrimEnd() + "`r`nVAULTS_CA_CERT_FILE=ca.crt`r`n" }
    $sequence = ([IO.File]::ReadAllText((Join-Path $target 'runtime/licenses/highest-sequence'))).Trim()
    if ($sequence -notmatch '^[1-9]\d*$') { throw 'Recovered license sequence is invalid; configuration was not changed.' }
    foreach ($setting in @(@('VAULTS_LICENSE_FILE', "/run/secrets/runtime/licenses/$sequence.json"), @('VAULTS_LICENSE_PUBLIC_KEYS_FILE', "/run/secrets/runtime/licenses/$sequence.keys.json"))) {
        $pattern = '(?m)^' + $setting[0] + '=[^\r\n]*'
        $line = $setting[0] + '=' + $setting[1]
        if ([regex]::IsMatch($next, $pattern)) { $next = [regex]::Replace($next, $pattern, $line) }
        else { $next = $next.TrimEnd() + "`r`n" + $line + "`r`n" }
    }
    [IO.File]::WriteAllText($envPath, $next, (New-Object Text.UTF8Encoding($false)))
    & node scripts/mvp-acceptance.mjs dev --check
    if ($LASTEXITCODE -ne 0) { [IO.File]::WriteAllText($envPath, $originalEnv, (New-Object Text.UTF8Encoding($false))); throw 'Startup preflight failed; the prior .env was restored.' }
    Write-Host 'Original identity restored and startup preflight passed in this shell. Run .\dev.ps1.'
} finally {
    if ($key) { [Array]::Clear($key, 0, $key.Length) }
    if (Test-Path -LiteralPath (Join-Path $temporary 'backup.key')) { Remove-Item -LiteralPath (Join-Path $temporary 'backup.key') -Force }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    Pop-Location
}
