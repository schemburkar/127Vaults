#![forbid(unsafe_code)]

mod agent;
mod desktop_profile;
mod devices;
pub use desktop_profile::desktop_profile_directory;
pub use devices::DeviceCommand;
mod generator;
pub mod native_passkeys;
mod passkeys;
use generator::generate_command;
pub use generator::{GenerateCommand, generate_secret};
pub mod client;
pub mod extension_host;
pub mod replica;
mod sync_transport;
pub mod tailscale;
pub mod vault_settings;

/// Starts a local unlock agent that the read-only extension connector can use.
///
/// # Errors
/// Returns a safe diagnostic if the agent cannot start.
pub fn start_connector_agent(
    executable: &std::path::Path,
    config_dir: &std::path::Path,
    username: &str,
    account_secret: &str,
    master_password: &[u8],
) -> Result<(), String> {
    agent::start_with_executable(
        executable,
        config_dir,
        username,
        account_secret,
        master_password,
        true,
    )
}

/// Reports whether this profile already has an unlocked local agent.
#[must_use]
pub fn connector_agent_active(config_dir: &std::path::Path) -> bool {
    agent::call(config_dir, "status", serde_json::json!({})).is_ok()
}

/// Keep an owned connector available during actual desktop interaction.
pub fn touch_connector_agent(config_dir: &std::path::Path) {
    let _ = agent::call(config_dir, "replica.status", serde_json::json!({}));
}

/// Reports whether the unlocked agent supports native OS passkey operations.
#[must_use]
pub fn connector_agent_native_capable(config_dir: &std::path::Path) -> bool {
    agent::call(config_dir, "status", serde_json::json!({}))
        .is_ok_and(|status| status["nativePasskeyProtocol"] == 4)
}

/// Locks a local agent started by this application.
pub fn stop_connector_agent(config_dir: &std::path::Path) {
    let _ = agent::call(config_dir, "logout", serde_json::json!({}));
}

