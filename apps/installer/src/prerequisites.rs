use crate::{archive, transport};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use vaults_installer::Result;
pub fn preview(server: bool, engine: Option<&str>) -> Vec<String> {
    let mut rows = vec![format!(
        "Platform: {} / {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    )];
    if server {
        rows.push("Server needs a private Node.js 24 runtime, a running container engine and Compose. Missing prerequisites are handled after you accept the plan.".into());
        if let Some(engine) = engine {
            rows.push(if probe(Command::new(engine).arg("info")) {
                format!("{engine}: running")
            } else {
                format!("{engine}: not ready; start its machine/service before continuing")
            });
        }
    } else {
        rows.push(
            "Client-only setup does not install a database, Node runtime or container engine."
                .into(),
        );
    }
    rows.push("If the operating system requests a restart, reboot and rerun the same installer. Completed installation receipts and server identity are preserved.".into());
    rows
}

pub fn run(command: &mut Command) -> Result<()> {
    let label = command.get_program().to_string_lossy().into_owned();
    let status = command.status()?;
    if cfg!(windows) && matches!(status.code(), Some(3010 | 1641)) {
        return Err("A prerequisite requires a restart. Restart Windows, then rerun this installer to resume; do not reset your server.".into());
    }
    if !status.success() {
        return Err(
            format!("{label} failed; correct the reported issue and rerun the installer").into(),
        );
    }
    Ok(())
}

/// Quiet capability probes have deadlines and never expose host configuration.
pub fn probe(command: &mut Command) -> bool {
    let Ok(mut child) = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < Duration::from_secs(15) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

pub fn node(root: &Path, allow_install: bool) -> Result<PathBuf> {
    let binary = if cfg!(windows) { "node.exe" } else { "node" };
    for candidate in [PathBuf::from(binary), root.join("runtime").join(binary)] {
        if probe(Command::new(&candidate).args([
            "-e",
            "process.exit(process.versions.node.split('.')[0] === '24' ? 0 : 1)",
        ])) {
            return Ok(candidate);
        }
    }
    if !allow_install {
        return Err("Node.js 24 is required; rerun without --no-install-prerequisites to install a private runtime".into());
    }
    cliclack::log::step(
        "Installing private Node.js 24 runtime (leaves other Node versions intact)",
    )?;
    let platform = match std::env::consts::OS {
        "windows" => "win",
        "linux" => "linux",
        "macos" => "darwin",
        _ => return Err("Unsupported Node platform".into()),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return Err("Unsupported CPU architecture".into()),
    };
    let suffix = format!(
        "-{platform}-{arch}.{}",
        if cfg!(windows) { "zip" } else { "tar.gz" }
    );
    let client = transport::client()?;
    let base = "https://nodejs.org/dist/latest-v24.x";
    let sums = client
        .get(format!("{base}/SHASUMS256.txt"))
        .send()?
        .error_for_status()?
        .text()?;
    let (hash, filename) = sums
        .lines()
        .filter_map(|line| line.split_once("  "))
        .find(|(_, file)| file.starts_with("node-v24.") && file.ends_with(&suffix))
        .ok_or("Node 24 download unavailable")?;
    if hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        || !filename
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
    {
        return Err("Invalid Node checksum manifest".into());
    }
    let response = client
        .get(format!("{base}/{filename}"))
        .send()?
        .error_for_status()?;
    let size = response
        .content_length()
        .filter(|size| *size < 200 * 1024 * 1024)
        .ok_or("Invalid Node archive size")?;
    let work = root.join(format!("runtime-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&work)?;
    let download = work.join(filename);
    transport::verified_download(response, &download, hash, size)?;
    let extracted = work.join("extracted");
    archive::extract(&download, &extracted, true)?;
    let runtime = root.join("runtime");
    if runtime.exists() {
        return Err(
            "Private Node runtime is damaged. Preserve it for inspection before replacing it"
                .into(),
        );
    }
    fs::rename(extracted, &runtime)?;
    let candidate = runtime.join(binary);
    if !probe(Command::new(&candidate).args([
        "-e",
        "process.exit(process.versions.node.split('.')[0] === '24' ? 0 : 1)",
    ])) {
        return Err("Private Node runtime verification failed".into());
    }
    Ok(candidate)
}

pub fn choose_engine(requested: Option<&str>) -> String {
    requested.map_or_else(
        || {
            for engine in ["podman", "docker"] {
                if probe(Command::new(engine).arg("info")) {
                    return engine.into();
                }
            }
            for engine in ["podman", "docker"] {
                if probe(Command::new(engine).arg("--version")) {
                    return engine.into();
                }
            }
            "docker".into()
        },
        str::to_owned,
    )
}

// Never refresh the Arch package database without upgrading installed packages:
// partial upgrades are unsupported on Arch and Omarchy.
fn arch_install(packages: &[&str]) -> Command {
    let mut command = Command::new("sudo");
    command.args(["pacman", "-Syu", "--needed"]).args(packages);
    command
}

fn arch_engine_install(name: &str) -> Command {
    arch_install(if name == "docker" {
        &["docker", "docker-compose"]
    } else {
        &["podman", "podman-compose"]
    })
}

pub fn desktop(allow_install: bool) -> Result<()> {
    if !cfg!(target_os = "linux") || !probe(Command::new("pacman").arg("--version")) {
        return Ok(());
    }
    arch_desktop(allow_install, probe, |command| {
        cliclack::log::step(
            "Installing Arch/Omarchy Desktop runtime packages (system upgrade may be required)",
        )?;
        run(command)
    })
}

fn arch_desktop(
    allow_install: bool,
    mut check: impl FnMut(&mut Command) -> bool,
    mut install: impl FnMut(&mut Command) -> Result<()>,
) -> Result<()> {
    let packages = ["webkit2gtk-4.1", "libsecret", "fuse2", "xdg-utils"];
    if check(Command::new("pacman").arg("-T").args(packages)) {
        return Ok(());
    }
    if !allow_install {
        return Err("Desktop runtime packages are missing. Run sudo pacman -Syu --needed webkit2gtk-4.1 libsecret fuse2 xdg-utils, then rerun. A running, unlocked Secret Service is also required".into());
    }
    install(&mut arch_install(&packages))?;
    if !check(Command::new("pacman").arg("-T").args(packages)) {
        return Err("Desktop runtime package verification failed".into());
    }
    Ok(())
}

pub fn engine(
    name: &str,
    provider: &mut Option<PathBuf>,
    root: &Path,
    allow_install: bool,
) -> Result<()> {
    if !probe(Command::new(name).arg("--version")) {
        if !allow_install {
            return Err(format!("{name} is missing").into());
        }
        cliclack::log::step(format!(
            "Installing {name} using the system package manager"
        ))?;
        if cfg!(windows) {
            let id = if name == "docker" {
                "Docker.DockerDesktop"
            } else {
                "RedHat.Podman"
            };
            run(Command::new("winget").args([
                "install",
                "--exact",
                "--id",
                id,
                "--accept-source-agreements",
                "--accept-package-agreements",
            ]))?;
        } else if cfg!(target_os = "linux") && probe(Command::new("apt-get").arg("--version")) {
            run(Command::new("sudo").args(["apt-get", "update"]))?;
            if name == "docker" {
                run(Command::new("sudo").args([
                    "apt-get",
                    "install",
                    "-y",
                    "docker.io",
                    "docker-compose-v2",
                ]))?;
            } else {
                run(Command::new("sudo").args([
                    "apt-get",
                    "install",
                    "-y",
                    "podman",
                    "podman-compose",
                ]))?;
            }
        } else if cfg!(target_os = "linux")
            && probe(Command::new("dnf").arg("--version"))
            && name == "podman"
        {
            run(Command::new("sudo").args(["dnf", "install", "-y", "podman", "podman-compose"]))?;
        } else if cfg!(target_os = "linux") && probe(Command::new("pacman").arg("--version")) {
            run(&mut arch_engine_install(name))?;
        } else {
            return Err("No supported package manager for automatic container setup. Install Docker/Podman with Compose, then rerun".into());
        }
    }
    if !probe(Command::new(name).arg("info")) {
        return Err(format!("{name} is installed but unreachable. Start the intended engine/machine, finish any required reboot or operator access setup, open a fresh terminal, and rerun. Existing engine connections are preserved").into());
    }
    let mut compose = Command::new(name);
    compose.args(["compose", "version"]);
    if let Some(path) = provider.as_ref() {
        compose.env("PODMAN_COMPOSE_PROVIDER", path);
    }
    if !probe(&mut compose) {
        if allow_install && name == "podman" && provider.is_none() {
            *provider = Some(install_compose(root)?);
        } else if allow_install
            && cfg!(target_os = "linux")
            && name == "docker"
            && probe(Command::new("apt-get").arg("--version"))
        {
            run(Command::new("sudo").args(["apt-get", "install", "-y", "docker-compose-v2"]))?;
        } else if allow_install
            && cfg!(target_os = "linux")
            && name == "docker"
            && probe(Command::new("pacman").arg("--version"))
        {
            run(&mut arch_install(&["docker-compose"]))?;
        } else {
            return Err("Compose is missing. Set up native Compose in Docker/Podman Desktop, or pass --compose-provider PATH, then rerun".into());
        }
        if let Some(path) = provider.as_ref() {
            compose.env("PODMAN_COMPOSE_PROVIDER", path);
        }
        if !probe(&mut compose) {
            return Err("Compose is still unavailable after prerequisite installation. Finish engine setup and rerun".into());
        }
    }
    Ok(())
}

fn install_compose(root: &Path) -> Result<PathBuf> {
    cliclack::log::step("Installing a private native Compose provider")?;
    let platform = if cfg!(windows) {
        "windows-x86_64.exe"
    } else {
        "linux-x86_64"
    };
    let name = format!("docker-compose-{platform}");
    let client = transport::client()?;
    let release: serde_json::Value = client
        .get("https://api.github.com/repos/docker/compose/releases/latest")
        .send()?
        .error_for_status()?
        .json()?;
    let asset = release["assets"]
        .as_array()
        .and_then(|values| values.iter().find(|a| a["name"].as_str() == Some(&name)))
        .ok_or("Native Compose release unavailable")?;
    let digest = asset["digest"]
        .as_str()
        .and_then(|v| v.strip_prefix("sha256:"))
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Compose release has no SHA-256 digest")?;
    let size = asset["size"]
        .as_u64()
        .filter(|v| *v > 0 && *v < 200 * 1024 * 1024)
        .ok_or("Invalid Compose size")?;
    let url = asset["browser_download_url"]
        .as_str()
        .filter(|v| v.starts_with("https://github.com/docker/compose/releases/download/"))
        .ok_or("Unexpected Compose download origin")?;
    let directory = root.join(format!("compose-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory)?;
    let destination = directory.join(if cfg!(windows) {
        "docker-compose.exe"
    } else {
        "docker-compose"
    });
    // Public release assets redirect to GitHub's asset CDN; no invitation is attached.
    let public_client = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(600))
        .build()?;
    transport::verified_download(public_client.get(url).send()?, &destination, digest, size)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))?;
    }
    if !probe(Command::new(&destination).arg("version")) {
        return Err("Downloaded Compose provider could not run".into());
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arch_engine_packages_keep_compose_and_require_full_upgrade() {
        for (engine, packages) in [
            ("docker", ["docker", "docker-compose"]),
            ("podman", ["podman", "podman-compose"]),
        ] {
            let command = arch_engine_install(engine);
            let args: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_str().unwrap())
                .collect();
            assert_eq!(command.get_program(), "sudo");
            assert_eq!(
                args,
                ["pacman", "-Syu", "--needed", packages[0], packages[1]]
            );
        }
    }

    #[test]
    fn arch_desktop_preserves_no_install_and_existing_packages() {
        arch_desktop(false, |_| true, |_| panic!("must not install")).unwrap();
        let error = arch_desktop(false, |_| false, |_| panic!("must not install")).unwrap_err();
        assert!(error.to_string().contains("sudo pacman -Syu --needed"));
    }

    #[test]
    fn arch_desktop_installs_missing_runtime_and_verifies_it() {
        let mut checks = 0;
        let mut installs = 0;
        arch_desktop(
            true,
            |command| {
                assert_eq!(command.get_program(), "pacman");
                assert_eq!(command.get_args().next().unwrap(), "-T");
                checks += 1;
                checks == 2
            },
            |command| {
                installs += 1;
                assert_eq!(command.get_program(), "sudo");
                let args: Vec<_> = command
                    .get_args()
                    .map(|arg| arg.to_str().unwrap())
                    .collect();
                assert_eq!(
                    args,
                    [
                        "pacman",
                        "-Syu",
                        "--needed",
                        "webkit2gtk-4.1",
                        "libsecret",
                        "fuse2",
                        "xdg-utils"
                    ]
                );
                Ok(())
            },
        )
        .unwrap();
        assert_eq!((checks, installs), (2, 1));
        assert!(
            arch_desktop(true, |_| false, |_| Ok(()))
                .unwrap_err()
                .to_string()
                .contains("verification failed")
        );
        assert!(
            arch_desktop(true, |_| false, |_| Err("package manager failed".into()))
                .unwrap_err()
                .to_string()
                .contains("package manager failed")
        );
    }
}
