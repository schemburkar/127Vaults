param(
    [string]$Distro = 'Vaults-Omarchy-Test',
    [string]$WorkRoot = "$env:USERPROFILE\.127vaults-omarchy-wsl",
    [switch]$Resume
)
$ErrorActionPreference = 'Stop'
if ($Distro -notmatch '^Vaults-Omarchy-[A-Za-z0-9-]+$') { throw 'Use an isolated Vaults-Omarchy-* distro name.' }
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$existing = ((& wsl --list --quiet) -replace "`0", '') -split "`n" | ForEach-Object { $_.Trim() }
if (($existing -contains $Distro) -and !$Resume) { throw "Distro $Distro already exists; inspect it or explicitly use -Resume." }
$destination = Join-Path $WorkRoot $Distro
if (!$Resume -and (Test-Path -LiteralPath $destination)) { throw "Installation path already exists: $destination" }
if ($Resume) {
    $previous = Get-Content (Join-Path $WorkRoot 'provenance.json') -Raw | ConvertFrom-Json
    if ($previous.distro -ne $Distro -or !($existing -contains $Distro)) { throw 'Resume requires the recorded test distro.' }
}
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$source = Join-Path $WorkRoot 'source'
$revision = 'f90ccb1f427f10b1e2ff80738a89acd32d19b0cd'
if (!(Test-Path -LiteralPath $source)) {
    & git -c core.autocrlf=false clone https://github.com/clarenceb/omarchy-wsl2.git $source
    if ($LASTEXITCODE) { throw 'Source clone failed' }
    & git -C $source checkout --detach $revision
    if ($LASTEXITCODE) { throw 'Pinned source checkout failed' }
}
if ((& git -C $source rev-parse HEAD) -ne $revision) { throw 'Unexpected WSL adaptation source revision' }
if (& git -C $source status --porcelain) { throw 'WSL adaptation source has local changes' }
$mirror = 'https://geo.mirror.pkgbuild.com/wsl/latest'
$imageName = if ($Resume) { $previous.image } else {
    (Invoke-WebRequest "$mirror/").Links.href |
        Where-Object { $_ -match '^archlinux-[0-9.]+\.wsl$' } | Sort-Object | Select-Object -Last 1
}
if (!$imageName) { throw 'Official Arch WSL image not found' }
$image = Join-Path $WorkRoot $imageName
if (!(Test-Path -LiteralPath $image)) {
    Invoke-WebRequest "$mirror/$imageName" -OutFile $image
}
$checksum = if ($Resume) { $previous.sha256 } else { (Invoke-WebRequest "$mirror/$imageName.SHA256").Content }
if ($checksum -is [byte[]]) { $checksum = [Text.Encoding]::UTF8.GetString($checksum) }
$expected = [regex]::Match($checksum, '(?i)\b[0-9a-f]{64}\b').Value
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $image).Hash
if (!$expected -or $actual -ne $expected) { throw 'Official Arch image SHA-256 mismatch' }
if (!$Resume) {
    @{ distro = $Distro; image = $imageName; sha256 = $actual; adaptationRevision = $revision;
    profile = 'headless'; omarchyRef = 'v4.0.6'; created = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content (Join-Path $WorkRoot 'provenance.json')
}
if (!$Resume) {
    & wsl --import $Distro $destination $image --version 2
    if ($LASTEXITCODE) { throw 'WSL import failed' }
}
$linuxSource = (& wsl -d $Distro -u root --exec wslpath -a ($source.Replace('\', '/'))).Trim()
if ($LASTEXITCODE) { throw 'WSL source path translation failed' }
# Provision only this new guest. Avoid the adaptation's seed/install targets:
# those targets unregister existing distros; this workflow never does that.
& wsl -d $Distro -u root --exec env "VAULTS_OMARCHY_SOURCE=$linuxSource" bash -c 'set -eu; if ! test -d /opt/vaults-omarchy-wsl2; then cp -a "$VAULTS_OMARCHY_SOURCE" /opt/vaults-omarchy-wsl2; fi; env OMARCHY_REF=v4.0.6 OMARCHY_WSL_PROFILE=headless OMARCHY_USER=omarchy OMARCHY_UID=1271 bash /opt/vaults-omarchy-wsl2/scripts/provision/main.sh' 2>&1 |
    Tee-Object -FilePath (Join-Path $WorkRoot 'provision.log')
if ($LASTEXITCODE) { throw "Provisioning failed; the isolated distro is retained for inspection: $Distro" }
& wsl --terminate $Distro
if ($LASTEXITCODE) { throw 'Guest restart failed' }
& wsl -d $Distro -u omarchy --exec bash -lc 'cat /etc/os-release; cat /etc/omarchy.conf; id; test -S /mnt/wslg/runtime-dir/wayland-0' 2>&1 |
    Tee-Object -FilePath (Join-Path $WorkRoot 'boot.log')
if ($LASTEXITCODE) { throw 'Guest boot/WSLg verification failed' }
Write-Host "Prepared $Distro. Logs and provenance: $WorkRoot. This is an unofficial WSL adaptation, not native Hyprland acceptance."
