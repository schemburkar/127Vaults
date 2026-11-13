#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned IPC arguments.

use serde_json::{Value, json};
use tauri::{Emitter, Manager};
mod clipboard;
mod idle_lease;
mod renderer_boundary;
mod session_epoch;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use vaults_cli::{
    TrustArgs,
    client::{Session, unlock_with_offline_fallback},
    connector_agent_active, enroll_device_with_status, establish_trust, start_connector_agent,
    stop_connector_agent, validate_trust,
};

#[derive(Default)]
struct DesktopState {
    session: Mutex<Option<(u64, Session)>>,
    enrollment: std::sync::Arc<Mutex<Value>>,
    connector_owned: Mutex<Option<(u64, PathBuf)>>,
    connector_seen: Mutex<Option<(u64, PathBuf)>>,
    epoch: std::sync::Arc<session_epoch::SessionEpoch>,
    transitions: std::sync::Arc<Mutex<()>>,
    unlocking: AtomicBool,
    idle: Mutex<Option<idle_lease::IdleLease>>,
}

struct UnlockLease<'a>(&'a AtomicBool);
impl Drop for UnlockLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn native_passkey_provider(action: String) -> Result<Value, String> {
    if !cfg!(target_os = "windows") {
        return Ok(json!({"available":false,"windows":false}));
    }
    if !vaults_cli::native_passkeys::WINDOWS_NATIVE_PASSKEYS_ENABLED {
        return if action == "status" {
            Ok(json!({"available":false,"windows":true,"disabled":true}))
        } else {
            Err(
                "Native Windows passkeys are disabled; use the 127Vaults browser extension"
                    .to_owned(),
            )
        };
    }
    let argument = match action.as_str() {
        "status" => "--status",
        "register" => "--register",
        "unregister" => "--unregister",
        "refresh" => "--sync-cache",
        "settings" => "--settings",
        _ => return Err("Unknown native passkey provider action".to_owned()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let exe = std::env::current_exe().map_err(|_| "Desktop location is unavailable")?.with_file_name("127vaults-passkey-provider.exe");
        if !exe.is_file() { return Ok(json!({"available":false,"windows":true,"installed":false})); }
        let mut command = std::process::Command::new(exe); command.arg(argument);
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
        let result = command.output().map_err(|_| "Could not launch native passkey provider")?;
        let mut value: Value = serde_json::from_slice(&result.stdout).map_err(|_| "Invalid native passkey provider response")?;
        value["windows"] = json!(true); value["installed"] = json!(true);
        if !result.status.success() {
            let message = if value["errorCode"] == 2_147_958_100_u64 {
                "Install and open the packaged 127Vaults Desktop build before registering native passkeys."
            } else { "Native provider operation failed. Check that Desktop is unlocked and Windows Hello is configured." };
            return Err(message.to_owned());
        }
        Ok(value)
    }).await.map_err(|_| "Native provider task failed".to_owned())?
}

#[tauri::command]
fn generate_secret(options: Value) -> Result<String, String> {
    vaults_cli::generate_secret(options)
}

impl Drop for DesktopState {
    fn drop(&mut self) {
        if let Ok(owned) = self.connector_owned.get_mut()
            && let Some((_, path)) = owned.take()
        {
            stop_connector_agent(&path);
        }
    }
}

const PROFILE_FILES: [&str; 5] = [
    "trust.conf",
    "device.conf",
    "installation-ca.pem",
    "offline-unlock.json",
    "replicas.json",
];

fn is_profile(path: &Path) -> bool {
    let trust = path.join("trust.conf");
    trust.is_file()
        && (path.join("installation-ca.pem").is_file()
            || profile(&trust, "mode").as_deref() == Some("cloud"))
}

fn adopt_cli_profile(destination: &Path) -> Result<bool, String> {
    if !vaults_cli::namespace::Namespace::current()?.production() {
        return Ok(false);
    }
    if is_profile(destination) {
        return Ok(false);
    }
    let working = std::env::current_dir().ok();
    let mut candidates = Vec::new();
    if let Some(directory) = &working {
        if let Ok(active) = fs::read_to_string(directory.join(".127vaults-active")) {
            candidates.push(PathBuf::from(active.trim()));
        }
        candidates.extend([
            directory.join(".127vaults"),
            directory.join(".127vaults-cli"),
        ]);
    }
    if let Some(home) = dirs::home_dir() {
        candidates.extend([home.join(".127vaults"), home.join(".127vaults-cli")]);
    }
    let Some(source) = candidates.into_iter().find(|path| {
        vaults_cli::namespace::Namespace::current()
            .is_ok_and(|namespace| namespace.can_import_profile(path))
            && is_profile(path)
    }) else {
        return Ok(false);
    };
    fs::create_dir_all(destination)
        .map_err(|_| "desktop configuration directory could not be created".to_owned())?;
    for name in PROFILE_FILES {
        let from = source.join(name);
        let to = destination.join(name);
        vaults_cli::namespace::validate_profile(&from)?;
        if from.is_file() && !to.exists() {
            fs::copy(from, to)
                .map_err(|_| format!("desktop could not import {name} from the CLI profile"))?;
        }
    }
    let replica_source = source.join("replicas");
    let replica_destination = destination.join("replicas");
    vaults_cli::namespace::validate_profile(&replica_source)?;
    if replica_source.is_dir() {
        fs::create_dir_all(&replica_destination)
            .map_err(|_| "desktop replica directory could not be created".to_owned())?;
        for entry in fs::read_dir(replica_source)
            .map_err(|_| "CLI replica directory could not be read".to_owned())?
        {
            let entry = entry.map_err(|_| "CLI replica directory could not be read".to_owned())?;
            let from = entry.path();
            if from.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            vaults_cli::namespace::validate_profile(&from)?;
            let to = replica_destination.join(entry.file_name());
            if !to.exists() {
                fs::copy(from, to)
                    .map_err(|_| "desktop could not import a CLI replica".to_owned())?;
            }
        }
    }
    Ok(true)
}

