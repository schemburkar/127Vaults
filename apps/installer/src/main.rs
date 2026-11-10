#![allow(clippy::case_sensitive_file_extension_comparisons)]
mod archive;
mod backups;
mod discovery;
mod enrollment_email;
mod extension_setup;
mod prerequisites;
mod transport;

use atomic_write_file::AtomicWriteFile;
use clap::Parser;
use discovery::BoundedOutput;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{IsTerminal, Write},
    path::{Path, PathBuf},
    process::Command,
};
use vaults_installer::{Artifact, Invitation, Product, Result, select_artifact};

#[derive(Parser)]
#[allow(clippy::struct_excessive_bools)] // Independent command-line switches.
#[command(
    name = "127vaults-install",
    version = vaults_installer::PACKAGE_VERSION,
    about = "Install and upgrade your licensed 127Vaults apps"
)]
struct Args {
    /// Private trial invitation URL. Prefer `VAULTS_INSTALL_INVITATION` to avoid shell history.
    #[arg(long, env = "VAULTS_INSTALL_INVITATION", hide_env_values = true)]
    invitation: Option<String>,
    #[arg(long, value_enum, value_delimiter = ',')]
    components: Vec<Product>,
    /// Installation state, packages and private Node runtime live here.
    #[arg(long)]
    directory: Option<PathBuf>,
    /// Adopt an existing extracted server installation, preserving its identity.
    #[arg(long)]
    from: Option<PathBuf>,
    #[arg(long, value_parser = ["podman", "docker"])]
    engine: Option<String>,
    #[arg(long)]
    compose_provider: Option<PathBuf>,
    /// Private LAN IPv4 address for a fresh server (default: loopback).
    #[arg(long)]
    endpoint: Option<String>,
    /// Exact custom DNS name, with private-CA TLS (requires a newer server bundle).
    #[arg(long)]
    hostname: Option<String>,
    #[arg(long, conflicts_with = "endpoint")]
    tailscale: bool,
    /// Existing protected 32-byte backup key; required for server upgrades.
    #[arg(long)]
    backup_key_file: Option<PathBuf>,
    /// New backup directory outside both bundles; required for upgrades.
    #[arg(long)]
    backup_dir: Option<PathBuf>,
    #[arg(long)]
    no_install_prerequisites: bool,
    /// Resolve eligible artifacts and planned changes without installing anything.
    #[arg(long)]
    plan: bool,
    /// Accept the install plan and trial activation; requires explicit components.
    #[arg(long)]
    yes: bool,
    /// HTTPS address of the existing server for PWA setup on a client machine.
    #[arg(long)]
    server_url: Option<String>,
    /// IDs shown by Chrome/Edge after loading the extension (comma-separated).
    #[arg(long, value_delimiter = ',', value_parser = extension_setup::parse_id)]
    extension_ids: Vec<String>,
    /// Installed native connector executable, if it cannot be found automatically.
    #[arg(long)]
    extension_host: Option<PathBuf>,
    /// List published local servers without an invitation or installation changes.
    #[arg(long)]
    discover: bool,
    /// Update an already licensed server without activating/downloading a trial license.
    #[arg(long)]
    keep_existing_license: bool,
    #[arg(skip)]
    expected_license: Option<serde_json::Value>,
}

#[derive(Default, Serialize, Deserialize)]
struct State {
    format: u8,
    records: Vec<Record>,
    #[serde(default)]
    pending_upgrade: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    preserved_server_setups: Vec<Record>,
}
#[derive(Serialize, Deserialize)]
struct Record {
    product: Product,
    digest: String,
    directory: PathBuf,
    complete: bool,
    engine: Option<String>,
    provider: Option<PathBuf>,
}
impl State {
    fn load(root: &Path) -> Result<Self> {
        let path = root.join("installation.json");
        if !path.exists() {
            return Ok(Self {
                format: 1,
                records: vec![],
                pending_upgrade: None,
                preserved_server_setups: vec![],
            });
        }
        let state: Self = serde_json::from_slice(&fs::read(path)?)?;
        if state.format != 1 {
            return Err("Unsupported installer state format".into());
        }
        Ok(state)
    }
    fn save(&self, root: &Path) -> Result<()> {
        let mut file = AtomicWriteFile::open(root.join("installation.json"))?;
        file.write_all(&serde_json::to_vec_pretty(self)?)?;
        file.commit()?;
        Ok(())
    }
    fn record(&mut self, record: Record) {
        self.records.retain(|r| r.product != record.product);
        self.records.push(record);
    }
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    protocol_version: u8,
    artifacts: Vec<Artifact>,
    source_revision: String,
    installation_id: Option<String>,
}

