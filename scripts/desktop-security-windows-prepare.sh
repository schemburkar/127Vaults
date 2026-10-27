#!/usr/bin/env bash
# Parent-side staging of already-cached Windows libraries. No downloads.
set -euo pipefail
work=$(realpath "${VAULTS_SECURITY_WORK:?}")
case "$work" in /tmp/127v-desktop-security-*) ;; *) exit 1;; esac
mkdir -p "$work/build/win-cargo/registry/cache/index.crates.io-1949cf8c6b5b557f" "$work/build/win-sysroot/lib/rustlib/x86_64-pc-windows-msvc" "$work/build/wincheck/src"
if [[ ! -d "$work/build/win-sysroot/lib/rustlib/x86_64-pc-windows-msvc/lib" ]]; then
  cp -a "${VAULTS_WINDOWS_STD:?}" "$work/build/win-sysroot/lib/rustlib/x86_64-pc-windows-msvc/lib"
fi
for pattern in 'windows*.crate' 'zeroize-1.8.2.crate' 'syn-2*.crate' 'quote-*.crate' 'proc-macro2-*.crate' 'unicode-ident-*.crate'; do
  find "${VAULTS_WINDOWS_CARGO_CACHE:?}" -name "$pattern" -exec cp '{}' "$work/build/win-cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/" \;
done
ln -sfn /scratch/cargo/registry/index "$work/build/win-cargo/registry/index"
cat > "$work/build/wincheck/Cargo.toml" <<'TOML'
[package]
name = "clipboard-windows-check"
version = "0.0.0"
edition = "2024"
[dependencies]
zeroize = "=1.8.2"
windows = { version = "=0.61.3", features = ["ApplicationModel_DataTransfer", "Foundation"] }
TOML
printf '#[path="/source/apps/desktop/src-tauri/src/clipboard.rs"]\nmod clipboard;\npub fn check() { let state = clipboard::ClipboardState::default(); let _ = state.copy("synthetic-owner".into(), "synthetic-value".into()); state.clear(None, true); }\n' > "$work/build/wincheck/src/lib.rs"