fn config_directory() -> Result<PathBuf, String> {
    let destination = vaults_cli::desktop_profile_directory()?;
    if std::env::var_os("VAULTS_CONFIG_DIR").is_none() {
        adopt_cli_profile(&destination)?;
    }
    Ok(destination)
}

#[tauri::command]
async fn configure_cloud_trust(url: String) -> Result<String, String> {
    let directory = config_directory()?;
    tauri::async_runtime::spawn_blocking(move || {
        vaults_cli::establish_cloud_trust(&directory, &url)
    })
    .await
    .map_err(|_| "Cloud vault verification did not complete".to_owned())?
}

#[tauri::command]
fn configure_server_trust(
    url: String,
    ca_path: String,
    server_id: String,
    expected_fingerprint: String,
) -> Result<String, String> {
    if !expected_fingerprint
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit())
        || expected_fingerprint.len() != 64
    {
        return Err(
            "enter the 64-character CA SHA-256 fingerprint from the server operator".to_owned(),
        );
    }
    let tailscale_ip = url::Url::parse(&url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .filter(|host| {
            host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| {
                let o = ip.octets();
                o[0] == 100 && (64..=127).contains(&o[1])
            })
        });
    if let Some(address) = &tailscale_ip
        && !vaults_cli::tailscale::discover()?
            .iter()
            .any(|peer| &peer.address == address)
    {
        return Err("The selected server is not an online Tailscale peer".to_owned());
    }
    let args = TrustArgs {
        url,
        ca: PathBuf::from(ca_path),
        server_id,
        tailscale_name: None,
        tailscale_ip: tailscale_ip.is_some(),
        config_dir: config_directory()?,
    };
    let validation = validate_trust(&args)?;
    if !validation.contains(&format!(
        "ca_sha256={}",
        expected_fingerprint.to_ascii_lowercase()
    )) {
        return Err("CA fingerprint does not match the operator value".to_owned());
    }
    establish_trust(&args)
}

#[tauri::command]
fn tailscale_peers() -> Result<Vec<vaults_cli::tailscale::Peer>, String> {
    vaults_cli::tailscale::discover()
}

#[tauri::command]
fn preview_server_connection(source: String) -> Result<Value, String> {
    let file = vaults_cli::server_connection::ServerConnection::parse(&source)?;
    Ok(
        json!({ "serverName": file.server_name, "serverUrl": file.server_url, "installationId": file.installation_id }),
    )
}

#[tauri::command]
fn initial_server_connection() -> Result<Option<String>, String> {
    use std::io::Read;
    let mut args = std::env::args_os().skip(1);
    while let Some(argument) = args.next() {
        if argument != "--connection-file" {
            continue;
        }
        let path = args.next().ok_or("Missing public connection file")?;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| "Cannot read the shared connection file")?
            .take(32769)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read the shared connection file")?;
        let source = String::from_utf8(bytes).map_err(|_| "Invalid connection file")?;
        vaults_cli::server_connection::ServerConnection::parse(&source)?;
        return Ok(Some(source));
    }
    Ok(None)
}

#[tauri::command]
async fn import_server_connection(source: String) -> Result<String, String> {
    let file = vaults_cli::server_connection::ServerConnection::parse(&source)?;
    let directory = config_directory()?;
    tauri::async_runtime::spawn_blocking(move || file.establish(&directory))
        .await
        .map_err(|_| "Server verification did not complete".to_owned())?
}

#[tauri::command]
async fn server_setup_status() -> Result<Value, String> {
    let directory = config_directory()?;
    tauri::async_runtime::spawn_blocking(move || {
        vaults_cli::server_connection::setup_status(&directory)
    })
    .await
    .map_err(|_| "Server check did not complete".to_owned())?
}

fn profile(path: &std::path::Path, key: &str) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")).map(str::to_owned))
}

fn secret_cache_path(config: &Path) -> PathBuf {
    config.join("account-secret-cache.json")
}