fn validate_network_selection(args: &Args, state: &State) -> Result<()> {
    if let Some(hostname) = &args.hostname {
        let valid = hostname.len() <= 253
            && hostname.contains('.')
            && !hostname.ends_with(".local")
            && !hostname.ends_with(".localhost")
            && hostname.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            });
        if !valid
            || (!args.tailscale
                && args
                    .endpoint
                    .as_deref()
                    .is_none_or(|e| matches!(e, "localhost" | "127.0.0.1")))
        {
            return Err("Use an exact lowercase DNS hostname with --endpoint PRIVATE-IP or --tailscale; .local/.localhost aliases are unsupported".into());
        }
    }
    if let Some(endpoint) = &args.endpoint {
        let private = endpoint == "localhost"
            || endpoint.parse::<std::net::Ipv4Addr>().is_ok_and(|address| {
                address == std::net::Ipv4Addr::LOCALHOST || address.is_private()
            });
        if !private {
            return Err("Use localhost, 127.0.0.1 or a private LAN IPv4 endpoint. Use --tailscale for native tailnet discovery".into());
        }
    }
    if args.endpoint.is_none() && !args.tailscale && args.hostname.is_none() {
        return Ok(());
    }
    if !args.components.contains(&Product::Server) {
        return Err("--endpoint and --tailscale apply only to server installations".into());
    }
    let existing = state
        .records
        .iter()
        .find(|record| record.product == Product::Server);
    let directory = args
        .from
        .as_ref()
        .or(existing.map(|record| &record.directory));
    if let Some(directory) = directory.filter(|path| path.join(".env").exists()) {
        let config = fs::read_to_string(directory.join(".env"))?;
        let endpoint = config
            .lines()
            .find_map(|line| line.strip_prefix("VAULTS_ENDPOINT_HOST="));
        let address = config
            .lines()
            .find_map(|line| line.strip_prefix("VAULTS_NETWORK_ADDRESS="))
            .or(endpoint);
        let tailnet = config
            .lines()
            .any(|line| line == "VAULTS_ACCESS_MODE=tailscale");
        if (args.tailscale && !tailnet)
            || args
                .endpoint
                .as_deref()
                .is_some_and(|requested| Some(requested) != address)
            || args
                .hostname
                .as_deref()
                .is_some_and(|requested| Some(requested) != endpoint)
        {
            return Err("Existing server network settings are preserved. Changing endpoint or enabling Tailscale requires a separate backed-up network migration; omit the new network flags to upgrade".into());
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = execute(Args::parse()) {
        let _ = cliclack::outro_cancel(error.to_string());
        std::process::exit(1);
    }
}

#[allow(clippy::too_many_lines)] // Sequential orchestration; helpers own side effects.
fn execute(mut args: Args) -> Result<()> {
    if args.discover {
        println!(
            "{}",
            serde_json::to_string_pretty(&discovery::discover(args.engine.as_deref())?)?
        );
        return Ok(());
    }
    cliclack::intro("127Vaults · Setup")?;
    let interactive = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    if args.components.is_empty() {
        if args.yes || !interactive {
            return Err(
                "Specify --components server,desktop,extension,cli,pwa for noninteractive use"
                    .into(),
            );
        }
        args.components = cliclack::multiselect("Which apps belong on this machine?")
            .item(
                Product::Server,
                "Server",
                "Private server, database and web app",
            )
            .item(Product::Desktop, "Desktop", "Native vault client")
            .item(
                Product::Extension,
                "Browser extension",
                "Install extension and connect it to Desktop or CLI",
            )
            .item(Product::Cli, "CLI", "Terminal client and native connector")
            .item(
                Product::Pwa,
                "PWA",
                "Install the server web app through your browser",
            )
            .initial_values(vec![Product::Server])
            .interact()?;
    }
    args.components.sort_by_key(|p| match p {
        Product::Server => 0,
        Product::Desktop => 1,
        Product::Cli => 2,
        Product::Extension => 3,
        Product::Pwa => 4,
    });
    args.components.dedup();
    if args.from.is_some() && !args.components.contains(&Product::Server) {
        return Err("--from applies to server installations; include --components server".into());
    }
    if args.keep_existing_license && !args.components.contains(&Product::Server) {
        return Err("--keep-existing-license requires an existing server selection".into());
    }
    let invitation = match args.invitation.take() {
        Some(value) => Invitation::parse(&value)?,
        None if interactive => {
            Invitation::parse(&cliclack::password("Paste your private invitation URL").interact()?)?
        }
        None => return Err("Provide VAULTS_INSTALL_INVITATION or --invitation".into()),
    };
    let root = args.directory.clone().unwrap_or(
        dirs::data_local_dir()
            .ok_or("Cannot locate local data directory")?
            .join("127Vaults/installer"),
    );
    let root = std::path::absolute(root)?;
    let initial_state = fs::read(root.join("installation.json")).ok();
    let mut state = State::load(&root)?;
    if let Some(path) = &state.pending_upgrade {
        return Err(format!("Interrupted upgrade needs recovery. Inspect {} and the previous server; reconcile installation.json only after verifying identity, data, license and health", path.display()).into());
    }
    if args.components.contains(&Product::Server) && args.from.is_none() {
        reconcile_server(&mut args, &mut state)?;
    }
    if interactive
        && !args.yes
        && !args.plan
        && args.components.contains(&Product::Server)
        && args.from.is_none()
        && args.endpoint.is_none()
        && !args.tailscale
        && args.hostname.is_none()
        && !state.records.iter().any(|record| {
            record.product == Product::Server
                && (record.complete || record.directory.join(".env").exists())
        })
    {
        choose_server_network(&mut args)?;
    }
    validate_network_selection(&args, &state)?;
    if let Some(path) = &args.compose_provider {
        args.compose_provider = Some(fs::canonicalize(path)?);
    }
    if let Some(from) = &args.from {
        if args.engine.is_none() {
            return Err("Adopting an existing server requires --engine podman|docker to preserve its engine".into());
        }
        if state
            .records
            .iter()
            .any(|r| r.product == Product::Server && r.complete)
        {
            return Err(
                "Server already tracked; omit --from and use the recorded installation".into(),
            );
        }
        let from = fs::canonicalize(from)?;
        if !from.join(".env").is_file() || !from.join("install.mjs").is_file() {
            return Err("--from must be an existing initialized server bundle".into());
        }
        state.record(Record {
            product: Product::Server,
            digest: String::new(),
            directory: from,
            complete: true,
            engine: args.engine.clone(),
            provider: args.compose_provider.clone(),
        });
    }
    let api = transport::Api::new(invitation)?;
    let release: Release = api.request("installer", None)?.json()?;
    if release.protocol_version != 1 || release.source_revision.len() < 40 {
        return Err("Invalid release metadata".into());
    }
    if args.components.contains(&Product::Server) {
        let binding = verify_invitation_binding(&state, release.installation_id.as_deref());
        if args.keep_existing_license || binding.is_err() {
            let record = state
                .records
                .iter()
                .find(|r| r.product == Product::Server && r.complete)
                .ok_or(
                    "Keeping an existing license requires a discovered/adopted initialized server",
                )?;
            let license = discovery::existing_license(
                &record.directory,
                record.engine.as_deref().unwrap_or_default(),
            )?;
            if !args.keep_existing_license {
                if !interactive || args.yes {
                    return Err("This invitation activates another installation. To use it only for authorized package downloads while retaining this server's active license, rerun with --keep-existing-license".into());
                }
                args.keep_existing_license = cliclack::confirm(format!(
                    "This machine already has an active {} license. Keep it and use the invitation only for package downloads? No trial activation or rebinding will occur.",
                    license["plan"].as_str().unwrap_or_default())).interact()?;
                if !args.keep_existing_license {
                    binding?;
                }
            }
            args.expected_license = Some(license);
            cliclack::log::info(
                "Keep this server's existing license. Package access uses the invitation; trial activation and license replacement are skipped",
            )?;
        } else {
            binding?;
            // Keep an already active license instead of reinstalling its signed sequence.
            if release.installation_id.is_some()
                && let Some(record) = state
                    .records
                    .iter()
                    .find(|r| r.product == Product::Server && r.complete)
                && let Ok(license) = discovery::existing_license(
                    &record.directory,
                    record.engine.as_deref().unwrap_or_default(),
                )
            {
                args.keep_existing_license = true;
                args.expected_license = Some(license);
                cliclack::log::info(
                    "Keep this server's existing license. This invitation already belongs to this installation; no activation or license replacement is needed",
                )?;
            }
        }
    }
    let mut selected = Vec::new();
    for &product in &args.components {
        if product == Product::Pwa {
            continue;
        }
        let asset = select_artifact(
            &release.artifacts,
            product,
            std::env::consts::OS,
            std::env::consts::ARCH,
        )?;
        let existing = state.records.iter().find(|r| r.product == product);
        if existing.is_some_and(|r| !r.complete && r.digest != asset.sha256) {
            return Err("Incomplete installation uses an older artifact. Recover it before selecting another release".into());
        }
        let action = if existing.is_some_and(|r| r.complete && r.digest == asset.sha256) {
            "Check existing installation"
        } else if existing.is_some_and(|r| r.complete) {
            "Upgrade"
        } else {
            "Install / resume"
        };
        cliclack::log::info(format!(
            "{action}: {} ({} MiB)",
            asset.filename,
            asset.size_bytes / 1_048_576
        ))?;
        selected.push((product, asset));
    }
    let upgrade = selected.iter().any(|(product, asset)| {
        *product == Product::Server
            && state
                .records
                .iter()
                .any(|r| r.product == Product::Server && r.complete && r.digest != asset.sha256)
    });
    let home = dirs::home_dir().ok_or("Cannot locate the home directory for recovery settings")?;
    let recovery = state
        .records
        .iter()
        .find(|r| r.product == Product::Server)
        .filter(|r| {
            args.components.contains(&Product::Server) && r.directory.join(".env").is_file()
        })
        .map(|r| backups::plan(&home, &r.directory, args.backup_key_file.as_deref()))
        .transpose()?;
    if let Some(record) = &recovery {
        args.backup_key_file = Some(record.key_file.clone());
        if upgrade {
            if args.backup_dir.is_none() {
                args.backup_dir = Some(
                    record
                        .backup_root
                        .join(format!("upgrade-{}", uuid::Uuid::new_v4())),
                );
            }
            if args.backup_dir.as_ref().is_some_and(|p| p.exists()) {
                return Err("Upgrade backup directory must be new".into());
            }
        }
        cliclack::log::info(format!(
            "Backup key ({}): {}\nBackup folder: {}",
            if record.key_file.exists() {
                "reuse"
            } else {
                "generate securely after confirmation"
            },
            record.key_file.display(),
            args.backup_dir
                .as_ref()
                .unwrap_or(&record.backup_root)
                .display()
        ))?;
    }
    if args.components.contains(&Product::Pwa) {
        if !args.components.contains(&Product::Server) && args.server_url.is_none() {
            return Err(
                "Client-only PWA setup requires --server-url https://your-private-server".into(),
            );
        }
        if let Some(url) = &args.server_url {
            let parsed = url::Url::parse(url)?;
            if parsed.scheme() != "https"
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err("PWA requires an HTTPS server URL without credentials".into());
            }
        }
        cliclack::log::info(
            "PWA uses the server's web app; no separate runtime or download is needed",
        )?;
    }
    if args.plan {
        cliclack::outro("Plan complete; no local installation changes made")?;
        return Ok(());
    }
    let confirmation = if state
        .records
        .iter()
        .any(|r| r.product == Product::Server && r.complete)
    {
        "Proceed with this update plan? Existing server identity, data and trial expiry are preserved. Missing prerequisites will be installed."
    } else {
        "Proceed with this plan? Fresh server activation starts the trial's 10 days. Missing prerequisites will be installed."
    };
    if !args.yes && (!interactive || !cliclack::confirm(confirmation).interact()?) {
        return Err(
            "Installation cancelled; use --yes with explicit components for automation".into(),
        );
    }
    fs::create_dir_all(&root)?;
    let lock = root.join("installer.lock");
    let mut file = OpenOptions::new().write(true).create_new(true).open(&lock).map_err(|_| "Installer lock exists. If no installer is running, inspect the interrupted installation before removing installer.lock")?;
    let _lock = Lock(lock);
    writeln!(file, "{}", std::process::id())?;
    if fs::read(root.join("installation.json")).ok() != initial_state {
        return Err("Installation state changed while preparing the plan; rerun to inspect the updated installation".into());
    }
    // Reload under the lock so another invocation cannot silently replace newer state.
    // The unchanged on-disk snapshot was checked above. Keep the read-only
    // discovery/adoption decisions prepared before confirmation.
    state.save(&root)?;
    let has_server = args.components.contains(&Product::Server);
    let node = if has_server {
        Some(prerequisites::node(&root, !args.no_install_prerequisites)?)
    } else {
        None
    };
    let prior = state.records.iter().find(|r| r.product == Product::Server);
    let recorded_engine = prior.and_then(|r| r.engine.clone());
    let engine = if has_server {
        prerequisites::choose_engine(args.engine.as_deref().or(recorded_engine.as_deref()))
    } else {
        String::new()
    };
    if let (Some(old), Some(new)) = (&recorded_engine, &args.engine)
        && old != new
    {
        return Err(
            "Changing the engine of an existing server requires a separate migration".into(),
        );
    }
    if args.compose_provider.is_none() {
        args.compose_provider = prior.and_then(|r| r.provider.clone());
    }
    if has_server {
        prerequisites::engine(
            &engine,
            &mut args.compose_provider,
            &root,
            !args.no_install_prerequisites,
        )?;
        if let Some(record) = &recovery {
            let directory = state
                .records
                .iter()
                .find(|r| r.product == Product::Server)
                .ok_or("Missing server")?;
            backups::prepare(record, node.as_ref().unwrap(), &directory.directory)?;
        }
    }
    let mut server_directory = None;
    for (product, asset) in selected {
        let old = state.records.iter().find(|r| r.product == product);
        if let Some(record) = old.filter(|r| r.complete && r.digest == asset.sha256) {
            if !record.directory.is_dir() {
                return Err("Recorded installation is missing; restore it before retrying".into());
            }
            if product == Product::Server {
                server_directory = Some(record.directory.clone());
                finish_license(
                    &api,
                    &release,
                    node.as_ref().unwrap(),
                    &record.directory,
                    &args,
                    &engine,
                )?;
            }
            cliclack::log::success(format!("{} is current", product.name()))?;
            continue;
        }
        let old_directory = old.filter(|r| r.complete).map(|r| r.directory.clone());
        if product == Product::Server
            && old_directory.is_some()
            && (args.backup_dir.is_none() || args.backup_key_file.is_none())
        {
            return Err("Server upgrade requires --backup-dir NEW-DIRECTORY and --backup-key-file EXISTING-32-BYTE-KEY".into());
        }
        let pending = old
            .filter(|r| !r.complete && r.digest == asset.sha256)
            .map(|r| r.directory.clone());
        let mut directory = if let Some(path) = pending {
            path
        } else {
            let work = root.join(format!("{}-{}", product.name(), uuid::Uuid::new_v4()));
            fs::create_dir(&work)?;
            let download = work.join(&asset.filename);
            let spinner = cliclack::spinner();
            spinner.start(format!("Downloading and verifying {}", asset.filename));
            api.download(&asset, &download)?;
            spinner.stop("SHA-256 and size verified");
            let extracted = work.join("app");
            if asset.filename.ends_with(".zip")
                || asset.filename.ends_with(".tar.gz")
                || asset.filename.ends_with(".tar")
            {
                archive::extract(&download, &extracted, false)?;
                archive::find(
                    &extracted,
                    match product {
                        Product::Server => "install.mjs",
                        Product::Extension => "manifest.json",
                        Product::Cli => {
                            if cfg!(windows) {
                                "127vaults.exe"
                            } else {
                                "127vaults"
                            }
                        }
                        _ => return Err("Unexpected archive format".into()),
                    },
                )?
            } else {
                work
            }
        };
        if product == Product::Server && args.hostname.is_some() {
            let supported = fs::read_to_string(directory.join("lib/private-network.mjs"))
                .is_ok_and(|source| source.contains("verifyHostnameAddress"));
            if !supported {
                return Err("This catalogue server does not support custom DNS yet. Deployed 0.1.7 can be installed/upgraded without --hostname; use a future DNS-capable server release for this option. Downloaded bytes were not modified".into());
            }
        }
        if matches!(product, Product::Cli | Product::Extension)
            && let Some(previous) = old_directory.as_ref()
        {
            state.pending_upgrade = Some(directory.clone());
            state.save(&root)?;
            replace_staged(&directory, previous, &root)?;
            directory.clone_from(previous);
            state.pending_upgrade = None;
        }
        // Keep the old server receipt until upgrade succeeds; recovery must never
        // reinterpret a half-completed upgrade as a fresh install.
        if old_directory.is_none() || product != Product::Server {
            state.record(Record {
                product,
                digest: asset.sha256.clone(),
                directory: directory.clone(),
                complete: false,
                engine: Some(engine.clone()),
                provider: args.compose_provider.clone(),
            });
            state.save(&root)?;
        }
        match product {
            Product::Server => {
                let node = node.as_ref().unwrap();
                if let Some(old) = old_directory {
                    state.pending_upgrade = Some(directory.clone());
                    state.save(&root)?;
                    let mut command = Command::new(node);
                    command
                        .current_dir(&directory)
                        .args(["install.mjs", "upgrade", "--from"])
                        .arg(old)
                        .arg("--backup-dir")
                        .arg(std::path::absolute(args.backup_dir.as_ref().unwrap())?)
                        .arg("--backup-key-file")
                        .arg(fs::canonicalize(args.backup_key_file.as_ref().unwrap())?);
                    add_options(&mut command, &args, &engine, false);
                    prerequisites::run(&mut command)?;
                    state.pending_upgrade = None;
                } else {
                    discovery::check_fresh_port(args.endpoint.as_deref(), args.tailscale)?;
                    let mut command = Command::new(node);
                    command
                        .current_dir(&directory)
                        .args(["install.mjs", "setup"]);
                    add_options(&mut command, &args, &engine, true);
                    // Each fresh installation gets its own identity outside the bundle.
                    // Never silently reuse the legacy global ~/.127vaults-test keys.
                    if !directory.join(".env").exists() {
                        command.arg("--private-dir").arg(
                            root.join("identities")
                                .join(uuid::Uuid::new_v4().to_string()),
                        );
                    }
                    prerequisites::run(&mut command)?;
                }
                // Save successful setup/upgrade before license network access, so a
                // disconnected trial service can be retried without another upgrade.
                state.record(Record {
                    product,
                    digest: asset.sha256.clone(),
                    directory: directory.clone(),
                    complete: true,
                    engine: Some(engine.clone()),
                    provider: args.compose_provider.clone(),
                });
                state.save(&root)?;
                if recovery.is_none() {
                    let record = backups::plan(&home, &directory, args.backup_key_file.as_deref())?;
                    backups::prepare(&record, node, &directory)?;
                }
                finish_license(&api, &release, node, &directory, &args, &engine)?;
                server_directory = Some(directory.clone());
            }
            Product::Desktop => {
                prerequisites::desktop(!args.no_install_prerequisites)?;
                let package = directory.join(&asset.filename);
                if transport::file_hash(&package)? != asset.sha256 {
                    return Err(
                        "Desktop package changed since download; refusing to execute it".into(),
                    );
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&package, fs::Permissions::from_mode(0o700))?;
                }
                if cfg!(windows) {
                    prerequisites::run(Command::new(&package).arg("/S"))?;
                } else if cfg!(target_os = "macos") {
                    prerequisites::run(Command::new("open").arg(&package))?;
                } else {
                    let launcher = root.join("127vaults-desktop.AppImage");
                    let mut output = AtomicWriteFile::open(&launcher)?;
                    std::io::copy(&mut fs::File::open(&package)?, &mut output)?;
                    output.commit()?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700))?;
                    }
                    cliclack::log::info(format!(
                        "Stable Desktop launcher: {}",
                        launcher.display()
                    ))?;
                }
                cliclack::log::info(format!(
                    "Desktop package: {}{}",
                    package.display(),
                    if cfg!(target_os = "macos") {
                        ". Finish dragging the app into Applications."
                    } else {
                        ""
                    }
                ))?;
            }
            Product::Extension => cliclack::note(
                "Browser approval required",
                format!(
                    "Open chrome://extensions or edge://extensions, enable Developer mode, choose Load unpacked, and select {}. Keep this folder in place.",
                    directory.display()
                ),
            )?,
            Product::Cli => cliclack::log::info(format!(
                "CLI installed at {}. Add this folder to PATH. Follow its README to register the native connector.",
                directory.display()
            ))?,
            Product::Pwa => {}
        }
        state.record(Record {
            product,
            digest: asset.sha256,
            directory,
            complete: product != Product::Extension,
            engine: Some(engine.clone()),
            provider: args.compose_provider.clone(),
        });
        state.save(&root)?;
        cliclack::log::success(format!("{} package installed", product.name()))?;
    }
    if let Some(directory) = server_directory {
        guide_server_owner(
            node.as_ref().ok_or("Server runtime unavailable")?,
            &directory,
            &args,
            &engine,
            interactive && !args.yes,
        )?;
    }
    if args.components.contains(&Product::Extension) {
        let index = state
            .records
            .iter()
            .position(|r| r.product == Product::Extension)
            .ok_or("Extension package is missing")?;
        // Older receipts marked extraction as complete; require connector setup too.
        state.records[index].complete = false;
        state.save(&root)?;
        let candidates: Vec<_> = state
            .records
            .iter()
            .filter(|r| matches!(r.product, Product::Cli | Product::Desktop) && r.complete)
            .map(|r| r.directory.clone())
            .collect();
        extension_setup::setup(
            &root,
            &state.records[index].directory,
            &args.extension_ids,
            args.extension_host.as_deref(),
            &candidates,
            interactive,
        )?;
        state.records[index].complete = true;
        state.save(&root)?;
    }
    if args.components.contains(&Product::Pwa) {
        cliclack::note(
            "Install the PWA",
            format!(
                "Open {} in your browser after verifying and trusting the server CA, then choose Install app / Add to Dock. Browser approval completes installation.",
                args.server_url
                    .as_deref()
                    .unwrap_or("the server's reported HTTPS address")
            ),
        )?;
    }
    cliclack::outro("Setup complete. Keep the installed folders and your protected backups.")?;
    Ok(())
}

