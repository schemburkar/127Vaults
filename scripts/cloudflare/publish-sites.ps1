# Website/control-plane deployment only. Existing verified package catalogue is retained.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
    [string]$Config = '.cloudflare-deploy/config.json',
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repository
if ((git branch --show-current) -ne 'main' -or (git rev-parse HEAD) -ne $Revision -or (git status --porcelain)) { throw 'Use clean local main at the dispatched source. No checkout is reset.' }
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
if (-not $settings.sites) { throw 'Configure the three site origins and admin allowlist first.' }
$stateRoot = if ([IO.Path]::IsPathRooted($settings.stateDirectory)) { $settings.stateDirectory } else { Join-Path (Split-Path ([IO.Path]::GetFullPath($Config))) $settings.stateDirectory }
$runRoot = Join-Path $stateRoot ('site-publications/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$receipt = [ordered]@{sourceRevision=$Revision;startedAt=[DateTime]::UtcNow.ToString('o');status='running';plan=[bool]$Plan;steps=@()}
function Invoke-SiteStep([string]$Name,[string]$Command,[string[]]$Arguments) {
    Write-Output "Checking $Name..."
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)." }
    $receipt.steps += $Name
}
Start-Transcript -LiteralPath (Join-Path $runRoot 'publication.log') | Out-Null
try {
    Invoke-SiteStep 'Site boundary and portal tests' 'pnpm' @('test:sites')
    Invoke-SiteStep 'Public intake checks' 'pnpm' @('check:public-intake')
    Invoke-SiteStep 'Cloudflare deployment regressions' 'node' @('--test','scripts/cloudflare/*.test.mjs','apps/public-intake/test/*.test.mjs','public-website/*.test.mjs')
    Invoke-SiteStep 'Four Worker dry-run' 'node' @('scripts/cloudflare/deploy.mjs','dry-run',$Config)
    if (-not $Plan) {
        Invoke-SiteStep 'Fetch remote main' 'git' @('fetch','origin','main')
        Invoke-SiteStep 'Exact pushed source' 'node' @('scripts/release/workflow-gates.mjs','sync',$Revision)
        Invoke-SiteStep 'Configure and verify admin Access and MFA' 'node' @('scripts/cloudflare/site-access.mjs','configure',$Config)
        # Capture the export's temporary signed URL, keeping it out of CI/terminal output.
        Invoke-SiteStep 'Backup retained D1 database' 'node' @('scripts/cloudflare/site-backup.mjs',$Config)
        Invoke-SiteStep 'Snapshot encrypted request and license records' 'node' @('scripts/cloudflare/site-records.mjs','snapshot',$Config,(Join-Path $runRoot 'records-before.json'))
        Invoke-SiteStep 'Apply pending additive migrations' 'node' @('scripts/cloudflare/deploy.mjs','provision',$Config)
        Invoke-SiteStep 'Deploy and verify separated sites' 'node' @('scripts/cloudflare/deploy.mjs','deploy',$Config)
        Invoke-SiteStep 'Verify unchanged request, invitation and license records' 'node' @('scripts/cloudflare/site-records.mjs','verify',$Config,(Join-Path $runRoot 'records-before.json'))
    }
    $receipt.status = 'passed'
} catch { $receipt.status='failed'; $receipt.error=$_.Exception.Message; throw }
finally {
    $receipt.finishedAt=[DateTime]::UtcNow.ToString('o')
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runRoot 'receipt.json') -Encoding utf8NoBOM
    Stop-Transcript | Out-Null
}
