# Read-only diagnostics for the invoking user's development environment.
# Reports paths and public certificate fingerprints, never key/credential contents.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$settings = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot '.env')) {
    if ($line -match '^(VAULTS_TLS_DIR|VAULTS_CA_CERT_FILE)=(.*)$') {
        $settings[$Matches[1]] = $Matches[2]
    }
}

function Get-FileStatus([string] $Path) {
    try {
        $entry = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        return [ordered]@{ path = $Path; exists = $true; directory = $entry.PSIsContainer; bytes = $(if ($entry.PSIsContainer) { $null } else { $entry.Length }) }
    } catch {
        return [ordered]@{ path = $Path; exists = $false; error = $_.CategoryInfo.Category.ToString() }
    }
}

function Get-PublicFingerprint([string] $Path) {
    try {
        $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $Path
        try { return $certificate.Thumbprint } finally { $certificate.Dispose() }
    } catch { return $null }
}

$identity = $settings['VAULTS_TLS_DIR']
$caFile = $settings['VAULTS_CA_CERT_FILE']
if (!$caFile) { $caFile = 'ca.crt' }
$configured = @()
if ($identity) {
    foreach ($part in @('', 'live', 'ca', 'live/server.crt', 'live/server.key', ('ca/' + $caFile), 'runtime/checkpoint.key')) {
        $path = if ($part) { Join-Path $identity $part } else { $identity }
        $configured += Get-FileStatus $path
    }
}

$roots = @((Join-Path $env:LOCALAPPDATA '127Vaults'), (Join-Path $env:USERPROFILE '.127vaults-local'))
if ($env:TEMP -and (Test-Path -LiteralPath $env:TEMP)) {
    $roots += @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter '*127vault*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
}
$candidates = @()
foreach ($root in $roots | Select-Object -Unique) {
    if (!(Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($cert in Get-ChildItem -LiteralPath $root -File -Filter 'server.crt' -Depth 5 -ErrorAction SilentlyContinue) {
        $keyPath = Join-Path $cert.DirectoryName 'server.key'
        $candidates += [ordered]@{
            certificate = $cert.FullName
            matchingKeyFileExists = Test-Path -LiteralPath $keyPath -PathType Leaf
            publicCertificateFingerprint = Get-PublicFingerprint $cert.FullName
        }
    }
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeProbe = $null
if ($nodeCommand -and $identity) {
    $probePath = Join-Path $identity 'live/server.crt'
    $nodeProbe = & $nodeCommand.Source -e "const fs=require('node:fs'); console.log(JSON.stringify({node:process.execPath,certificateExists:fs.existsSync(process.argv[1])}));" $probePath
    if ($LASTEXITCODE -ne 0) { throw 'Node filesystem probe failed.' }
}
$pinnedCa = Join-Path $env:APPDATA '127Vaults/installation-ca.pem'
[ordered]@{
    account = (& whoami)
    userProfile = $env:USERPROFILE
    localAppData = $env:LOCALAPPDATA
    computer = $env:COMPUTERNAME
    repository = $repoRoot
    nodeProbe = $nodeProbe
    configuredIdentity = $configured
    desktopPinnedCaExists = Test-Path -LiteralPath $pinnedCa -PathType Leaf
    desktopPinnedCaFingerprint = Get-PublicFingerprint $pinnedCa
    searchedRoots = $roots
    candidateCertificates = $candidates
} | ConvertTo-Json -Depth 6