fn choose_server_network(args: &mut Args) -> Result<()> {
    let mode = cliclack::select("Who needs to reach this vault?")
        .item(
            "loopback",
            "This computer only",
            "Keep the vault on this computer",
        )
        .item(
            "lan",
            "Devices on my home network",
            "Use this server’s private IPv4 address",
        )
        .item(
            "tailscale",
            "Devices on my Tailscale network",
            "Use Tailscale already installed and signed in on this server",
        )
        .interact()?;
    args.tailscale = mode == "tailscale";
    if mode == "lan" {
        args.endpoint = Some(cliclack::input("Private IPv4 address of this server")
            .validate(|value: &String| value.parse::<std::net::Ipv4Addr>().ok()
                .filter(std::net::Ipv4Addr::is_private).map(|_| ()).ok_or("Enter this computer’s private LAN IPv4 address, for example 192.168.1.20."))
            .interact()?);
    }
    Ok(())
}

fn reconcile_server(args: &mut Args, state: &mut State) -> Result<()> {
    let servers = discovery::discover(args.engine.as_deref())?;
    reconcile_discovered(args, state, servers)
}

fn reconcile_discovered(
    args: &mut Args,
    state: &mut State,
    servers: Vec<discovery::Server>,
) -> Result<()> {
    if servers.len() > 1 {
        let paths = servers
            .iter()
            .map(|s| format!("{} ({})", s.directory.display(), s.engine))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("Multiple published servers found. Select the intended initialized bundle with --from and --engine; preserve all installations:\n{paths}").into());
    }
    let old = state.records.iter().find(|r| r.product == Product::Server);
    if let Some(server) = servers.into_iter().next() {
        let matches = old.is_some_and(|r| {
            fs::canonicalize(&r.directory).ok().as_ref() == Some(&server.directory)
        });
        if !matches {
            if old.is_some_and(|r| r.complete) {
                return Err("The recorded server differs from the running server. Inspect both installations and explicitly select the intended state directory; neither was modified".into());
            }
            if let Some(record) = old {
                cliclack::log::warning(format!(
                    "An incomplete separate setup is preserved at {}. The published server will be updated instead",
                    record.directory.display()
                ))?;
            }
            if let Some(index) = state
                .records
                .iter()
                .position(|r| r.product == Product::Server)
            {
                let preserved = state.records.remove(index);
                state.preserved_server_setups.push(preserved);
            }
            cliclack::log::info(format!(
                "Found existing server: {}. Preserve its identity, database, CA, license and admin account",
                server.directory.display()
            ))?;
            args.engine = Some(server.engine.clone());
            state.record(Record {
                product: Product::Server,
                digest: String::new(),
                directory: server.directory,
                complete: true,
                engine: Some(server.engine),
                provider: args.compose_provider.clone(),
            });
        }
    } else if old.is_none_or(|r| !r.complete) {
        discovery::check_fresh_port(args.endpoint.as_deref(), args.tailscale)?;
    }
    Ok(())
}