fn secret_cache_key(config: &Path, username: &str) -> Option<String> {
    let server = profile(&config.join("trust.conf"), "server_id")?;
    let device = profile(&config.join("device.conf"), "device_id")?;
    Some(format!("{server}:{device}:{username}"))
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn cache_expiry() -> u64 {
    now_seconds() + 30 * 24 * 60 * 60
}

fn cached_username(config: &Path) -> Option<String> {
    let record: Value = serde_json::from_slice(&fs::read(secret_cache_path(config)).ok()?).ok()?;
    let username = record["username"].as_str()?;
    let expires_at = record["expiresAt"].as_u64()?;
    if expires_at <= now_seconds() {
        return None;
    }
    Some(username.to_owned())
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
fn cached_account_secret(config: &Path, username: &str) -> Option<String> {
    if cached_username(config)?.as_str() != username {
        return None;
    }
    let entry = keyring::Entry::new(
        &vaults_cli::namespace::service("127Vaults account secret").ok()?,
        &secret_cache_key(config, username)?,
    )
    .ok()?;
    let secret = String::from_utf8(entry.get_secret().ok()?).ok()?;
    (secret.len() == 64 && secret.bytes().all(|b| b.is_ascii_hexdigit())).then_some(secret)
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn cached_account_secret(_config: &Path, _username: &str) -> Option<String> {
    None
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
fn remember_account_secret(config: &Path, username: &str, secret: &str) -> Result<(), String> {
    let key = secret_cache_key(config, username).ok_or("device identity is unavailable")?;
    let entry = keyring::Entry::new(
        &vaults_cli::namespace::service("127Vaults account secret")?,
        &key,
    )
    .map_err(|_| "OS credential storage is unavailable")?;
    entry
        .set_secret(secret.as_bytes())
        .map_err(|_| "account secret could not be protected by the OS")?;
    let record = json!({"username":username,"expiresAt":cache_expiry()});
    fs::write(
        secret_cache_path(config),
        serde_json::to_vec(&record).map_err(|_| "account secret cache metadata is invalid")?,
    )
    .map_err(|_| "account secret cache metadata could not be saved".to_owned())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn remember_account_secret(_config: &Path, _username: &str, _secret: &str) -> Result<(), String> {
    Err("OS credential storage is unavailable".to_owned())
}

#[tauri::command]
fn desktop_info() -> Result<Value, String> {
    let config = config_directory()?;
    let trust = config.join("trust.conf");
    let origin = profile(&trust, "url");
    let cloud = profile(&trust, "mode").as_deref() == Some("cloud");
    Ok(json!({
        "configured": config.join("trust.conf").is_file() && config.join("device.conf").is_file(),
        "configurationPath": config,
        "serverAddress": origin,
        "registrationUrl": origin.as_ref().map(|url| format!("{}/?register=1", url.trim_end_matches('/'))),
        "cloudVaultUrl": origin.filter(|_| cloud).map(|url| format!("{}/", url.trim_end_matches('/'))),
        "cachedUsername": cached_username(&config),
        "hasCachedSecret": cached_username(&config).and_then(|username| cached_account_secret(&config, &username)).is_some(),
        "deviceId": profile(&config.join("device.conf"), "device_id"),
    }))
}

fn with_session<T>(
    state: &tauri::State<'_, DesktopState>,
    action: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "desktop vault state is unavailable".to_owned())?;
    let (epoch, session) = guard.as_mut().ok_or("vault is locked")?;
    let expected = *epoch;
    let expired = state
        .idle
        .lock()
        .map_err(|_| "desktop idle state is unavailable")?
        .as_ref()
        .is_some_and(|lease| lease.expired(expected, std::time::Instant::now()));
    if state.epoch.current() != expected || expired {
        // The watchdog emits the lock event before dropping an expired online
        // session, whose logout request can block on the network.
        if !expired {
            guard.take();
        }
        return Err("vault is locked".to_owned());
    }
    session.require_license(false)?;
    let result = action(session);
    if state.epoch.current() != expected {
        guard.take();
        return Err("vault is locked".to_owned());
    }
    result
}

#[tauri::command]
#[allow(clippy::too_many_lines)] // One ordered unlock ceremony and its isolated blocking worker.
async fn unlock(
    state: tauri::State<'_, DesktopState>,
    username: String,
    account_secret: String,
    master_password: String,
) -> Result<Value, String> {
    if state.unlocking.swap(true, Ordering::AcqRel) {
        return Err("unlock is already in progress".to_owned());
    }
    let _lease = UnlockLease(&state.unlocking);
    let epoch = {
        let _transition = state
            .transitions
            .lock()
            .map_err(|_| "desktop transition state is unavailable")?;
        let epoch = state.epoch.advance();
        state
            .connector_seen
            .lock()
            .map_err(|_| "desktop connector state is unavailable")?
            .take();
        if let Some((_, path)) = state
            .connector_owned
            .lock()
            .map_err(|_| "desktop connector state is unavailable".to_owned())?
            .take()
        {
            stop_connector_agent(&path);
        }
        epoch
    };
    // Password derivation, replica verification and the initial network request
    // can all be expensive. Keep them off the webview command thread so the
    // unlock progress UI remains responsive.
    let config = config_directory()?;
    let connector_config = config.clone();
    let transitions = state.transitions.clone();
    let current_epoch = state.epoch.clone();
    let supplied_secret = !account_secret.is_empty();
    let (session, result, connector_owned) = tauri::async_runtime::spawn_blocking(move || {
        let secret = if account_secret.is_empty() {
            cached_account_secret(&config, &username)
                .ok_or("account secret is required on this device or after 30 days")?
        } else {
            account_secret
        };
        let mut session = unlock_with_offline_fallback(
            &config,
            &username,
            &secret,
            master_password.as_bytes(),
        )?;
        session.use_background_license_refresh();
        let online = session.is_online();
        let offline_reason = session.offline_reason().map(str::to_owned);
        let vaults = session.vault_list()?;
        let vault = vaults
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["retired"] != true).or_else(|| rows.first()))
            .and_then(|row| row["vaultId"].as_str())
            .map(str::to_owned).ok_or("no local vault is available")?;
        let settings = session.vault_settings();
        let default_view = settings["defaultView"].clone();
        let has_active_vault = vaults.as_array().is_some_and(|rows| rows.iter().any(|row| row["retired"] != true));
        let view_kind = if has_active_vault { default_view["kind"].as_str().unwrap_or("all") } else { "all" };
        let (items, collection_id) = match view_kind {
            "all" => (session.item_list_all()?, None),
            "collection" => {
                let id = default_view["id"].as_str().ok_or("default collection is invalid")?;
                (session.collection_items(id)?["items"].clone(), Some(id.to_owned()))
            }
            "vault" => {
                let selected = default_view["id"].as_str().unwrap_or(&vault);
                if vaults.as_array().is_some_and(|rows| rows.iter().any(|row| row["vaultId"] == selected && row["retired"] != true)) {
                    (session.item_list(selected)?, None)
                } else { (session.item_list(&vault)?, None) }
            }
            _ => (session.item_list(&vault)?, None),
        };
        let initial_vault = if view_kind == "vault" {
            default_view["id"].as_str().filter(|selected| vaults.as_array().is_some_and(|rows| rows.iter().any(|row| row["vaultId"] == *selected && row["retired"] != true))).unwrap_or(&vault).to_owned()
        } else { vault.clone() };
        let secret_remembered = if supplied_secret { remember_account_secret(&config, &username, &secret).is_ok() } else { true };
        let _transition = transitions.lock().map_err(|_| "desktop transition state is unavailable")?;
        if current_epoch.current() != epoch { return Err("unlock was canceled by a lock request".into()); }
        let connector_start = if vaults_cli::connector_agent_desktop_compatible(&config) {
            Ok(false)
        } else {
            std::env::current_exe()
                .map_err(|_| "Desktop executable is unavailable".to_owned())
                .and_then(|exe| start_connector_agent(&exe, &config, &username, &secret, master_password.as_bytes()))
                .map(|()| true)
        };
        let connector_error = connector_start.as_ref().err().cloned();
        let connector_owned = connector_start.unwrap_or(false);
        Ok::<_, String>((
            session,
            json!({"online":online,"offlineReason":offline_reason,"vaultId":initial_vault,"vaults":vaults,"items":items,"settings":settings,"viewKind":view_kind,"collectionId":collection_id,"secretRemembered":secret_remembered,"extensionConnectorActive":connector_owned || connector_agent_active(&config),"extensionConnectorError":connector_error}),
            connector_owned.then_some(config),
        ))
    })
    .await
    .map_err(|_| "the secure unlock worker stopped unexpectedly".to_owned())??;
    commit_unlock(
        &state,
        epoch,
        session,
        result,
        connector_owned,
        connector_config,
    )
}

fn commit_unlock(
    state: &tauri::State<'_, DesktopState>,
    epoch: u64,
    session: Session,
    mut result: Value,
    connector_owned: Option<PathBuf>,
    connector_config: PathBuf,
) -> Result<Value, String> {
    let _transition = state
        .transitions
        .lock()
        .map_err(|_| "desktop transition state is unavailable")?;
    let mut current = state
        .session
        .lock()
        .map_err(|_| "desktop vault state is unavailable")?;
    if state.epoch.current() != epoch {
        if let Some(path) = connector_owned {
            stop_connector_agent(&path);
        }
        return Err("unlock was canceled by a lock request".to_owned());
    }
    *current = Some((epoch, session));
    *state
        .idle
        .lock()
        .map_err(|_| "desktop idle state is unavailable")? =
        Some(idle_lease::IdleLease::new(epoch, std::time::Instant::now()));
    *state
        .connector_owned
        .lock()
        .map_err(|_| "desktop connector state is unavailable".to_owned())? =
        connector_owned.map(|path| (epoch, path));
    *state
        .connector_seen
        .lock()
        .map_err(|_| "desktop connector state is unavailable")? =
        result["extensionConnectorActive"]
            .as_bool()
            .unwrap_or(false)
            .then_some((epoch, connector_config));
    result["sessionEpoch"] = json!(epoch);
    Ok(result)
}

#[tauri::command]
async fn session_activity(state: tauri::State<'_, DesktopState>) -> Result<(), String> {
    let epoch = state.epoch.current();
    if let Some(lease) = state
        .idle
        .lock()
        .map_err(|_| "desktop idle state is unavailable")?
        .as_mut()
    {
        // Activity cannot revive a lease that has already expired.
        if !lease.expired(epoch, std::time::Instant::now()) {
            lease.touch(epoch, std::time::Instant::now());
        }
    }
    let owned = state
        .connector_seen
        .lock()
        .map_err(|_| "desktop connector state is unavailable")?
        .clone();
    if let Some((epoch, path)) = owned
        && state.epoch.current() == epoch
    {
        tauri::async_runtime::spawn_blocking(move || vaults_cli::touch_connector_agent(&path))
            .await
            .map_err(|_| "desktop activity worker failed")?;
    }
    Ok(())
}

#[tauri::command]
async fn import_passwords(
    app: tauri::AppHandle,
    vault_id: String,
    bytes: Vec<u8>,
    format: String,
    confirm: bool,
    selected_vaults: Option<Vec<String>>,
    inspect: Option<bool>,
) -> Result<Value, String> {
    let epoch = app.state::<DesktopState>().epoch.current();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = zeroize::Zeroizing::new(bytes);
        let state = app.state::<DesktopState>();
        if state.epoch.current() != epoch {
            return Err("Vault was locked".into());
        }
        with_session(&state, |session| {
            session.import_passwords_selected(
                &vault_id,
                &bytes,
                &format,
                confirm,
                selected_vaults.as_deref(),
                inspect.unwrap_or(false),
                || state.epoch.current() == epoch,
            )
        })
    })
    .await
    .map_err(|_| "Import worker stopped".to_owned())?
}

