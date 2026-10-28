# Complete protected release on the provisioned workstation. Uses the established release-set engine.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$Revision,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,79}$')][string]$Label,
    [ValidateRange(1,9999)][int]$Attempt = 1,
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repository
if ((git branch --show-current) -ne 'main' -or (git rev-parse HEAD) -ne $Revision -or (git status --porcelain)) { throw 'Use clean local main at the exact dispatched release source; no checkout is reset.' }
$runRoot = Join-Path (Split-Path $repository) "127Vaults-Releases/actions/$Label"
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$configPath = Join-Path $runRoot 'release-set.json'
$requestPath = Join-Path $runRoot 'request.json'
$request = @{sourceRevision=$Revision;version=$Version;label=$Label}
if (Test-Path -LiteralPath $requestPath) {
    $old=Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
    if ($old.sourceRevision -ne $Revision -or $old.version -ne $Version -or $old.label -ne $Label) { throw 'This run label belongs to a different source or version.' }
} else {
    $originalConfig=Join-Path $repository '.cloudflare-deploy/release-set.json'
    $originalDirectory=Split-Path $originalConfig
    $settings=if(Test-Path -LiteralPath $originalConfig){Get-Content -LiteralPath $originalConfig -Raw | ConvertFrom-Json -AsHashtable}else{@{}}
    foreach($field in @('deploymentConfig','cacheRoot','composeProvider','sevenZip','r2CredentialsFile')) {
        if($settings[$field] -and -not [IO.Path]::IsPathRooted($settings[$field])){$settings[$field]=[IO.Path]::GetFullPath((Join-Path $originalDirectory $settings[$field]))}
    }
    if(-not $settings.deploymentConfig){$settings.deploymentConfig=Join-Path $originalDirectory 'config.json'}
    $settings.outputRoot=Join-Path $runRoot 'packages'; $settings.version=$Version
    $settings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
    $request | ConvertTo-Json | Set-Content -LiteralPath $requestPath -Encoding utf8NoBOM
}
$settings=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$cacheRoot=if($settings.cacheRoot){$settings.cacheRoot}else{Join-Path ([Environment]::GetFolderPath('UserProfile')) '.127vaults-release-cache'}
$setRoot=Join-Path $cacheRoot "sets/$Label"
$logPath=Join-Path $runRoot "attempt-$Attempt.log"
$receiptPath=Join-Path $runRoot "attempt-$Attempt.json"
if((Test-Path -LiteralPath $logPath) -or (Test-Path -LiteralPath $receiptPath)){throw 'Use a fresh attempt number; earlier receipts are retained.'}
$record=[ordered]@{schemaVersion=1;sourceRevision=$Revision;version=$Version;label=$Label;attempt=$Attempt;plan=[bool]$Plan;status='running';startedAt=[DateTime]::UtcNow.ToString('o');steps=@();setRoot=$setRoot;outputRoot=$settings.outputRoot}
function Invoke-ReleaseStep([string]$Name,[string]$Command,[string[]]$Arguments) {
    $step=[ordered]@{name=$Name;status='running';startedAt=[DateTime]::UtcNow.ToString('o')}; $record.steps+=$step
    Write-Output "Checking $Name..."
    try { & $Command @Arguments 2>&1 | Out-Host; $step.exitCode=$LASTEXITCODE; if($LASTEXITCODE -ne 0){throw "$Name failed (exit $LASTEXITCODE)."}; $step.status='passed' }
    catch {$step.status='failed';throw}
    finally {$step.finishedAt=[DateTime]::UtcNow.ToString('o')}
}
Start-Transcript -LiteralPath $logPath | Out-Null
try {
    Invoke-ReleaseStep 'Committed versioned notes' 'node' @('scripts/release/workflow-gates.mjs','notes',$Version)
    if($Plan) {
        Invoke-ReleaseStep 'Coordinated release plan' 'pwsh' @('-NoProfile','-File','./release-set.ps1','build','-Config',$configPath,'-Ref',$Revision,'-Label',$Label,'-Plan')
    } else {
        Invoke-ReleaseStep 'Fetch remote main' 'git' @('fetch','origin','main')
        Invoke-ReleaseStep 'Pinned source and synchronized main' 'node' @('scripts/release/workflow-gates.mjs','sync',$Revision)
        Invoke-ReleaseStep 'Local sites' 'pnpm' @('test:sites')
        Invoke-ReleaseStep 'Workspace checks before build' 'pnpm' @('check')
        Invoke-ReleaseStep 'Workspace tests before build' 'pnpm' @('test')
        $buildPath=Join-Path $setRoot 'build.json'
        if(-not(Test-Path -LiteralPath $buildPath)) {
            Invoke-ReleaseStep 'Coordinated build and upgrade gates' 'pwsh' @('-NoProfile','-File','./release-set.ps1','build','-Config',$configPath,'-Ref',$Revision,'-Label',$Label)
        }
        $build=Get-Content -LiteralPath $buildPath -Raw | ConvertFrom-Json
        if($build.status -ne 'tested' -or $build.revision -ne $Revision -or $build.releaseDirectories.Count -ne 8 -or @($build.versions.PSObject.Properties | Where-Object {$_.Value -ne $Version}).Count){throw 'Tested packages do not match the dispatched source and coordinated version.'}
        $publicationAction='publish'
        $statePath=Join-Path $setRoot 'cloudflare/state.json'
        if(Test-Path -LiteralPath $statePath) {
            $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            if($state.deployedReleaseIdentity -eq $build.catalogueIdentity){$publicationAction='verify'}
        }
        Invoke-ReleaseStep 'Cloudflare publication and protected delivery verification' 'pwsh' @('-NoProfile','-File','./release-set.ps1',$publicationAction,'-Config',$configPath,'-Label',$Label)
        Invoke-ReleaseStep 'Workspace checks after deployment' 'pnpm' @('check')
        Invoke-ReleaseStep 'Workspace tests after deployment' 'pnpm' @('test')
        $active=Get-Content -LiteralPath $settings.deploymentConfig -Raw | ConvertFrom-Json
        $notes=Invoke-WebRequest -Uri "$($active.origin)/downloads" -Headers @{'Cache-Control'='no-cache'}
        if($notes.StatusCode -ne 200 -or -not $notes.Content.Contains("id=`"version-$($Version.Replace('.','-'))`"")){throw 'Versioned public release notes are not live.'}
        # No generated or unrelated work is committed implicitly. Intended source was committed before dispatch.
        if(git status --porcelain){throw 'Tracked or untracked work appeared during release. Preserve and review it before tagging.'}
        Invoke-ReleaseStep 'Push completed main' 'git' @('push','origin','main')
        Invoke-ReleaseStep 'Fetch immediately before GitHub tag creation' 'git' @('fetch','origin','main')
        Invoke-ReleaseStep 'Exact source and zero-unpushed-commits gate' 'node' @('scripts/release/workflow-gates.mjs','sync',$Revision)
        Invoke-ReleaseStep 'GitHub release with verified installer assets' 'node' @('scripts/release/github.mjs',"v$Version",$Revision,"docs/release/$Version.md",'--publish',$settings.outputRoot)
        Invoke-ReleaseStep 'Verify GitHub release and uploaded assets' 'node' @('scripts/release/github.mjs',"v$Version",$Revision,"docs/release/$Version.md",'--plan',$settings.outputRoot)
        Invoke-ReleaseStep 'Push final related main state' 'git' @('push','origin','main')
        Invoke-ReleaseStep 'Final remote synchronization' 'git' @('fetch','origin','main')
        Invoke-ReleaseStep 'Final source gate' 'node' @('scripts/release/workflow-gates.mjs','sync',$Revision)
        # Make the normal local publish default point to this fully verified release.
        Copy-Item -LiteralPath (Join-Path $runRoot 'latest-release-set.json') -Destination (Join-Path $repository '.cloudflare-deploy/latest-release-set.json') -Force
        $record.siteNotes="$($active.origin)/downloads#version-$($Version.Replace('.','-'))"
        $record.githubRelease="https://github.com/$env:GITHUB_REPOSITORY/releases/tag/v$Version"
    }
    $record.status='passed'; Write-Output "Release workflow passed for $Version (plan: $([bool]$Plan))."
} catch {$record.status='failed';$record.error=$_.Exception.Message;throw}
finally {
    $record.finishedAt=[DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
    if($env:GITHUB_STEP_SUMMARY){"127Vaults $Version — $($record.status). Source: $Revision. Private receipts: $runRoot" | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY}
    Stop-Transcript | Out-Null
}
