param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string[]]$ExtensionIds,
    [Parameter(Mandatory=$true)][string]$HostBinary,
    [ValidateSet('Chrome','Edge','Both')][string]$Browser = 'Both'
)

$resolved = (Resolve-Path -LiteralPath $HostBinary -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($resolved) -ne '.exe') { throw 'HostBinary must be a built .exe file.' }
$manifestPath = Join-Path (Split-Path -Parent $resolved) 'com.127vaults.connector.json'
$manifest = @{
    name = 'com.127vaults.connector'
    description = '127Vaults read-only local client connector'
    path = $resolved
    type = 'stdio'
    allowed_origins = @($ExtensionIds | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))

if ($Browser -in @('Chrome','Both')) {
    $key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.127vaults.connector'
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
}
if ($Browser -in @('Edge','Both')) {
    $key = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.127vaults.connector'
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
}
Write-Output "Registered $manifestPath for $Browser and extension IDs $($ExtensionIds -join ', ')"
