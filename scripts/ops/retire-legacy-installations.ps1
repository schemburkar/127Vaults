param([switch]$Confirm)
$ErrorActionPreference = 'Stop'
# One-time retirement of user-classified legacy development installations.
# Preserve data, keys and rollback inputs; never treat these as a live upgrade.
$devRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA '127Vaults Namespaces/development'))
$owner = Join-Path $devRoot 'namespace-owner'
if (-not (Test-Path -LiteralPath $owner) -or (Get-Content -LiteralPath $owner -Raw).Trim() -ne 'development') { throw 'Initialize the owned development namespace first.' }
$sources = @(
    @{ path = (Join-Path $env:LOCALAPPDATA '127Vaults'); label = 'local-127Vaults' },
    @{ path = (Join-Path $env:LOCALAPPDATA '127Vaults Desktop-test'); label = 'legacy-desktop' },
    @{ path = (Join-Path $env:LOCALAPPDATA 'com.127vaults.desktop.poc'); label = 'legacy-webview' },
    @{ path = (Join-Path $env:APPDATA '127Vaults'); label = 'roaming-profile' },
    @{ path = (Join-Path $env:USERPROFILE '.127vaults'); label = 'recovery-settings' }
) | Where-Object { Test-Path -LiteralPath $_.path }
foreach ($source in $sources) {
    $source.path = [IO.Path]::GetFullPath($source.path)
    # Require an exact known leaf directly under its intended user directory.
    if ([IO.Path]::GetDirectoryName($source.path) -notin @($env:LOCALAPPDATA, $env:APPDATA, $env:USERPROFILE)) { throw 'Unexpected archive source parent.' }
    for ($item = Get-Item -LiteralPath $source.path; $null -ne $item; $item = $item.Parent) {
        if ($item.LinkType) { throw 'Redirected archive source refused.' }
    }
    if (Get-ChildItem -LiteralPath $source.path -Recurse -Force -Attributes ReparsePoint) { throw 'Archive source contains a link; inspect before retirement.' }
}
for ($item = Get-Item -LiteralPath $devRoot; $null -ne $item; $item = $item.Parent) {
    if ($item.LinkType) { throw 'Redirected archive destination refused.' }
}
if (Get-Process | Where-Object ProcessName -Match '127vault|vaults') { throw 'Close all Vaults apps and agents before retirement.' }
$containers = & podman ps --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify stopped containers.' }
if ($containers | Where-Object { ($_.Names -join ' ') -match 'vaults' }) { throw 'Stop Vaults containers before retirement.' }
$registrations = @()
foreach ($browser in @('Google/Chrome', 'Microsoft/Edge')) {
    $key = "HKCU:/Software/$browser/NativeMessagingHosts/com.127vaults.connector"
    if (Test-Path -LiteralPath $key) {
        $manifest = (Get-Item -LiteralPath $key).GetValue('')
        if (-not ($sources | Where-Object { $manifest.StartsWith($_.path + '\', [StringComparison]::OrdinalIgnoreCase) })) { throw 'Connector is outside the reviewed legacy installations.' }
        $registrations += @{ key = $key; manifest = $manifest }
    }
}
$archive = [IO.Path]::GetFullPath((Join-Path $devRoot ('legacy-retired-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
if (-not $archive.StartsWith($devRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive escaped development root.' }
$receipt = @{ version = 1; at = [DateTime]::UtcNow.ToString('o'); archive = $archive; sources = @($sources); registrations = $registrations; confirmed = [bool]$Confirm; moved = @(); notes = 'Retired legacy state, not a runnable namespace migration. Original absolute paths remain in archived receipts. Keep old database volumes and identity together. No live entitlement was activated.' }
if ($Confirm) {
    New-Item -ItemType Directory -Path $archive | Out-Null
    $receiptPath = Join-Path $archive 'retirement.json'
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath
    foreach ($entry in $registrations) { Remove-Item -LiteralPath $entry.key }
    foreach ($source in $sources) {
        $destination = [IO.Path]::GetFullPath((Join-Path $archive $source.label))
        if ([IO.Path]::GetDirectoryName($destination) -ne $archive) { throw 'Invalid archive destination.' }
        Move-Item -LiteralPath $source.path -Destination $destination
        $receipt.moved += @{ from = $source.path; to = $destination }
        $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath
    }
}
$receipt | ConvertTo-Json -Depth 8
