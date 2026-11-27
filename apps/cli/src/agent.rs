use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::client::{self, Session};

static PASSKEY_SESSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
fn passkey_session() -> &'static str {
    PASSKEY_SESSION.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

const IDLE_TTL: Duration = Duration::from_mins(30);
const CAPABILITY_SERVICE: &str = "127Vaults CLI unlock lease";

fn redact_conflict_fields(item: &mut Value) {
    item["password"] = json!("[redacted]");
    if let Some(fields) = item["customFields"].as_array_mut() {
        for field in fields {
            if field["type"] == "password" {
                field["value"] = json!("[redacted]");
            }
        }
    }
}

fn conflict_field_choices(
    base: &str,
    choices: &[String],
) -> Result<Vec<(&'static str, bool)>, String> {
    if !matches!(base, "local" | "server") {
        return Err("explicit local or server merge base is required".to_owned());
    }
    let mut result = ["title", "website", "username", "password", "customFields"]
        .map(|field| (field, base == "local"))
        .to_vec();
    let mut seen = std::collections::HashSet::new();
    for choice in choices {
        let (field, source) = choice
            .split_once('=')
            .ok_or("field source must be FIELD=local or FIELD=server")?;
        if !seen.insert(field) || !matches!(source, "local" | "server") {
            return Err("duplicate field or invalid field source".to_owned());
        }
        let target = result
            .iter_mut()
            .find(|(name, _)| *name == field)
            .ok_or("unknown merge field")?;
        target.1 = source == "local";
    }
    Ok(result)
}

#[derive(Serialize, Deserialize)]
struct Startup {
    account_secret: String,
    master_password: String,
}

impl Drop for Startup {
    fn drop(&mut self) {
        self.account_secret.zeroize();
        self.master_password.zeroize();
    }
}

#[derive(Serialize)]
struct StartupRef<'a> {
    account_secret: &'a str,
    master_password: &'a str,
}

#[derive(Serialize, Deserialize)]
struct Request {
    capability: String,
    action: String,
    #[serde(default)]
    vault: Option<String>,
    #[serde(default)]
    migration_file: Option<std::path::PathBuf>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    destination: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    collection_id: Option<String>,
    #[serde(default)]
    vault_ids: Vec<String>,
    #[serde(default)]
    view_kind: Option<String>,
    #[serde(default)]
    choice: Option<String>,
    #[serde(default)]
    clear: bool,
    #[serde(default)]
    keep_copies: bool,
    #[serde(default)]
    item: Option<String>,
    #[serde(default)]
    entry_id: Option<String>,
    #[serde(default)]
    operation_id: Option<String>,
    #[serde(default)]
    keep: Option<String>,
    #[serde(default)]
    field_sources: Vec<String>,
    #[serde(default)]
    password_field: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    website: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default, rename = "customFields")]
    custom_fields: Vec<Value>,
    #[serde(default)]
    passkey_metadata: Value,
    #[serde(default)]
    verification_session: Option<String>,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    enrollment_id: Option<String>,
    #[serde(default)]
    fingerprint: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Response {
    ok: bool,
    value: Value,
}

fn clear_value(value: &mut Value) {
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(rows) => rows.iter_mut().for_each(clear_value),
        Value::Object(fields) => fields.values_mut().for_each(clear_value),
        _ => {}
    }
}
struct SensitiveValue(Value);
impl Drop for SensitiveValue {
    fn drop(&mut self) {
        clear_value(&mut self.0);
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        self.capability.zeroize();
        if let Some(password) = &mut self.password {
            password.zeroize();
        }
        self.custom_fields.iter_mut().for_each(clear_value);
        clear_value(&mut self.passkey_metadata);
    }
}
impl Drop for Response {
    fn drop(&mut self) {
        clear_value(&mut self.value);
    }
}
struct LeaseCleanup {
    state: PathBuf,
    protected: keyring::Entry,
}
impl Drop for LeaseCleanup {
    fn drop(&mut self) {
        let _ = self.protected.delete_credential();
        let _ = fs::remove_file(&self.state);
    }
}

fn profile(path: &Path, key: &str) -> Result<String, String> {
    crate::namespace::validate_profile(path)?;
    fs::read_to_string(path)
        .map_err(|_| "client profile is missing".to_owned())?
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")).map(str::to_owned))
        .ok_or_else(|| "client profile is invalid".to_owned())
}