#[tauri::command]
fn item_list(state: tauri::State<'_, DesktopState>, vault_id: String) -> Result<Value, String> {
    with_session(&state, |session| session.item_list(&vault_id))
}

#[tauri::command]
fn device_list(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.device_list())
}

#[tauri::command]
fn license_access_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.entitlement_status())
}

#[tauri::command]
async fn license_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    let epoch = state.epoch.current();
    let request = with_session(&state, |session| {
        if session.is_online() {
            Ok(Some(session.license_status_request()?))
        } else {
            Ok(None)
        }
    })?;
    let Some(request) = request else {
        return with_session(&state, |session| session.entitlement_status());
    };
    let received = tauri::async_runtime::spawn_blocking(move || {
        vaults_cli::client::fetch_license_status(request)
    })
    .await
    .map_err(|_| "License worker stopped")?;
    if state.epoch.current() != epoch {
        return Err("Vault was locked".into());
    }
    with_session(&state, |session| match received {
        Ok(status) => {
            session.cache_license_status(status)?;
            session.entitlement_status()
        }
        Err(error)
            if matches!(
                error.as_str(),
                "server connection failed" | "server request timed out"
            ) =>
        {
            session.entitlement_status()
        }
        Err(error) => Err(error),
    })
}

#[tauri::command]
fn device_revoke(
    state: tauri::State<'_, DesktopState>,
    device_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| session.device_revoke(&device_id))
}

