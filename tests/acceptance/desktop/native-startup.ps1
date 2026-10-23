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
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VaultsStartupWindow {
    delegate bool Callback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
    public static string Title(IntPtr window) { var text = new StringBuilder(512); GetWindowText(window, text, text.Capacity); return text.ToString(); }
    public static IntPtr Find(int processId) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, parameter) => { uint owner; GetWindowThreadProcessId(window, out owner); if (owner == processId && Title(window).Contains("127Vaults")) { found=window; return false; } return true; }, IntPtr.Zero);
        return found;
    }
}
'@
try {
    $env:VAULTS_CONFIG_DIR = Join-Path $workspace 'profile'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $workspace 'webview'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
    $desktopProcess = Start-Process -FilePath $binary -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace 'stdout.log') -RedirectStandardError (Join-Path $workspace 'stderr.log')
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $handle = [IntPtr]::Zero
    do {
        Start-Sleep -Milliseconds 250
        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) { throw "Desktop exited before startup ($($desktopProcess.ExitCode))." }
        # MainWindowHandle ignores hidden NSIS dialogs. Enumerate owned windows
        # directly so background verification does not need a visible installer.
        $handle = [VaultsStartupWindow]::Find($desktopProcess.Id)
    } while ($handle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
    if ($handle -eq [IntPtr]::Zero) { throw "$Kind did not create its native window." }
    $title = [VaultsStartupWindow]::Title($handle)
    $receipt = @{ status='passed'; kind=$Kind; executable=$binary; sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant(); nativeWindow=$title; isolatedProfile=$env:VAULTS_CONFIG_DIR; checkedAt=[DateTime]::UtcNow.ToString('o') }
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
