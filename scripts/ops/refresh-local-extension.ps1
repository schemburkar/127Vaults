[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstalledDirectory,
  [Parameter(Mandatory=$true)][string]$ReceiptDirectory
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$installed = (Resolve-Path -LiteralPath $InstalledDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $installed 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.name -notin @('127Vaults', '127Vaults (experimental)')) { throw 'Select the existing 127Vaults unpacked extension.' }
$source = Join-Path $repo 'apps/extension'
if ($installed -eq $source) { throw 'This extension already loads the workspace files.' }
$receipt = [IO.Path]::GetFullPath($ReceiptDirectory)
if (Test-Path -LiteralPath $receipt) { throw 'Choose a new receipt directory.' }
# Only popup files change. Preserve native registrations, extension identity,
# permissions, storage and all other installed package files.
$files = @('popup.html', 'src/popup.css', 'src/popup.mjs')
foreach ($file in $files) {
  if (!(Test-Path -LiteralPath (Join-Path $source $file)) -or !(Test-Path -LiteralPath (Join-Path $installed $file))) { throw "Required popup file missing: $file" }
}
New-Item -ItemType Directory -Path $receipt | Out-Null
$hashes = @{}
foreach ($file in $files) {
  $backup = Join-Path $receipt $file
  New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $installed $file) -Destination $backup
}
try {
  foreach ($file in $files) {
    $from = Join-Path $source $file
    $to = Join-Path $installed $file
    Copy-Item -LiteralPath $from -Destination $to -Force
    $hash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash -ne $hash) { throw "Popup verification failed: $file" }
    $hashes[$file] = $hash
  }
} catch {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $receipt $file) -Destination (Join-Path $installed $file) -Force }
  throw
}
@{ completedAt = [DateTime]::UtcNow.ToString('o'); installedDirectory = $installed; hashes = $hashes; sourceRevision = (& git -C $repo rev-parse HEAD); sourceModified = [bool](& git -C $repo status --porcelain) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $receipt 'extension-refresh.json')
Write-Output 'Installed popup updated and verified. Reload 127Vaults on the browser extensions page.'