#[tauri::command]
fn vault_list(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.vault_list())
}

#[tauri::command]
fn vault_create(state: tauri::State<'_, DesktopState>, name: String) -> Result<Value, String> {
    with_session(&state, |session| {
        let created = session.vault_create(&name)?;
        Ok(json!({"created":created,"vaults":session.vault_list()?}))
    })
}

#[tauri::command]
fn vault_rename(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    name: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        let settings = session.rename_vault(&vault_id, &name)?;
        Ok(json!({"settings":settings,"vaults":session.vault_list()?}))
    })
}

#[tauri::command]
fn vault_settings(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| Ok(session.vault_settings()))
}

#[tauri::command]
fn vault_settings_review(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.vault_settings_review())
}

#[tauri::command]
fn vault_settings_resolve(
    state: tauri::State<'_, DesktopState>,
    keep: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.resolve_vault_settings_conflict(&keep)
    })
}

#[tauri::command]
fn collection_save(
    state: tauri::State<'_, DesktopState>,
    collection_id: Option<String>,
    name: String,
    vault_ids: Vec<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.save_collection(collection_id.as_deref(), &name, &vault_ids)
    })
}

#[tauri::command]
fn collection_remove(
    state: tauri::State<'_, DesktopState>,
    collection_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| session.remove_collection(&collection_id))
}

#[tauri::command]
fn collection_items(
    state: tauri::State<'_, DesktopState>,
    collection_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| session.collection_items(&collection_id))
}

#[tauri::command]
fn vault_default_view(
    state: tauri::State<'_, DesktopState>,
    kind: String,
    selector: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.set_default_view(&kind, selector.as_deref())
    })
}

#[tauri::command]
fn vault_removal_preference(
    state: tauri::State<'_, DesktopState>,
    choice: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.set_removal_preference(choice.as_deref())
    })
}

#[tauri::command]
fn vault_removal_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.removal_status())
}

#[tauri::command]
fn vault_archive(state: tauri::State<'_, DesktopState>, vault_id: String) -> Result<Value, String> {
    with_session(&state, |session| {
        let receipt = session.archive_vault(&vault_id)?;
        Ok(
            json!({"receipt":receipt,"vaults":session.vault_list()?,"settings":session.vault_settings()}),
        )
    })
}

#[tauri::command]
fn vault_move(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    destination_vault_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        let receipt = session.move_vault(&vault_id, &destination_vault_id)?;
        Ok(
            json!({"receipt":receipt,"vaults":session.vault_list()?,"settings":session.vault_settings()}),
        )
    })
}

