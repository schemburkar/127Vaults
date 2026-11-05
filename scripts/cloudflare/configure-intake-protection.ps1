# Provision a domain-restricted widget with the separate cf CLI profile. Never print its secret.
param([Parameter(Mandatory)][ValidateRange(2,10000)][int]$VolumeThreshold, [ValidateRange(1,24)][int]$WindowHours = 4)
$ErrorActionPreference = 'Stop'
$configFile = Join-Path $PSScriptRoot '../../.cloudflare-deploy/config.json'
$settings = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$widgetName = '127Vaults access requests'
$widgetsJson = & cf turnstile widgets list
if ($LASTEXITCODE -ne 0) { throw 'Could not list Turnstile widgets' }
$widgets = @($widgetsJson | ConvertFrom-Json)
$widget = $widgets | Where-Object { $_.name -eq $widgetName } | Select-Object -First 1
if (-not $widget) {
  $body = @{ name=$widgetName; domains=@(([Uri]$settings.origin).Host); mode='managed'; clearance_level='no_clearance' } | ConvertTo-Json -Compress
  $createdJson = & cf turnstile widgets create --body $body
  if ($LASTEXITCODE -ne 0) { throw 'Could not create Turnstile widget' }
  $widget = $createdJson | ConvertFrom-Json
}
if ($widget.sitekey -and -not $widget.secret) {
  $detailJson = & cf turnstile widgets get $widget.sitekey
  if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve widget provisioning credentials' }
  $widget = $detailJson | ConvertFrom-Json
}
if (-not $widget.secret -or -not $widget.sitekey) { throw 'Widget did not include provisioning credentials' }
if (@($widget.domains).Count -ne 1 -or $widget.domains[0] -ne ([Uri]$settings.origin).Host) { throw 'Existing widget has unexpected domains' }
[IO.File]::WriteAllText((Join-Path $settings.secretsDirectory 'turnstile-secret-key'), $widget.secret)
$settings | Add-Member -Force -NotePropertyName intakeProtection -NotePropertyValue @{
  siteKey=$widget.sitekey; waitMs=15000; cookieCooldownMs=60000; volumeThreshold=$VolumeThreshold; volumeWindowMs=($WindowHours * 3600000)
}
$settings | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $configFile -Encoding utf8NoBOM
Write-Output 'Domain-restricted Turnstile widget and private intake protection settings saved. No emails sent.'
