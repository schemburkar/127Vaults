param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [ValidateSet('server', 'desktop', 'extension')]
    [string[]] $Service = @('server', 'desktop', 'extension')
)

$repoRoot = $PSScriptRoot

if ('server' -in $Service) {
    Push-Location $repoRoot
    try {
        & node scripts/mvp-acceptance.mjs dev --check
        if ($LASTEXITCODE -ne 0) {
            throw 'Server startup preflight failed. See the diagnostic above; no server window was opened.'
        }
    } finally {
        Pop-Location
    }
    Write-Host 'Starting server: pnpm mvp:dev'
    Start-Process powershell.exe -WorkingDirectory $repoRoot -ArgumentList '-NoExit', '-Command', 'pnpm mvp:dev'
}

if ('desktop' -in $Service) {
    Write-Host 'Starting desktop: pnpm --filter @127vaults/desktop dev'
    Start-Process powershell.exe -WorkingDirectory $repoRoot -ArgumentList '-NoExit', '-Command', 'pnpm --filter @127vaults/desktop dev'
}

if ('extension' -in $Service) {
    Write-Host "Extension: load $repoRoot\apps\extension as an unpacked extension in chrome://extensions or edge://extensions."
    Write-Host 'After changing extension files, click Reload on its extension card.'
}