fn identity(config_dir: &Path) -> Result<String, String> {
    let server = profile(&config_dir.join("trust.conf"), "server_id")?;
    let device = profile(&config_dir.join("device.conf"), "device_id")?;
    Ok(format!("{server}:{device}"))
}

fn entry(config_dir: &Path) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        &crate::namespace::service(CAPABILITY_SERVICE)?,
        &profile_identity(config_dir)?,
    )
    .map_err(|_| "OS credential storage is unavailable".to_owned())
}

fn profile_identity(config_dir: &Path) -> Result<String, String> {
    let canonical =
        fs::canonicalize(config_dir).map_err(|_| "client profile is unavailable".to_owned())?;
    let digest = Sha256::digest(canonical.as_os_str().as_encoded_bytes());
    Ok(format!(
        "{}:profile-v2:{}",
        identity(config_dir)?,
        hex::encode(digest)
    ))
}

fn legacy_entry(config_dir: &Path) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        &crate::namespace::service(CAPABILITY_SERVICE)?,
        &identity(config_dir)?,
    )
    .map_err(|_| "OS credential storage is unavailable".to_owned())
}

fn state_path(config_dir: &Path) -> PathBuf {
    config_dir.join("agent.conf")
}

fn vault_selector(session: &Session, requested: Option<&str>) -> Result<String, String> {
    if let Some(value) = requested {
        return Ok(value.to_owned());
    }
    let listed = session.vault_list()?;
    let rows = listed
        .as_array()
        .ok_or("invalid vault list")?
        .iter()
        .filter(|row| row["retired"] != true)
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err(
            "--vault is required when the account does not have exactly one vault".to_owned(),
        );
    }
    rows[0]["vaultId"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "invalid vault list".to_owned())
}

