#!/usr/bin/env bash
# Offline native checks on the existing Linux development host. Sources and
# cached toolchain/registry are read-only; all writes stay in bounded tmpfs.
set -euo pipefail
work=${VAULTS_SECURITY_WORK:?Run desktop-security-prepare.sh and set VAULTS_SECURITY_WORK}
case "$(realpath "$work")" in /tmp/127v-desktop-security-*) ;; *) exit 1;; esac
test -d "$work/source/apps/desktop/src-tauri"
mkdir -p "$work/build/gen"
case ${VAULTS_NATIVE_CHECK_MODE:-native} in
  native) checks='cargo check --locked --offline -p vaults-desktop-poc && cargo test --locked --offline -p vaults-desktop-poc --bin vaults-desktop-poc && cargo test --locked --offline -p vaults-cli --lib' ;;
  windows) checks='CARGO_HOME=/scratch/win-cargo CARGO_TARGET_DIR=/scratch/windows-target RUSTFLAGS="--sysroot /scratch/win-sysroot" cargo check --offline --manifest-path /scratch/wincheck/Cargo.toml --target x86_64-pc-windows-msvc' ;;
  *) exit 1 ;;
esac
exec /usr/bin/timeout 600 /usr/bin/bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /bin /bin \
  --ro-bind /etc/ld.so.cache /etc/ld.so.cache --ro-bind /etc/alternatives /etc/alternatives --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$work/build" /scratch --ro-bind "$work/source" /source \
  --bind "$work/build/gen" /source/apps/desktop/src-tauri/gen \
  --ro-bind /home/vaults-dev/.rustup/toolchains/1.98.1-x86_64-unknown-linux-gnu /toolchain \
  --ro-bind /home/vaults-dev/.cargo/registry /scratch/cargo/registry \
  --chdir /source --clearenv --setenv PATH /toolchain/bin:/usr/bin:/bin \
  --setenv HOME /scratch/home --setenv CARGO_HOME /scratch/cargo \
  --setenv CARGO_TARGET_DIR /scratch/target --setenv CARGO_BUILD_JOBS 2 --setenv LANG C.UTF-8 \
  --setenv CARGO_PROFILE_DEV_DEBUG 0 --setenv CARGO_PROFILE_TEST_DEBUG 0 --setenv CARGO_INCREMENTAL 0 \
  /bin/bash -c "ulimit -t 540; ulimit -u 128; ulimit -v 4194304; ulimit -n 512; ulimit -f 524288; $checks"
