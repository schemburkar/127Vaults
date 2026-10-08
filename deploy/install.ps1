$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Install Node.js 24 from https://nodejs.org/en/download, then rerun this command. See README.md for container prerequisites.' }
& $node.Source (Join-Path $PSScriptRoot 'install.mjs') @args
exit $LASTEXITCODE