#[allow(clippy::too_many_lines)]
fn dispatch(
    session: &mut Session,
    request: &mut Request,
    read_only: bool,
) -> Result<Value, String> {
    if request
        .verification_session
        .as_deref()
        .is_some_and(|value| value != passkey_session())
    {
        return Err("Desktop unlock session changed; start sign-in again".to_owned());
    }
    if read_only
        && !matches!(
            request.action.as_str(),
            "status"
                | "extension.status"
                | "extension.logins"
                | "extension.get"
                | "logout"
                | "vault.list"
                | "replica.status"
                | "license.status"
                | "item.list"
                | "item.list.all"
                | "item.get"
                | "migration.export"
                | "passkey.list"
                | "passkey.targets"
                | "passkey.get"
                | "passkey.save"
                | "native.preview"
                | "native.perform"
                | "native.cache"
        )
    {
        if let Some(password) = request.password.as_mut() {
            password.zeroize();
        }
        return Err("read-only agent command denied".to_owned());
    }
    if request.action == "extension.status" {
        return session.connector_status();
    }
    if request.action == "extension.logins" {
        let site = request.website.as_deref().ok_or("Site required")?;
        return session
            .with_cached_license(|session| crate::extension_host::session_entries(session, site));
    }
    if request.action == "extension.get" {
        return session.with_cached_license(|session| {
            crate::extension_host::session_credential(
                session,
                request.vault.as_deref().ok_or("Vault required")?,
                request.item.as_deref().ok_or("Item required")?,
                request.entry_id.as_deref().unwrap_or(""),
                request.website.as_deref().ok_or("Site required")?,
            )
        });
    }
    if matches!(request.action.as_str(), "status" | "replica.status") {
        session.require_cached_license(false)?;
    } else if !matches!(request.action.as_str(), "license.status" | "logout") {
        session.require_license(false)?;
    }
    let result = match request.action.as_str() {
        "status" => Ok(
            json!({"authenticated":session.is_online(),"unlocked":true,"online":session.is_online(),"offlineReason":session.offline_reason(),"idleTimeoutSeconds":IDLE_TTL.as_secs(),"nativePasskeyProtocol":4,"desktopConnectorProtocol":1,"extensionReadProtocol":1,"passkeyVerificationSession":passkey_session()}),
        ),
        "logout" => Ok(json!({"loggedOut":true})),
        "migration.import" => {
            let path = request
                .migration_file
                .as_ref()
                .ok_or("Import file is required")?;
            let mut bytes = zeroize::Zeroizing::new(Vec::new());
            fs::File::open(path)
                .map_err(|_| "Import file is unavailable")?
                .take((crate::migration::MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read import")?;
            session.import_passwords(
                request.vault.as_deref().ok_or("Target vault is required")?,
                &bytes,
                request.format.as_deref().ok_or("Format is required")?,
                request.confirm,
            )
        }
        "migration.export" => session.export_passwords(
            request
                .migration_file
                .as_deref()
                .ok_or("Output file is required")?,
            request.format.as_deref().unwrap_or("127vaults"),
        ),
        "vault.list" => session.vault_list(),
        "replica.status" => session.replica_status(),
        "license.status" => session.license_status(),
        "device.list" => session.device_list(),
        "device.inspect" => session.inspect_device_code(
            request
                .code
                .as_deref()
                .ok_or("enrollment code is required")?,
        ),
        "device.approve" => session.approve_reviewed_device(
            request
                .code
                .as_deref()
                .ok_or("enrollment code is required")?,
            request
                .enrollment_id
                .as_deref()
                .ok_or("reviewed enrollment ID is required")?,
            request
                .device_id
                .as_deref()
                .ok_or("reviewed device ID is required")?,
            request
                .fingerprint
                .as_deref()
                .ok_or("reviewed fingerprint is required")?,
        ),
        "device.revoke" => session.device_revoke(
            request
                .device_id
                .as_deref()
                .ok_or("device ID is required")?,
        ),
        "sync" => session.sync_now(),
        "sync.review" => session.sync_review(),
        "conflict.list" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            session.conflict_list(&vault)
        }
        "conflict.show" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            let operation = request
                .operation_id
                .as_deref()
                .ok_or("operation ID is required")?;
            let (vault_id, item_id) = session.conflict_item_id(&vault, operation)?;
            let mut draft = session.conflict_draft(&vault_id, &item_id, operation)?;
            redact_conflict_fields(&mut draft);
            Ok(json!({"operationId":operation,"draft":draft}))
        }
        "conflict.compare" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            let operation = request
                .operation_id
                .as_deref()
                .ok_or("operation ID is required")?;
            let (vault_id, item_id) = session.conflict_item_id(&vault, operation)?;
            let mut comparison = session.conflict_compare(&vault_id, &item_id, operation)?;
            let mut draft = session.conflict_draft(&vault_id, &item_id, operation)?;
            redact_conflict_fields(&mut draft);
            if comparison["server"].is_object() {
                redact_conflict_fields(&mut comparison["server"]);
            }
            comparison["operationId"] = json!(operation);
            comparison["vaultId"] = json!(vault_id);
            comparison["itemId"] = json!(item_id);
            comparison["draft"] = draft;
            Ok(comparison)
        }
        "conflict.merge" => {
            let choices = conflict_field_choices(
                request.keep.as_deref().unwrap_or(""),
                &request.field_sources,
            )?;
            let vault = vault_selector(session, request.vault.as_deref())?;
            let operation = request
                .operation_id
                .as_deref()
                .ok_or("operation ID is required")?;
            let (vault_id, item_id) = session.conflict_item_id(&vault, operation)?;
            let comparison = session.conflict_compare(&vault_id, &item_id, operation)?;
            if !comparison["server"].is_object() {
                return Err("server item is absent; queued edit preserved; choose explicit whole-version recovery".to_owned());
            }
            let draft = session.conflict_draft(&vault_id, &item_id, operation)?;
            let mut merged = json!({});
            for (field, local) in choices {
                merged[field] = if local {
                    draft[field].clone()
                } else {
                    comparison["server"][field].clone()
                };
            }
            session.item_upsert_resolving(
                &vault_id,
                &item_id,
                operation,
                merged["title"].as_str().ok_or("invalid merge title")?,
                merged["website"].as_str().ok_or("invalid merge website")?,
                merged["username"]
                    .as_str()
                    .ok_or("invalid merge username")?,
                merged["password"]
                    .as_str()
                    .ok_or("invalid merge password")?,
                merged["customFields"]
                    .as_array()
                    .ok_or("invalid merge custom fields")?,
            )
        }
        "conflict.resolve" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            session.resolve_conflict(
                &vault,
                request
                    .operation_id
                    .as_deref()
                    .ok_or("operation ID is required")?,
                request
                    .keep
                    .as_deref()
                    .ok_or("resolution choice is required")?,
            )
        }
        "vault.create" => session.vault_create(request.name.as_deref().unwrap_or("Private")),
        "vault.settings" => Ok(session.vault_settings()),
        "vault.settings.sync" => session.sync_vault_settings(),
        "vault.settings.review" => session.vault_settings_review(),
        "vault.settings.resolve" => session.resolve_vault_settings_conflict(
            request
                .keep
                .as_deref()
                .ok_or("resolution choice is required")?,
        ),
        "vault.rename" => session.rename_vault(
            request.vault.as_deref().ok_or("vault is required")?,
            request.name.as_deref().ok_or("name is required")?,
        ),
        "vault.settings.preference" => session.set_removal_preference(request.choice.as_deref()),
        "vault.archive" => {
            session.archive_vault(request.vault.as_deref().ok_or("vault is required")?)
        }
        "vault.move" => session.move_vault(
            request.vault.as_deref().ok_or("vault is required")?,
            request
                .destination
                .as_deref()
                .ok_or("destination is required")?,
        ),
        "vault.removal.status" => session.removal_status(),
        "vault.move.abort" => {
            if request.keep_copies {
                session.abort_move_plan()
            } else {
                Err("--keep-copies is required".to_owned())
            }
        }
        "vault.restore" => {
            session.restore_archived_vault(request.vault.as_deref().ok_or("vault is required")?)
        }
        "vault.settings.default-view" => session.set_default_view(
            request
                .view_kind
                .as_deref()
                .ok_or("view kind is required")?,
            request
                .vault
                .as_deref()
                .or(request.collection_id.as_deref()),
        ),
        "collection.save" => session.save_collection(
            request.collection_id.as_deref(),
            request.name.as_deref().ok_or("name is required")?,
            &request.vault_ids,
        ),
        "collection.remove" => session.remove_collection(
            request
                .collection_id
                .as_deref()
                .ok_or("collection ID is required")?,
        ),
        "collection.items" => session.collection_items(
            request
                .collection_id
                .as_deref()
                .ok_or("collection ID is required")?,
        ),
        "vault.info" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            session.vault_info(&vault)
        }
        "vault.default" => {
            let id = if request.clear {
                session.set_default_vault(None)?
            } else if let Some(vault) = request.vault.as_deref() {
                session.set_default_vault(Some(vault))?
            } else {
                session.default_vault()?
            };
            Ok(json!({"defaultVaultId":id}))
        }
        "item.list" => {
            let vault = vault_selector(session, request.vault.as_deref())?;
            session.item_list(&vault)
        }
        "item.list.all" => session.item_list_all(),
        "passkey.targets" => {
            session.passkey_targets(request.website.as_deref().ok_or("Site required")?)
        }
        "passkey.list" => session.passkey_list(
            request
                .website
                .as_deref()
                .ok_or("site origin is required")?,
        ),
        "passkey.get" => session.passkey_get(
            request.vault.as_deref().ok_or("vault is required")?,
            request.item.as_deref().ok_or("item is required")?,
            request
                .website
                .as_deref()
                .ok_or("site origin is required")?,
        ),
        "native.cache" => {
            let mut entries = Vec::new();
            let rows = session.item_list_all()?;
            let mut sites = std::collections::HashSet::new();
            for row in rows.as_array().ok_or("Invalid item list")? {
                if row["itemType"] == "passkey"
                    && let Some(site) = row["website"].as_str()
                    && sites.insert(site.to_owned())
                {
                    entries.extend(
                        session
                            .passkey_list(site)?
                            .as_array()
                            .ok_or("Invalid passkey list")?
                            .iter()
                            .cloned(),
                    );
                }
            }
            Ok(json!({"entries":entries}))
        }
        "native.preview" => {
            crate::native_passkeys::dispatch(session, &request.passkey_metadata, true)
        }
        "native.perform" => {
            crate::native_passkeys::dispatch(session, &request.passkey_metadata, false)
        }
        "passkey.save" => session.passkey_save_into(
            request.vault.as_deref().ok_or("vault is required")?,
            request.item.as_deref().filter(|item| !item.is_empty()),
            request
                .website
                .as_deref()
                .ok_or("site origin is required")?,
            &request.passkey_metadata,
            request.password.as_deref().ok_or("key is required")?,
        ),
        "item.get" => session.item_get(
            &vault_selector(session, request.vault.as_deref())?,
            request.item.as_deref().ok_or("item is required")?,
            request.password_field.as_deref(),
        ),
        "item.create" => session.item_upsert(
            &vault_selector(session, request.vault.as_deref())?,
            None,
            request.title.as_deref().ok_or("title is required")?,
            request.website.as_deref().unwrap_or(""),
            request.username.as_deref().unwrap_or(""),
            request.password.as_deref().unwrap_or(""),
            &request.custom_fields,
        ),
        "item.delete" => session.item_delete(
            &vault_selector(session, request.vault.as_deref())?,
            request.item.as_deref().ok_or("item is required")?,
        ),
        "item.edit" => session.item_upsert(
            &vault_selector(session, request.vault.as_deref())?,
            request.item.as_deref(),
            request.title.as_deref().ok_or("title is required")?,
            request.website.as_deref().unwrap_or(""),
            request.username.as_deref().unwrap_or(""),
            request.password.as_deref().unwrap_or(""),
            &request.custom_fields,
        ),
        _ => Err("unsupported agent command".to_owned()),
    };
    if let Some(password) = request.password.as_mut() {
        password.zeroize();
    }
    result
}

