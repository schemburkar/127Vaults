# Repository-scoped Windows runner, under the logged-in build account. No service or workflow dispatch.
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('register','start','status')][string]$Action = 'status',
    [string]$RunnerDirectory,
    [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$RunnerName = "$env:COMPUTERNAME-127vaults-release"
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This runner setup is for the Windows release workstation.' }
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repository
$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
$ghPath = if ($ghCommand) { $ghCommand.Source } else { Join-Path $env:ProgramFiles 'GitHub CLI/gh.exe' }
if (-not (Test-Path -LiteralPath $ghPath)) { throw 'Install GitHub CLI and sign in with repository administration access.' }
function Invoke-GitHubJson([string[]]$Arguments) {
    $previousDebug = $env:GH_DEBUG
    try {
        $env:GH_DEBUG = $null
        $result = & $ghPath @Arguments
        if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI request failed. Check authentication and repository permissions.' }
        return ($result | ConvertFrom-Json)
    } finally { $env:GH_DEBUG = $previousDebug }
}
$repo = Invoke-GitHubJson @('repo','view','--json','nameWithOwner,isPrivate,viewerPermission,url')
if ($repo.viewerPermission -ne 'ADMIN') { throw 'Runner management requires repository administration access.' }
if ($Action -eq 'register' -and -not $repo.isPrivate) { throw 'New runner registration requires a private repository.' }
if (-not $RunnerDirectory) { $RunnerDirectory = Join-Path (Split-Path $repository) '127Vaults-Runner' }
$runnerRoot = [IO.Path]::GetFullPath($RunnerDirectory).TrimEnd('\')
if ($runnerRoot -eq [IO.Path]::GetPathRoot($runnerRoot).TrimEnd('\') -or $runnerRoot -eq $repository -or $repository.StartsWith("$runnerRoot\",[StringComparison]::OrdinalIgnoreCase) -or $runnerRoot.StartsWith("$repository\",[StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a dedicated runner directory outside the checkout.' }
if (Test-Path -LiteralPath $runnerRoot) {
    if ((Get-Item -LiteralPath $runnerRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runner directory must not be a junction or symlink.' }
}
$endpoint = "repos/$($repo.nameWithOwner)/actions/runners"
$settingsPath = Join-Path $runnerRoot '.runner'
$listenerPath = Join-Path $runnerRoot 'bin/Runner.Listener.exe'
function Get-RegisteredRunner {
    $records = Invoke-GitHubJson @('api',"${endpoint}?per_page=100")
    return @($records.runners | Where-Object {$_.name -eq $RunnerName})
}
function Assert-LocalRegistration {
    if (-not (Test-Path -LiteralPath $settingsPath)) { throw 'Register this runner before starting it.' }
    $configured = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($configured.agentName -ne $RunnerName -or $configured.gitHubUrl.TrimEnd('/') -ne $repo.url.TrimEnd('/')) { throw 'Existing runner belongs to a different name or repository. Nothing was replaced.' }
}
if ($Action -eq 'register') {
    if (Test-Path -LiteralPath $settingsPath) { Assert-LocalRegistration }
    else {
        if (@(Get-RegisteredRunner).Count -gt 0) { throw 'A runner with this name already exists on GitHub. Nothing was replaced.' }
        if ((Test-Path -LiteralPath $runnerRoot) -and @(Get-ChildItem -LiteralPath $runnerRoot -Force).Count -gt 0 -and -not (Test-Path -LiteralPath (Join-Path $runnerRoot 'install-receipt.json'))) { throw 'Runner directory contains unrecognized files. Use a dedicated directory.' }
        New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $runnerRoot '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect the runner credential directory.' }
        $apps = Invoke-GitHubJson @('api',"$endpoint/downloads")
        $app = @($apps | Where-Object {$_.os -eq 'win' -and $_.architecture -eq 'x64'})
        if ($app.Count -ne 1 -or $app[0].filename -notmatch '^actions-runner-win-x64-(\d+\.\d+\.\d+)\.zip$') { throw 'No unambiguous Windows x64 runner package was returned.' }
        $version = $Matches[1]; $app = $app[0]
        $release = Invoke-GitHubJson @('api',"repos/actions/runner/releases/tags/v$version")
        $asset = @($release.assets | Where-Object {$_.name -eq $app.filename})
        if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:([a-f0-9]{64})$' -or $asset[0].browser_download_url -ne $app.download_url -or $app.download_url -notlike 'https://github.com/actions/runner/releases/download/*') { throw 'Official runner archive checksum or source is unavailable.' }
        $expectedHash = $Matches[1]
        $archive = Join-Path $runnerRoot $app.filename
        if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $app.download_url -OutFile $archive }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Runner archive checksum mismatch. Nothing was executed.' }
        [ordered]@{repository=$repo.nameWithOwner;version=$version;archive=$app.filename;sha256=$expectedHash;verifiedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runnerRoot 'install-receipt.json') -Encoding utf8NoBOM
        if (-not (Test-Path -LiteralPath $listenerPath)) { Expand-Archive -LiteralPath $archive -DestinationPath $runnerRoot }
        $registration = Invoke-GitHubJson @('api','--method','POST',"$endpoint/registration-token")
        if (-not $registration.token) { throw 'GitHub did not return a registration token.' }
        $previousToken = $env:ACTIONS_RUNNER_INPUT_TOKEN
        try {
            # The runner masks this input and removes it from its environment. Never use a token in argv or receipts.
            $env:ACTIONS_RUNNER_INPUT_TOKEN = $registration.token
            Push-Location -LiteralPath $runnerRoot
            try { & $listenerPath configure --unattended --url $repo.url --name $RunnerName --labels 'vaults-release' --work '_work' }
            finally { Pop-Location }
            if ($LASTEXITCODE -ne 0) { throw 'Runner registration failed.' }
        } finally { $env:ACTIONS_RUNNER_INPUT_TOKEN = $previousToken; $registration = $null }
        Assert-LocalRegistration
    }
}
if ($Action -in @('register','start')) {
    Assert-LocalRegistration
    if (-not $repo.isPrivate) {
        $registered = @(Get-RegisteredRunner)
        $localSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        if ($registered.Count -ne 1 -or $localSettings.agentId -ne $registered[0].id -or 'vaults-release' -notin $registered[0].labels.name) {
            throw 'The existing local runner must match the GitHub registration and release label.'
        }
    }
    foreach ($tool in @('pwsh','node','pnpm','git','cargo','podman','wsl')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required release tool is missing from this account's PATH: $tool" }
    }
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'Runner.Listener.exe'" | Where-Object {$_.ExecutablePath -eq $listenerPath})
    if (-not $running.Count) {
        $logs = Join-Path $runnerRoot 'logs'; New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
        Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/c','run.cmd') -WorkingDirectory $runnerRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$stamp.stdout.log") -RedirectStandardError (Join-Path $logs "$stamp.stderr.log") | Out-Null
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $online = @(Get-RegisteredRunner)
        if ($online.Count -eq 1 -and $online[0].status -eq 'online') { break }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
}
Assert-LocalRegistration
$runners = @(Get-RegisteredRunner)
if ($runners.Count -ne 1) { throw 'Runner not found on GitHub.' }
$runner = $runners[0]
$localSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
if ($localSettings.agentId -ne $runner.id) { throw 'Local and remote runner identities differ.' }
$summary = [ordered]@{repository=$repo.nameWithOwner;runnerId=$runner.id;name=$runner.name;status=$runner.status;busy=$runner.busy;labels=@($runner.labels.name);directory=$runnerRoot;account=[Security.Principal.WindowsIdentity]::GetCurrent().Name;checkedAt=[DateTime]::UtcNow.ToString('o');serviceInstalled=$false}
$summary | ConvertTo-Json -Depth 4
if (Test-Path -LiteralPath $runnerRoot) { $summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runnerRoot 'status-receipt.json') -Encoding utf8NoBOM }
if ($Action -ne 'status' -and ($runner.status -ne 'online' -or 'vaults-release' -notin $runner.labels.name)) { throw 'Runner is not online with the required release label. Inspect its local logs.' }
