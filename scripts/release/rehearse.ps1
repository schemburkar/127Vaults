# Reuse the provisioned workstation and existing release engine. Never publish.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,79}$')][string]$Label,
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repository
if ((git branch --show-current) -ne 'main') { throw 'The workstation checkout must be on main.' }
if ((git rev-parse HEAD) -ne $Revision) { throw 'Requested source differs from workstation HEAD; synchronize main before running.' }
if (git status --porcelain) { throw 'Commit or preserve workstation edits before running.' }
$receiptRoot = Join-Path (Split-Path $repository) '127Vaults-Rehearsals'
New-Item -ItemType Directory -Force -Path $receiptRoot | Out-Null
$receipt = Join-Path $receiptRoot "$Label.log"
if (Test-Path -LiteralPath $receipt) { throw 'Use a new rehearsal label; previous receipts are retained.' }
Start-Transcript -LiteralPath $receipt | Out-Null
try {
    if (-not $PlanOnly) {
        & pnpm test:sites
        if ($LASTEXITCODE -ne 0) { throw 'Local site and hostname checks failed.' }
    }
    $buildArgs = @('build', '-Ref', $Revision, '-Label', $Label)
    if ($PlanOnly) { $buildArgs += '-Plan' }
    & pwsh -NoProfile -File ./release-set.ps1 @buildArgs
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
    if (-not $PlanOnly) {
        & pwsh -NoProfile -File ./release-set.ps1 publish -Label $Label -Plan
        if ($LASTEXITCODE -ne 0) { throw 'Publication preview failed.' }
        & pnpm check
        if ($LASTEXITCODE -ne 0) { throw 'Workspace checks failed.' }
        & pnpm test
        if ($LASTEXITCODE -ne 0) { throw 'Workspace tests failed.' }
    }
    Write-Output 'Rehearsal passed. Cloudflare uploads, deployment, Git pushes and GitHub release creation were not executed.'
} finally { Stop-Transcript | Out-Null }
