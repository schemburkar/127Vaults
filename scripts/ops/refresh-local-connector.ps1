[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Manifest,
  [Parameter(Mandatory=$true)][string]$ReceiptDirectory
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$registration = Get-Content -LiteralPath (Resolve-Path -LiteralPath $Manifest).Path -Raw | ConvertFrom-Json
if ($registration.name -ne 'com.127vaults.connector') { throw 'Select an existing 127Vaults connector manifest.' }
$installed = (Resolve-Path -LiteralPath $registration.path).Path
if ([IO.Path]::GetFileName($installed) -ne '127vaults-extension-host.exe') { throw 'Unexpected connector executable.' }
$receipt = [IO.Path]::GetFullPath($ReceiptDirectory)
if (Test-Path -LiteralPath $receipt) { throw 'Choose a new receipt directory.' }
Push-Location $repo
try {
  & cargo build --locked -p vaults-cli --bin 127vaults-extension-host
  if ($LASTEXITCODE -ne 0) { throw 'Connector build failed; installed connector preserved.' }
} finally { Pop-Location }
$built = Join-Path $repo 'target/debug/127vaults-extension-host.exe'
if ($installed -eq $built) { throw 'Select an installed connector, not the build output.' }
New-Item -ItemType Directory -Path $receipt | Out-Null
$backup = Join-Path $receipt 'previous-127vaults-extension-host.exe'
Copy-Item -LiteralPath $installed -Destination $backup
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installed } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }
$expectedHash = (Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash
Copy-Item -LiteralPath $built -Destination $installed -Force
if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $expectedHash) {
  Copy-Item -LiteralPath $backup -Destination $installed -Force
  throw 'Connector verification failed; previous executable restored.'
}
@{ completedAt = [DateTime]::UtcNow.ToString('o'); installedExecutable = $installed; sha256 = $expectedHash; previousExecutable = $backup; sourceRevision = (& git -C $repo rev-parse HEAD); sourceModified = [bool](& git -C $repo status --porcelain) } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receipt 'connector-refresh.json')
Write-Output 'Installed connector updated and SHA-256 verified. Reload the extension to reconnect.'