use std::{
    fmt::Write as _,
    fs,
    fs::OpenOptions,
    io::{self, Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::PathBuf,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::{Args, Parser, Subcommand};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use zeroize::Zeroizing;

#[derive(Debug, Parser)]
#[command(
    name = "127vaults",
    version = option_env!("VAULTS_PACKAGE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")),
    about = "Official 127Vaults private-beta client"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Generate a local cryptographically random secret (printed to stdout).
    Generate {
        #[command(subcommand)]
        command: GenerateCommand,
    },
    /// Validate an installation endpoint and trust material.
    Server {
        #[command(subcommand)]
        command: ServerCommand,
    },
    /// Enroll this CLI and manage this account's trusted devices.
    Device {
        #[command(subcommand)]
        command: DeviceCommand,
    },
    /// Log in, optionally enrolling this CLI first.
    Login {
        username: String,
        #[arg(long)]
        enroll: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    #[command(hide = true)]
    AgentServe {
        #[arg(long)]
        username: String,
        #[arg(long)]
        config_dir: PathBuf,
        #[arg(long)]
        read_only: bool,
    },
    /// Verify an interactive unlock, then discard the session and keys.
    Unlock {
        #[arg(long)]
        username: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Encrypted vault operations.
    Vault {
        #[command(subcommand)]
        command: VaultCommand,
    },
    Collection {
        #[command(subcommand)]
        command: CollectionCommand,
    },
    /// Encrypted item operations.
    Item {
        #[command(subcommand)]
        command: ItemCommand,
    },
    /// Upload queued edits and refresh verified encrypted replicas.
    Sync {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// List queued item labels and changed field names without replaying writes or revealing values.
    SyncReview {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Review and resolve quarantined local edits.
    Conflict {
        #[command(subcommand)]
        command: ConflictCommand,
    },
    /// Report the CLI's per-command lock behavior.
    Lock {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Report the CLI's per-command logout behavior.
    Logout {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Show a redacted client status.
    Status {
        #[arg(long)]
        json: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Show the server's redacted license status (online only).
    License {
        #[command(subcommand)]
        command: LicenseCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum LicenseCommand {
    Status {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
pub enum ServerCommand {
    Trust(TrustArgs),
    /// Discover an online Tailscale server by name and verify its HTTPS identity.
    Tailscale {
        server: String,
        #[arg(long)]
        ca: PathBuf,
        #[arg(long)]
        server_id: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}

#[derive(Debug, Args)]
pub struct TrustArgs {
    #[arg(long)]
    pub url: String,
    /// Public installation CA certificate. Never supply a private key.
    #[arg(long)]
    pub ca: PathBuf,
    /// Expected server identity copied through a trusted operator channel.
    #[arg(long)]
    pub server_id: String,
    /// Exact enrolled `MagicDNS` name. Required for DNS-name endpoints.
    #[arg(long)]
    pub tailscale_name: Option<String>,
    /// Assert that a 100.64.0.0/10 address was discovered from Tailscale state.
    #[arg(long)]
    pub tailscale_ip: bool,
    /// Directory in which to create the non-secret trust profile.
    #[arg(long, default_value = ".127vaults")]
    pub config_dir: PathBuf,
}

#[derive(Debug, Subcommand)]
pub enum VaultCommand {
    List {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Create {
        /// Encrypted vault name.
        #[arg(default_value = "Private")]
        name: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Info {
        /// Vault name, generated V-code, or internal UUID.
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Rename {
        vault: String,
        name: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Settings {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    SettingsSync {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    SettingsReview {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    SettingsResolve {
        #[arg(long, value_parser = ["server", "local"])]
        keep: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    RemovalPreference {
        #[arg(long, value_parser = ["move", "archive"])]
        choice: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Archive {
        vault: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Move {
        vault: String,
        #[arg(long = "to")]
        destination: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    RemovalStatus {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    AbortMove {
        /// Acknowledge that destination copies may remain and must be reviewed.
        #[arg(long, required = true)]
        keep_copies: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Restore {
        vault: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    DefaultView {
        #[arg(value_parser = ["all", "vault", "collection"])]
        kind: String,
        selector: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Show, set, or clear this profile's preferred vault at unlock.
    Default {
        vault: Option<String>,
        #[arg(long, conflicts_with = "vault")]
        clear: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
pub enum CollectionCommand {
    List {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Save {
        name: String,
        #[arg(long)]
        id: Option<String>,
        #[arg(long = "vault", required = true)]
        vaults: Vec<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Remove {
        id: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Items {
        id: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}
#[derive(Debug, Subcommand)]
pub enum ItemCommand {
    /// Permanently delete one item (also supports a durable offline request).
    Delete {
        #[arg(long)]
        vault: Option<String>,
        /// Unique item title, generated I-code, or internal UUID.
        id: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    List {
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, conflicts_with = "vault")]
        all: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Get {
        #[arg(long)]
        vault: Option<String>,
        /// Unique item title, generated I-code, or internal UUID.
        id: String,
        /// Print only the named password-class field for piping (built-in name, custom label, or custom field ID).
        #[arg(long, value_name = "FIELD")]
        password: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Create {
        #[arg(long)]
        vault: Option<String>,
        #[command(flatten)]
        input: ItemInputArgs,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    Edit {
        #[arg(long)]
        vault: Option<String>,
        /// Unique item title, generated I-code, or internal UUID.
        id: String,
        #[command(flatten)]
        input: ItemInputArgs,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConflictCommand {
    /// Merge verified versions using an explicit base and field source choices.
    Merge {
        operation_id: String,
        #[arg(long, value_parser = ["local", "server"], required = true)]
        base: String,
        /// Repeat FIELD=local or FIELD=server (title, website, username, password, customFields).
        #[arg(long = "field-source")]
        field_sources: Vec<String>,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Compare the queued draft with verified server fields without submitting it.
    Compare {
        operation_id: String,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    List {
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Show a local draft with secret fields redacted.
    Show {
        operation_id: String,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Keep the verified server item or resubmit the local draft.
    Resolve {
        operation_id: String,
        #[arg(long, value_parser = ["server", "local"])]
        keep: String,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}

#[derive(Debug, Args)]
pub struct ItemInputArgs {
    /// Prompt for the standard fields.
    #[arg(long)]
    interactive: bool,
    /// JSON object, `-` for stdin, or `@path` for a UTF-8 JSON file.
    #[arg(long, value_name = "OBJECT|-|@FILE")]
    json: Option<String>,
    /// Repeatable KEY=VALUE field. Values on the command line may be visible to other processes.
    #[arg(long, value_name = "KEY=VALUE")]
    field: Vec<String>,
    /// First-party item type (defaults to login).
    #[arg(long = "type", value_parser = ["login", "bank", "card", "wifi", "router", "ssh", "password"])]
    item_type: Option<String>,
}

pub trait SecretPrompt {
    /// Reads a secret without terminal echo.
    ///
    /// # Errors
    /// Returns an error when a secure no-echo input backend is unavailable.
    fn read_secret(&mut self, prompt: &str) -> io::Result<Vec<u8>>;
}

pub struct TerminalSecretPrompt;
impl SecretPrompt for TerminalSecretPrompt {
    fn read_secret(&mut self, prompt: &str) -> io::Result<Vec<u8>> {
        rpassword::prompt_password(prompt).map(String::into_bytes)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum EndpointKind {
    Loopback,
    PrivateLan,
    Tailscale,
}

/// Validates that an endpoint is restricted to an approved private network class.
///
/// # Errors
/// Returns a safe diagnostic when the URL or explicit Tailscale binding is invalid.
pub fn validate_private_url(
    raw: &str,
    tailscale_name: Option<&str>,
    tailscale_ip: bool,
) -> Result<EndpointKind, String> {
    let url = Url::parse(raw).map_err(|_| "endpoint must be an absolute HTTPS URL".to_owned())?;
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "endpoint must be HTTPS and contain no credentials, query, or fragment".to_owned(),
        );
    }
    if url.path() != "/" {
        return Err("endpoint must not contain a path".to_owned());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "endpoint has no host".to_owned())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(EndpointKind::Loopback);
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) if v4.is_loopback() => Ok(EndpointKind::Loopback),
            IpAddr::V6(v6) if v6.is_loopback() => Ok(EndpointKind::Loopback),
            IpAddr::V4(v4) if is_rfc1918(v4) => Ok(EndpointKind::PrivateLan),
            IpAddr::V4(v4) if is_cgnat(v4) && tailscale_ip => Ok(EndpointKind::Tailscale),
            IpAddr::V6(v6) if is_tailscale_v6(v6) && tailscale_ip => Ok(EndpointKind::Tailscale),
            _ => Err(
                "endpoint is not loopback, RFC1918 private LAN, or explicitly enrolled Tailscale"
                    .to_owned(),
            ),
        };
    }
    let enrolled = tailscale_name.ok_or_else(|| {
        "DNS endpoints require --tailscale-name with the exact enrolled MagicDNS name".to_owned()
    })?;
    if !host.eq_ignore_ascii_case(enrolled) || !host.to_ascii_lowercase().ends_with(".ts.net") {
        return Err("host must exactly match an enrolled *.ts.net MagicDNS name".to_owned());
    }
    Ok(EndpointKind::Tailscale)
}

fn is_rfc1918(ip: Ipv4Addr) -> bool {
    ip.is_private()
}
fn is_cgnat(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..=127).contains(&o[1])
}
fn is_tailscale_v6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0
}

/// Validates public trust material without persisting it.
///
/// # Errors
/// Returns a safe diagnostic for invalid endpoints, identities, or CA files.
pub fn validate_trust(args: &TrustArgs) -> Result<String, String> {
    let kind = validate_private_url(&args.url, args.tailscale_name.as_deref(), args.tailscale_ip)?;
    if args.server_id.trim().is_empty()
        || args.server_id.len() > 256
        || args.server_id.chars().any(char::is_whitespace)
    {
        return Err(
            "server identity must be a non-empty token of at most 256 characters".to_owned(),
        );
    }
    let ca = fs::read(&args.ca).map_err(|_| "could not read CA certificate".to_owned())?;
    if ca.len() > 1024 * 1024
        || !ca.starts_with(b"-----BEGIN CERTIFICATE-----")
        || !ca.windows(25).any(|w| w == b"-----END CERTIFICATE-----")
    {
        return Err("CA file must be a PEM certificate no larger than 1 MiB".to_owned());
    }
    let digest = Sha256::digest(&ca);
    let mut fingerprint = String::new();
    for byte in digest {
        let _ = write!(fingerprint, "{byte:02x}");
    }
    Ok(format!(
        "trust material valid (not persisted)\nendpoint_kind={kind:?}\nca_sha256={fingerprint}\nserver_identity=[redacted]"
    ))
}

fn trust_profile(args: &TrustArgs, ca: &[u8]) -> Result<Vec<u8>, String> {
    let url = Url::parse(&args.url).map_err(|_| "invalid endpoint".to_owned())?;
    let canonical = url.to_string();
    let fingerprint = Sha256::digest(ca);
    let mut fingerprint_hex = String::with_capacity(64);
    for byte in fingerprint {
        let _ = write!(fingerprint_hex, "{byte:02x}");
    }
    Ok(format!(
        "version=1\nurl={canonical}\nserver_id={}\nca_sha256={fingerprint_hex}\n",
        args.server_id
    )
    .into_bytes())
}

fn write_new_or_equal(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(bytes)
                .and_then(|()| file.sync_all())
                .map_err(|_| "could not persist trust profile".to_owned())?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let current =
                fs::read(path).map_err(|_| "could not read existing trust profile".to_owned())?;
            if current == bytes {
                Ok(())
            } else {
                Err("trust profile already exists with different contents".to_owned())
            }
        }
        Err(_) => Err("could not persist trust profile".to_owned()),
    }
}

/// Verifies the endpoint using only the explicitly supplied CA, then persists an
/// immutable trust-on-first-use profile. Existing differing trust is never replaced.
///
/// # Errors
/// Fails closed for TLS, HTTP, filesystem, or existing-profile mismatches.
pub fn establish_trust(args: &TrustArgs) -> Result<String, String> {
    let validation = validate_trust(args)?;
    let ca = fs::read(&args.ca).map_err(|_| "could not read CA certificate".to_owned())?;
    let certificate = reqwest::Certificate::from_pem(&ca)
        .map_err(|_| "CA file is not a usable PEM certificate".to_owned())?;
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(certificate)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|_| "could not initialize the pinned HTTPS client".to_owned())?;
    let health = Url::parse(&args.url)
        .and_then(|url| url.join("health/live"))
        .map_err(|_| "invalid endpoint".to_owned())?;
    let response = client
        .get(health)
        .send()
        .map_err(|_| "pinned HTTPS endpoint is unavailable or untrusted".to_owned())?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("pinned HTTPS endpoint did not pass its liveness check".to_owned());
    }
    fs::create_dir_all(&args.config_dir)
        .map_err(|_| "could not create trust profile directory".to_owned())?;
    let profile = trust_profile(args, &ca)?;
    write_new_or_equal(&args.config_dir.join("installation-ca.pem"), &ca)?;
    write_new_or_equal(&args.config_dir.join("trust.conf"), &profile)?;
    Ok(format!(
        "{validation}\nprofile={}\nhttps_probe=ok",
        args.config_dir.display()
    ))
}

fn configured(config_dir: &std::path::Path) -> bool {
    let Ok(profile) = fs::read_to_string(config_dir.join("trust.conf")) else {
        return false;
    };
    let Ok(ca) = fs::read(config_dir.join("installation-ca.pem")) else {
        return false;
    };
    let mut digest = String::with_capacity(64);
    for byte in Sha256::digest(ca) {
        let _ = write!(digest, "{byte:02x}");
    }
    profile.lines().any(|line| line == "version=1")
        && profile
            .lines()
            .any(|line| line == format!("ca_sha256={digest}"))
}

fn active_profile_path() -> PathBuf {
    PathBuf::from(".127vaults-active")
}

fn remember_active_profile(config_dir: &std::path::Path) -> Result<(), String> {
    let absolute = if config_dir.is_absolute() {
        config_dir.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|_| "could not resolve active profile".to_owned())?
            .join(config_dir)
    };
    let value = format!("{}\n", absolute.display());
    fs::write(active_profile_path(), &value)
        .map_err(|_| "could not remember active profile".to_owned())?;
    if let Some(home) = dirs::home_dir() {
        fs::write(home.join(".127vaults-active"), value)
            .map_err(|_| "could not remember connector profile".to_owned())?;
    }
    Ok(())
}

fn effective_config_dir(requested: &std::path::Path) -> PathBuf {
    if requested != std::path::Path::new(".127vaults") {
        return requested.to_owned();
    }
    fs::read_to_string(active_profile_path())
        .ok()
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| path.join("trust.conf").is_file() && path.join("device.conf").is_file())
        .unwrap_or_else(|| requested.to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentRequest<'a> {
    device_id: &'a str,
    protection_class: &'static str,
    public_key: String,
    version: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalBundle {
    version: u8,
    account_id: String,
    enrollment_id: String,
    new_device_id: String,
    new_device_public_key: String,
    expires_at: String,
    code: String,
    approval_signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PossessionBinding<'a> {
    account_id: &'a str,
    enrollment_id: &'a str,
    expires_at: &'a str,
    new_device_id: &'a str,
    new_device_public_key: &'a str,
    purpose: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentCompletion<'a> {
    approval_signature: &'a str,
    code: &'a str,
    enrollment_id: &'a str,
    possession_signature: String,
    version: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnrollmentReceipt {
    version: u8,
    device_id: String,
    credential_epoch: u64,
}

fn file_profile_value(path: &std::path::Path, key: &str) -> Result<String, String> {
    let profile = fs::read_to_string(path).map_err(|_| "client profile is missing".to_owned())?;
    profile
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")).map(str::to_owned))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "client profile is invalid".to_owned())
}

fn profile_value(config_dir: &std::path::Path, key: &str) -> Result<String, String> {
    file_profile_value(&config_dir.join("trust.conf"), key)
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
fn store_device_key(server_id: &str, device_id: &str, seed: &[u8]) -> Result<(), String> {
    let entry = keyring::Entry::new(
        "127Vaults device identity",
        &format!("{server_id}:{device_id}"),
    )
    .map_err(|_| "OS credential storage is unavailable".to_owned())?;
    entry
        .set_secret(seed)
        .map_err(|_| "OS credential storage rejected the device key".to_owned())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn store_device_key(_server_id: &str, _device_id: &str, _seed: &[u8]) -> Result<(), String> {
    Err("OS credential storage is not implemented on this platform".to_owned())
}

#[allow(dead_code)]
fn enroll_device_legacy(config_dir: &std::path::Path, username: &str) -> Result<String, String> {
    if !configured(config_dir) {
        return Err("run server trust before enrollment".to_owned());
    }
    if config_dir.join("device.conf").exists() {
        return Err(
            "this CLI profile already has a device identity; use a new --config-dir for enrollment"
                .to_owned(),
        );
    }
    let server_id = profile_value(config_dir, "server_id")?;
    let device_id = uuid::Uuid::new_v4().to_string();
    let signing = SigningKey::generate(&mut OsRng);
    let public_key = URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes());
    let request = EnrollmentRequest {
        device_id: &device_id,
        protection_class: "unknown",
        public_key: public_key.clone(),
        version: 1,
    };
    println!(
        "Paste this CLI request into Trusted devices > Enroll a CLI device:\n{}",
        serde_json::to_string(&request).map_err(|_| "could not encode enrollment request")?
    );
    print!("Paste the browser approval bundle here, then press Enter:\n> ");
    io::stdout().flush().map_err(|_| "terminal output failed")?;
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|_| "could not read approval bundle")?;
    let approval: ApprovalBundle =
        serde_json::from_str(line.trim()).map_err(|_| "approval bundle is invalid")?;
    if approval.version != 1
        || approval.new_device_id != device_id
        || approval.new_device_public_key != public_key
    {
        return Err("approval bundle does not match this CLI device".to_owned());
    }
    let binding = PossessionBinding {
        account_id: &approval.account_id,
        enrollment_id: &approval.enrollment_id,
        expires_at: &approval.expires_at,
        new_device_id: &approval.new_device_id,
        new_device_public_key: &approval.new_device_public_key,
        purpose: "device-possession",
    };
    let bytes = serde_json::to_vec(&binding).map_err(|_| "could not encode possession proof")?;
    let completion = EnrollmentCompletion {
        approval_signature: &approval.approval_signature,
        code: &approval.code,
        enrollment_id: &approval.enrollment_id,
        possession_signature: URL_SAFE_NO_PAD.encode(signing.sign(&bytes).to_bytes()),
        version: 1,
    };
    println!(
        "Paste this completion proof back into the browser:\n{}",
        serde_json::to_string(&completion).map_err(|_| "could not encode completion proof")?
    );
    print!("Paste the browser success receipt here. Nothing is stored before it verifies:\n> ");
    io::stdout().flush().map_err(|_| "terminal output failed")?;
    line.clear();
    io::stdin()
        .read_line(&mut line)
        .map_err(|_| "could not read browser receipt")?;
    let receipt: EnrollmentReceipt = serde_json::from_str(line.trim())
        .map_err(|_| "browser did not provide a valid enrollment receipt".to_owned())?;
    if receipt.version != 1 || receipt.device_id != device_id || receipt.credential_epoch == 0 {
        return Err("browser enrollment receipt does not match this CLI device".to_owned());
    }
    store_device_key(&server_id, &device_id, signing.as_bytes())?;
    let device_profile =
        format!("version=1\ndevice_id={device_id}\nserver_id={server_id}\nusername={username}\n");
    write_new_or_equal(&config_dir.join("device.conf"), device_profile.as_bytes())?;
    Ok(format!(
        "device enrolled\ndevice_id={device_id}\nkey_storage=os"
    ))
}

fn enrollment_post(
    client: &reqwest::blocking::Client,
    origin: &str,
    action: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let enrollment_id = body["enrollmentId"].as_str();
    let path = match (action, enrollment_id) {
        ("request", _) => "/api/v1/device-enrollment".to_owned(),
        ("poll", Some(id)) => format!("/api/v1/device-enrollment/{id}/poll"),
        ("complete", Some(id)) => format!("/api/v1/device-enrollment/{id}/complete"),
        _ => return Err("invalid enrollment request".to_owned()),
    };
    let mut request_body = body.clone();
    if action != "request" {
        request_body
            .as_object_mut()
            .ok_or("invalid enrollment request")?
            .remove("enrollmentId");
    }
    let response = client
        .post(format!("{origin}{path}"))
        .json(&request_body)
        .send()
        .map_err(|error| {
            let category = if error.is_timeout() {
                "timeout"
            } else if error.is_connect() {
                "connection"
            } else if error.is_request() {
                "request"
            } else {
                "transport"
            };
            format!("enrollment server is unavailable ({category})")
        })?;
    let status = response.status();
    let value = response
        .json::<serde_json::Value>()
        .map_err(|_| "invalid enrollment response".to_owned())?;
    if !status.is_success() {
        return Err(format!(
            "enrollment rejected ({})",
            value["error"].as_str().unwrap_or("UNKNOWN")
        ));
    }
    Ok(value)
}

#[allow(clippy::too_many_lines)]
/// Enrolls a device and reports its approval code to the caller.
///
/// # Errors
///
/// Returns an error when trust is not configured, enrollment fails, or the
/// server response cannot be verified.
pub fn enroll_device_with_status(
    config_dir: &std::path::Path,
    username: &str,
    on_code: impl FnOnce(&str),
) -> Result<String, String> {
    enroll_device_with_identity(config_dir, username, |code, _, _| on_code(code))
}

#[allow(clippy::too_many_lines)]
fn enroll_device_with_identity(
    config_dir: &std::path::Path,
    username: &str,
    on_code: impl FnOnce(&str, &str, &str),
) -> Result<String, String> {
    if !configured(config_dir) {
        return Err("run server trust before enrollment".to_owned());
    }
    if config_dir.join("device.conf").exists() {
        return Err(
            "this CLI profile already has a device identity; use a new --config-dir for enrollment"
                .to_owned(),
        );
    }
    let server_id = profile_value(config_dir, "server_id")?;
    let origin = profile_value(config_dir, "url")?
        .trim_end_matches('/')
        .to_owned();
    let ca = fs::read(config_dir.join("installation-ca.pem"))
        .map_err(|_| "installation CA is missing".to_owned())?;
    let certificate =
        reqwest::Certificate::from_pem(&ca).map_err(|_| "installation CA is invalid".to_owned())?;
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(certificate)
        .redirect(reqwest::redirect::Policy::none())
        // Do not reuse a socket after the experimental Node server closes it
        // without a TLS close_notify between short polling requests.
        .pool_max_idle_per_host(0)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "could not initialize HTTPS client".to_owned())?;
    let device_id = uuid::Uuid::new_v4().to_string();
    let signing = SigningKey::generate(&mut OsRng);
    let public_key = URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes());
    let proof = serde_json::json!({"deviceId":device_id,"publicKey":public_key,"purpose":"enrollment-request","username":username});
    let request_signature = URL_SAFE_NO_PAD.encode(
        signing
            .sign(&serde_json::to_vec(&proof).map_err(|_| "could not encode enrollment request")?)
            .to_bytes(),
    );
    let started = enrollment_post(
        &client,
        &origin,
        "request",
        &serde_json::json!({"username":username,"newDeviceId":device_id,"newDevicePublicKey":public_key,"requestSignature":request_signature}),
    )?;
    let enrollment_id = started["enrollmentId"]
        .as_str()
        .ok_or("invalid enrollment response")?;
    if devices::device_id(enrollment_id)? != enrollment_id {
        return Err("invalid enrollment response".to_owned());
    }
    let poll_token = started["pollToken"]
        .as_str()
        .ok_or("invalid enrollment response")?;
    let code = started["code"]
        .as_str()
        .ok_or("invalid enrollment response")?;
    devices::normalize_code(code)?;
    if URL_SAFE_NO_PAD
        .decode(poll_token)
        .map_err(|_| "invalid enrollment response")?
        .len()
        != 32
    {
        return Err("invalid enrollment response".to_owned());
    }
    let expires_at = started["expiresAt"]
        .as_str()
        .ok_or("invalid enrollment response")?;
    on_code(
        code,
        &device_id,
        &devices::key_fingerprint(&signing.verifying_key().to_bytes()),
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_mins(10);
    let approved = loop {
        if std::time::Instant::now() >= deadline {
            return Err("enrollment expired; request a new code".to_owned());
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
        let value = enrollment_post(
            &client,
            &origin,
            "poll",
            &serde_json::json!({"enrollmentId":enrollment_id,"pollToken":poll_token}),
        )?;
        match value["status"].as_str() {
            Some("approved") => break value,
            Some("pending") => {}
            _ => return Err("invalid enrollment polling response".to_owned()),
        }
    };
    let binding = approved["binding"].clone();
    let inspected = devices::EnrollmentInspection::parse(binding.clone())?;
    inspected.matches(
        enrollment_id,
        &device_id,
        &devices::key_fingerprint(&signing.verifying_key().to_bytes()),
    )?;
    if binding["newDevicePublicKey"] != public_key || binding["expiresAt"] != expires_at {
        return Err("server approval does not match this CLI device".to_owned());
    }
    let approver_key: [u8; 32] = URL_SAFE_NO_PAD
        .decode(
            approved["approverPublicKey"]
                .as_str()
                .ok_or("invalid approval")?,
        )
        .map_err(|_| "invalid approval")?
        .try_into()
        .map_err(|_| "invalid approval")?;
    let approval_signature = URL_SAFE_NO_PAD
        .decode(
            approved["approvalSignature"]
                .as_str()
                .ok_or("invalid approval")?,
        )
        .map_err(|_| "invalid approval")?;
    VerifyingKey::from_bytes(&approver_key)
        .map_err(|_| "invalid approver key")?
        .verify(
            &serde_json::to_vec(&binding).map_err(|_| "invalid approval")?,
            &Signature::from_slice(&approval_signature)
                .map_err(|_| "invalid approval signature")?,
        )
        .map_err(|_| "trusted-device approval signature was invalid".to_owned())?;
    let mut possession = binding.as_object().cloned().ok_or("invalid approval")?;
    possession.insert(
        "purpose".to_owned(),
        serde_json::Value::String("device-possession".to_owned()),
    );
    let possession_signature = URL_SAFE_NO_PAD.encode(
        signing
            .sign(
                &serde_json::to_vec(&possession)
                    .map_err(|_| "could not encode possession proof")?,
            )
            .to_bytes(),
    );
    let receipt = enrollment_post(
        &client,
        &origin,
        "complete",
        &serde_json::json!({"enrollmentId":enrollment_id,"pollToken":poll_token,"possessionSignature":possession_signature}),
    )?;
    if receipt["deviceId"] != device_id {
        return Err("server receipt does not match this CLI device".to_owned());
    }
    store_device_key(&server_id, &device_id, signing.as_bytes())?;
    let profile =
        format!("version=1\ndevice_id={device_id}\nserver_id={server_id}\nusername={username}\n");
    write_new_or_equal(&config_dir.join("device.conf"), profile.as_bytes())?;
    Ok(format!(
        "device enrolled\ndevice_id={device_id}\nkey_storage=os"
    ))
}

fn enroll_device(config_dir: &std::path::Path, username: &str) -> Result<String, String> {
    enroll_device_with_identity(config_dir, username, |code, device_id, fingerprint| {
        eprintln!(
            "Enrollment code: {code}\nDevice ID: {device_id}\nSigning-key fingerprint (SHA-256): {fingerprint}\nCompare these on an already trusted web, desktop, or CLI device before approving. Waiting for approval…"
        );
    })
}

fn authenticated_session(
    config_dir: &std::path::Path,
    username: Option<&str>,
) -> Result<client::Session, String> {
    let username = match username {
        Some(value) => value.to_owned(),
        None => file_profile_value(&config_dir.join("device.conf"), "username")?,
    };
    let mut prompt = TerminalSecretPrompt;
    let secret = Zeroizing::new(
        prompt
            .read_secret("Account secret: ")
            .map_err(|_| "secure terminal input failed".to_owned())?,
    );
    let password = Zeroizing::new(
        prompt
            .read_secret("Master password: ")
            .map_err(|_| "secure terminal input failed".to_owned())?,
    );
    let secret = std::str::from_utf8(&secret)
        .map_err(|_| "account secret must be hexadecimal".to_owned())?;
    client::unlock(config_dir, &username, secret, &password)
}

fn unlock_material() -> Result<(Zeroizing<String>, Zeroizing<Vec<u8>>), String> {
    let mut prompt = TerminalSecretPrompt;
    let secret = Zeroizing::new(
        String::from_utf8(
            prompt
                .read_secret("Account secret: ")
                .map_err(|_| "secure terminal input failed".to_owned())?,
        )
        .map_err(|_| "account secret must be hexadecimal".to_owned())?,
    );
    let password = Zeroizing::new(
        prompt
            .read_secret("Master password: ")
            .map_err(|_| "secure terminal input failed".to_owned())?,
    );
    Ok((secret, password))
}

fn input(prompt: &str) -> Result<String, String> {
    print!("{prompt}");
    io::stdout()
        .flush()
        .map_err(|_| "terminal output failed".to_owned())?;
    let mut value = String::new();
    io::stdin()
        .read_line(&mut value)
        .map_err(|_| "terminal input failed".to_owned())?;
    Ok(value.trim_end().to_owned())
}

#[allow(clippy::type_complexity)]
fn item_fields() -> Result<
    (
        String,
        String,
        String,
        Zeroizing<String>,
        Vec<serde_json::Value>,
    ),
    String,
> {
    let title = input("Title: ")?;
    let website = normalize_website(&input("Website: ")?)?;
    let username = input("Username: ")?;
    let password = Zeroizing::new(
        rpassword::prompt_password("Password: ")
            .map_err(|_| "secure terminal input failed".to_owned())?,
    );
    Ok((title, website, username, password, Vec::new()))
}

fn normalize_website(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let candidate = if value.contains("://") {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    let parsed =
        Url::parse(&candidate).map_err(|_| "website must be a valid HTTP(S) URL or domain")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("website must be a valid HTTP(S) URL or domain".to_owned());
    }
    Ok(parsed.to_string())
}

#[allow(clippy::too_many_lines, clippy::type_complexity)]
fn item_fields_from_args(
    args: ItemInputArgs,
) -> Result<
    (
        String,
        String,
        String,
        Zeroizing<String>,
        Vec<serde_json::Value>,
    ),
    String,
> {
    let requested_type = args.item_type.clone();
    if args.interactive {
        if requested_type
            .as_deref()
            .is_some_and(|kind| kind != "login")
        {
            return Err("typed items require --json or --field input".to_owned());
        }
        if args.json.is_some() || !args.field.is_empty() {
            return Err("--interactive cannot be combined with --json or --field".to_owned());
        }
        return item_fields();
    }
    if args.json.is_some() && !args.field.is_empty() {
        return Err("choose either --json or --field".to_owned());
    }
    let value = if let Some(source) = args.json {
        let text = if source == "-" {
            let mut value = String::new();
            io::stdin()
                .read_to_string(&mut value)
                .map_err(|_| "could not read item JSON")?;
            value
        } else if let Some(path) = source.strip_prefix('@') {
            fs::read_to_string(path).map_err(|_| "could not read item JSON file")?
        } else {
            source
        };
        serde_json::from_str::<serde_json::Value>(&text)
            .map_err(|_| "item JSON must be a valid object")?
    } else if !args.field.is_empty() {
        let mut object = serde_json::Map::new();
        let mut custom_fields = Vec::new();
        for pair in args.field {
            let (key, value) = pair
                .split_once('=')
                .ok_or("each --field must be KEY=VALUE")?;
            if key.is_empty() {
                return Err("item field names must be non-empty and unique".to_owned());
            }
            if matches!(key, "title" | "website" | "username" | "password" | "type") {
                if object
                    .insert(key.to_owned(), serde_json::Value::String(value.to_owned()))
                    .is_some()
                {
                    return Err("item field names must be non-empty and unique".to_owned());
                }
            } else {
                let (label, kind) = key.rsplit_once(':').unwrap_or((key, "text"));
                if label.is_empty()
                    || !matches!(
                        kind,
                        "text" | "password" | "url" | "date" | "email" | "number" | "note"
                    )
                    || custom_fields.iter().any(|field: &serde_json::Value| {
                        field["label"]
                            .as_str()
                            .is_some_and(|existing| existing.eq_ignore_ascii_case(label))
                    })
                {
                    return Err(
                        "custom fields must use unique NAME[:TYPE]=VALUE names and supported types"
                            .to_owned(),
                    );
                }
                let value = if kind == "url" {
                    normalize_website(value)?
                } else {
                    value.to_owned()
                };
                let id = if matches!(
                    label,
                    "bank_name"
                        | "account_number"
                        | "bank_pin"
                        | "card_number"
                        | "cardholder"
                        | "expiry"
                        | "cvv"
                        | "card_pin"
                        | "ssid"
                        | "wifi_security"
                        | "router_address"
                        | "host"
                        | "port"
                ) {
                    label.to_owned()
                } else {
                    uuid::Uuid::new_v4().to_string()
                };
                custom_fields
                    .push(serde_json::json!({"id":id,"label":label,"type":kind,"value":value}));
            }
        }
        object.insert(
            "customFields".to_owned(),
            serde_json::Value::Array(custom_fields),
        );
        serde_json::Value::Object(object)
    } else {
        return Err("provide --json, one or more --field values, or --interactive".to_owned());
    };
    let object = value.as_object().ok_or("item JSON must be an object")?;
    let embedded_type = object
        .get("customFields")
        .and_then(serde_json::Value::as_array)
        .and_then(|fields| {
            fields
                .iter()
                .find(|field| field["id"] == "__127vaults_item_type")
        })
        .and_then(|field| field["value"].as_str());
    let kind = requested_type
        .as_deref()
        .or_else(|| object.get("type").and_then(serde_json::Value::as_str))
        .or(embedded_type)
        .unwrap_or("login");
    if !matches!(
        kind,
        "login" | "bank" | "card" | "wifi" | "router" | "ssh" | "password"
    ) {
        return Err("item type is unsupported".to_owned());
    }
    if requested_type
        .as_deref()
        .is_some_and(|requested| object.get("type").is_some_and(|given| given != requested))
    {
        return Err("--type and item type disagree".to_owned());
    }
    let field = |name: &str, required: bool| -> Result<String, String> {
        match object.get(name) {
            Some(serde_json::Value::String(value)) => Ok(value.to_owned()),
            None if !required => Ok(String::new()),
            _ => Err(format!("item field {name} must be a string")),
        }
    };
    let title = field("title", true)?;
    if title.trim().is_empty() {
        return Err("item field title must not be empty".to_owned());
    }
    let website = normalize_website(&field("website", false)?)?;
    let mut custom_fields = match object.get("customFields") {
        None => Vec::new(),
        Some(serde_json::Value::Array(fields)) => fields.clone(),
        Some(_) => return Err("item field customFields must be an array".to_owned()),
    };
    let mut labels = std::collections::HashSet::new();
    for custom in &mut custom_fields {
        let custom = custom
            .as_object_mut()
            .ok_or("each custom field must be an object")?;
        let label = custom
            .get("label")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .ok_or("each custom field needs a non-empty label")?
            .to_owned();
        let id = custom
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let is_marker = id == "__127vaults_item_type" || id.starts_with("__127vaults_section:");
        if !is_marker
            && !id.starts_with("__127vaults_field:")
            && !labels.insert(label.to_lowercase())
        {
            return Err("custom field labels must be unique".to_owned());
        }
        let kind = custom
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or("each custom field needs a supported type")?;
        if !matches!(
            kind,
            "text" | "password" | "url" | "date" | "email" | "number" | "note" | "metadata"
        ) {
            return Err("each custom field needs a supported type".to_owned());
        }
        let mut value = custom
            .get("value")
            .and_then(serde_json::Value::as_str)
            .ok_or("each custom field value must be a string")?
            .to_owned();
        if kind == "url" {
            value = normalize_website(&value)?;
        }
        custom.insert("label".to_owned(), serde_json::Value::String(label));
        custom.insert("value".to_owned(), serde_json::Value::String(value));
        custom
            .entry("id")
            .or_insert_with(|| serde_json::Value::String(uuid::Uuid::new_v4().to_string()));
    }
    let marker = custom_fields
        .iter()
        .position(|field| field["id"] == "__127vaults_item_type");
    if let Some(index) = marker {
        if custom_fields[index]["type"] != "metadata" || custom_fields[index]["value"] != kind {
            return Err("item type marker is invalid".to_owned());
        }
    } else if kind != "login" {
        custom_fields.insert(0, serde_json::json!({"id":"__127vaults_item_type","label":"Item type","type":"metadata","value":kind}));
    }
    validate_typed_fields(&custom_fields, kind)?;
    Ok((
        title,
        website,
        field("username", false)?,
        Zeroizing::new(field("password", false)?),
        custom_fields,
    ))
}

fn validate_typed_fields(fields: &[serde_json::Value], kind: &str) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    let mut sections = std::collections::HashSet::new();
    for field in fields {
        let id = field["id"]
            .as_str()
            .ok_or("custom field ID must be a string")?;
        if id.is_empty() || !ids.insert(id) {
            return Err("custom field IDs must be non-empty and unique".to_owned());
        }
        if id == "__127vaults_item_type" {
            if field["type"] != "metadata" || field["value"] != kind {
                return Err("item type marker is invalid".to_owned());
            }
        } else if let Some(section) = id.strip_prefix("__127vaults_section:") {
            let section_type = field["value"]
                .as_str()
                .unwrap_or("")
                .split('|')
                .next()
                .unwrap_or("");
            if section.is_empty()
                || field["type"] != "metadata"
                || !matches!(
                    section_type,
                    "login" | "bank" | "card" | "wifi" | "router" | "ssh" | "password" | "security"
                )
            {
                return Err("section marker is invalid".to_owned());
            }
            sections.insert(section);
        } else if field["type"] == "metadata"
            || id.starts_with("__127vaults_") && !id.starts_with("__127vaults_field:")
        {
            return Err("reserved item field is invalid".to_owned());
        }
    }
    for field in fields {
        if let Some(rest) = field["id"]
            .as_str()
            .unwrap_or("")
            .strip_prefix("__127vaults_field:")
        {
            let section = rest.split(':').next().unwrap_or("");
            if !sections.contains(section) || !rest.contains(':') {
                return Err("section field has no matching section".to_owned());
            }
        }
    }
    Ok(())
}

/// Executes the currently implemented offline CLI command surface.
///
/// # Errors
/// Returns a safe diagnostic when validation fails or a command is not implemented.
#[allow(clippy::too_many_lines)]
pub fn run(cli: Cli) -> Result<String, String> {
    match cli.command {
        Command::Generate { command } => generate_command(command),
        Command::License {
            command: LicenseCommand::Status { config_dir },
        } => {
            let mut status = agent::call(
                &effective_config_dir(&config_dir),
                "license.status",
                serde_json::json!({}),
            )?;
            let guidance = match status["mode"].as_str() {
                Some("active") => "License active. Check expiresAt and renew before expiry.",
                Some("read-only") => {
                    "License expired. Server vault and invitation writes are blocked during the 30-day read-only period. Install a renewed license on the server."
                }
                Some("revoked") => {
                    "License revoked. Server writes are blocked. Ask the server operator to install a valid replacement license."
                }
                Some("locked") => {
                    "License locked. Server writes are blocked. Check expiry and the server clock, then ask the operator to install a valid license if needed."
                }
                _ => {
                    "Experimental or unavailable license status. Confirm the server operator status before relying on it."
                }
            };
            status["guidance"] = serde_json::json!(guidance);
            serde_json::to_string_pretty(&status)
                .map_err(|_| "could not encode license status".to_owned())
        }
        Command::Server {
            command: ServerCommand::Trust(args),
        } => establish_trust(&args),
        Command::Server {
            command:
                ServerCommand::Tailscale {
                    server,
                    ca,
                    server_id,
                    config_dir,
                },
        } => {
            let peers = tailscale::discover()?;
            let matches: Vec<_> = peers
                .iter()
                .filter(|peer| {
                    peer.name.eq_ignore_ascii_case(&server)
                        || peer
                            .name
                            .split('.')
                            .next()
                            .is_some_and(|name| name.eq_ignore_ascii_case(&server))
                })
                .collect();
            if matches.len() != 1 {
                return Err(
                    "Choose one exact online Tailscale server name; no unique match was found"
                        .to_owned(),
                );
            }
            establish_trust(&TrustArgs {
                url: format!("https://{}:12780", matches[0].address),
                ca,
                server_id,
                config_dir,
                tailscale_name: None,
                tailscale_ip: true,
            })
        }
        Command::Status { json, config_dir } => {
            let config_dir = effective_config_dir(&config_dir);
            let status = agent::call(&config_dir, "status", serde_json::json!({})).ok();
            let authenticated = status
                .as_ref()
                .is_some_and(|value| value["authenticated"] == true);
            let unlocked = status
                .as_ref()
                .is_some_and(|value| value["unlocked"] == true);
            let online = status.as_ref().is_some_and(|value| value["online"] == true);
            let reason = status
                .as_ref()
                .and_then(|value| value["offlineReason"].as_str());
            if json {
                return serde_json::to_string(&serde_json::json!({"configured":configured(&config_dir),"authenticated":authenticated,"unlocked":unlocked,"online":online,"offlineReason":reason,"secrets":"redacted"}))
                    .map_err(|_| "could not encode status".to_owned());
            }
            let mut output = format!(
                "configured: {}\nauthenticated: {}\nunlocked: {}\nonline: {}\nsecrets: [redacted]",
                if configured(&config_dir) { "yes" } else { "no" },
                if authenticated { "yes" } else { "no" },
                if unlocked { "yes" } else { "no" },
                if online { "yes" } else { "no" }
            );
            if let Some(reason) = reason {
                write!(output, "\noffline reason: {reason}")
                    .map_err(|_| "could not encode status")?;
            }
            Ok(output)
        }
        Command::Device { command } => devices::run(command),
        Command::Login {
            username,
            enroll,
            config_dir,
        } => {
            if enroll {
                println!("{}", enroll_device(&config_dir, &username)?);
            }
            let (secret, password) = unlock_material()?;
            agent::start(&config_dir, &username, &secret, &password)?;
            remember_active_profile(&config_dir)?;
            Ok("login verified; unlocked for up to 30 minutes of inactivity".to_owned())
        }
        Command::AgentServe {
            username,
            config_dir,
            read_only,
        } => agent::serve(&config_dir, &username, read_only),
        Command::Unlock {
            username,
            config_dir,
        } => {
            let _session = authenticated_session(&config_dir, Some(&username))?;
            Ok("unlock verified; keys discarded at process exit".to_owned())
        }
        Command::Vault {
            command: VaultCommand::List { config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.list",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode vault list".to_owned()),
        Command::Sync { config_dir } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "sync",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode sync result".to_owned()),
        Command::SyncReview { config_dir } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "sync.review",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode sync review".to_owned()),
        Command::Conflict { command } => {
            let (config_dir, action, body) = match command {
                ConflictCommand::Merge {
                    operation_id,
                    base,
                    field_sources,
                    vault,
                    config_dir,
                } => (
                    config_dir,
                    "conflict.merge",
                    serde_json::json!({"vault":vault,"operation_id":operation_id,"keep":base,"field_sources":field_sources}),
                ),
                ConflictCommand::Compare {
                    operation_id,
                    vault,
                    config_dir,
                } => (
                    config_dir,
                    "conflict.compare",
                    serde_json::json!({"vault":vault,"operation_id":operation_id}),
                ),
                ConflictCommand::List { vault, config_dir } => (
                    config_dir,
                    "conflict.list",
                    serde_json::json!({"vault":vault}),
                ),
                ConflictCommand::Show {
                    operation_id,
                    vault,
                    config_dir,
                } => (
                    config_dir,
                    "conflict.show",
                    serde_json::json!({"vault":vault,"operation_id":operation_id}),
                ),
                ConflictCommand::Resolve {
                    operation_id,
                    keep,
                    vault,
                    config_dir,
                } => (
                    config_dir,
                    "conflict.resolve",
                    serde_json::json!({"vault":vault,"operation_id":operation_id,"keep":keep}),
                ),
            };
            serde_json::to_string_pretty(&agent::call(
                &effective_config_dir(&config_dir),
                action,
                body,
            )?)
            .map_err(|_| "could not encode conflict result".to_owned())
        }
        Command::Vault {
            command: VaultCommand::Create { name, config_dir },
        } => {
            let config_dir = effective_config_dir(&config_dir);
            serde_json::to_string_pretty(&agent::call(
                &config_dir,
                "vault.create",
                serde_json::json!({"name":name}),
            )?)
            .map_err(|_| "could not encode vault result".to_owned())
        }
        Command::Vault {
            command:
                VaultCommand::Rename {
                    vault,
                    name,
                    config_dir,
                },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.rename",
            serde_json::json!({"vault":vault,"name":name}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::SettingsSync { config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.settings.sync",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::SettingsReview { config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.settings.review",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::SettingsResolve { keep, config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.settings.resolve",
            serde_json::json!({"keep":keep}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::RemovalPreference { choice, config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.settings.preference",
            serde_json::json!({"choice":choice}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::Archive { vault, config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.archive",
            serde_json::json!({"vault":vault}),
        )?)
        .map_err(|_| "could not encode vault archive result".to_owned()),
        Command::Vault {
            command:
                VaultCommand::Move {
                    vault,
                    destination,
                    config_dir,
                },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.move",
            serde_json::json!({"vault":vault,"destination":destination}),
        )?)
        .map_err(|_| "could not encode vault move result".to_owned()),
        Command::Vault {
            command: VaultCommand::RemovalStatus { config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.removal.status",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode vault removal status".to_owned()),
        Command::Vault {
            command:
                VaultCommand::AbortMove {
                    keep_copies,
                    config_dir,
                },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.move.abort",
            serde_json::json!({"keep_copies":keep_copies}),
        )?)
        .map_err(|_| "could not encode vault move abort".to_owned()),
        Command::Vault {
            command: VaultCommand::Restore { vault, config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.restore",
            serde_json::json!({"vault":vault}),
        )?)
        .map_err(|_| "could not encode vault restore result".to_owned()),
        Command::Vault {
            command:
                VaultCommand::DefaultView {
                    kind,
                    selector,
                    config_dir,
                },
        } => {
            if kind != "all" && selector.is_none() {
                return Err("vault or collection selector is required".to_owned());
            }
            serde_json::to_string_pretty(&agent::call(
                &effective_config_dir(&config_dir),
                "vault.settings.default-view",
                serde_json::json!({"view_kind":kind,"vault":selector,"collection_id":selector}),
            )?)
            .map_err(|_| "could not encode vault settings".to_owned())
        }
        Command::Collection { command } => {
            let (config_dir, action, body) = match command {
                CollectionCommand::List { config_dir } => {
                    (config_dir, "vault.settings", serde_json::json!({}))
                }
                CollectionCommand::Save {
                    name,
                    id,
                    vaults,
                    config_dir,
                } => (
                    config_dir,
                    "collection.save",
                    serde_json::json!({"name":name,"collection_id":id,"vault_ids":vaults}),
                ),
                CollectionCommand::Remove { id, config_dir } => (
                    config_dir,
                    "collection.remove",
                    serde_json::json!({"collection_id":id}),
                ),
                CollectionCommand::Items { id, config_dir } => (
                    config_dir,
                    "collection.items",
                    serde_json::json!({"collection_id":id}),
                ),
            };
            serde_json::to_string_pretty(&agent::call(
                &effective_config_dir(&config_dir),
                action,
                body,
            )?)
            .map_err(|_| "could not encode collection result".to_owned())
        }
        Command::Vault {
            command: VaultCommand::Settings { config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.settings",
            serde_json::json!({}),
        )?)
        .map_err(|_| "could not encode vault settings".to_owned()),
        Command::Vault {
            command: VaultCommand::Info { vault, config_dir },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.info",
            serde_json::json!({"vault":vault}),
        )?)
        .map_err(|_| "could not encode vault information".to_owned()),
        Command::Vault {
            command:
                VaultCommand::Default {
                    vault,
                    clear,
                    config_dir,
                },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            "vault.default",
            serde_json::json!({"vault":vault,"clear":clear}),
        )?)
        .map_err(|_| "could not encode default vault".to_owned()),
        Command::Item {
            command:
                ItemCommand::List {
                    vault,
                    all,
                    config_dir,
                },
        } => serde_json::to_string_pretty(&agent::call(
            &effective_config_dir(&config_dir),
            if all { "item.list.all" } else { "item.list" },
            serde_json::json!({"vault":vault}),
        )?)
        .map_err(|_| "could not encode item list".to_owned()),
        Command::Item {
            command:
                ItemCommand::Get {
                    vault,
                    id,
                    password,
                    config_dir,
                },
        } => {
            let config_dir = effective_config_dir(&config_dir);
            let reveal_password = password.is_some();
            let value = agent::call(
                &config_dir,
                "item.get",
                serde_json::json!({"vault":vault,"item":id,"password_field":password}),
            )?;
            if reveal_password {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "invalid password-field response".to_owned())
            } else {
                serde_json::to_string_pretty(&value).map_err(|_| "could not encode item".to_owned())
            }
        }
        Command::Item {
            command:
                ItemCommand::Create {
                    vault,
                    input,
                    config_dir,
                },
        } => {
            let config_dir = effective_config_dir(&config_dir);
            let (title, website, username, password, custom_fields) = item_fields_from_args(input)?;
            serde_json::to_string_pretty(&agent::call(&config_dir,"item.create",serde_json::json!({"vault":vault,"title":title,"website":website,"username":username,"password":password.as_str(),"customFields":custom_fields}))?)
            .map_err(|_| "could not encode result".to_owned())
        }
        Command::Item {
            command:
                ItemCommand::Delete {
                    vault,
                    id,
                    config_dir,
                },
        } => {
            let config_dir = effective_config_dir(&config_dir);
            serde_json::to_string_pretty(&agent::call(
                &config_dir,
                "item.delete",
                serde_json::json!({"vault":vault,"item":id}),
            )?)
            .map_err(|_| "could not encode result".to_owned())
        }
        Command::Lock { config_dir } | Command::Logout { config_dir } => {
            let config_dir = effective_config_dir(&config_dir);
            let _ = agent::call(&config_dir, "logout", serde_json::json!({}))?;
            Ok("logged out; local keys destroyed".to_owned())
        }
        Command::Item {
            command:
                ItemCommand::Edit {
                    vault,
                    id,
                    input,
                    config_dir,
                },
        } => {
            let config_dir = effective_config_dir(&config_dir);
            let (title, website, username, password, custom_fields) = item_fields_from_args(input)?;
            serde_json::to_string_pretty(&agent::call(&config_dir,"item.edit",serde_json::json!({"vault":vault,"item":id,"title":title,"website":website,"username":username,"password":password.as_str(),"customFields":custom_fields}))?)
            .map_err(|_| "could not encode result".to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_transport_has_no_legacy_api_paths() {
        let source = include_str!("lib.rs");
        assert!(!source.contains(&["/api", "/experimental/v2/device-enrollments"].concat()));
        assert!(source.contains("/api/v1/device-enrollment"));
    }
    use clap::Parser;

    #[test]
    fn refuses_secret_as_enrollment_argument() {
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "device",
                "enroll",
                "--url",
                "https://localhost",
                "--code",
                "secret"
            ])
            .is_err()
        );
    }

    #[test]
    fn device_management_commands_require_explicit_identity_and_support_confirmation_flags() {
        assert!(Cli::try_parse_from(["127vaults", "device", "list"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "device", "inspect", "ABCDEFGH"]).is_ok());
        assert!(
            Cli::try_parse_from(["127vaults", "device", "approve", "ABCDEFGH", "--yes"]).is_err()
        );
        let id = "11111111-1111-4111-8111-111111111111";
        let fingerprint = "0".repeat(64);
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "device",
                "approve",
                "ABCDEFGH",
                "--device-id",
                id,
                "--fingerprint",
                &fingerprint,
                "--yes"
            ])
            .is_ok()
        );
        assert!(Cli::try_parse_from(["127vaults", "device", "revoke", id, "--yes"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "device", "revoke"]).is_err());
        assert!(Cli::try_parse_from(["127vaults", "device", "rotate-password"]).is_err());
    }

    #[test]
    fn sync_and_conflict_commands_require_explicit_resolution_choice() {
        assert!(Cli::try_parse_from(["127vaults", "sync"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "conflict", "list"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "conflict", "show", "operation-id"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "conflict", "compare", "operation-id"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "conflict", "compare"]).is_err());
        assert!(Cli::try_parse_from(["127vaults", "conflict", "merge", "operation-id"]).is_err());
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "conflict",
                "merge",
                "operation-id",
                "--base",
                "local",
                "--field-source",
                "title=server"
            ])
            .is_ok()
        );
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "conflict",
                "resolve",
                "operation-id",
                "--keep",
                "local"
            ])
            .is_ok()
        );
        assert!(Cli::try_parse_from(["127vaults", "conflict", "resolve", "operation-id"]).is_err());
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "conflict",
                "resolve",
                "operation-id",
                "--keep",
                "both"
            ])
            .is_err()
        );
    }
    #[test]
    fn all_vault_item_list_cannot_be_combined_with_single_vault_selector() {
        assert!(Cli::try_parse_from(["127vaults", "item", "list", "--all"]).is_ok());
        assert!(
            Cli::try_parse_from(["127vaults", "item", "list", "--all", "--vault", "Private"])
                .is_err()
        );
    }
    #[test]
    fn classifies_allowed_endpoints() {
        assert_eq!(
            validate_private_url("https://127.0.0.1:12780", None, false),
            Ok(EndpointKind::Loopback)
        );
        assert_eq!(
            validate_private_url("https://192.168.1.4", None, false),
            Ok(EndpointKind::PrivateLan)
        );
        assert_eq!(
            validate_private_url(
                "https://host.tailnet.ts.net",
                Some("host.tailnet.ts.net"),
                false
            ),
            Ok(EndpointKind::Tailscale)
        );
    }
    #[test]
    fn rejects_public_and_ambiguous_cgnat_endpoints() {
        assert!(validate_private_url("https://example.com", None, false).is_err());
        assert!(validate_private_url("https://8.8.8.8", None, false).is_err());
        assert!(validate_private_url("https://100.64.0.1", None, false).is_err());
        assert_eq!(
            validate_private_url("https://100.64.0.1", None, true),
            Ok(EndpointKind::Tailscale)
        );
    }
    #[test]
    fn secrets_are_not_accepted_as_unlock_flags() {
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "unlock",
                "--username",
                "owner",
                "--master-password",
                "bad"
            ])
            .is_err()
        );
    }

    #[test]
    fn primary_cli_flow_uses_login_and_human_vault_selectors() {
        assert!(matches!(
            Cli::try_parse_from(["127vaults", "login", "owner_127", "--enroll"])
                .unwrap()
                .command,
            Command::Login {
                username,
                enroll: true,
                ..
            } if username == "owner_127"
        ));
        assert!(Cli::try_parse_from(["127vaults", "vault", "info", "Private"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "vault", "create", "Private"]).is_ok());
        assert!(Cli::try_parse_from(["127vaults", "item", "list"]).is_ok());
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "item",
                "create",
                "--field",
                "title=Example",
                "--field",
                "website=example.com"
            ])
            .is_ok()
        );
    }

    #[test]
    fn noninteractive_item_fields_are_validated_and_normalized() {
        let values = item_fields_from_args(ItemInputArgs {
            interactive: false,
            json: None,
            item_type: None,
            field: vec![
                "title=Example".to_owned(),
                "website=example.com".to_owned(),
                "password=secret".to_owned(),
            ],
        })
        .unwrap();
        assert_eq!(values.0, "Example");
        assert_eq!(values.1, "https://example.com/");
        assert_eq!(values.3.as_str(), "secret");
        let custom = item_fields_from_args(ItemInputArgs {
            interactive: false,
            json: None,
            item_type: None,
            field: vec!["title=Codes".to_owned(), "pin:password=1234".to_owned()],
        })
        .unwrap();
        assert_eq!(custom.4[0]["label"], "pin");
        assert_eq!(custom.4[0]["type"], "password");
        assert_eq!(custom.4[0]["value"], "1234");
        assert!(normalize_website("ftp://example.com").is_err());
        assert!(
            item_fields_from_args(ItemInputArgs {
                interactive: false,
                json: Some(r#"{"title":""}"#.to_owned()),
                item_type: None,
                field: Vec::new(),
            })
            .is_err()
        );
    }
    #[test]
    fn typed_item_and_sections_keep_desktop_format() {
        let item = item_fields_from_args(ItemInputArgs {
            interactive: false,
            json: Some(r#"{"title":"Travel card","type":"card","customFields":[{"id":"card_number","label":"Card number","type":"password","value":"4111"},{"id":"__127vaults_section:sec1","label":"Section","type":"metadata","value":"security|Security info"},{"id":"__127vaults_field:sec1:answer","label":"Answer","type":"password","value":"rose"}]}"#.to_owned()),
            field: Vec::new(),
            item_type: None,
        }).unwrap();
        assert_eq!(item.4[0]["value"], "card");
        assert_eq!(item.4[1]["id"], "card_number");
        assert_eq!(item.4[3]["value"], "rose");
        let shorthand = item_fields_from_args(ItemInputArgs {
            interactive: false,
            json: None,
            field: vec!["title=My Wi-Fi".to_owned(), "ssid=Home".to_owned()],
            item_type: Some("wifi".to_owned()),
        })
        .unwrap();
        assert_eq!(shorthand.4[0]["value"], "wifi");
        assert_eq!(shorthand.4[1]["id"], "ssid");
        assert!(
            validate_typed_fields(
                &[serde_json::json!({"id":"__127vaults_field:missing:answer","type":"password"})],
                "login"
            )
            .is_err()
        );
    }
    #[test]
    fn move_requires_destination_and_abort_requires_copy_acknowledgement() {
        assert!(Cli::try_parse_from(["127vaults", "vault", "move", "Source"]).is_err());
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "vault",
                "move",
                "Source",
                "--to",
                "Destination"
            ])
            .is_ok()
        );
        assert!(Cli::try_parse_from(["127vaults", "vault", "abort-move"]).is_err());
        assert!(Cli::try_parse_from(["127vaults", "vault", "abort-move", "--keep-copies"]).is_ok());
    }
    #[test]
    fn status_is_redacted() {
        let output = run(Cli::parse_from(["127vaults", "status", "--json"])).unwrap();
        assert!(output.contains("redacted"));
        assert!(!output.contains("token"));
    }

    #[test]
    fn trust_files_are_create_only_and_idempotent() {
        let root = std::env::temp_dir().join(format!("127vaults-cli-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        let path = root.join("trust.conf");
        write_new_or_equal(&path, b"first").unwrap();
        write_new_or_equal(&path, b"first").unwrap();
        assert!(write_new_or_equal(&path, b"second").is_err());
        assert_eq!(fs::read(path).unwrap(), b"first");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_trust_and_device_profiles_from_their_own_files() {
        let root =
            std::env::temp_dir().join(format!("127vaults-cli-profile-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("trust.conf"), "server_id=installation\n").unwrap();
        fs::write(root.join("device.conf"), "username=owner_127\n").unwrap();
        assert_eq!(profile_value(&root, "server_id").unwrap(), "installation");
        assert_eq!(
            file_profile_value(&root.join("device.conf"), "username").unwrap(),
            "owner_127"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
