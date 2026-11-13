param(
    [Parameter(Mandatory)][ValidatePattern('^com\.127vaults\.connector\.(development|test_[a-z0-9_]{1,40})$')][string]$HostName,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$registrations = @()
foreach ($browser in @('Google\Chrome','Microsoft\Edge')) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\$HostName"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $file = (Get-Item -LiteralPath $key).GetValue('')
    if ([IO.Path]::GetFileName($file) -ne "$HostName.json") { throw 'Connector manifest filename mismatch' }
    $item = Get-Item -LiteralPath $file
    if ($item.PSIsContainer -or $item.LinkType) { throw 'Redirected connector manifest refused' }
    for ($parent = $item.Directory; $null -ne $parent; $parent = $parent.Parent) {
        if ($parent.LinkType) { throw 'Redirected connector directory refused' }
    }
    $manifest = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($manifest.name -ne $HostName) { throw 'Connector manifest ownership mismatch' }
    $registrations += @{ key=$key; manifest=$file }
}
if ($Remove) {
    foreach ($entry in $registrations) { Remove-Item -LiteralPath $entry.key }
    foreach ($file in ($registrations.manifest | Select-Object -Unique)) { Remove-Item -LiteralPath $file }
}
ConvertTo-Json -InputObject @($registrations) -Compress