fn verify_invitation_binding(state: &State, binding: Option<&str>) -> Result<()> {
    let Some(expected) = binding else {
        return Ok(());
    };
    let record = state.records.iter().find(|r| r.product == Product::Server)
        .ok_or("This invitation is already bound to an installation. Start/adopt that server with --from; a replacement requires approval")?;
    let config = fs::read_to_string(record.directory.join(".env"))?;
    let private = config
        .lines()
        .find_map(|line| line.strip_prefix("VAULTS_TLS_DIR="))
        .ok_or("Missing existing installation identity directory")?;
    let actual = fs::read_to_string(Path::new(private).join("installation-id"))?;
    if actual.trim() != expected {
        return Err("Invitation is bound to another installation. No upgrade or new identity was started; select the matching server or request an approved replacement".into());
    }
    Ok(())
}

fn add_options(command: &mut Command, args: &Args, engine: &str, fresh: bool) {
    if engine == "docker" {
        command.arg("--docker");
    }
    if let Some(provider) = &args.compose_provider {
        command.arg("--compose-provider").arg(provider);
    }
    if fresh {
        if let Some(endpoint) = &args.endpoint {
            command.arg("--endpoint").arg(endpoint);
        }
        if args.tailscale {
            command.arg("--tailscale");
        }
        if let Some(hostname) = &args.hostname {
            command.arg("--hostname").arg(hostname);
        }
    }
}

