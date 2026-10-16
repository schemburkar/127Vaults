# Local release entry point; the same Node engine can be called by future CI.
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('desktop','cli','extension','server','web')][string]$Product,
    [ValidateSet('native','windows','linux','both')][string]$Platform = 'native',
    [Alias('BuildLabel')][string]$Label,
    [string]$Version,
    [string]$Ref = 'HEAD',
    [string]$OutputRoot,
    [string]$CacheRoot,
    [string]$IssuerPublicKeys,
    [ValidateSet('podman','docker')][string]$Engine = 'podman',
    [string]$WslDistro = 'Ubuntu-24.04',
    [string]$WslUser,
    [string]$LinuxCacheRoot,
    [string]$Verify,
    [switch]$Plan,
    [switch]$Doctor,
    [switch]$Force,
    [switch]$RefreshBaseImages,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction Stop
$request = @{
    repository = $PSScriptRoot; product = $Product; platform = $Platform
    label = $Label; version = $Version; ref = $Ref; outputRoot = $OutputRoot
    cacheRoot = $CacheRoot; issuerPublicKeys = $IssuerPublicKeys; engine = $Engine; wslDistro = $WslDistro
    wslUser = $WslUser; linuxCacheRoot = $LinuxCacheRoot; verify = $Verify
    plan = [bool]$Plan; doctor = [bool]$Doctor; force = [bool]$Force
    refreshImages = [bool]$RefreshBaseImages; help = [bool]$Help
}
# Paths and labels travel as JSON, never as generated shell commands.
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $request | ConvertTo-Json -Depth 5 -Compress | & $node.Source (Join-Path $PSScriptRoot 'scripts/release/release.mjs') --request
    $releaseExit = $LASTEXITCODE
} finally { $OutputEncoding = $previousEncoding }
exit $releaseExit
