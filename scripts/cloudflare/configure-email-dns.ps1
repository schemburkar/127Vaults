param(
  [Parameter(Mandatory)][string]$Zone,
  [Parameter(Mandatory)][string]$RecordsFile,
  [Parameter(Mandatory)][string]$ReceiptFile
)
$ErrorActionPreference = 'Stop'
# Use the separate cf CLI profile, which can have different permissions from Wrangler.
$records = @(Get-Content -LiteralPath $RecordsFile -Raw | ConvertFrom-Json)
$existingJson = & cf dns records list --zone $Zone
if ($LASTEXITCODE -ne 0) { throw 'Could not read DNS records' }
$existing = @($existingJson | ConvertFrom-Json)
$receipt = @()
foreach ($record in $records) {
  if ($record.type -notin @('TXT', 'MX', 'CNAME')) { throw 'Unsupported email DNS record type' }
  if (-not $record.name.EndsWith(".$Zone")) { throw 'Email DNS record must be a subdomain of the selected zone' }
  $matches = @($existing | Where-Object { $_.name -eq $record.name -and $_.type -eq $record.type })
  $identical = @($matches | Where-Object { $_.content -eq $record.content -and ($record.type -ne 'MX' -or $_.priority -eq $record.priority) })
  if ($identical.Count) {
    $receipt += @{ name = $record.name; type = $record.type; action = 'unchanged'; id = $identical[0].id }
    continue
  }
  if ($matches.Count -or @($existing | Where-Object { $_.name -eq $record.name -and ($_.type -eq 'CNAME' -or $record.type -eq 'CNAME') }).Count) {
    throw "Conflicting DNS record at $($record.name); no existing records were overwritten"
  }
  $body = $record | ConvertTo-Json -Compress
  $createdJson = & cf dns records create --zone $Zone --body $body
  if ($LASTEXITCODE -ne 0) { throw "Could not create $($record.type) $($record.name)" }
  $created = $createdJson | ConvertFrom-Json
  $receipt += @{ name = $record.name; type = $record.type; action = 'created'; id = $created.id }
}
$verifiedJson = & cf dns records list --zone $Zone
if ($LASTEXITCODE -ne 0) { throw 'Could not verify DNS changes' }
$verified = @($verifiedJson | ConvertFrom-Json)
foreach ($record in $records) {
  if (-not @($verified | Where-Object { $_.name -eq $record.name -and $_.type -eq $record.type -and $_.content -eq $record.content -and ($record.type -ne 'MX' -or $_.priority -eq $record.priority) -and -not $_.proxied }).Count) {
    throw "DNS verification failed for $($record.name)"
  }
}
@{ verifiedAt = [DateTime]::UtcNow.ToString('o'); zone = $Zone; records = $receipt } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReceiptFile
Write-Output "Verified $($records.Count) email DNS records; receipt saved to $ReceiptFile"
