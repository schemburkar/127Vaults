param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [ValidateSet('server', 'desktop', 'extension')]
    [string[]] $Service = @('server', 'desktop', 'extension'),
    [switch] $Check
)

$repoRoot = $PSScriptRoot
if (-not $env:VAULTS_NAMESPACE) { $env:VAULTS_NAMESPACE = 'development' }
if ($env:VAULTS_NAMESPACE -notin @('development','test')) { throw 'Development launchers cannot target production.' }

$namespaceJson = & node (Join-Path $repoRoot 'scripts/namespace.mjs') status
if ($LASTEXITCODE -ne 0) { throw 'Namespace configuration is invalid.' }
$namespaceInfo = $namespaceJson | ConvertFrom-Json

function Start-DevelopmentService([string] $Name, [string] $Command) {
    $logs = Join-Path $repoRoot (".tools/namespaces/" + $namespaceInfo.namespace + "/logs")
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $repoRoot -ArgumentList '-NoProfile', '-Command', $Command -RedirectStandardOutput (Join-Path $logs "$Name.log") -RedirectStandardError (Join-Path $logs "$Name.error.log")
    Write-Host "$Name logs: $logs"
}

if ('server' -in $Service) {
    Push-Location $repoRoot
    try {
        & node scripts/mvp-acceptance.mjs dev --check
        if ($LASTEXITCODE -ne 0) {
            throw 'Server startup preflight failed. See the diagnostic above; no server window was opened.'
        }
    } finally {
        Pop-Location
    }
    if ($Check) { Write-Host 'Server preflight passed. The selected startup mode is shown above.' }
    else { Write-Host 'Starting server with the verified startup mode: pnpm mvp:dev' }
    if (-not $Check) { Start-DevelopmentService 'server' 'pnpm mvp:dev' }
}

if ('desktop' -in $Service) {
    $desktopPaths = @((Join-Path $repoRoot 'target/debug/vaults-desktop-poc.exe'), (Join-Path $repoRoot 'target/release/vaults-desktop-poc.exe'))
    $runningDesktop = @(Get-Process -Name vaults-desktop-poc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -in $desktopPaths })
    if ($runningDesktop.Count -gt 0) { Write-Host 'Desktop is already open for this checkout. Its window and unlocked work were preserved.' }
    elseif ($Check) { Write-Host 'Desktop command ready: pnpm --filter @127vaults/desktop dev' }
    else {
        Write-Host 'Starting desktop: pnpm --filter @127vaults/desktop dev'
        Start-DevelopmentService 'desktop' 'pnpm --filter @127vaults/desktop dev'
    }
}

if ('extension' -in $Service) {
    & node (Join-Path $repoRoot 'scripts/extension-dev.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Extension asset preparation failed.' }
    Write-Host 'After changing extension files, click Reload on its extension card.'
}