#[tauri::command]
fn vault_restore(state: tauri::State<'_, DesktopState>, vault_id: String) -> Result<Value, String> {
    with_session(&state, |session| {
        let receipt = session.restore_archived_vault(&vault_id)?;
        Ok(
            json!({"receipt":receipt,"vaults":session.vault_list()?,"settings":session.vault_settings()}),
        )
    })
}

#[tauri::command]
fn vault_abort_move(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.abort_move_plan())
}

#[tauri::command]
fn item_get(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session
            .item_get(&vault_id, &item_id, None)
            .map(renderer_boundary::public_value)
    })
}

#[tauri::command]
fn item_secret(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
    field: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        let summary = session.item_get(&vault_id, &item_id, None)?;
        renderer_boundary::allow_secret(&summary, &field)?;
        session.item_get(&vault_id, &item_id, Some(&field))
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn item_save(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: Option<String>,
    title: String,
    website: String,
    username: String,
    password: String,
    mut custom_fields: Vec<Value>,
    resolving_operation_id: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        if let Some(item) = item_id.as_deref() {
            let original = session.item_get(&vault_id, item, None)?;
            let remove_passkey = custom_fields
                .iter()
                .any(|f| f["id"] == "__127vaults_remove_passkey" && f["value"] == "true");
            custom_fields.retain(|f| f["id"] != "__127vaults_remove_passkey");
            if remove_passkey {
                custom_fields.retain(|f| {
                    f["id"] != "__127vaults_passkey" && f["id"] != "__127vaults_passkey_key"
                });
            }
            if !remove_passkey
                && original["customFields"]
                    .as_array()
                    .is_some_and(|fields| fields.iter().any(|f| f["id"] == "__127vaults_passkey"))
            {
                if website != original["website"].as_str().unwrap_or("") {
                    return Err("A passkey's website cannot be changed".to_owned());
                }
                let key = session.item_get(&vault_id, item, Some("__127vaults_passkey_key"))?;
                custom_fields.retain(|field| {
                    field["id"] != "__127vaults_passkey_key" && field["id"] != "__127vaults_passkey"
                });
                for field in original["customFields"]
                    .as_array()
                    .ok_or("invalid passkey")?
                {
                    if field["id"] == "__127vaults_passkey_key" {
                        let mut restored = field.clone();
                        restored["value"] = key.clone();
                        custom_fields.push(restored);
                    } else if field["id"] == "__127vaults_passkey" {
                        custom_fields.push(field.clone());
                    }
                }
            }
        }
        let save = |session: &mut Session| {
            if let Some(operation_id) = resolving_operation_id.as_deref() {
                session.item_upsert_resolving(
                    &vault_id,
                    item_id.as_deref().ok_or("missing item identity")?,
                    operation_id,
                    &title,
                    &website,
                    &username,
                    &password,
                    &custom_fields,
                )
            } else {
                session.item_upsert(
                    &vault_id,
                    item_id.as_deref(),
                    &title,
                    &website,
                    &username,
                    &password,
                    &custom_fields,
                )
            }
        };
        // Surface a stale-revision response to the UI. Silently retrying here
        // can overwrite an edit made on another device without user review.
        let result = match save(session) {
            Err(error) if error.contains("409") => return Err(error),
            other => other?,
        };
        // The server may advance the catalogue revision when it accepts an
        // update. Refresh the verified replica before the next edit starts.
        if session.is_online() {
            session.sync_now()?;
        }
        let items = session.item_list(&vault_id)?;
        Ok(json!({"result":result,"items":items}))
    })
}

#[tauri::command]
fn item_delete(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
    resolving_operation_id: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        let result = if let Some(operation) = resolving_operation_id {
            let (_, pending_item) = session.conflict_item_id(&vault_id, &operation)?;
            if pending_item != item_id {
                return Err("pending deletion item does not match".to_owned());
            }
            if session.conflict_draft(&vault_id, &item_id, &operation)?["deleted"] != true {
                return Err("pending operation is not a deletion".to_owned());
            }
            session.resolve_conflict(&vault_id, &operation, "local")?
        } else {
            session.item_delete(&vault_id, &item_id)?
        };
        if session.is_online() {
            session.sync_now()?;
        }
        Ok(json!({"result":result,"items":session.item_list(&vault_id)?}))
    })
}

#[tauri::command]
fn replica_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| session.replica_status())
}

#[tauri::command]
fn sync_review(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, vaults_cli::client::Session::sync_review)
}

#[tauri::command]
fn sync(state: tauri::State<'_, DesktopState>, vault_id: String) -> Result<Value, String> {
    with_session(&state, |session| {
        let result = session.sync_now()?;
        let vaults = session.vault_list()?;
        let active = vaults
            .as_array()
            .ok_or("invalid vault list")?
            .iter()
            .filter(|row| row["retired"] != true)
            .collect::<Vec<_>>();
        let selected = active
            .iter()
            .find(|row| row["vaultId"] == vault_id)
            .or_else(|| active.first())
            .and_then(|row| row["vaultId"].as_str())
            .map(str::to_owned);
        let items = match selected.as_deref() {
            Some(id) => session.item_list(id)?,
            None => json!([]),
        };
        Ok(
            json!({"accepted": result["accepted"], "pending":result["pending"], "conflicts":result["conflicts"], "vaultSettings":result["vaultSettings"], "vaults":vaults, "selectedVaultId":selected,"items": items}),
        )
    })
}

