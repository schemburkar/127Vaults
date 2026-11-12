# Build a complete Windows/Linux installer set, then publish it explicitly.
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('build','publish','verify')][string]$Action = 'build',
    [string]$Config,
    [string]$Label,
    [string]$Ref = 'HEAD',
    [switch]$Plan,
    [switch]$UseCloudflareCliAuth,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if (-not $Config) { $Config = Join-Path $PSScriptRoot '.cloudflare-deploy/release-set.json' }
$request = @{ action=$Action; config=$Config; label=$Label; ref=$Ref; plan=[bool]$Plan; help=[bool]$Help }
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $entry = if ($UseCloudflareCliAuth) { 'scripts/release/cloudflare-cli-auth.mjs' } else { 'scripts/release/set.mjs' }
    $request | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot $entry) --request
    $releaseExit = $LASTEXITCODE
} finally { $OutputEncoding = $previousEncoding }
exit $releaseExit