fn finish_license(
    api: &transport::Api,
    release: &Release,
    node: &Path,
    directory: &Path,
    args: &Args,
    engine: &str,
) -> Result<()> {
    if args.keep_existing_license {
        let actual = discovery::existing_license(directory, engine)?;
        if args.expected_license.as_ref() != Some(&actual) {
            return Err("Existing installation/license changed during the update. Preserve backups and inspect the running server; no trial license was installed".into());
        }
        cliclack::log::success(
            "Existing license, installation binding and expiry preserved; no trial activation or license download",
        )?;
        return Ok(());
    }
    let mut identify = Command::new(node);
    identify
        .current_dir(directory)
        .args(["server.mjs", "install", "identify"]);
    add_options(&mut identify, args, engine, false);
    existing_identity_options(&mut identify, directory)?;
    let output = identify.output()?;
    if !output.status.success() {
        return Err("Cannot read the running installation identity; restore server health before binding a license".into());
    }
    let text = String::from_utf8(output.stdout)?;
    let id = text
        .lines()
        .find_map(|line| line.strip_prefix("Installation ID: "))
        .ok_or("Missing installation ID")?;
    uuid::Uuid::parse_str(id)?;
    if release
        .installation_id
        .as_deref()
        .is_some_and(|existing| existing != id)
    {
        return Err("Invitation is bound to another installation. Use its existing server or request an approved replacement".into());
    }
    api.request("activate", Some(&serde_json::json!({"installationId": id})))?;
    let license = api.request("license", None)?.bytes()?;
    if license.len() > 65536 {
        return Err("Unexpected license size".into());
    }
    let path = directory.join(format!("trial-license-{}.json", uuid::Uuid::new_v4()));
    fs::write(&path, license)?;
    let result = (|| -> Result<()> {
        let mut install = Command::new(node);
        install
            .current_dir(directory)
            .args(["server.mjs", "install", "license", "--file"])
            .arg(&path);
        add_options(&mut install, args, engine, false);
        existing_identity_options(&mut install, directory)?;
        prerequisites::run(&mut install)?;
        let mut start = Command::new(node);
        start
            .current_dir(directory)
            .args(["server.mjs", "install", "start"]);
        add_options(&mut start, args, engine, false);
        existing_identity_options(&mut start, directory)?;
        prerequisites::run(&mut start)
    })();
    let _ = fs::remove_file(path);
    result
}

