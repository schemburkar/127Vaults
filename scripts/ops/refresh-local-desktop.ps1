[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstalledExecutable,
  [Parameter(Mandatory=$true)][string]$ReceiptDirectory
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$installed = (Resolve-Path -LiteralPath $InstalledExecutable).Path
$receipt = [IO.Path]::GetFullPath($ReceiptDirectory)
if ([IO.Path]::GetFileName($installed) -ne 'vaults-desktop-poc.exe') { throw 'Select the installed 127Vaults Desktop executable.' }
$built = Join-Path $repo 'target/release/vaults-desktop-poc.exe'
if ($installed -eq $built) { throw 'Select an installed app, not the build output.' }
if (Test-Path -LiteralPath $receipt) { throw 'Choose a new receipt directory; previous backups are preserved.' }
Push-Location (Join-Path $repo 'apps/desktop')
try {
  & node node_modules/@tauri-apps/cli/tauri.js build --no-bundle -- --locked
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed; installed app was preserved.' }
} finally { Pop-Location }
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installed })
foreach ($entry in $running | Where-Object { $_.CommandLine -notmatch 'agent-serve' }) {
  $app = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
  if ($app -and $app.MainWindowHandle -ne 0) {
    if (!$app.CloseMainWindow()) { throw 'Could not close Desktop. Close it after saving edits, then retry.' }
    if (!$app.WaitForExit(15000)) { throw 'Desktop is still open. Save or cancel pending edits, close it, then retry.' }
  } elseif ($app) { throw 'Desktop is still starting. Wait for its window, then retry.' }
}
# The read-only connector belongs to the app just closed. Do not stop other installations.
foreach ($entry in $running | Where-Object { $_.CommandLine -match 'agent-serve' }) {
  $agent = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
  if ($agent) { Stop-Process -Id $entry.ProcessId -ErrorAction Stop }
}
New-Item -ItemType Directory -Path $receipt | Out-Null
$backup = Join-Path $receipt 'previous-vaults-desktop-poc.exe'
Copy-Item -LiteralPath $installed -Destination $backup
$expectedHash = (Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash
Copy-Item -LiteralPath $built -Destination $installed -Force
if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $expectedHash) {
  Copy-Item -LiteralPath $backup -Destination $installed -Force
  throw 'Installed executable verification failed; previous executable restored.'
}
$launched = Start-Process -FilePath $installed -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$actual = Get-CimInstance Win32_Process -Filter "ProcessId = $($launched.Id)"
if (!$actual -or $actual.ExecutablePath -ne $installed) { throw 'The updated app did not stay running at the selected installation path.' }
$record = @{
  completedAt = [DateTime]::UtcNow.ToString('o'); sourceRevision = (& git -C $repo rev-parse HEAD)
  sourceModified = [bool](& git -C $repo status --porcelain)
  installedExecutable = $installed; sha256 = $expectedHash; processId = $launched.Id; previousExecutable = $backup
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receipt 'desktop-refresh.json')
Write-Output "Updated and relaunched $installed; verified SHA-256 $expectedHash. Receipt: $receipt"
