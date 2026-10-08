param([string]$PackageDirectory = "$PSScriptRoot/../../../../target/native-passkeys/package")
$ErrorActionPreference = 'Stop'
$development = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if ($development.AllowDevelopmentWithoutDevLicense -ne 1) {
  throw 'Enable Windows Developer Mode yourself before running this local development installer. No Windows security setting or certificate trust has been changed.'
}
$manifest = Join-Path ([System.IO.Path]::GetFullPath($PackageDirectory)) 'AppxManifest.xml'
if (!(Test-Path -LiteralPath $manifest)) { throw 'Build the native package first using package.ps1.' }
Add-AppxPackage -Register $manifest -ErrorAction Stop
Get-AppxPackage -Name '127Vaults.Desktop' | Select-Object Name, Version, PackageFamilyName
Write-Output 'Open the installed 127Vaults Desktop from Start. Unlock it, then register native passkeys from Settings > Profile and enable 127Vaults in Windows passkey Advanced options.'