fn existing_identity_options(command: &mut Command, directory: &Path) -> Result<()> {
    let config = fs::read_to_string(directory.join(".env"))?;
    let private = config
        .lines()
        .find_map(|line| line.strip_prefix("VAULTS_TLS_DIR="))
        .ok_or("Missing existing private identity directory")?;
    command.arg("--private-dir").arg(private);
    if config
        .lines()
        .any(|line| line == "VAULTS_ACCESS_MODE=tailscale")
    {
        command.arg("--tailscale");
    }
    Ok(())
}

fn guide_server_owner(
    node: &Path,
    directory: &Path,
    args: &Args,
    engine: &str,
    interactive: bool,
) -> Result<()> {
    let config = fs::read_to_string(directory.join(".env"))?;
    let field = |prefix| config.lines().find_map(|line| line.strip_prefix(prefix));
    let endpoint = field("VAULTS_ENDPOINT_HOST=").ok_or("Missing server address")?;
    let port = field("VAULTS_PUBLISH_PORT=")
        .unwrap_or("12780")
        .parse::<u16>()?;
    let origin = url::Url::parse(&format!("https://{endpoint}:{port}/"))?;
    if origin.host_str() != Some(endpoint)
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.port_or_known_default() != Some(port)
    {
        return Err("Invalid configured server address".into());
    }
    let private_dir = field("VAULTS_TLS_DIR=").ok_or("Missing private identity directory")?;
    let ca = directory.join(private_dir).join("ca").join("ca.crt");
    let fingerprint = transport::file_hash(&ca)?;
    let installation = fs::read_to_string(directory.join(private_dir).join("installation-id"))
        .ok()
        .and_then(|value| uuid::Uuid::parse_str(value.trim()).ok())
        .map_or_else(String::new, |id| format!("Installation ID: {id}\n"));
    cliclack::note(
        "Connect to your server",
        format!(
            "Server address: {origin}\n{installation}Public CA certificate: {}\nCA file SHA-256: {fingerprint}\nVerify this file and add it to your operating system or browser trust store. Open the server address after your browser trusts it.",
            ca.display()
        ),
    )?;
    let admin_origin = if field("VAULTS_ACCESS_MODE=") == Some("loopback") {
        Some(origin.join("admin/")?)
    } else if field("VAULTS_LOCAL_ADMIN=") == Some("1") {
        Some(url::Url::parse("https://127.0.0.1:12781/admin/")?)
    } else {
        None
    };
    if let Some(admin_origin) = admin_origin {
        let operator_file = directory
            .join(private_dir)
            .join("runtime")
            .join("admin-operators.json");
        guide_local_admin(node, directory, args, engine, interactive, &operator_file)?;
        cliclack::note(
            "Local administration",
            if operator_file.is_file() {
                format!(
                    "Open {admin_origin} on this computer after trusting the CA. Use your local operator credentials to manage users, invitations and devices. Share the vault address with your household."
                )
            } else {
                "To set up a local operator later, rerun the installer interactively and select Server.".to_owned()
            },
        )?;
    }
    let mut start = Command::new(node);
    start
        .current_dir(directory)
        .args(["server.mjs", "install", "start"]);
    add_options(&mut start, args, engine, false);
    existing_identity_options(&mut start, directory)?;
    enrollment_email::guide(
        &directory.join(".env"),
        &directory
            .join(private_dir)
            .join("runtime")
            .join("smtp-password"),
        interactive,
        || prerequisites::run(&mut start),
    )?;
    guide_owner_enrollment(node, directory, args, engine, interactive, &origin)
}

