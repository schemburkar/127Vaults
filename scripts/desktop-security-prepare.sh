#!/usr/bin/env bash
# Trusted parent-side preparation, before any target-controlled process runs.
# Run as root on the existing Linux development host to mount bounded scratch.
set -euo pipefail
if [[ ${1:-} == --cleanup ]]; then
  work=$(realpath "${VAULTS_SECURITY_WORK:?}")
  case "$work" in /tmp/127v-desktop-security-*) ;; *) exit 1;; esac
  if mountpoint -q "$work/build"; then umount "$work/build"; fi
  rm -rf -- "$work"
  exit
fi
repo=$(realpath "${VAULTS_SOURCE:?Set VAULTS_SOURCE to the repository directory}")
test -f "$repo/apps/desktop/src-tauri/src/main.rs"
work=$(mktemp -d /tmp/127v-desktop-security-XXXXXX)
chmod 755 "$work"
mkdir -p "$work/source/apps/desktop" "$work/build"
mount -t tmpfs -o size=3g,mode=1777 tmpfs "$work/build"
mkdir -p "$work/build/cargo" "$work/build/home" "$work/build/gen" "$work/build/tmp" "$work/build/vite-temp" "$work/build/vite-cache"
chmod 777 "$work/build/"*
cp "$repo/Cargo.toml" "$repo/Cargo.lock" "$repo/package.json" "$work/source/"
cp -a "$repo/crates" "$repo/packages" "$work/source/"
cp -a "$repo/apps/cli" "$repo/apps/installer" "$work/source/apps/"
for name in src-tauri src test dist public package.json tsconfig.json vite.config.ts index.html; do
  cp -a "$repo/apps/desktop/$name" "$work/source/apps/desktop/"
done
mkdir -p "$work/source/node_modules/.pnpm" "$work/source/node_modules/.vite-temp" "$work/source/apps/desktop/node_modules"
chmod 777 "$work/source/node_modules"
find /home/vaults-dev/projects/127Vaults/node_modules -maxdepth 1 -type l -exec cp -a '{}' "$work/source/node_modules/" \;
printf '%s\n' "$work"