fn read_agent_request(stream: &TcpStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "local agent failed")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "local agent failed")?;
    let reader = stream.try_clone().map_err(|_| "local agent failed")?;
    let mut input = Zeroizing::new(String::new());
    BufReader::new(reader)
        .take(1_048_577)
        .read_line(&mut input)
        .map_err(|_| "invalid local agent request")?;
    if input.len() > 1_048_576 || !input.ends_with('\n') {
        return Err("invalid local agent request".to_owned());
    }
    serde_json::from_str(&input).map_err(|_| "invalid local agent request".to_owned())
}
pub fn serve(config_dir: &Path, username: &str, read_only: bool) -> Result<String, String> {
    // Credentials must leave scope before the long-lived agent loop, on success or failure.
    let session = {
        let mut line = Zeroizing::new(String::new());
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|_| "could not receive unlock material")?;
        let mut startup: Startup =
            serde_json::from_str(&line).map_err(|_| "invalid unlock material")?;
        line.zeroize();
        let password = Zeroizing::new(startup.master_password.as_bytes().to_vec());
        let secret = Zeroizing::new(std::mem::take(&mut startup.account_secret));
        startup.master_password.zeroize();
        startup.account_secret.zeroize();
        if read_only {
            client::unlock_offline(config_dir, username, &secret, &password)?
        } else {
            client::unlock_with_offline_fallback(config_dir, username, &secret, &password)?
        }
    };
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|_| "could not start local unlock agent")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "could not configure local unlock agent")?;
    let mut raw = [0_u8; 32];
    OsRng.fill_bytes(&mut raw);
    let capability = Zeroizing::new(URL_SAFE_NO_PAD.encode(raw));
    raw.zeroize();
    let protected = entry(config_dir)?;
    protected
        .set_password(&capability)
        .map_err(|_| "could not protect local agent capability")?;
    let lease_cleanup = LeaseCleanup {
        state: state_path(config_dir),
        protected,
    };
    fs::write(
        state_path(config_dir),
        format!(
            "version=2\nport={}\n",
            listener
                .local_addr()
                .map_err(|_| "could not inspect local unlock agent")?
                .port()
        ),
    )
    .map_err(|_| "could not write local agent state")?;
    println!("ready");
    std::io::stdout()
        .flush()
        .map_err(|_| "could not acknowledge local unlock agent")?;
    serve_loop(
        session,
        listener,
        &capability,
        read_only,
        IDLE_TTL,
        Some(lease_cleanup),
    )
}
#[allow(clippy::needless_pass_by_value)] // Own the listener so timeout/logout closes its port.
fn serve_loop(
    mut session: Session,
    listener: TcpListener,
    capability: &str,
    read_only: bool,
    idle_ttl: Duration,
    cleanup: Option<LeaseCleanup>,
) -> Result<String, String> {
    let _lease_cleanup = cleanup;
    let mut last = Instant::now();
    while last.elapsed() < idle_ttl {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nodelay(true);
                let Ok(mut request) = read_agent_request(&stream) else {
                    continue;
                };
                let authorized = request.capability.as_bytes() == capability.as_bytes();
                request.capability.zeroize();
                let result = if authorized {
                    if request.action != "status" {
                        last = Instant::now();
                    }
                    dispatch(&mut session, &mut request, read_only)
                } else {
                    Err("local agent authorization failed".to_owned())
                };
                let stop = authorized && request.action == "logout";
                let response = match result {
                    Ok(value) => Response { ok: true, value },
                    Err(error) => Response {
                        ok: false,
                        value: Value::String(error),
                    },
                };
                let encoded = Zeroizing::new(
                    serde_json::to_string(&response).map_err(|_| "local agent failed")?,
                );
                let _ = writeln!(stream, "{}", encoded.as_str());
                if stop {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => break,
        }
    }
    Ok(String::new())
}

