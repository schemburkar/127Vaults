# Build a complete Windows/Linux installer set, then publish it explicitly.
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('build','publish')][string]$Action = 'build',
    [string]$Config,
    [string]$Label,
    [string]$Ref = 'HEAD',
    [switch]$Plan,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if (-not $Config) { $Config = Join-Path $PSScriptRoot '.cloudflare-deploy/release-set.json' }
$request = @{ action=$Action; config=$Config; label=$Label; ref=$Ref; plan=[bool]$Plan; help=[bool]$Help }
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $request | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot 'scripts/release/set.mjs') --request
    $releaseExit = $LASTEXITCODE
} finally { $OutputEncoding = $previousEncoding }
exit $releaseExit