fn guide_owner_enrollment(
    node: &Path,
    directory: &Path,
    args: &Args,
    engine: &str,
    interactive: bool,
    origin: &url::Url,
) -> Result<()> {
    let mut bootstrap = Command::new(node);
    bootstrap
        .current_dir(directory)
        .args(["server.mjs", "install", "bootstrap"]);
    add_options(&mut bootstrap, args, engine, false);
    existing_identity_options(&mut bootstrap, directory)?;
    if interactive
        && cliclack::confirm("Generate a first-owner setup code if this server still needs one?")
            .interact()?
    {
        if let Ok(output) = bootstrap.bounded_output()
            && output.status.success()
            && let Ok(text) = String::from_utf8(output.stdout)
        {
            if text
                .lines()
                .any(|line| line == "Owner already exists; bootstrap is closed.")
            {
                cliclack::log::info(
                    "An owner is already enrolled. Open the server address to sign in.",
                )?;
                return Ok(());
            }
            if let Some(code) = owner_setup_code(&text) {
                let mut setup_url = origin.clone();
                setup_url.set_fragment(Some(&format!("ownerSetup={code}")));
                cliclack::note(
                    "Create your vault owner",
                    format!(
                        "After trusting the CA, open this private setup link within 60 minutes:\n{setup_url}\nIf the vault asks for a code, enter {code}. Keep the link and code private."
                    ),
                )?;
                return Ok(());
            }
        }
        cliclack::log::warning(
            "Owner setup code was unavailable. Check that the server is running and the license is active.",
        )?;
    }
    let command = render_command(&bootstrap);
    cliclack::note(
        "Finish first-owner setup later",
        format!(
            "Rerun the installer interactively and select Server, or run this command from {}:\n{command}",
            directory.display()
        ),
    )?;
    Ok(())
}

fn guide_local_admin(
    node: &Path,
    directory: &Path,
    args: &Args,
    engine: &str,
    interactive: bool,
    operator_file: &Path,
) -> Result<()> {
    if operator_file.try_exists()?
        || !interactive
        || !cliclack::confirm("Set up the local administration console on this computer?")
            .interact()?
    {
        return Ok(());
    }
    let username: String = cliclack::input("Local operator username")
        .default_input("localowner")
        .validate(|value: &String| {
            if (3..=40).contains(&value.len())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                Ok(())
            } else {
                Err("Use 3–40 letters, digits, hyphens or underscores.")
            }
        })
        .interact()?;
    let password =
        cliclack::password("Choose a separate local operator password (16–256 characters)")
            .validate(|value: &String| {
                if (16..=256).contains(&value.encode_utf16().count()) {
                    Ok(())
                } else {
                    Err("Use 16–256 characters.")
                }
            })
            .interact()?;
    let confirmed_password = cliclack::password("Confirm the local operator password")
        .validate(move |value: &String| {
            if value == &password {
                Ok(())
            } else {
                Err("The passwords do not match.")
            }
        })
        .interact()?;
    prerequisites::run(
        Command::new(node)
            .current_dir(directory)
            .args(["server.mjs", "admin", "init", &username])
            .arg(operator_file)
            .env("VAULTS_ADMIN_SETUP_PASSWORD", confirmed_password),
    )?;
    for action in ["stop", "start"] {
        let mut server = Command::new(node);
        server
            .current_dir(directory)
            .args(["server.mjs", "install", action]);
        add_options(&mut server, args, engine, false);
        existing_identity_options(&mut server, directory)?;
        prerequisites::run(&mut server)?;
    }
    Ok(())
}

