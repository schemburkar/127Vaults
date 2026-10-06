# Linux WSL check — 2026-10-06

The existing WSL instance is Ubuntu 20.04 on WSL2 with WSLg. It initially had no Linux Rust toolchain, compiler, `pkg-config`, or GTK/WebKit development packages. This check installed Rust through rustup and the Ubuntu build dependencies needed for the CLI (`build-essential`, `pkg-config`, `libssl-dev`, `libsecret-1-dev`, `libdbus-1-dev`). The repo's pinned Rust 1.98.1 toolchain was installed automatically.

From `/mnt/c/Projects/127Vaults`, `CARGO_TARGET_DIR=/tmp/127vaults-linux-target cargo test -p vaults-cli --lib -q` passed: **36 tests, zero failures**. The first attempt identified the missing `dbus-1.pc`; after installing `libdbus-1-dev`, the same command passed. This verifies Linux CLI compilation and unit behavior only. It does not exercise a running Secret Service, an enrolled device, the extension native host, packaging, or offline sync against a server.

No Linux desktop build or GUI run was accepted. This Ubuntu 20.04 instance does not offer `libwebkit2gtk-4.1-dev`, required by Tauri 2 for Linux builds. Use a newer distro with Tauri's prerequisites, then build and run the desktop in WSLg and on a native Linux desktop before claiming support. WSLg is useful development evidence but cannot establish distribution, keyring, Wayland/X11 drag, or clean-machine behavior on actual Linux hosts.
