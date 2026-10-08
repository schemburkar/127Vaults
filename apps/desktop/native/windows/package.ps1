param([string]$OutputDirectory = "$PSScriptRoot/../../../../target/native-passkeys")
$ErrorActionPreference = 'Stop'
$repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$stage = Join-Path $output 'package'
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'Assets') | Out-Null
$binaries = @('vaults-desktop-poc.exe', '127vaults.exe', '127vaults-native-passkey-host.exe', '127vaults-passkey-provider.exe', '127vaults-extension-host.exe')
foreach ($binary in $binaries) {
  $source = Join-Path $repository "target/debug/$binary"
  if ($binary -eq '127vaults.exe') { $source = Join-Path $repository 'target/debug/deps/127vaults-native-provider.exe' }
  if ($binary -eq '127vaults-extension-host.exe') { $source = Join-Path $repository 'target/debug/deps/127vaults_extension_host-native-provider.exe' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $binary)
}
Copy-Item -LiteralPath (Join-Path $repository 'apps/desktop/src-tauri/icons/128x128.png') -Destination (Join-Path $stage 'Assets/Logo.png')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'AppxManifest.xml') -Destination (Join-Path $stage 'AppxManifest.xml')
$makeappx = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe"
& $makeappx pack /d $stage /p (Join-Path $output '127Vaults.NativePasskeys.msix') /o
if ($LASTEXITCODE) { throw 'Passkey provider package validation failed.' }
Write-Output "Unsigned package created at $output. Use a trusted signing certificate for installation, or register the staging manifest on a machine where Developer Mode is already enabled. This script does not modify certificate trust or enable Developer Mode."