fn owner_setup_code(output: &str) -> Option<&str> {
    let code = output.lines().find_map(|line| {
        line.strip_prefix("One-time owner setup code (expires in 60 minutes): ")
    })?;
    let secret = code.strip_prefix("127V-B1-")?;
    (secret.len() == 43
        && secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    .then_some(code)
}

fn render_command(command: &Command) -> String {
    let quote = |value: &std::ffi::OsStr| {
        let value = value.to_string_lossy();
        format!(
            "'{}'",
            value.replace('\'', if cfg!(windows) { "''" } else { "'\\''" })
        )
    };
    let words = std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(quote)
        .collect::<Vec<_>>()
        .join(" ");
    if cfg!(windows) {
        format!("& {words}")
    } else {
        words
    }
}

fn replace_staged(staged: &Path, previous: &Path, root: &Path) -> Result<()> {
    let root = fs::canonicalize(root)?;
    let staged = fs::canonicalize(staged)?;
    let previous = fs::canonicalize(previous)?;
    if !staged.starts_with(&root)
        || !previous.starts_with(&root)
        || previous == root
        || staged == previous
    {
        return Err("Client update paths must remain inside the installer directory".into());
    }
    // Browser registration is user-approved local state, absent from release archives.
    let native_manifest = previous.join("com.127vaults.connector.json");
    if native_manifest.is_file() {
        let mut target = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(staged.join("com.127vaults.connector.json"))?;
        std::io::copy(&mut fs::File::open(native_manifest)?, &mut target)?;
    }
    let backup = previous.with_file_name(format!("previous-{}", uuid::Uuid::new_v4()));
    fs::rename(&previous, &backup)?;
    if let Err(error) = fs::rename(&staged, &previous) {
        fs::rename(&backup, &previous)?;
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owner_setup_output_accepts_only_the_expected_capability() {
        let code = format!("127V-B1-{}", "a".repeat(43));
        let output = format!("One-time owner setup code (expires in 60 minutes): {code}\r\n");
        assert_eq!(owner_setup_code(&output), Some(code.as_str()));
        assert_eq!(
            owner_setup_code("Owner already exists; bootstrap is closed."),
            None
        );
        assert_eq!(
            owner_setup_code(&format!("{output}more").replace(&code, "127V-B1-invalid")),
            None
        );
    }
    #[test]
    fn network_selection_keeps_same_mode_resumable_and_rejects_silent_migration() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        fs::write(
            root.join(".env"),
            "VAULTS_ACCESS_MODE=loopback\nVAULTS_ENDPOINT_HOST=127.0.0.1\n",
        )
        .unwrap();
        let mut state = State::load(&root).unwrap();
        state.record(Record {
            product: Product::Server,
            digest: "old".into(),
            directory: root.clone(),
            complete: true,
            engine: Some("podman".into()),
            provider: None,
        });
        let args =
            Args::try_parse_from(["installer", "--components", "server", "--tailscale"]).unwrap();
        assert!(validate_network_selection(&args, &state).is_err());
        fs::write(
            root.join(".env"),
            "VAULTS_ACCESS_MODE=tailscale\nVAULTS_ENDPOINT_HOST=100.64.0.10\n",
        )
        .unwrap();
        assert!(validate_network_selection(&args, &state).is_ok());
        let args = Args::try_parse_from([
            "installer",
            "--components",
            "server",
            "--endpoint",
            "10.0.0.11",
        ])
        .unwrap();
        assert!(validate_network_selection(&args, &state).is_err());
        fs::remove_file(root.join(".env")).unwrap();
        state.records[0].complete = false;
        assert!(validate_network_selection(&args, &state).is_ok());
        let args =
            Args::try_parse_from(["installer", "--components", "cli", "--tailscale"]).unwrap();
        assert!(validate_network_selection(&args, &State::default()).is_err());
        assert!(
            Args::try_parse_from(["installer", "--endpoint", "10.0.0.1", "--tailscale"]).is_err()
        );
        for endpoint in ["8.8.8.8", "0.0.0.0", "127.0.0.2", "example.com"] {
            let args = Args::try_parse_from([
                "installer",
                "--components",
                "server",
                "--endpoint",
                endpoint,
            ])
            .unwrap();
            assert!(validate_network_selection(&args, &State::default()).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn discovers_running_server_instead_of_resuming_unrelated_fresh_setup() {
        let mut args = Args::try_parse_from(["installer", "--components", "server"]).unwrap();
        let mut state = State::default();
        state.record(Record {
            product: Product::Server,
            digest: "failed".into(),
            directory: PathBuf::from("failed-separate-setup"),
            complete: false,
            engine: Some("podman".into()),
            provider: None,
        });
        let server = || discovery::Server {
            directory: PathBuf::from("running-server"),
            engine: "podman".into(),
            project: "vaults-test-123456abcdef".into(),
        };
        reconcile_discovered(&mut args, &mut state, vec![server()]).unwrap();
        assert_eq!(state.records[0].directory, PathBuf::from("running-server"));
        assert!(state.records[0].complete);
        assert!(state.records[0].digest.is_empty());
        assert_eq!(
            state.preserved_server_setups[0].directory,
            PathBuf::from("failed-separate-setup")
        );
        assert_eq!(args.engine.as_deref(), Some("podman"));
        assert!(reconcile_discovered(&mut args, &mut state, vec![server(), server()]).is_err());
        state.records[0].directory = PathBuf::from("another-complete-server");
        assert!(reconcile_discovered(&mut args, &mut state, vec![server()]).is_err());
        assert_eq!(
            state.records[0].directory,
            PathBuf::from("another-complete-server")
        );
    }

    #[test]
    fn bound_trial_refuses_another_identity_before_upgrade() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        fs::write(
            root.join(".env"),
            format!("VAULTS_TLS_DIR={}\n", root.display()),
        )
        .unwrap();
        fs::write(root.join("installation-id"), "known-id\n").unwrap();
        let mut state = State::default();
        assert!(verify_invitation_binding(&state, Some("known-id")).is_err());
        state.record(Record {
            product: Product::Server,
            digest: "old".into(),
            directory: root.clone(),
            complete: true,
            engine: Some("podman".into()),
            provider: None,
        });
        assert!(verify_invitation_binding(&state, Some("known-id")).is_ok());
        assert!(verify_invitation_binding(&state, Some("other-id")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn client_updates_preserve_registered_path_and_previous_contents() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let previous = root.join("registered-client");
        let staged = root.join("new");
        fs::create_dir_all(&previous).unwrap();
        fs::create_dir(&staged).unwrap();
        fs::write(previous.join("manifest.json"), b"old").unwrap();
        fs::write(
            previous.join("com.127vaults.connector.json"),
            b"approved-registration",
        )
        .unwrap();
        fs::write(staged.join("manifest.json"), b"new").unwrap();
        replace_staged(&staged, &previous, &root).unwrap();
        assert_eq!(fs::read(previous.join("manifest.json")).unwrap(), b"new");
        assert_eq!(
            fs::read(previous.join("com.127vaults.connector.json")).unwrap(),
            b"approved-registration"
        );
        let backup = fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("previous-")
            })
            .unwrap();
        assert_eq!(fs::read(backup.join("manifest.json")).unwrap(), b"old");
        assert!(replace_staged(&previous, &root, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn state_retains_interrupted_upgrade_and_atomic_receipts() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let mut state = State::load(&root).unwrap();
        state.pending_upgrade = Some(root.join("new-server"));
        state.record(Record {
            product: Product::Server,
            digest: "old".into(),
            directory: root.join("old-server"),
            complete: true,
            engine: Some("podman".into()),
            provider: None,
        });
        state.save(&root).unwrap();
        let loaded = State::load(&root).unwrap();
        assert!(loaded.pending_upgrade.is_some());
        assert_eq!(loaded.records[0].digest, "old");
        fs::write(root.join("installation.json"), b"{}").unwrap();
        assert!(State::load(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
