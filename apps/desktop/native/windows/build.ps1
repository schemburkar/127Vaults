param([string]$OutputDirectory = "$PSScriptRoot/../../../../target/debug")
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Install Visual Studio C++ build tools and the Windows SDK.' }
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$source = Join-Path $PSScriptRoot 'provider.cpp'
$output = Join-Path $resolvedOutput '127vaults-passkey-provider.exe'
$object = Join-Path $resolvedOutput '127vaults-passkey-provider.obj'
$devcmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
& cmd.exe /d /c "call `"$devcmd`" -arch=x64 -host_arch=x64 >nul && cl /nologo /std:c++20 /EHsc /W4 /guard:cf /DUNICODE /D_UNICODE `"$source`" /Fo`"$object`" /Fe`"$output`" /link /DYNAMICBASE /NXCOMPAT"
if ($LASTEXITCODE) { throw 'Native passkey provider build failed.' }
