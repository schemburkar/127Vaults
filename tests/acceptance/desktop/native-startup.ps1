param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$Work,
    [ValidateSet('Desktop','Installer')][string]$Kind = 'Desktop'
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
$workspace = [IO.Path]::GetFullPath($Work)
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if ($workspace.TrimEnd('\') -eq $repository.TrimEnd('\') -or $workspace.StartsWith($repository.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Use a new workspace outside the source checkout.' }
if (Test-Path -LiteralPath $workspace) { throw 'The startup workspace already exists.' }
New-Item -ItemType Directory -Path $workspace | Out-Null
$saved = @{}
foreach ($name in @('VAULTS_CONFIG_DIR','WEBVIEW2_USER_DATA_FOLDER','WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$desktopProcess = $null
try {
    $env:VAULTS_CONFIG_DIR = Join-Path $workspace 'profile'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $workspace 'webview'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
    $desktopProcess = Start-Process -FilePath $binary -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace 'stdout.log') -RedirectStandardError (Join-Path $workspace 'stderr.log')
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 250
        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) { throw "Desktop exited before startup ($($desktopProcess.ExitCode))." }
    } while ($desktopProcess.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($desktopProcess.MainWindowHandle -eq 0) { throw 'Desktop did not create its native window.' }
    Add-Type -AssemblyName UIAutomationClient
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($desktopProcess.MainWindowHandle)
    if ($window.Current.Name -notlike '*127Vaults*') { throw 'Unexpected desktop window title.' }
    $receipt = @{ status='passed'; kind=$Kind; executable=$binary; sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant(); nativeWindow=$window.Current.Name; isolatedProfile=$env:VAULTS_CONFIG_DIR; checkedAt=[DateTime]::UtcNow.ToString('o') }
    $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspace 'evidence.json')
    if ($Kind -eq 'Desktop') { Write-Host 'Native Tauri desktop started with an isolated profile and WebView data folder.' }
    else { Write-Host 'Native installer welcome window started; installation was not requested.' }
} finally {
    if ($desktopProcess -and -not $desktopProcess.HasExited) {
        [void]$desktopProcess.CloseMainWindow()
        if (-not $desktopProcess.WaitForExit(5000)) { Stop-Process -Id $desktopProcess.Id -ErrorAction SilentlyContinue }
    }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