pub fn start(
    config_dir: &Path,
    username: &str,
    account_secret: &str,
    master_password: &[u8],
) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "could not locate CLI executable")?;
    start_with_executable(
        &exe,
        config_dir,
        username,
        account_secret,
        master_password,
        false,
    )
}

pub fn start_with_executable(
    exe: &Path,
    config_dir: &Path,
    username: &str,
    account_secret: &str,
    master_password: &[u8],
    read_only: bool,
) -> Result<(), String> {
    if call(config_dir, "logout", json!({})).is_ok() {
        let deadline = Instant::now() + Duration::from_secs(2);
        while state_path(config_dir).exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        if state_path(config_dir).exists() {
            return Err("previous local unlock agent did not stop".to_owned());
        }
    }
    let mut command = Command::new(exe);
    command
        .arg("agent-serve")
        .arg("--username")
        .arg(username)
        .arg("--config-dir")
        .arg(config_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if read_only {
        command.arg("--read-only");
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "could not start local unlock agent")?;
    let master_password =
        std::str::from_utf8(master_password).map_err(|_| "master password must be UTF-8")?;
    let startup = StartupRef {
        account_secret,
        master_password,
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or("could not start local unlock agent")?;
    serde_json::to_writer(&mut stdin, &startup)
        .map_err(|_| "could not start local unlock agent")?;
    writeln!(stdin).map_err(|_| "could not start local unlock agent")?;
    let mut ready = String::new();
    BufReader::new(
        child
            .stdout
            .take()
            .ok_or("could not start local unlock agent")?,
    )
    .read_line(&mut ready)
    .map_err(|_| "local unlock agent did not start")?;
    connector_startup_result(&ready)
}

fn connector_startup_result(ready: &str) -> Result<(), String> {
    if ready.trim() == "ready" {
        return Ok(());
    }
    let error = serde_json::from_str::<Value>(ready)
        .ok()
        .and_then(|value| value["error"].as_str().map(str::to_owned))
        .filter(|error| !error.is_empty() && error.len() <= 512)
        .unwrap_or_else(|| "local unlock agent did not start".to_owned());
    Err(error)
}

#[cfg(test)]
mod startup_tests {
    #[test]
    fn startup_preserves_diagnostics_and_requires_explicit_readiness() {
        assert!(super::connector_startup_result("ready\n").is_ok());
        assert_eq!(
            super::connector_startup_result(r#"{"error":"offline unlock is not provisioned"}"#)
                .unwrap_err(),
            "offline unlock is not provisioned"
        );
        for response in ["", "not ready", "{}", r#"{"error":42}"#] {
            assert_eq!(
                super::connector_startup_result(response).unwrap_err(),
                "local unlock agent did not start"
            );
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
pub fn call(config_dir: &Path, action: &str, fields: Value) -> Result<Value, String> {
    crate::namespace::validate_profile(config_dir)?;
    crate::namespace::validate_profile(&state_path(config_dir))?;
    let mut fields = SensitiveValue(fields);
    let state = fs::read_to_string(state_path(config_dir))
        .map_err(|_| "not logged in; run login first".to_owned())?;
    let port = state
        .lines()
        .find_map(|line| line.strip_prefix("port="))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or("invalid local agent state")?;
    let version = state.lines().find_map(|line| line.strip_prefix("version="));
    let lease = match version {
        Some("1") => legacy_entry(config_dir)?,
        Some("2") => entry(config_dir)?,
        _ => return Err("unsupported local agent state; lock and unlock the client".to_owned()),
    };
    let capability = lease
        .get_password()
        .map_err(|_| "not logged in; run login first".to_owned())?;
    let mut value = fields
        .0
        .as_object_mut()
        .map(std::mem::take)
        .unwrap_or_default();
    value.insert("capability".to_owned(), Value::String(capability));
    value.insert("action".to_owned(), Value::String(action.to_owned()));
    let mut outbound = SensitiveValue(Value::Object(value));
    let mut stream = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(2),
    )
    .map_err(|_| "unlock session expired; run login again".to_owned())?;
    stream
        .set_nodelay(true)
        .map_err(|_| "local agent unavailable")?;
    let timeout = if matches!(action, "status" | "logout") {
        2
    } else {
        90
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(timeout)))
        .map_err(|_| "local agent unavailable")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "local agent unavailable")?;
    let mut encoded =
        Zeroizing::new(serde_json::to_vec(&outbound.0).map_err(|_| "local agent unavailable")?);
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .map_err(|_| "local agent unavailable")?;
    if let Some(object) = outbound.0.as_object_mut() {
        for name in ["capability", "password"] {
            if let Some(Value::String(secret)) = object.get_mut(name) {
                secret.zeroize();
            }
        }
    }
    let mut line = Zeroizing::new(String::new());
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|_| "local agent unavailable")?;
    let mut response: Response =
        serde_json::from_str(&line).map_err(|_| "invalid local agent response")?;
    if response.ok {
        Ok(response.value.take())
    } else {
        Err(response
            .value
            .as_str()
            .unwrap_or("agent command failed")
            .to_owned())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn agent_requires_capability_and_authenticated_logout_ends_the_lease() {
        let (session, directory) = crate::client::device_transport_tests::offline_agent_session();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            super::serve_loop(
                session,
                listener,
                "fixture-capability",
                true,
                std::time::Duration::from_secs(30),
                None,
            )
        });
        let send = |capability: &str| {
            use std::io::{BufRead, Read, Write};
            let mut stream = std::net::TcpStream::connect(address).unwrap();
            stream.set_nodelay(true).unwrap();
            // Match call(): serialize first and send one buffered line. Display
            // formatting otherwise performs many tiny writes against the
            // agent's three-second request deadline on Windows.
            let request = format!(
                "{}\n",
                serde_json::json!({"action":"logout","capability":capability})
            );
            stream.write_all(request.as_bytes()).unwrap();
            let mut line = String::new();
            std::io::BufReader::new(stream.take(4096))
                .read_line(&mut line)
                .unwrap();
            line
        };
        assert_eq!(
            send("wrong"),
            "{\"ok\":false,\"value\":\"local agent authorization failed\"}\n"
        );
        assert_eq!(
            send("fixture-capability"),
            "{\"ok\":true,\"value\":{\"loggedOut\":true}}\n"
        );
        assert!(worker.join().unwrap().is_ok());
        assert!(std::net::TcpStream::connect(address).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn idle_agent_exits_without_any_command_or_restart_authority() {
        let (session, directory) = crate::client::device_transport_tests::offline_agent_session();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        assert!(
            super::serve_loop(
                session,
                listener,
                "fixture-capability",
                true,
                std::time::Duration::from_millis(20),
                None
            )
            .is_ok()
        );
        assert!(std::net::TcpStream::connect(address).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn status_polling_cannot_keep_an_agent_unlocked() {
        use std::io::{BufRead, Write};
        let (session, directory) = crate::client::device_transport_tests::offline_agent_session();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, done) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = super::serve_loop(
                session,
                listener,
                "fixture-capability",
                true,
                std::time::Duration::from_millis(150),
                None,
            );
            sender.send(result).unwrap();
        });
        let started = std::time::Instant::now();
        let mut replies = 0;
        let mut stopped = false;
        while started.elapsed() < std::time::Duration::from_secs(5) {
            if let Ok(result) = done.try_recv() {
                assert!(result.is_ok());
                stopped = true;
                break;
            }
            let Ok(mut stream) = std::net::TcpStream::connect_timeout(
                &address,
                std::time::Duration::from_millis(50),
            ) else {
                assert!(
                    done.recv_timeout(std::time::Duration::from_secs(1))
                        .unwrap()
                        .is_ok()
                );
                stopped = true;
                break;
            };
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                .unwrap();
            if writeln!(
                stream,
                "{}",
                serde_json::json!({"action":"status","capability":"fixture-capability"})
            )
            .is_err()
            {
                continue;
            }
            let mut line = String::new();
            if std::io::BufReader::new(stream).read_line(&mut line).is_ok() && !line.is_empty() {
                replies += 1;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(stopped, "Status polling kept the lease alive");
        assert!(replies > 0);
        worker.join().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn conflict_merge_requires_explicit_known_unique_field_sources() {
        assert!(super::conflict_field_choices("", &[]).is_err());
        assert!(super::conflict_field_choices("local", &["unknown=server".to_owned()]).is_err());
        assert!(
            super::conflict_field_choices(
                "local",
                &["title=server".to_owned(), "title=local".to_owned()]
            )
            .is_err()
        );
        assert!(super::conflict_field_choices("server", &["password=both".to_owned()]).is_err());
        let choices = super::conflict_field_choices(
            "local",
            &["title=server".to_owned(), "customFields=server".to_owned()],
        )
        .unwrap();
        assert_eq!(
            choices,
            vec![
                ("title", false),
                ("website", true),
                ("username", true),
                ("password", true),
                ("customFields", false)
            ]
        );
    }
    #[test]
    fn conflict_comparison_masks_builtin_custom_and_related_passwords() {
        let mut item = serde_json::json!({"title":"visible title","username":"visible user","password":"builtin secret","customFields":[
            {"id":"ordinary","type":"text","value":"visible note"},
            {"id":"custom","type":"password","value":"custom secret"},
            {"id":"__127vaults_field:section:answer","type":"password","value":"related secret"}
        ]});
        super::redact_conflict_fields(&mut item);
        assert_eq!(item["password"], "[redacted]");
        assert_eq!(item["customFields"][0]["value"], "visible note");
        assert_eq!(item["customFields"][1]["value"], "[redacted]");
        assert_eq!(item["customFields"][2]["value"], "[redacted]");
        assert_eq!(item["title"], "visible title");
        assert_eq!(item["username"], "visible user");
    }
    use super::*;

    #[test]
    fn adopted_profiles_have_independent_capabilities_and_aliases_share_their_identity() {
        let root = std::env::temp_dir().join(format!("127vaults-agent-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let first = root.join("cli");
        let second = root.join("desktop");
        for profile in [&first, &second] {
            fs::create_dir(profile).unwrap();
            fs::write(profile.join("trust.conf"), "server_id=fictitious-server\n").unwrap();
            fs::write(profile.join("device.conf"), "device_id=fictitious-device\n").unwrap();
        }
        assert_eq!(identity(&first).unwrap(), identity(&second).unwrap());
        assert_ne!(
            profile_identity(&first).unwrap(),
            profile_identity(&second).unwrap()
        );
        assert_eq!(
            profile_identity(&first).unwrap(),
            profile_identity(&first.join(".")).unwrap()
        );
        for profile in [&first, &second] {
            fs::remove_file(profile.join("trust.conf")).unwrap();
            fs::remove_file(profile.join("device.conf")).unwrap();
            fs::remove_dir(profile).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn connector_agent_denies_all_device_management_before_dispatch() {
        let mut session = crate::client::device_transport_tests::session("http://127.0.0.1:1");
        for action in [
            "device.list",
            "device.inspect",
            "device.approve",
            "device.revoke",
            "conflict.compare",
            "conflict.merge",
            "sync.review",
        ] {
            let mut request: Request = serde_json::from_value(
                json!({"capability":"fixture","action":action,"password":"synthetic-secret"}),
            )
            .unwrap();
            assert_eq!(
                dispatch(&mut session, &mut request, true).unwrap_err(),
                "read-only agent command denied"
            );
            assert!(
                request
                    .password
                    .as_ref()
                    .unwrap()
                    .bytes()
                    .all(|byte| byte == 0)
            );
        }
    }
}