#[tauri::command]
fn discard_local_changes(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| {
        let result = session.discard_local_changes()?;
        let vault = session
            .vault_list()?
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["retired"] != true))
            .and_then(|row| row["vaultId"].as_str())
            .map(str::to_owned);
        let items = match vault.as_deref() {
            Some(id) => session.item_list(id)?,
            None => json!([]),
        };
        Ok(json!({"discarded":result["discarded"],"items":items}))
    })
}

#[tauri::command]
fn discard_conflict(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
    operation_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.conflict_compare(&vault_id, &item_id, &operation_id)?;
        session.discard_conflict(&vault_id, &item_id, &operation_id)?;
        Ok(json!({"items":session.item_list(&vault_id)?}))
    })
}

#[tauri::command]
fn conflict_draft(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
    operation_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session
            .conflict_draft(&vault_id, &item_id, &operation_id)
            .map(renderer_boundary::public_value)
    })
}

#[tauri::command]
fn conflict_compare(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
    operation_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session
            .conflict_compare(&vault_id, &item_id, &operation_id)
            .map(renderer_boundary::public_value)
    })
}

#[tauri::command]
fn lock(app: tauri::AppHandle, state: tauri::State<'_, DesktopState>) -> Result<(), String> {
    let _transition = state
        .transitions
        .lock()
        .map_err(|_| "desktop transition state is unavailable")?;
    state.epoch.advance();
    schedule_clipboard_clear(&app, None, true);
    let seen = state
        .connector_seen
        .lock()
        .map_err(|_| "desktop connector state is unavailable")?
        .take();
    state
        .idle
        .lock()
        .map_err(|_| "desktop idle state is unavailable")?
        .take();
    let owned = state
        .connector_owned
        .lock()
        .map_err(|_| "desktop connector state is unavailable")?
        .take();
    for path in connector_lock_paths(
        seen.map(|(_, path)| path),
        owned.map(|(_, path)| path),
        config_directory().ok(),
    ) {
        stop_connector_agent(&path);
    }
    state
        .session
        .lock()
        .map_err(|_| "desktop vault state is unavailable".to_owned())?
        .take();
    Ok(())
}

fn connector_lock_paths(
    seen: Option<PathBuf>,
    owned: Option<PathBuf>,
    pending: Option<PathBuf>,
) -> std::collections::BTreeSet<PathBuf> {
    seen.into_iter().chain(owned).chain(pending).collect()
}

#[cfg(test)]
mod lock_tests {
    use super::*;
    #[test]
    fn explicit_lock_revokes_borrowed_owned_and_pending_connectors_once() {
        let path = PathBuf::from("synthetic-profile");
        assert!(connector_lock_paths(Some(path.clone()), None, None).contains(&path));
        assert!(connector_lock_paths(None, Some(path.clone()), None).contains(&path));
        assert!(connector_lock_paths(None, None, Some(path.clone())).contains(&path));
        assert_eq!(
            connector_lock_paths(Some(path.clone()), Some(path.clone()), Some(path)).len(),
            1
        );
    }
}

fn schedule_clipboard_clear(app: &tauri::AppHandle, owner: Option<String>, force: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        handle
            .state::<clipboard::ClipboardState>()
            .clear(owner.as_deref(), force);
    });
}

#[tauri::command]
async fn clipboard_copy(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    value: String,
) -> Result<(), String> {
    let epoch = app.state::<DesktopState>().epoch.current();
    let owner = window.label().to_owned();
    let handle = app.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let state = handle.state::<DesktopState>();
        let result = if state.epoch.current() == epoch {
            with_session(&state, |_| {
                handle
                    .state::<clipboard::ClipboardState>()
                    .copy(owner, value)
            })
        } else {
            Err("Vault is locked".into())
        };
        let _ = sender.try_send(result);
    })
    .map_err(|_| "Clipboard worker is unavailable")?;
    receiver.recv().await.ok_or("Clipboard worker stopped")?
}

