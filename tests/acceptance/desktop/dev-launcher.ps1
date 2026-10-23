param(
    [Parameter(Mandatory=$true)][string]$EnvironmentFile,
    [Parameter(Mandatory=$true)][string]$Work
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$workspace = [IO.Path]::GetFullPath($Work)
if ($workspace -eq $repository -or $workspace.StartsWith($repository.TrimEnd('\')+'\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Use an external startup workspace.' }
if (Test-Path -LiteralPath $workspace) { throw 'Use a new startup workspace.' }
New-Item -ItemType Directory -Path $workspace | Out-Null
$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2] } }
$saved = @{}
foreach ($name in @('VAULTS_MVP_ENV_FILE','VAULTS_CONFIG_DIR','WEBVIEW2_USER_DATA_FOLDER')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$launches = [Collections.Generic.List[object]]::new()
# Exercise the actual launcher and actual child commands, adding only hidden
# windows/log capture and PID ownership for cleanup of this test's processes.
function Start-Process {
    param($FilePath, $WorkingDirectory, $ArgumentList)
    $number = $launches.Count
    $child = Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace "child-$number.out.log") -RedirectStandardError (Join-Path $workspace "child-$number.err.log")
    $launches.Add($child)
}
try {
    $env:VAULTS_MVP_ENV_FILE = (Resolve-Path -LiteralPath $EnvironmentFile).Path
    $env:VAULTS_CONFIG_DIR = Join-Path $workspace 'desktop-profile'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $workspace 'webview'
    & (Join-Path $repository 'dev.ps1')
    if ($launches.Count -ne 2) { throw 'The default launcher did not start server and desktop processes.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    $desktopWindow = $null
    do {
        $processes = @(Get-CimInstance Win32_Process)
        $owned = [Collections.Generic.HashSet[uint32]]::new()
        foreach ($child in $launches) { [void]$owned.Add([uint32]$child.Id) }
        do { $added = $false; foreach ($proc in $processes) { if ($owned.Contains([uint32]$proc.ParentProcessId) -and $owned.Add([uint32]$proc.ProcessId)) { $added = $true } } } while ($added)
        foreach ($proc in $processes | Where-Object { $owned.Contains([uint32]$_.ProcessId) -and $_.Name -eq 'vaults-desktop-poc.exe' }) {
            $candidate = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.MainWindowHandle -ne 0 -and $candidate.MainWindowTitle -like '*127Vaults*') { $desktopWindow = $candidate }
        }
        if (-not $desktopWindow) { Start-Sleep -Milliseconds 500 }
    } while (-not $desktopWindow -and [DateTime]::UtcNow -lt $deadline)
    if (-not $desktopWindow) { throw 'The dev launcher desktop did not create its native window.' }
    $port = if ($settings['VAULTS_DEV_WEB_PORT']) { $settings['VAULTS_DEV_WEB_PORT'] } else { '12780' }
    $caFile = if ($settings['VAULTS_CA_CERT_FILE']) { $settings['VAULTS_CA_CERT_FILE'] } else { 'ca.crt' }
    $ca = Join-Path $settings['VAULTS_TLS_DIR'] (Join-Path 'ca' $caFile)
    & node (Join-Path $repository 'scripts/browser-assets-smoke.mjs') "https://127.0.0.1:$port" $ca --development
    if ($LASTEXITCODE -ne 0) { throw 'HTTPS dev UI, raw client modules or API proxy verification failed.' }
    @{ status='passed'; actualLauncher=$true; actualChildCommands=$true; nativeWindow=$desktopWindow.MainWindowTitle; extensionPrepared=$true; httpsAssetsAndApiProxy=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace 'evidence.json')
    Write-Host 'Actual dev.ps1 server/desktop/extension launch and HTTPS assets/API proxy passed.'
} finally {
    $processes = @(Get-CimInstance Win32_Process)
    $owned = [Collections.Generic.HashSet[uint32]]::new()
    foreach ($child in $launches) { [void]$owned.Add([uint32]$child.Id) }
    do { $added = $false; foreach ($proc in $processes) { if ($owned.Contains([uint32]$proc.ParentProcessId) -and $owned.Add([uint32]$proc.ProcessId)) { $added=$true } } } while ($added)
    foreach ($proc in $processes | Where-Object { $owned.Contains([uint32]$_.ProcessId) } | Sort-Object ProcessId -Descending) { Stop-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
