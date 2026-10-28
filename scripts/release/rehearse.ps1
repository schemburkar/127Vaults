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
$recordPath = Join-Path $receiptRoot "$Label.json"
$configPath = Join-Path $receiptRoot "$Label-release-set.json"
if ((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $recordPath) -or (Test-Path -LiteralPath $configPath)) { throw 'Use a new rehearsal label; previous receipts are retained.' }
# Rehearsals must not claim production output paths or change the production candidate pointer.
$originalConfig = Join-Path $repository '.cloudflare-deploy/release-set.json'
$originalDirectory = Split-Path $originalConfig
$settings = if (Test-Path -LiteralPath $originalConfig) { Get-Content -LiteralPath $originalConfig -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
foreach ($field in @('deploymentConfig', 'cacheRoot', 'composeProvider', 'sevenZip', 'r2CredentialsFile')) {
    if ($settings[$field] -and -not [IO.Path]::IsPathRooted($settings[$field])) { $settings[$field] = [IO.Path]::GetFullPath((Join-Path $originalDirectory $settings[$field])) }
}
if (-not $settings.deploymentConfig) { $settings.deploymentConfig = Join-Path $originalDirectory 'config.json' }
$settings.outputRoot = Join-Path $receiptRoot "$Label-packages"
$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
$record = [ordered]@{ schemaVersion = 1; sourceRevision = $Revision; label = $Label; planOnly = [bool]$PlanOnly; startedAt = [DateTime]::UtcNow.ToString('o'); status = 'running'; steps = @(); outputRoot = $settings.outputRoot; config = $configPath; remoteWrites = $false }
function Invoke-RehearsalStep([string]$Name, [string]$Command, [string[]]$Arguments) {
    $step = [ordered]@{ name = $Name; startedAt = [DateTime]::UtcNow.ToString('o'); status = 'running' }
    $record.steps += $step
    Write-Output "Checking $Name..."
    try {
        # Route native output through PowerShell so the transcript retains it.
        & $Command @Arguments 2>&1 | Out-Host
        $step.exitCode = $LASTEXITCODE
        if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)." }
        $step.status = 'passed'
    } catch { $step.status = 'failed'; throw }
    finally { $step.finishedAt = [DateTime]::UtcNow.ToString('o') }
}
Start-Transcript -LiteralPath $receipt | Out-Null
try {
    # Fail on workspace problems before spending time building the installer set.
    if (-not $PlanOnly) {
        Invoke-RehearsalStep 'Local sites' 'pnpm' @('test:sites')
        Invoke-RehearsalStep 'Workspace checks' 'pnpm' @('check')
        Invoke-RehearsalStep 'Workspace tests' 'pnpm' @('test')
    }
    $buildArgs = @('-NoProfile', '-File', './release-set.ps1', 'build', '-Config', $configPath, '-Ref', $Revision, '-Label', $Label)
    if ($PlanOnly) { $buildArgs += '-Plan' }
    Invoke-RehearsalStep 'Release build' 'pwsh' $buildArgs
    if (-not $PlanOnly) {
        Invoke-RehearsalStep 'Publication preview' 'pwsh' @('-NoProfile', '-File', './release-set.ps1', 'publish', '-Config', $configPath, '-Label', $Label, '-Plan')
    }
    $record.status = 'passed'
    Write-Output 'Rehearsal passed. Cloudflare uploads, deployment, Git pushes and GitHub release creation were not executed.'
} catch { $record.status = 'failed'; $record.error = $_.Exception.Message; throw }
finally {
    $record.finishedAt = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $recordPath -Encoding utf8NoBOM
    Stop-Transcript | Out-Null
}