#[tauri::command]
fn begin_device_enrollment(
    state: tauri::State<'_, DesktopState>,
    username: String,
) -> Result<(), String> {
    if username.trim().is_empty() {
        return Err("enter your registered username".to_owned());
    }
    let config = config_directory()?;
    let enrollment = state.enrollment.clone();
    *enrollment
        .lock()
        .map_err(|_| "enrollment state is unavailable")? = json!({"state":"starting"});
    std::thread::spawn(move || {
        let existing = config.join("device.conf");
        let backup = config.join("device.conf.before-enrollment");
        let had_existing = existing.is_file();
        if had_existing && fs::rename(&existing, &backup).is_err() {
            if let Ok(mut value) = enrollment.lock() {
                *value = json!({"state":"error","message":"existing desktop identity could not be preserved"});
            }
            return;
        }
        let status = enrollment.clone();
        let callback_config = config.clone();
        let result = enroll_device_with_status(&config, username.trim(), move |code| {
            let trust = callback_config.join("trust.conf");
            let origin = profile(&trust, "url").unwrap_or_default();
            let separator = if profile(&trust, "mode").as_deref() == Some("cloud") {
                '#'
            } else {
                '?'
            };
            if let Ok(mut value) = status.lock() {
                *value = json!({"state":"approval","code":code,"approvalUrl":format!("{}/{separator}enrollDevice={code}", origin.trim_end_matches('/'))});
            }
        });
        match result {
            Ok(_) => {
                let _ = fs::remove_file(&backup);
                if let Ok(mut value) = enrollment.lock() {
                    *value = json!({"state":"complete"});
                }
            }
            Err(message) => {
                if had_existing {
                    let _ = fs::rename(&backup, &existing);
                }
                if let Ok(mut value) = enrollment.lock() {
                    *value = json!({"state":"error","message":message});
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn device_enrollment_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    state
        .enrollment
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "enrollment state is unavailable".to_owned())
}

fn run_embedded_connector() -> bool {
    if let Some(result) = vaults_cli::desktop_connector_entry() {
        match result {
            Ok(output) => println!("{output}"),
            Err(error) => {
                println!("{}", json!({"error":error}));
                eprintln!("127Vaults connector: {error}");
                std::process::exit(2);
            }
        }
        return true;
    }
    false
}

#[allow(clippy::too_many_lines)] // Tauri startup, event handlers and explicit command registration stay together.
fn main() {
    if let Err(error) = vaults_cli::namespace::Namespace::current() {
        eprintln!("{error}");
        std::process::exit(2);
    }
    if run_embedded_connector() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DesktopState::default())
        .manage(clipboard::ClipboardState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                // Native cleanup remains available after the renderer is gone.
                window
                    .state::<clipboard::ClipboardState>()
                    .clear(Some(window.label()), true);
                if window.label() == "main" {
                    window
                        .state::<clipboard::ClipboardState>()
                        .clear(None, true);
                    let _ = lock(window.app_handle().clone(), window.state::<DesktopState>());
                }
            }
        })
        .setup(|app| {
            let namespace = vaults_cli::namespace::Namespace::current()?;
            if !namespace.production()
                && let Some(window) = app.get_webview_window("main")
            {
                window.set_title(&format!("{} Desktop", namespace.name()))?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut confirmation = vaults_cli::ConnectorLockConfirmation::default();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    schedule_clipboard_clear(&handle, None, false);
                    let state = handle.state::<DesktopState>();
                    let epoch = state.epoch.current();
                    let expired = state.idle.lock().is_ok_and(|lease| {
                        lease
                            .as_ref()
                            .is_some_and(|lease| lease.expired(epoch, std::time::Instant::now()))
                    });
                    let owned = state
                        .connector_seen
                        .lock()
                        .ok()
                        .and_then(|owned| owned.clone());
                    let reason = if expired {
                        Some("Vault locked after inactivity".to_owned())
                    } else {
                        owned
                            .as_ref()
                            .and_then(|(_, path)| vaults_cli::connector_agent_lock_reason(path))
                    };
                    if state.epoch.current() != epoch
                        || !(expired || confirmation.observe(epoch, reason.is_some()))
                    {
                        continue;
                    }
                    let Ok(_transition) = state.transitions.lock() else {
                        continue;
                    };
                    if !state.epoch.revoke(epoch) {
                        continue;
                    }
                    // Revoke access and notify every window before waiting on an in-flight network operation.
                    let _ = handle.emit(
                        "vaults-connector-locked",
                        json!({"epoch":epoch,"reason":reason}),
                    );
                    if let Some((saved, path)) = owned
                        && saved == epoch
                    {
                        stop_connector_agent(&path);
                    }
                    schedule_clipboard_clear(&handle, None, true);
                    if let Ok(mut session) = state.session.lock()
                        && session.as_ref().is_some_and(|(saved, _)| *saved == epoch)
                    {
                        session.take();
                    }
                    if let Ok(mut owned) = state.connector_owned.lock()
                        && owned.as_ref().is_some_and(|(saved, _)| *saved == epoch)
                    {
                        owned.take();
                    }
                    if let Ok(mut seen) = state.connector_seen.lock()
                        && seen.as_ref().is_some_and(|(saved, _)| *saved == epoch)
                    {
                        seen.take();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_secret,
            clipboard_copy,
            native_passkey_provider,
            desktop_info,
            unlock,
            session_activity,
            item_list,
            import_passwords,
            vault_list,
            vault_create,
            device_list,
            license_status,
            license_access_status,
            device_revoke,
            vault_rename,
            vault_settings,
            vault_settings_review,
            vault_settings_resolve,
            collection_save,
            collection_remove,
            collection_items,
            vault_default_view,
            vault_removal_preference,
            vault_removal_status,
            vault_archive,
            vault_move,
            vault_restore,
            vault_abort_move,
            item_get,
            item_secret,
            item_save,
            item_delete,
            replica_status,
            sync_review,
            sync,
            discard_local_changes,
            discard_conflict,
            conflict_draft,
            conflict_compare,
            lock,
            begin_device_enrollment,
            device_enrollment_status,
            configure_server_trust,
            preview_server_connection,
            initial_server_connection,
            import_server_connection,
            server_setup_status,
            configure_cloud_trust,
            tailscale_peers
        ])
        .run(tauri::generate_context!())
        .expect("desktop POC runtime failed");
}
