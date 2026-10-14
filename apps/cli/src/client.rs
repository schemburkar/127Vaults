#![allow(clippy::missing_errors_doc, clippy::must_use_candidate)]
use std::fs::OpenOptions;
use std::io::Write as _;
use std::{fs, path::Path};

use crate::{
    replica::{PendingMutation, Replica, ReplicaItem, ReplicaStore, verify_remote_cursor_progress},
    sync_transport::{HttpSyncTransport, SyncTransport},
    vault_settings::{self, SettingsData, SettingsRecord, SettingsStore},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use reqwest::{StatusCode, blocking::Client, header::SET_COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha512};
use vaults_crypto::{
    ecf1::{Core, KeyHandle},
    opaque::{self, Binding},
};

pub struct Session {
    client: Client,
    origin: String,
    cookie: String,
    csrf: String,
    core: Core,
    root: KeyHandle,
    signing: SigningKey,
    tenant_id: String,
    device_id: String,
    epoch: u64,
    replica_store: ReplicaStore,
    profile_dir: std::path::PathBuf,
    settings_store: SettingsStore,
    settings_record: SettingsRecord,
    settings_data: SettingsData,
    settings_conflict: bool,
    settings_remote: Option<(Option<String>, Option<String>)>,
    sync_transport: Option<HttpSyncTransport>,
    online: bool,
    offline_reason: Option<String>,
    vault_handles: std::collections::HashMap<String, KeyHandle>,
    // Successful TLS receipts advance signing continuity without changing the
    // encrypted item baseline that the editor reviewed. Verified hydration
    // replaces these in-memory hints with the actual server device heads.
    accepted_device_heads: std::collections::HashMap<String, String>,
}

fn verified_cached_item_body(
    core: &Core,
    vault: KeyHandle,
    catalogue: &[u8],
    item_id: &str,
    index: &[u8],
    cached: Option<&ReplicaItem>,
) -> Option<Vec<u8>> {
    let cached = cached?;
    if cached.item_id != item_id || cached.index != URL_SAFE_NO_PAD.encode(index) {
        return None;
    }
    let body = URL_SAFE_NO_PAD.decode(&cached.body).ok()?;
    // Reuse ciphertext only after verification against the current server
    // catalogue's body commitment, revision and authenticated vault context.
    core.decrypt_private_part(vault, catalogue, uuid_bytes(item_id).ok()?, &body, 3)
        .ok()?;
    Some(body)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OfflineUnlockRecord {
    version: u32,
    username: String,
    tenant_id: String,
    device_id: String,
    epoch: u64,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    server_id: Option<String>,
    descriptor: String,
    envelope: String,
}

impl OfflineUnlockRecord {
    fn matches_trust(&self, origin: &str, server_id: &str) -> bool {
        match self.version {
            // Existing self-hosted records predate endpoint binding. Cloud
            // profiles must be version 2 or newer before offline unlock.
            1 => self.origin.is_none() && self.server_id.is_none(),
            2 => {
                self.origin.as_deref() == Some(origin)
                    && self.server_id.as_deref() == Some(server_id)
            }
            _ => false,
        }
    }
}

#[derive(Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(deny_unknown_fields)]
struct TenantBinding {
    version: u32,
    origin: String,
    server_id: String,
    tenant_id: String,
}

fn tenant_binding_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("tenant-binding.json")
}

fn check_tenant_binding(config_dir: &Path, expected: &TenantBinding) -> Result<(), String> {
    let bytes = match fs::read(tenant_binding_path(config_dir)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("tenant binding is unavailable".to_owned()),
    };
    let existing: TenantBinding =
        serde_json::from_slice(&bytes).map_err(|_| "tenant binding is invalid".to_owned())?;
    if existing != *expected {
        return Err("trusted profile is bound to a different tenant".to_owned());
    }
    Ok(())
}

fn persist_tenant_binding(config_dir: &Path, expected: &TenantBinding) -> Result<(), String> {
    let path = tenant_binding_path(config_dir);
    let bytes = serde_json::to_vec(expected).map_err(|_| "tenant binding is invalid".to_owned())?;
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => file
            .write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "could not persist tenant binding".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            check_tenant_binding(config_dir, expected)
        }
        Err(_) => Err("could not persist tenant binding".to_owned()),
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct VaultRemovalJournal {
    source_vault_id: String,
    choice: String,
    #[serde(default)]
    destination_vault_id: Option<String>,
    #[serde(default)]
    source_catalogue_revision: Option<String>,
    #[serde(default)]
    item_mappings: Vec<ItemMoveMapping>,
    request: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ItemMoveMapping {
    source_item_id: String,
    destination_item_id: String,
}

fn removal_journal_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("vault-removal.json")
}

fn save_removal_journal(config_dir: &Path, journal: &VaultRemovalJournal) -> Result<(), String> {
    journal.validate()?;
    let path = removal_journal_path(config_dir);
    let bytes = serde_json::to_vec(journal).map_err(|_| "vault removal could not be prepared")?;
    if bytes.len() > 32 * 1024 {
        return Err("vault removal journal is too large".to_owned());
    }
    let mut file = atomic_write_file::AtomicWriteFile::open(path)
        .map_err(|_| "vault removal journal is unavailable")?;
    file.write_all(&bytes)
        .map_err(|_| "vault removal journal could not be saved")?;
    file.commit()
        .map_err(|_| "vault removal journal could not be saved".to_owned())
}

fn load_removal_journal(config_dir: &Path) -> Result<Option<VaultRemovalJournal>, String> {
    match fs::read(removal_journal_path(config_dir)) {
        Ok(bytes) => {
            if bytes.len() > 32 * 1024 {
                return Err("vault removal journal is too large".to_owned());
            }
            let journal: VaultRemovalJournal = serde_json::from_slice(&bytes)
                .map_err(|_| "vault removal journal is invalid".to_owned())?;
            journal.validate()?;
            Ok(Some(journal))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("vault removal journal is unavailable".to_owned()),
    }
}

impl VaultRemovalJournal {
    fn validate(&self) -> Result<(), String> {
        let invalid = || "vault removal journal is invalid".to_owned();
        uuid::Uuid::parse_str(&self.source_vault_id).map_err(|_| invalid())?;
        match self.choice.as_str() {
            "archive" | "restore"
                if self.destination_vault_id.is_none()
                    && self.item_mappings.is_empty()
                    && self.request.is_object() =>
            {
                Ok(())
            }
            "move" => {
                let destination = self.destination_vault_id.as_deref().ok_or_else(invalid)?;
                uuid::Uuid::parse_str(destination).map_err(|_| invalid())?;
                if destination == self.source_vault_id
                    || self
                        .source_catalogue_revision
                        .as_deref()
                        .is_none_or(|revision| uuid::Uuid::parse_str(revision).is_err())
                    || self.item_mappings.len() > 50
                    || !(self.request.is_null() || self.request.is_object())
                {
                    return Err(invalid());
                }
                let mut sources = std::collections::HashSet::new();
                let mut destinations = std::collections::HashSet::new();
                for mapping in &self.item_mappings {
                    uuid::Uuid::parse_str(&mapping.source_item_id).map_err(|_| invalid())?;
                    uuid::Uuid::parse_str(&mapping.destination_item_id).map_err(|_| invalid())?;
                    if !sources.insert(&mapping.source_item_id)
                        || !destinations.insert(&mapping.destination_item_id)
                    {
                        return Err(invalid());
                    }
                }
                Ok(())
            }
            _ => Err(invalid()),
        }
    }
}

fn settings_after_archive(mut settings: SettingsData, source: &str) -> SettingsData {
    for collection in &mut settings.collections {
        collection.vault_ids.retain(|id| id != source);
    }
    settings
        .collections
        .retain(|collection| !collection.vault_ids.is_empty());
    if matches!(&settings.default_view, Some(vault_settings::View::Vault(id)) if id == source)
        || matches!(&settings.default_view, Some(vault_settings::View::Collection(id)) if !settings.collections.iter().any(|collection| &collection.id == id))
    {
        settings.default_view = None;
    }
    settings
}

fn settings_after_move(
    mut settings: SettingsData,
    source: &str,
    destination: &str,
) -> SettingsData {
    for collection in &mut settings.collections {
        for id in &mut collection.vault_ids {
            if id == source {
                destination.clone_into(id);
            }
        }
        collection.vault_ids.sort();
        collection.vault_ids.dedup();
    }
    if matches!(&settings.default_view, Some(vault_settings::View::Vault(id)) if id == source) {
        settings.default_view = Some(vault_settings::View::Vault(destination.to_owned()));
    }
    settings
}

fn offline_record_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("offline-unlock.json")
}

fn local_settings(
    config_dir: &Path,
    core: &Core,
    root: KeyHandle,
) -> Result<(SettingsStore, SettingsRecord, SettingsData), String> {
    let store = SettingsStore::new(config_dir);
    let record = store.load()?;
    let envelope = record
        .pending
        .as_ref()
        .map(|p| &p.envelope)
        .or(record.verified_envelope.as_ref());
    let data = match envelope {
        Some(value) => vault_settings::decrypt(core, root, value)?,
        None => SettingsData::empty(),
    };
    Ok((store, record, data))
}

fn save_offline_record(config_dir: &Path, record: &OfflineUnlockRecord) -> Result<(), String> {
    use std::io::Write as _;
    let bytes =
        serde_json::to_vec(record).map_err(|_| "offline unlock record could not be encoded")?;
    let mut file = atomic_write_file::AtomicWriteFile::open(offline_record_path(config_dir))
        .map_err(|_| "offline unlock record is unavailable")?;
    file.write_all(&bytes)
        .map_err(|_| "offline unlock record could not be written")?;
    file.commit()
        .map_err(|_| "offline unlock record could not be committed".to_owned())
}

/// Unlocks a previously hydrated replica without contacting the server.
pub fn unlock_offline(
    config_dir: &Path,
    username: &str,
    secret_hex: &str,
    password: &[u8],
) -> Result<Session, String> {
    let secret_vec = hex::decode(secret_hex)
        .map_err(|_| "account secret must be 64 hexadecimal characters".to_owned())?;
    let secret: [u8; 32] = secret_vec
        .try_into()
        .map_err(|_| "account secret must be 64 hexadecimal characters".to_owned())?;
    if password.len() < 20 {
        return Err("master password must contain at least 20 characters".to_owned());
    }
    let record: OfflineUnlockRecord = serde_json::from_slice(
        &fs::read(offline_record_path(config_dir))
            .map_err(|_| "offline unlock is not provisioned".to_owned())?,
    )
    .map_err(|_| "offline unlock record is invalid".to_owned())?;
    if record.username != username
        || record.epoch == 0
        || uuid::Uuid::parse_str(&record.tenant_id).is_err()
        || uuid::Uuid::parse_str(&record.device_id).is_err()
    {
        return Err("offline unlock record is invalid".to_owned());
    }
    let (_, origin, server_id, _) = http_client(config_dir)?;
    if !record.matches_trust(&origin, &server_id) {
        return Err("offline unlock record does not match the trusted endpoint".to_owned());
    }
    check_tenant_binding(
        config_dir,
        &TenantBinding {
            version: 1,
            origin: origin.clone(),
            server_id: server_id.clone(),
            tenant_id: record.tenant_id.clone(),
        },
    )?;
    if ReplicaStore::new(config_dir).list()?.is_empty() {
        return Err("offline replica is unavailable".to_owned());
    }
    let descriptor = URL_SAFE_NO_PAD
        .decode(record.descriptor)
        .map_err(|_| "offline unlock record is invalid")?;
    let envelope = URL_SAFE_NO_PAD
        .decode(record.envelope)
        .map_err(|_| "offline unlock record is invalid")?;
    let mut core = Core::new();
    let root = core
        .unwrap_root(&envelope, &descriptor, password, &secret)
        .map_err(|_| "offline authentication failed".to_owned())?;
    let signing = stored_signing_key(config_dir, &server_id, &record.device_id)?;
    let (settings_store, settings_record, settings_data) = local_settings(config_dir, &core, root)?;
    Ok(Session {
        client: Client::new(),
        origin,
        cookie: String::new(),
        csrf: String::new(),
        core,
        root,
        signing,
        tenant_id: record.tenant_id,
        device_id: record.device_id,
        epoch: record.epoch,
        replica_store: ReplicaStore::new(config_dir),
        profile_dir: config_dir.to_path_buf(),
        settings_store,
        settings_record,
        settings_data,
        settings_conflict: false,
        settings_remote: None,
        sync_transport: None,
        online: false,
        offline_reason: None,
        vault_handles: std::collections::HashMap::new(),
        accepted_device_heads: std::collections::HashMap::new(),
    })
}

fn profile(path: &Path, key: &str) -> Result<String, String> {
    fs::read_to_string(path)
        .map_err(|_| "client profile is missing".to_owned())?
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")).map(str::to_owned))
        .ok_or_else(|| "client profile is invalid".to_owned())
}

fn bytes(value: &Value, name: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(
            value
                .get(name)
                .and_then(Value::as_str)
                .ok_or("invalid server response")?,
        )
        .map_err(|_| "invalid server response".to_owned())
}

fn uuid_bytes(value: &str) -> Result<[u8; 16], String> {
    Ok(*uuid::Uuid::parse_str(value)
        .map_err(|_| "invalid UUID".to_owned())?
        .as_bytes())
}

fn merge_item_fields(base: &Value, local: &Value, remote: &Value) -> Result<Value, Vec<String>> {
    let mut merged = remote.clone();
    let mut conflicts = Vec::new();
    for field in ["title", "website", "username", "password", "customFields"] {
        let local_changed = local[field] != base[field];
        let remote_changed = remote[field] != base[field];
        if local_changed && remote_changed && local[field] != remote[field] {
            conflicts.push(field.to_owned());
        } else if local_changed {
            merged[field] = local[field].clone();
        }
    }
    if conflicts.is_empty() {
        Ok(merged)
    } else {
        Err(conflicts)
    }
}

type ParsedBinding = (
    String,
    [u8; 16],
    [u8; 16],
    [u8; 16],
    u64,
    [u8; 32],
    [u8; 32],
);
fn parse_binding(raw: &[u8]) -> Result<ParsedBinding, String> {
    if raw.len() < 2 {
        return Err("invalid authentication binding".to_owned());
    }
    let n = usize::from(u16::from_be_bytes([raw[0], raw[1]]));
    if n == 0 || raw.len() != 2 + n + 16 * 3 + 8 + 32 * 2 {
        return Err("invalid authentication binding".to_owned());
    }
    let mut p = 2;
    let origin = std::str::from_utf8(&raw[p..p + n])
        .map_err(|_| "invalid authentication binding")?
        .to_owned();
    p += n;
    let installation = raw[p..p + 16]
        .try_into()
        .map_err(|_| "invalid authentication binding")?;
    p += 16;
    let account = raw[p..p + 16]
        .try_into()
        .map_err(|_| "invalid authentication binding")?;
    p += 16;
    let device = raw[p..p + 16]
        .try_into()
        .map_err(|_| "invalid authentication binding")?;
    p += 16;
    let epoch = u64::from_be_bytes(
        raw[p..p + 8]
            .try_into()
            .map_err(|_| "invalid authentication binding")?,
    );
    p += 8;
    let attempt = raw[p..p + 32]
        .try_into()
        .map_err(|_| "invalid authentication binding")?;
    p += 32;
    let server_key = raw[p..p + 32]
        .try_into()
        .map_err(|_| "invalid authentication binding")?;
    Ok((
        origin,
        installation,
        account,
        device,
        epoch,
        attempt,
        server_key,
    ))
}

fn authentication_context_hash(raw: &[u8]) -> Result<[u8; 64], String> {
    let context = raw
        .get(
            ..raw
                .len()
                .checked_sub(32)
                .ok_or("invalid authentication binding")?,
        )
        .ok_or("invalid authentication binding")?;
    let mut input = b"127Vaults/login-context/1\0".to_vec();
    input.extend_from_slice(context);
    Ok(Sha512::digest(input).into())
}

fn post(
    client: &Client,
    origin: &str,
    path: &str,
    csrf: &str,
    cookie: &str,
    body: &Value,
) -> Result<reqwest::blocking::Response, String> {
    let response = client
        .post(format!("{origin}{path}"))
        .header("Origin", origin)
        .header("X-127V-CSRF", csrf)
        .header("Cookie", cookie)
        .json(body)
        .send()
        .map_err(|error| server_connection_error(&error))?;
    if !response.status().is_success() {
        return Err(format!(
            "server rejected request ({})",
            response.status().as_u16()
        ));
    }
    Ok(response)
}

fn stored_signing_key(
    config_dir: &Path,
    server_id: &str,
    device_id: &str,
) -> Result<SigningKey, String> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let entry = keyring::Entry::new(
            "127Vaults device identity",
            &format!("{server_id}:{device_id}"),
        )
        .map_err(|_| "OS credential storage is unavailable".to_owned())?;
        let secret = entry
            .get_secret()
            .map_err(|_| "enrolled device key is unavailable".to_owned())?;
        let seed: [u8; 32] = secret
            .try_into()
            .map_err(|_| "stored device key is invalid".to_owned())?;
        let configured = profile(&config_dir.join("device.conf"), "device_id")?;
        if configured != device_id {
            return Err("device profile does not match protected key".to_owned());
        }
        Ok(SigningKey::from_bytes(&seed))
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (config_dir, server_id, device_id);
        Err("OS credential storage is unavailable".to_owned())
    }
}

fn http_client(config_dir: &Path) -> Result<(Client, String, String, String), String> {
    let origin = profile(&config_dir.join("trust.conf"), "url")?
        .trim_end_matches('/')
        .to_owned();
    let server_id = profile(&config_dir.join("trust.conf"), "server_id")?;
    let device_id = profile(&config_dir.join("device.conf"), "device_id")?;
    let ca = fs::read(config_dir.join("installation-ca.pem"))
        .map_err(|_| "installation CA is missing".to_owned())?;
    let cert =
        reqwest::Certificate::from_pem(&ca).map_err(|_| "installation CA is invalid".to_owned())?;
    let client = Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(cert)
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "could not initialize HTTPS client".to_owned())?;
    Ok((client, origin, server_id, device_id))
}

fn server_connection_error(error: &reqwest::Error) -> String {
    let mut source: Option<&dyn std::error::Error> = Some(&error);
    while let Some(current) = source {
        let detail = current.to_string().to_ascii_lowercase();
        if detail.contains("certificate") || detail.contains("unknownissuer") {
            return "server TLS certificate is not trusted by this device".to_owned();
        }
        source = current.source();
    }
    if error.is_timeout() {
        "server request timed out".to_owned()
    } else if error.is_connect() {
        "server connection failed".to_owned()
    } else {
        "server request failed".to_owned()
    }
}

#[allow(clippy::too_many_lines)]
pub fn unlock(
    config_dir: &Path,
    username: &str,
    secret_hex: &str,
    password: &[u8],
) -> Result<Session, String> {
    let secret_vec = hex::decode(secret_hex)
        .map_err(|_| "account secret must be 64 hexadecimal characters".to_owned())?;
    let secret: [u8; 32] = secret_vec
        .try_into()
        .map_err(|_| "account secret must be 64 hexadecimal characters".to_owned())?;
    if password.len() < 20 {
        return Err("master password must contain at least 20 characters".to_owned());
    }
    let (client, origin, server_id, device_id) = http_client(config_dir)?;
    let ceremony = client
        .get(format!("{origin}/api/v1/ceremony"))
        .send()
        .map_err(|error| server_connection_error(&error))?;
    if ceremony.status() != StatusCode::OK {
        return Err("authentication ceremony unavailable".to_owned());
    }
    let cookie = ceremony
        .headers()
        .get(SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .ok_or("invalid ceremony cookie")?
        .to_owned();
    let csrf = ceremony
        .json::<Value>()
        .map_err(|_| "invalid ceremony response")?["csrf"]
        .as_str()
        .ok_or("invalid ceremony response")?
        .to_owned();
    let start = opaque::client_login_start(&secret, password)
        .map_err(|_| "authentication failed".to_owned())?;
    let begun_response = post(
        &client,
        &origin,
        "/api/v1/auth/",
        &csrf,
        &cookie,
        &json!({"username":username,"deviceId":device_id,"request":URL_SAFE_NO_PAD.encode(&start.message)}),
    )?;
    let cookie = begun_response
        .headers()
        .get(SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .ok_or("invalid ceremony cookie")?
        .to_owned();
    let begun = begun_response
        .json::<Value>()
        .map_err(|_| "invalid authentication response")?;
    let csrf = begun["csrf"]
        .as_str()
        .ok_or("invalid authentication response")?
        .to_owned();
    let challenge = bytes(&begun, "challenge")?;
    let binding_raw = bytes(&begun, "binding")?;
    let (binding_origin, installation, account, device, epoch, attempt, server_public_key) =
        parse_binding(&binding_raw)?;
    if binding_origin != origin || device != uuid_bytes(&device_id)? {
        return Err("authentication binding mismatch".to_owned());
    }
    let trusted_tenant = TenantBinding {
        version: 1,
        origin: origin.clone(),
        server_id: server_id.clone(),
        tenant_id: uuid::Uuid::from_bytes(installation).to_string(),
    };
    check_tenant_binding(config_dir, &trusted_tenant)?;
    let binding = Binding {
        origin: binding_origin.as_bytes(),
        installation,
        account,
        device,
        epoch,
        attempt,
        server_public_key,
    };
    let finish = opaque::client_login_finish(&start.state, &secret, password, &challenge, binding)
        .map_err(|_| "authentication failed".to_owned())?;
    let attempt_id = begun["attemptId"]
        .as_str()
        .ok_or("invalid authentication response")?;
    let root_response = post(
        &client,
        &origin,
        &format!("/api/v1/auth/{attempt_id}/password"),
        &csrf,
        &cookie,
        &json!({"finalization":URL_SAFE_NO_PAD.encode(&finish.message)}),
    )?
    .json::<Value>()
    .map_err(|_| "invalid root response")?;
    let descriptor = bytes(&root_response, "descriptor")?;
    let envelope = bytes(&root_response, "envelope")?;
    let tag = bytes(&root_response, "tag")?;
    let keys = opaque::derive_application_keys(&finish.session_key, binding)
        .map_err(|_| "authentication failed".to_owned())?;
    let expected = opaque::root_response_tag(
        &*keys.root_tag,
        binding,
        &start.message,
        &challenge,
        &finish.message,
        &descriptor,
        &envelope,
    )
    .map_err(|_| "authentication failed".to_owned())?;
    if tag.as_slice() != expected {
        return Err("root response authentication failed".to_owned());
    }
    let mut core = Core::new();
    let root = core
        .unwrap_root(&envelope, &descriptor, password, &secret)
        .map_err(|_| "root unlock failed".to_owned())?;
    let context_hash = authentication_context_hash(&binding_raw)?;
    let transcript_hash = Sha512::new()
        .chain_update(&start.message)
        .chain_update(&challenge)
        .finalize();
    let root_hash = Sha512::new()
        .chain_update(&descriptor)
        .chain_update(&envelope)
        .finalize();
    let mut proof = b"127Vaults/device-proof/1\0".to_vec();
    proof.extend_from_slice(&context_hash);
    proof.extend_from_slice(&transcript_hash);
    proof.extend_from_slice(&installation);
    proof.extend_from_slice(&account);
    proof.extend_from_slice(&device);
    proof.extend_from_slice(&epoch.to_be_bytes());
    proof.extend_from_slice(&root_hash);
    let signing = stored_signing_key(config_dir, &server_id, &device_id)?;
    let response = post(
        &client,
        &origin,
        &format!("/api/v1/auth/{attempt_id}/device-proof"),
        &csrf,
        &cookie,
        &json!({"signature":URL_SAFE_NO_PAD.encode(signing.sign(&proof).to_bytes())}),
    )?;
    let session_cookie = response
        .headers()
        .get(SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .ok_or("invalid session cookie")?
        .to_owned();
    let csrf = response
        .json::<Value>()
        .map_err(|_| "invalid session response")?["csrf"]
        .as_str()
        .ok_or("invalid session response")?
        .to_owned();
    let sync_transport = HttpSyncTransport::new(
        client.clone(),
        origin.clone(),
        session_cookie.clone(),
        csrf.clone(),
    );
    persist_tenant_binding(config_dir, &trusted_tenant)?;
    let (settings_store, settings_record, settings_data) = local_settings(config_dir, &core, root)?;
    let mut session = Session {
        client,
        origin,
        cookie: session_cookie,
        csrf,
        core,
        root,
        signing,
        tenant_id: uuid::Uuid::from_bytes(installation).to_string(),
        device_id,
        epoch,
        replica_store: ReplicaStore::new(config_dir),
        profile_dir: config_dir.to_path_buf(),
        settings_store,
        settings_record,
        settings_data,
        settings_conflict: false,
        settings_remote: None,
        sync_transport: Some(sync_transport),
        online: true,
        offline_reason: None,
        vault_handles: std::collections::HashMap::new(),
        accepted_device_heads: std::collections::HashMap::new(),
    };
    session.hydrate_replicas()?;
    session.sync_vault_settings()?;
    save_offline_record(
        config_dir,
        &OfflineUnlockRecord {
            version: 2,
            username: username.to_owned(),
            tenant_id: session.tenant_id.clone(),
            device_id: session.device_id.clone(),
            epoch,
            origin: Some(session.origin.clone()),
            server_id: Some(server_id),
            descriptor: URL_SAFE_NO_PAD.encode(descriptor),
            envelope: URL_SAFE_NO_PAD.encode(envelope),
        },
    )?;
    Ok(session)
}

/// Prefers fresh server authentication and falls back to the locally cached,
/// password-wrapped root when the device is offline or has been revoked.
pub fn unlock_with_offline_fallback(
    config_dir: &Path,
    username: &str,
    secret_hex: &str,
    password: &[u8],
) -> Result<Session, String> {
    match unlock(config_dir, username, secret_hex, password) {
        Ok(session) => Ok(session),
        Err(online_error) => unlock_offline(config_dir, username, secret_hex, password)
            .map(|mut session| {
                session.offline_reason = Some(online_error.clone());
                session
            })
            .map_err(|offline_error| format!("{online_error}; {offline_error}")),
    }
}

impl Session {
    pub fn device_list(&self) -> Result<Value, String> {
        if !self.online {
            return Err("device list is unavailable while offline".to_owned());
        }
        let mut response = self.get("/api/v1/devices")?;
        response["currentDeviceId"] = json!(self.device_id);
        Ok(response)
    }
    pub fn device_revoke(&self, device_id: &str) -> Result<Value, String> {
        if !self.online {
            return Err("device management is unavailable while offline".to_owned());
        }
        let id = crate::devices::revoke_target(device_id, &self.device_id)?;
        self.post_auth(
            "/api/v1/devices/revoke",
            reqwest::Method::POST,
            &json!({"deviceId":id}),
        )
    }
    pub fn vault_settings(&self) -> Value {
        json!({"names":self.settings_data.names,"collections":self.settings_data.collections,
            "defaultView":self.settings_data.default_view,"removalPreference":self.settings_data.removal_preference,
            "pending":self.settings_record.pending.is_some(),"conflict":self.settings_conflict})
    }

    pub fn vault_settings_review(&self) -> Result<Value, String> {
        if !self.settings_conflict {
            return Err("vault settings conflict is unavailable".to_owned());
        }
        let (revision, envelope) = self
            .settings_remote
            .as_ref()
            .ok_or("vault settings conflict is unavailable")?;
        let server = match envelope {
            Some(value) => vault_settings::decrypt(&self.core, self.root, value)?,
            None => SettingsData::empty(),
        };
        Ok(
            json!({"local":self.settings_data,"server":server,"serverRevision":revision,
            "localPending":self.settings_record.pending.is_some()}),
        )
    }

    fn settings_sync_error(&mut self, error: String) -> String {
        if matches!(
            error.as_str(),
            "server rejected request (401)" | "server rejected request (403)"
        ) {
            self.online = false;
            self.offline_reason = Some("The server no longer authorizes this session. Local copies and pending changes are preserved.".to_owned());
        }
        error
    }

    fn fetch_vault_settings(&mut self) -> Result<(Option<String>, Option<String>), String> {
        let remote = self
            .get("/api/v1/vault-settings")
            .map_err(|error| self.settings_sync_error(error))?;
        let revision = remote["revision"].as_str().map(str::to_owned);
        let envelope = remote["envelope"].as_str().map(str::to_owned);
        if revision.is_some() != envelope.is_some() {
            return Err("invalid vault settings response".to_owned());
        }
        if let Some(ref value) = envelope {
            if Some(vault_settings::revision(value)?) != revision {
                return Err("invalid vault settings response".to_owned());
            }
            vault_settings::decrypt(&self.core, self.root, value)?;
        }
        Ok((revision, envelope))
    }

    pub fn sync_vault_settings(&mut self) -> Result<Value, String> {
        if !self.online {
            return Err("vault settings sync unavailable while offline".to_owned());
        }
        let (revision, envelope) = self.fetch_vault_settings()?;
        if let Some(pending) = self.settings_record.pending.clone() {
            if pending.base_revision != revision {
                self.settings_conflict = true;
                self.settings_remote = Some((revision, envelope));
                return Ok(self.vault_settings());
            }
            let next_revision = vault_settings::revision(&pending.envelope)?;
            self.post_auth("/api/v1/vault-settings", reqwest::Method::PUT,
                &json!({"baseRevision":revision,"revision":next_revision,"envelope":pending.envelope})).map_err(|error| self.settings_sync_error(error))?;
            self.settings_record.remote_revision = Some(next_revision);
            self.settings_record.verified_envelope = Some(pending.envelope);
            self.settings_record.pending = None;
            self.settings_store.commit(&self.settings_record)?;
            self.settings_conflict = false;
            self.settings_remote = None;
        } else if self.settings_record.remote_revision != revision {
            if self.settings_record.remote_revision.is_some() {
                self.settings_conflict = true;
                self.settings_remote = Some((revision, envelope));
                return Ok(self.vault_settings());
            }
            self.settings_data = match envelope.as_ref() {
                Some(value) => vault_settings::decrypt(&self.core, self.root, value)?,
                None => SettingsData::empty(),
            };
            self.settings_record.remote_revision = revision;
            self.settings_record.verified_envelope = envelope;
            self.settings_store.commit(&self.settings_record)?;
        } else if self.settings_record.verified_envelope != envelope {
            self.settings_conflict = true;
            self.settings_remote = Some((revision, envelope));
            return Ok(self.vault_settings());
        }
        Ok(self.vault_settings())
    }

    pub fn resolve_vault_settings_conflict(&mut self, keep: &str) -> Result<Value, String> {
        if !matches!(keep, "server" | "local") {
            return Err("choose server or local".to_owned());
        }
        if !self.online || !self.settings_conflict {
            return Err("vault settings conflict is unavailable".to_owned());
        }
        let (revision, envelope) = self
            .settings_remote
            .clone()
            .ok_or("vault settings conflict is unavailable")?;
        let current = self.fetch_vault_settings()?;
        if current != (revision.clone(), envelope.clone()) {
            self.settings_remote = Some(current);
            return Err("server vault settings changed; review the conflict again".to_owned());
        }
        match keep {
            "server" => {
                self.settings_data = match envelope.as_ref() {
                    Some(value) => vault_settings::decrypt(&self.core, self.root, value)?,
                    None => SettingsData::empty(),
                };
                self.settings_record.remote_revision = revision;
                self.settings_record.verified_envelope = envelope;
                self.settings_record.pending = None;
                self.settings_store.commit(&self.settings_record)?;
            }
            "local" => {
                let sealed = vault_settings::encrypt(&self.core, self.root, &self.settings_data)?;
                self.settings_record.remote_revision = revision.clone();
                self.settings_record.verified_envelope = envelope;
                self.settings_record.pending = Some(vault_settings::PendingSettings {
                    base_revision: revision,
                    envelope: sealed,
                });
                self.settings_store.commit(&self.settings_record)?;
            }
            _ => return Err("choose server or local".to_owned()),
        }
        self.settings_conflict = false;
        self.settings_remote = None;
        if keep == "local" {
            self.sync_vault_settings()?;
        }
        Ok(self.vault_settings())
    }

    fn edit_vault_settings(
        &mut self,
        change: impl FnOnce(&mut SettingsData) -> Result<(), String>,
    ) -> Result<Value, String> {
        if self.settings_conflict {
            return Err("resolve the vault settings conflict first".to_owned());
        }
        let mut next = self.settings_data.clone();
        change(&mut next)?;
        let envelope = vault_settings::encrypt(&self.core, self.root, &next)?;
        self.settings_record.pending = Some(vault_settings::PendingSettings {
            base_revision: self.settings_record.remote_revision.clone(),
            envelope,
        });
        self.settings_store.commit(&self.settings_record)?;
        self.settings_data = next;
        if self.online {
            let _ = self.sync_vault_settings();
        }
        Ok(self.vault_settings())
    }

    pub fn rename_vault(&mut self, selector: &str, name: &str) -> Result<Value, String> {
        let id = self.resolve_vault_id(selector)?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err("vault name must contain 1 to 80 characters".to_owned());
        }
        self.edit_vault_settings(|settings| {
            settings.names.insert(id, name.to_owned());
            Ok(())
        })
    }

    pub fn save_collection(
        &mut self,
        id: Option<&str>,
        name: &str,
        vaults: &[String],
    ) -> Result<Value, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || vaults.is_empty() {
            return Err("collection needs a name and at least one vault".to_owned());
        }
        let mut ids = Vec::new();
        for vault in vaults {
            let resolved = self.resolve_vault_id(vault)?;
            if !ids.contains(&resolved) {
                ids.push(resolved);
            }
        }
        let editing = id.is_some();
        let id = match id {
            Some(id) => uuid::Uuid::parse_str(id)
                .map_err(|_| "invalid collection ID")?
                .to_string(),
            None => uuid::Uuid::new_v4().to_string(),
        };
        self.edit_vault_settings(|settings| {
            if let Some(existing) = settings.collections.iter_mut().find(|row| row.id == id) {
                name.clone_into(&mut existing.name);
                existing.vault_ids = ids;
            } else {
                if editing {
                    return Err("collection is unavailable".to_owned());
                }
                settings.collections.push(vault_settings::Collection {
                    id,
                    name: name.to_owned(),
                    vault_ids: ids,
                });
            }
            Ok(())
        })
    }

    pub fn remove_collection(&mut self, id: &str) -> Result<Value, String> {
        self.edit_vault_settings(|settings| {
            let before = settings.collections.len();
            settings.collections.retain(|row| row.id != id);
            if before == settings.collections.len() { return Err("collection is unavailable".to_owned()); }
            if matches!(&settings.default_view, Some(vault_settings::View::Collection(current)) if current == id) { settings.default_view = None; }
            Ok(())
        })
    }

    pub fn set_removal_preference(&mut self, choice: Option<&str>) -> Result<Value, String> {
        if choice.is_some_and(|value| !matches!(value, "move" | "archive")) {
            return Err("choose move or archive".to_owned());
        }
        self.edit_vault_settings(|settings| {
            settings.removal_preference = choice.map(str::to_owned);
            Ok(())
        })
    }

    fn ensure_vault_settled(&self, vault_id: &str) -> Result<Replica, String> {
        let replica = self
            .replica_store
            .load(vault_id)?
            .ok_or("local replica is unavailable")?;
        if replica.retired {
            return Err("vault is already retired".to_owned());
        }
        if !replica.pending.is_empty()
            || !replica.conflicts.is_empty()
            || replica.sync_error.is_some()
        {
            return Err(
                "resolve pending edits and conflicts before removing this vault".to_owned(),
            );
        }
        if replica
            .checkpoint
            .as_ref()
            .and_then(|checkpoint| checkpoint["cursor"].as_u64())
            != Some(replica.cursor)
        {
            return Err(
                "vault checkpoint is not settled; sync before removing this vault".to_owned(),
            );
        }
        Ok(replica)
    }

    fn catalogue_revision(replica: &Replica) -> Result<String, String> {
        let catalogue = URL_SAFE_NO_PAD
            .decode(&replica.catalogue)
            .map_err(|_| "local replica is invalid")?;
        Ok(uuid::Uuid::from_bytes(
            catalogue
                .get(44..60)
                .ok_or("local replica is invalid")?
                .try_into()
                .map_err(|_| "local replica is invalid")?,
        )
        .to_string())
    }

    fn finish_removal(&mut self, journal: &VaultRemovalJournal) -> Result<Value, String> {
        let source = &journal.source_vault_id;
        let response = self.post_auth(
            &format!("/api/v1/vaults/{source}/removal"),
            reqwest::Method::POST,
            &journal.request,
        )?;
        if response["requestId"] != journal.request["requestId"]
            || response["vaultId"] != *source
            || response["choice"] != journal.choice
        {
            return Err("vault removal receipt is invalid".to_owned());
        }
        if journal.choice == "move"
            && (response["destinationVaultId"].as_str() != journal.destination_vault_id.as_deref()
                || response["itemCount"].as_u64() != Some(journal.item_mappings.len() as u64))
        {
            return Err("vault move receipt is invalid".to_owned());
        }
        let envelope = journal.request["settings"]["envelope"]
            .as_str()
            .ok_or("vault removal journal is invalid")?;
        let data = vault_settings::decrypt(&self.core, self.root, envelope)?;
        self.settings_record.remote_revision = journal.request["settings"]["revision"]
            .as_str()
            .map(str::to_owned);
        self.settings_record.verified_envelope = Some(envelope.to_owned());
        self.settings_record.pending = None;
        self.settings_store.commit(&self.settings_record)?;
        self.settings_data = data;
        self.settings_conflict = false;
        self.settings_remote = None;
        self.hydrate_replicas()?;
        fs::remove_file(removal_journal_path(&self.profile_dir))
            .map_err(|_| "vault removal journal could not be cleared")?;
        Ok(response)
    }

    pub fn removal_status(&self) -> Result<Value, String> {
        let Some(journal) = load_removal_journal(&self.profile_dir)? else {
            return Ok(json!({"pending":false}));
        };
        Ok(
            json!({"pending":true,"choice":journal.choice,"sourceVaultId":journal.source_vault_id,
            "destinationVaultId":journal.destination_vault_id,"itemMappings":journal.item_mappings,
            "stage":if journal.request.is_null() {"copying"} else {"finalizing"}}),
        )
    }

    pub fn abort_move_plan(&self) -> Result<Value, String> {
        let journal =
            load_removal_journal(&self.profile_dir)?.ok_or("vault move plan is unavailable")?;
        if journal.choice != "move" || !journal.request.is_null() {
            return Err("finalized requests must be retried, not abandoned".to_owned());
        }
        fs::remove_file(removal_journal_path(&self.profile_dir))
            .map_err(|_| "vault move plan could not be cleared")?;
        Ok(
            json!({"aborted":true,"sourceVaultId":journal.source_vault_id,
            "destinationVaultId":journal.destination_vault_id,"copiedItemsMayRemain":true,
            "itemMappings":journal.item_mappings}),
        )
    }

    pub fn archive_vault(&mut self, selector: &str) -> Result<Value, String> {
        if !self.online {
            return Err("vault removal requires an online session".to_owned());
        }
        if let Some(journal) = load_removal_journal(&self.profile_dir)? {
            if journal.choice != "archive"
                || self.resolve_vault_id(selector)? != journal.source_vault_id
            {
                return Err("resume the pending vault removal first".to_owned());
            }
            return self.finish_removal(&journal);
        }
        self.sync_now()?;
        if self.settings_conflict || self.settings_record.pending.is_some() {
            return Err("resolve vault settings before removing a vault".to_owned());
        }
        let source = self.resolve_vault_id(selector)?;
        self.checkpoint_now(&source)?;
        let replica = self.ensure_vault_settled(&source)?;
        let settings = settings_after_archive(self.settings_data.clone(), &source);
        let envelope = vault_settings::encrypt(&self.core, self.root, &settings)?;
        let request = json!({"requestId":uuid::Uuid::new_v4(),"choice":"archive","destinationVaultId":null,"sourceCatalogueRevision":Self::catalogue_revision(&replica)?,"destinationCatalogueRevision":null,"itemMappings":[],"settings":{"baseRevision":self.settings_record.remote_revision,"revision":vault_settings::revision(&envelope)?,"envelope":envelope}});
        let journal = VaultRemovalJournal {
            source_vault_id: source,
            choice: "archive".to_owned(),
            destination_vault_id: None,
            source_catalogue_revision: None,
            item_mappings: Vec::new(),
            request,
        };
        save_removal_journal(&self.profile_dir, &journal)?;
        self.finish_removal(&journal)
    }

    #[allow(clippy::too_many_lines)]
    pub fn move_vault(
        &mut self,
        source_selector: &str,
        destination_selector: &str,
    ) -> Result<Value, String> {
        if !self.online {
            return Err("vault removal requires an online session".to_owned());
        }
        let mut journal = if let Some(journal) = load_removal_journal(&self.profile_dir)? {
            if journal.choice != "move"
                || self.resolve_vault_id(source_selector)? != journal.source_vault_id
                || self.resolve_vault_id(destination_selector)?
                    != journal.destination_vault_id.as_deref().unwrap_or("")
            {
                return Err("resume the pending vault removal first".to_owned());
            }
            journal
        } else {
            self.sync_now()?;
            if self.settings_conflict || self.settings_record.pending.is_some() {
                return Err("resolve vault settings before removing a vault".to_owned());
            }
            let source = self.resolve_vault_id(source_selector)?;
            let destination = self.resolve_vault_id(destination_selector)?;
            if source == destination {
                return Err("move destination must differ from the source".to_owned());
            }
            self.checkpoint_now(&source)?;
            self.checkpoint_now(&destination)?;
            let source_replica = self.ensure_vault_settled(&source)?;
            self.ensure_vault_settled(&destination)?;
            if source_replica.items.len() > 50 {
                return Err("move exceeds the 50-item server limit".to_owned());
            }
            let journal = VaultRemovalJournal {
                source_vault_id: source,
                choice: "move".to_owned(),
                destination_vault_id: Some(destination),
                source_catalogue_revision: Some(Self::catalogue_revision(&source_replica)?),
                item_mappings: source_replica
                    .items
                    .iter()
                    .map(|item| ItemMoveMapping {
                        source_item_id: item.item_id.clone(),
                        destination_item_id: uuid::Uuid::new_v4().to_string(),
                    })
                    .collect(),
                request: Value::Null,
            };
            save_removal_journal(&self.profile_dir, &journal)?;
            journal
        };
        if !journal.request.is_null() {
            return self.finish_removal(&journal);
        }
        self.sync_now()?;
        let source = journal.source_vault_id.clone();
        let destination = journal
            .destination_vault_id
            .clone()
            .ok_or("vault removal journal is invalid")?;
        self.checkpoint_now(&source)?;
        let source_replica = self.ensure_vault_settled(&source)?;
        if Some(Self::catalogue_revision(&source_replica)?) != journal.source_catalogue_revision {
            return Err(
                "source changed during move; copied items were preserved for review".to_owned(),
            );
        }
        let destination_replica = self
            .replica_store
            .load(&destination)?
            .ok_or("local replica is unavailable")?;
        if destination_replica.retired
            || !destination_replica.pending.is_empty()
            || !destination_replica.conflicts.is_empty()
        {
            return Err(
                "resolve destination pending edits and conflicts before continuing move".to_owned(),
            );
        }
        for mapping in &journal.item_mappings {
            let source_item = source_replica
                .items
                .iter()
                .find(|item| item.item_id == mapping.source_item_id)
                .ok_or("source item changed during move")?;
            let draft = self.decrypt_item_parts(
                &source,
                &source_item.item_id,
                &source_replica.catalogue,
                &source_item.index,
                &source_item.body,
            )?;
            let destination_replica = self
                .replica_store
                .load(&destination)?
                .ok_or("local replica is unavailable")?;
            if let Some(existing) = destination_replica
                .items
                .iter()
                .find(|item| item.item_id == mapping.destination_item_id)
            {
                let copied = self.decrypt_item_parts(
                    &destination,
                    &existing.item_id,
                    &destination_replica.catalogue,
                    &existing.index,
                    &existing.body,
                )?;
                for field in ["title", "website", "username", "password", "customFields"] {
                    if copied[field] != draft[field] {
                        return Err("destination copy changed during move; review it before retiring the source".to_owned());
                    }
                }
                continue;
            }
            self.item_upsert_at_id(
                &destination,
                None,
                Some(&mapping.destination_item_id),
                draft["title"].as_str().ok_or("source item is invalid")?,
                draft["website"].as_str().ok_or("source item is invalid")?,
                draft["username"].as_str().ok_or("source item is invalid")?,
                draft["password"].as_str().ok_or("source item is invalid")?,
                draft["customFields"]
                    .as_array()
                    .ok_or("source item is invalid")?,
            )?;
            // Refresh the signed device head before the next create. The
            // catalogue advances locally, but the operation log advances only
            // after the server accepts and the replica is hydrated.
            self.sync_now()?;
            let current_source = self
                .replica_store
                .load(&source)?
                .ok_or("local replica is unavailable")?;
            if Some(Self::catalogue_revision(&current_source)?) != journal.source_catalogue_revision
            {
                return Err(
                    "source changed during move; copied items were preserved for review".to_owned(),
                );
            }
            let current_destination = self
                .replica_store
                .load(&destination)?
                .ok_or("local replica is unavailable")?;
            if !current_destination.pending.is_empty() || !current_destination.conflicts.is_empty()
            {
                return Err(
                    "destination copy is pending or conflicted; resume the move after resolving it"
                        .to_owned(),
                );
            }
        }
        self.sync_now()?;
        self.checkpoint_now(&destination)?;
        let source_replica = self.ensure_vault_settled(&source)?;
        let destination_replica = self.ensure_vault_settled(&destination)?;
        if Some(Self::catalogue_revision(&source_replica)?) != journal.source_catalogue_revision {
            return Err(
                "source changed during move; copied items were preserved for review".to_owned(),
            );
        }
        for mapping in &journal.item_mappings {
            let source_item = source_replica
                .items
                .iter()
                .find(|item| item.item_id == mapping.source_item_id)
                .ok_or("source item changed during move")?;
            let destination_item = destination_replica
                .items
                .iter()
                .find(|item| item.item_id == mapping.destination_item_id)
                .ok_or("destination copy is missing")?;
            let original = self.decrypt_item_parts(
                &source,
                &source_item.item_id,
                &source_replica.catalogue,
                &source_item.index,
                &source_item.body,
            )?;
            let copied = self.decrypt_item_parts(
                &destination,
                &destination_item.item_id,
                &destination_replica.catalogue,
                &destination_item.index,
                &destination_item.body,
            )?;
            for field in ["title", "website", "username", "password", "customFields"] {
                if original[field] != copied[field] {
                    return Err(
                        "destination copy differs from source; source was preserved".to_owned()
                    );
                }
            }
        }
        if self.settings_conflict || self.settings_record.pending.is_some() {
            return Err("resolve vault settings before retiring the source".to_owned());
        }
        let settings = settings_after_move(self.settings_data.clone(), &source, &destination);
        let envelope = vault_settings::encrypt(&self.core, self.root, &settings)?;
        journal.request = json!({"requestId":uuid::Uuid::new_v4(),"choice":"move","destinationVaultId":destination,
            "sourceCatalogueRevision":Self::catalogue_revision(&source_replica)?,
            "destinationCatalogueRevision":Self::catalogue_revision(&destination_replica)?,
            "itemMappings":journal.item_mappings.iter().map(|mapping| json!({"sourceItemId":mapping.source_item_id,"destinationItemId":mapping.destination_item_id})).collect::<Vec<_>>(),
            "settings":{"baseRevision":self.settings_record.remote_revision,"revision":vault_settings::revision(&envelope)?,"envelope":envelope}});
        save_removal_journal(&self.profile_dir, &journal)?;
        self.finish_removal(&journal)
    }

    pub fn restore_archived_vault(&mut self, selector: &str) -> Result<Value, String> {
        if !self.online {
            return Err("vault restore requires an online session".to_owned());
        }
        if let Some(journal) = load_removal_journal(&self.profile_dir)? {
            if journal.choice != "restore"
                || self.resolve_vault_id(selector)? != journal.source_vault_id
            {
                return Err("resume the pending vault removal first".to_owned());
            }
            return self.finish_restore(&journal);
        }
        self.hydrate_replicas()?;
        let source = self.resolve_vault_id(selector)?;
        let replica = self
            .replica_store
            .load(&source)?
            .ok_or("local replica is unavailable")?;
        if !replica.retired || replica.retirement_choice.as_deref() != Some("archive") {
            return Err("vault is not archived".to_owned());
        }
        let request = json!({"requestId":uuid::Uuid::new_v4(),"sourceCatalogueRevision":Self::catalogue_revision(&replica)?});
        let journal = VaultRemovalJournal {
            source_vault_id: source,
            choice: "restore".to_owned(),
            destination_vault_id: None,
            source_catalogue_revision: None,
            item_mappings: Vec::new(),
            request,
        };
        save_removal_journal(&self.profile_dir, &journal)?;
        self.finish_restore(&journal)
    }

    fn finish_restore(&mut self, journal: &VaultRemovalJournal) -> Result<Value, String> {
        let source = &journal.source_vault_id;
        let response = self.post_auth(
            &format!("/api/v1/vaults/{source}/restore"),
            reqwest::Method::POST,
            &journal.request,
        )?;
        if response["requestId"] != journal.request["requestId"]
            || response["vaultId"] != *source
            || response["restored"] != true
        {
            return Err("vault restore receipt is invalid".to_owned());
        }
        self.hydrate_replicas()?;
        fs::remove_file(removal_journal_path(&self.profile_dir))
            .map_err(|_| "vault restore journal could not be cleared")?;
        Ok(response)
    }

    pub fn set_default_view(
        &mut self,
        kind: &str,
        selector: Option<&str>,
    ) -> Result<Value, String> {
        let view = match kind {
            "all" => vault_settings::View::All,
            "vault" => vault_settings::View::Vault(
                self.resolve_vault_id(selector.ok_or("vault is required")?)?,
            ),
            "collection" => {
                let id = selector.ok_or("collection ID is required")?;
                if !self
                    .settings_data
                    .collections
                    .iter()
                    .any(|row| row.id == id)
                {
                    return Err("collection is unavailable".to_owned());
                }
                vault_settings::View::Collection(id.to_owned())
            }
            _ => return Err("choose all, vault, or collection".to_owned()),
        };
        self.edit_vault_settings(|settings| {
            settings.default_view = Some(view);
            Ok(())
        })
    }

    pub fn collection_items(&mut self, id: &str) -> Result<Value, String> {
        let collection = self
            .settings_data
            .collections
            .iter()
            .find(|row| row.id == id)
            .ok_or("collection is unavailable")?
            .clone();
        let available = self.vault_list()?;
        let mut items = Vec::new();
        let mut unavailable = Vec::new();
        for vault_id in collection.vault_ids {
            if !available
                .as_array()
                .ok_or("invalid vault list")?
                .iter()
                .any(|row| row["vaultId"] == vault_id)
            {
                unavailable.push(vault_id);
                continue;
            }
            for mut item in self
                .item_list(&vault_id)?
                .as_array()
                .ok_or("invalid item list")?
                .clone()
            {
                item["vaultId"] = json!(vault_id);
                items.push(item);
            }
        }
        Ok(json!({"items":items,"unavailableVaultIds":unavailable}))
    }
    pub fn default_vault(&self) -> Result<Option<String>, String> {
        let path = self.profile_dir.join("default-vault.txt");
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("default vault preference is unavailable".to_owned()),
        };
        let id = raw.trim();
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("default vault preference is invalid".to_owned());
        }
        let listed = self.vault_list()?;
        Ok(listed
            .as_array()
            .and_then(|rows| {
                rows.iter()
                    .find(|row| row["vaultId"] == id && row["retired"] != true)
            })
            .map(|_| id.to_owned()))
    }

    pub fn set_default_vault(&self, selector: Option<&str>) -> Result<Option<String>, String> {
        let path = self.profile_dir.join("default-vault.txt");
        let Some(selector) = selector else {
            match fs::remove_file(path) {
                Ok(()) => return Ok(None),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("default vault preference could not be cleared".to_owned()),
            }
        };
        let id = self.resolve_vault_id(selector)?;
        let mut file = atomic_write_file::AtomicWriteFile::open(path)
            .map_err(|_| "default vault preference is unavailable")?;
        file.write_all(id.as_bytes())
            .map_err(|_| "default vault preference could not be saved")?;
        file.commit()
            .map_err(|_| "default vault preference could not be saved")?;
        Ok(Some(id))
    }
    /// Approves a new device using this authenticated trusted device.
    pub fn approve_device_code(&self, code: &str) -> Result<(), String> {
        let inspected = self.device_enrollment(code)?;
        self.sign_device_approval(&inspected)?;
        Ok(())
    }

    fn device_enrollment(
        &self,
        code: &str,
    ) -> Result<crate::devices::EnrollmentInspection, String> {
        if !self.online {
            return Err("device approval requires an online session".to_owned());
        }
        let code = crate::devices::normalize_code(code)?;
        let inspected = self.post_auth(
            "/api/v1/device-enrollment/inspect",
            reqwest::Method::POST,
            &json!({"code":code}),
        )?;
        crate::devices::EnrollmentInspection::parse(inspected)
    }

    pub fn inspect_device_code(&self, code: &str) -> Result<Value, String> {
        self.device_enrollment(code)?.review()
    }

    pub fn approve_reviewed_device(
        &self,
        code: &str,
        enrollment_id: &str,
        device_id: &str,
        fingerprint: &str,
    ) -> Result<Value, String> {
        let inspected = self.device_enrollment(code)?;
        inspected.matches(enrollment_id, device_id, fingerprint)?;
        self.sign_device_approval(&inspected)?;
        Ok(json!({"approved":true,"deviceId":inspected.new_device_id,
            "enrollmentId":inspected.enrollment_id,"enrollmentComplete":false}))
    }

    fn sign_device_approval(
        &self,
        inspected: &crate::devices::EnrollmentInspection,
    ) -> Result<(), String> {
        let bytes = inspected.signing_bytes()?;
        let signature = URL_SAFE_NO_PAD.encode(self.signing.sign(&bytes).to_bytes());
        self.post_auth(
            &format!(
                "/api/v1/device-enrollment/{}/approval",
                inspected.enrollment_id
            ),
            reqwest::Method::POST,
            &json!({"approvalSignature":signature}),
        )?;
        Ok(())
    }

    /// Asks the server to sign the current operation head, then verifies and
    /// pins the returned checkpoint during normal replica hydration.
    pub fn checkpoint_now(&mut self, vault_id: &str) -> Result<(), String> {
        if !self.online {
            return Err("checkpoint requires an online session".to_owned());
        }
        self.post_auth(
            &format!("/api/v1/vaults/{vault_id}/checkpoint"),
            reqwest::Method::POST,
            &json!({}),
        )?;
        self.hydrate_replicas()
    }
    /// Explicitly retire one rejected mutation after choosing the verified
    /// server item. Other queued edits in the vault remain untouched.
    pub fn discard_conflict(
        &mut self,
        vault_id: &str,
        item_id: &str,
        operation_id: &str,
    ) -> Result<(), String> {
        self.replica_store.update(vault_id, |replica| {
            let before = replica.pending.len();
            replica.pending.retain(|entry| {
                !(entry.operation["opId"] == operation_id && entry.operation["itemId"] == item_id)
            });
            if before == replica.pending.len() {
                return Err("pending conflict is unavailable".to_owned());
            }
            replica
                .conflicts
                .retain(|row| row["operationId"] != operation_id);
            replica.sync_error = None;
            Ok(())
        })?;
        Ok(())
    }

    pub fn conflict_list(&self, vault_selector: &str) -> Result<Value, String> {
        let vault_id = self.resolve_vault_id(vault_selector)?;
        let replica = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        Ok(
            json!({"vaultId":vault_id,"pending":replica.pending.len(),"conflicts":replica.conflicts,"syncError":replica.sync_error}),
        )
    }

    pub fn conflict_item_id(
        &self,
        vault_selector: &str,
        operation_id: &str,
    ) -> Result<(String, String), String> {
        let vault_id = self.resolve_vault_id(vault_selector)?;
        let replica = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        let row = replica
            .conflicts
            .iter()
            .find(|row| row["operationId"] == operation_id)
            .ok_or("pending conflict is unavailable")?;
        let item_id = row["itemId"]
            .as_str()
            .ok_or("pending conflict is invalid")?;
        if !replica.pending.iter().any(|entry| {
            entry.operation["opId"] == operation_id && entry.operation["itemId"] == item_id
        }) {
            return Err("pending conflict is unavailable".to_owned());
        }
        Ok((vault_id, item_id.to_owned()))
    }

    pub fn resolve_conflict(
        &mut self,
        vault_selector: &str,
        operation_id: &str,
        keep: &str,
    ) -> Result<Value, String> {
        let (vault_id, item_id) = self.conflict_item_id(vault_selector, operation_id)?;
        if keep == "server" {
            // An online agent may have lost its connection or authorization
            // since comparison. Verify the current server copy before retiring
            // this draft, just as the Desktop server-copy action does.
            self.conflict_compare(&vault_id, &item_id, operation_id)?;
            self.discard_conflict(&vault_id, &item_id, operation_id)?;
            return Ok(json!({"resolved":operation_id,"kept":"server"}));
        }
        if keep != "local" {
            return Err("choose server or local".to_owned());
        }
        let draft = self.conflict_draft(&vault_id, &item_id, operation_id)?;
        let result = self.item_upsert_resolving(
            &vault_id,
            &item_id,
            operation_id,
            draft["title"].as_str().ok_or("pending item is invalid")?,
            draft["website"].as_str().ok_or("pending item is invalid")?,
            draft["username"]
                .as_str()
                .ok_or("pending item is invalid")?,
            draft["password"]
                .as_str()
                .ok_or("pending item is invalid")?,
            draft["customFields"]
                .as_array()
                .ok_or("pending item is invalid")?,
        )?;
        Ok(json!({"resolved":operation_id,"kept":"local","result":result}))
    }

    /// Decrypt a quarantined draft only in memory for the merge UI. The replica
    /// retains the original ciphertext request and never stores this result.
    pub fn conflict_draft(
        &mut self,
        vault_id: &str,
        item_id: &str,
        operation_id: &str,
    ) -> Result<Value, String> {
        let replica = self
            .replica_store
            .load(vault_id)?
            .ok_or("local replica is unavailable")?;
        if !replica
            .conflicts
            .iter()
            .any(|row| row["operationId"] == operation_id && row["itemId"] == item_id)
        {
            return Err("pending conflict is unavailable".to_owned());
        }
        let pending = replica
            .pending
            .iter()
            .find(|entry| {
                entry.operation["opId"] == operation_id && entry.operation["itemId"] == item_id
            })
            .ok_or("pending conflict is unavailable")?;
        let catalogue = pending.request["catalogue"]
            .as_str()
            .ok_or("pending item is invalid")?
            .to_owned();
        let index = pending.request["index"]
            .as_str()
            .ok_or("pending item is invalid")?
            .to_owned();
        let body = pending.request["body"]
            .as_str()
            .ok_or("pending item is invalid")?
            .to_owned();
        self.decrypt_item_parts(vault_id, item_id, &catalogue, &index, &body)
    }

    /// Refresh verified server state for comparison without submitting queued work.
    pub fn conflict_compare(
        &mut self,
        vault_id: &str,
        item_id: &str,
        operation_id: &str,
    ) -> Result<Value, String> {
        let (_, pending_item) = self.conflict_item_id(vault_id, operation_id)?;
        if pending_item != item_id {
            return Err("pending conflict item does not match".to_owned());
        }
        if !self.online {
            return Err(
                "Reconnect to load the verified server version. Your queued edit is preserved."
                    .to_owned(),
            );
        }
        self.hydrate_replicas()?;
        let replica = self
            .replica_store
            .load(vault_id)?
            .ok_or("local replica unavailable")?;
        let conflict = replica
            .conflicts
            .iter()
            .find(|row| row["operationId"] == operation_id)
            .ok_or("pending conflict is unavailable")?;
        let Some(item) = replica.items.iter().find(|row| row.item_id == item_id) else {
            let queued_create = replica.pending.iter().any(|entry| {
                entry.operation["opId"] == operation_id && entry.operation["kind"] == "item.create"
            });
            return Ok(
                json!({"deleted":true,"queuedCreate":queued_create,"conflict":conflict,"server":null}),
            );
        };
        let server = self.decrypt_item_parts(
            vault_id,
            item_id,
            &replica.catalogue,
            &item.index,
            &item.body,
        )?;
        Ok(json!({"deleted":false,"conflict":conflict,"server":server}))
    }

    fn decrypt_item_parts(
        &mut self,
        vault_id: &str,
        item_id: &str,
        catalogue: &str,
        index: &str,
        body: &str,
    ) -> Result<Value, String> {
        let catalogue = URL_SAFE_NO_PAD
            .decode(catalogue)
            .map_err(|_| "encrypted item is invalid")?;
        let index = URL_SAFE_NO_PAD
            .decode(index)
            .map_err(|_| "encrypted item is invalid")?;
        let body = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| "encrypted item is invalid")?;
        let (_, vault, _) = self.open_vault(vault_id)?;
        let index = self
            .core
            .decrypt_private_part(vault, &catalogue, uuid_bytes(item_id)?, &index, 4)
            .map_err(|_| "item index verification failed")?;
        let body = self
            .core
            .decrypt_private_part(vault, &catalogue, uuid_bytes(item_id)?, &body, 3)
            .map_err(|_| "item verification failed")?;
        let index: Value =
            serde_json::from_slice(&index).map_err(|_| "pending item index is invalid")?;
        let body: Value =
            serde_json::from_slice(&body).map_err(|_| "pending item body is invalid")?;
        Ok(
            json!({"itemId":item_id,"title":index["title"],"website":index["website"],"username":body["username"],"password":body["password"],"customFields":body["customFields"]}),
        )
    }
    /// Drops unsynchronized local mutations, then replaces the replica with the
    /// latest verified server state. This is intentionally separate from sync,
    /// which always tries to preserve and upload pending work.
    pub fn discard_local_changes(&mut self) -> Result<Value, String> {
        if !self.online {
            return Err("server state is unavailable while offline".to_owned());
        }
        let replicas = self.replica_store.list()?;
        let discarded = replicas
            .iter()
            .map(|replica| replica.pending.len())
            .sum::<usize>();
        for replica in replicas {
            self.replica_store.update(&replica.vault_id, |current| {
                current.pending.clear();
                current.conflicts.clear();
                current.sync_error = None;
                Ok(())
            })?;
        }
        self.hydrate_replicas()?;
        Ok(json!({"discarded":discarded,"online":true}))
    }

    /// Retries durable pending mutations by their stable request/operation IDs,
    /// then refreshes and verifies the encrypted replica.
    pub fn sync_now(&mut self) -> Result<Value, String> {
        if !self.online {
            return Err("sync unavailable while offline".to_owned());
        }
        let replicas = self.replica_store.list()?;
        let mut accepted = 0_u64;
        for replica in replicas {
            for pending in replica.pending.clone() {
                // A rejected operation needs a new causal base before it can be
                // sent again. Keep its exact request bytes for explicit rebase.
                if replica
                    .conflicts
                    .iter()
                    .any(|conflict| conflict["operationId"] == pending.operation["opId"])
                {
                    continue;
                }
                let item_id = pending.operation["itemId"]
                    .as_str()
                    .ok_or("pending operation is invalid")?;
                let create = pending.operation["kind"] == "item.create";
                let path = if create {
                    format!("/api/v1/vaults/{}/items", replica.vault_id)
                } else {
                    format!("/api/v1/vaults/{}/items/{item_id}", replica.vault_id)
                };
                match self.post_auth(
                    &path,
                    if create {
                        reqwest::Method::POST
                    } else {
                        reqwest::Method::PUT
                    },
                    &pending.request,
                ) {
                    Ok(_) => {
                        let op_id = pending.operation["opId"].clone();
                        self.replica_store.update(&replica.vault_id, |current| {
                            current
                                .acknowledge(op_id.as_str().ok_or("invalid accepted operation")?)?;
                            current
                                .pending
                                .retain(|candidate| candidate.operation["opId"] != op_id);
                            current.sync_error = None;
                            Ok(())
                        })?;
                        accepted += 1;
                    }
                    Err(error) => {
                        self.replica_store.update(&replica.vault_id, |current| {
                            current.sync_error = Some(error.clone());
                            if error.contains("409") {
                                current.mark_stale(&pending.operation, item_id);
                            }
                            Ok(())
                        })?;
                        if error.contains("401") || error.contains("403") {
                            self.online = false;
                            return Err(
                                "sync authorization was revoked; pending operations were preserved"
                                    .to_owned(),
                            );
                        }
                    }
                }
            }
        }
        if let Err(error) = self.hydrate_replicas() {
            if error.contains("401") || error.contains("403") {
                self.online = false;
            }
            return Err(error);
        }
        let rebased = self.rebase_nonoverlapping_conflicts()?;
        let conflicts = self
            .replica_store
            .list()?
            .into_iter()
            .flat_map(|replica| replica.conflicts)
            .collect::<Vec<_>>();
        let pending = self
            .replica_store
            .list()?
            .iter()
            .map(|replica| replica.pending.len())
            .sum::<usize>();
        let settings = match self.sync_vault_settings() {
            Ok(settings) => settings,
            Err(error) => {
                if !self.online {
                    return Err(error);
                }
                json!({"pending":true,"error":error})
            }
        };
        Ok(
            json!({"accepted":accepted,"rebased":rebased,"pending":pending,"online":true,"conflicts":conflicts,"vaultSettings":settings}),
        )
    }

    #[allow(clippy::too_many_lines)]
    fn rebase_nonoverlapping_conflicts(&mut self) -> Result<u64, String> {
        let mut rebased = 0;
        let move_plan = load_removal_journal(&self.profile_dir)?
            .filter(|journal| journal.choice == "move" && journal.request.is_null());
        for replica in self.replica_store.list()? {
            for conflict in replica.conflicts.clone() {
                // Earlier operations in this batch may have recreated an item
                // or advanced its verified body. Review the current snapshot.
                let replica = self
                    .replica_store
                    .load(&replica.vault_id)?
                    .ok_or("local replica is unavailable")?;
                let Some(operation_id) = conflict["operationId"].as_str() else {
                    continue;
                };
                let Some(item_id) = conflict["itemId"].as_str() else {
                    continue;
                };
                let Some(pending) = replica
                    .pending
                    .iter()
                    .find(|entry| entry.operation["opId"] == operation_id)
                else {
                    continue;
                };
                if pending.operation["kind"] == "item.create" {
                    if move_plan.as_ref().is_some_and(|journal| {
                        journal.destination_vault_id.as_deref() == Some(&replica.vault_id)
                            && journal
                                .item_mappings
                                .iter()
                                .any(|mapping| mapping.destination_item_id == item_id)
                    }) {
                        // A move's reserved destination ID must never be
                        // replaced by the generic stale-create rebase.
                        continue;
                    }
                    if replica.items.iter().any(|row| row.item_id == item_id) {
                        self.replica_store.update(&replica.vault_id, |current| {
                            if let Some(row) = current
                                .conflicts
                                .iter_mut()
                                .find(|row| row["operationId"] == operation_id)
                            {
                                row["kind"] = json!("create-id-collision");
                            }
                            Ok(())
                        })?;
                    } else {
                        self.rebase_stale_create(&replica.vault_id, item_id, operation_id)?;
                        self.hydrate_replicas()?;
                        rebased += 1;
                    }
                    continue;
                }
                let (Some(base_catalogue), Some(base_item)) =
                    (&pending.base_catalogue, &pending.base_item)
                else {
                    continue;
                };
                let Some(remote_item) = replica.items.iter().find(|row| row.item_id == item_id)
                else {
                    self.replica_store.update(&replica.vault_id, |current| {
                        if let Some(row) = current
                            .conflicts
                            .iter_mut()
                            .find(|row| row["operationId"] == operation_id)
                        {
                            row["kind"] = json!("delete-edit-divergence");
                        }
                        Ok(())
                    })?;
                    continue;
                };
                let base = self.decrypt_item_parts(
                    &replica.vault_id,
                    item_id,
                    base_catalogue,
                    &base_item.index,
                    &base_item.body,
                )?;
                let local = self.conflict_draft(&replica.vault_id, item_id, operation_id)?;
                let remote = self.decrypt_item_parts(
                    &replica.vault_id,
                    item_id,
                    &replica.catalogue,
                    &remote_item.index,
                    &remote_item.body,
                )?;
                match merge_item_fields(&base, &local, &remote) {
                    Err(fields) => {
                        let local_fields =
                            ["title", "website", "username", "password", "customFields"]
                                .into_iter()
                                .filter(|field| local[*field] != base[*field])
                                .collect::<Vec<_>>();
                        let remote_fields =
                            ["title", "website", "username", "password", "customFields"]
                                .into_iter()
                                .filter(|field| remote[*field] != base[*field])
                                .collect::<Vec<_>>();
                        self.replica_store.update(&replica.vault_id, |current| {
                            if let Some(row) = current
                                .conflicts
                                .iter_mut()
                                .find(|row| row["operationId"] == operation_id)
                            {
                                row["kind"] = json!("same-field");
                                row["fields"] = json!(fields);
                                row["localFields"] = json!(local_fields);
                                row["remoteFields"] = json!(remote_fields);
                                row["remoteCursor"] = json!(current.cursor);
                            }
                            Ok(())
                        })?;
                    }
                    Ok(merged) => {
                        let fields = merged["customFields"]
                            .as_array()
                            .ok_or("merged item is invalid")?;
                        self.item_upsert_resolving(
                            &replica.vault_id,
                            item_id,
                            operation_id,
                            merged["title"].as_str().ok_or("merged item is invalid")?,
                            merged["website"].as_str().ok_or("merged item is invalid")?,
                            merged["username"]
                                .as_str()
                                .ok_or("merged item is invalid")?,
                            merged["password"]
                                .as_str()
                                .ok_or("merged item is invalid")?,
                            fields,
                        )?;
                        self.hydrate_replicas()?;
                        rebased += 1;
                    }
                }
            }
        }
        Ok(rebased)
    }

    fn rebase_stale_create(
        &mut self,
        vault_id: &str,
        item_id: &str,
        operation_id: &str,
    ) -> Result<(), String> {
        // A previous rebase in this batch may have advanced both the catalogue
        // and this device's accepted head. Do not sign against the older snapshot.
        self.hydrate_replicas()?;
        let draft = self.conflict_draft(vault_id, item_id, operation_id)?;
        let before = self
            .replica_store
            .load(vault_id)?
            .ok_or("local replica is unavailable")?;
        self.discard_conflict(vault_id, item_id, operation_id)?;
        let result = self.item_upsert_at_id(
            vault_id,
            None,
            Some(item_id),
            draft["title"].as_str().ok_or("pending item is invalid")?,
            draft["website"].as_str().ok_or("pending item is invalid")?,
            draft["username"]
                .as_str()
                .ok_or("pending item is invalid")?,
            draft["password"]
                .as_str()
                .ok_or("pending item is invalid")?,
            draft["customFields"]
                .as_array()
                .ok_or("pending item is invalid")?,
        );
        if result.is_err() {
            let current = self
                .replica_store
                .load(vault_id)?
                .ok_or("local replica is unavailable")?;
            let replacement_queued = current.pending.iter().any(|entry| {
                !before
                    .pending
                    .iter()
                    .any(|old| old.operation["opId"] == entry.operation["opId"])
            });
            if !replacement_queued {
                self.replica_store.commit(&before)?;
            }
        }
        result.map(|_| ())
    }

    #[allow(clippy::too_many_lines)]
    fn hydrate_replicas(&mut self) -> Result<(), String> {
        let directory = self.get("/api/v1/vaults")?;
        let directory_bytes = bytes(&directory, "directory")?;
        let envelopes = directory["vaultEnvelopes"]
            .as_array()
            .ok_or("invalid vault list")?;
        for envelope_row in envelopes {
            let vault_id = envelope_row["vaultId"]
                .as_str()
                .ok_or("invalid vault list")?
                .to_owned();
            let envelope = bytes(envelope_row, "envelope")?;
            let opened = self
                .core
                .open_private_vault(
                    self.root,
                    &directory_bytes,
                    uuid_bytes(&vault_id)?,
                    &envelope,
                )
                .map_err(|_| "vault could not be opened")?;
            let handle = opened.handle.ok_or("vault key unavailable")?;
            let catalogue_response = self.get(&format!("/api/v1/vaults/{vault_id}/items"))?;
            let catalogue = bytes(&catalogue_response, "catalogue")?;
            let revision = uuid::Uuid::from_bytes(
                catalogue
                    .get(44..60)
                    .ok_or("invalid catalogue")?
                    .try_into()
                    .map_err(|_| "invalid catalogue")?,
            )
            .to_string();
            let cached_replica = self.replica_store.load(&vault_id)?;
            let cached_items: std::collections::HashMap<_, _> = cached_replica
                .as_ref()
                .map(|replica| {
                    replica
                        .items
                        .iter()
                        .map(|item| (item.item_id.as_str(), item))
                        .collect()
                })
                .unwrap_or_default();
            let mut items = Vec::new();
            for row in catalogue_response["indices"]
                .as_array()
                .ok_or("invalid item list")?
            {
                let item_id = row["itemId"]
                    .as_str()
                    .ok_or("invalid item list")?
                    .to_owned();
                let index = bytes(row, "envelope")?;
                self.core
                    .decrypt_private_part(handle, &catalogue, uuid_bytes(&item_id)?, &index, 4)
                    .map_err(|_| "item index verification failed")?;
                let body = if let Some(body) = verified_cached_item_body(
                    &self.core,
                    handle,
                    &catalogue,
                    &item_id,
                    &index,
                    cached_items.get(item_id.as_str()).copied(),
                ) {
                    body
                } else {
                    let body_response = self.get(&format!(
                        "/api/v1/vaults/{vault_id}/items/{item_id}?catalogueRevision={revision}"
                    ))?;
                    let body = bytes(&body_response, "envelope")?;
                    self.core
                        .decrypt_private_part(handle, &catalogue, uuid_bytes(&item_id)?, &body, 3)
                        .map_err(|_| "item verification failed")?;
                    body
                };
                items.push(ReplicaItem {
                    item_id,
                    index: URL_SAFE_NO_PAD.encode(index),
                    body: URL_SAFE_NO_PAD.encode(body),
                    created_at: row["createdAt"].as_u64(),
                    updated_at: row["updatedAt"].as_u64(),
                });
            }
            let transport = self
                .sync_transport
                .as_ref()
                .ok_or("sync transport unavailable")?;
            let sync = crate::sync_transport::pull_history(transport, &vault_id)?;
            let operations = sync["operations"]
                .as_array()
                .ok_or("invalid sync response")?;
            let device_keys = sync["devicePublicKeys"]
                .as_object()
                .ok_or("operation verification keys are missing")?;
            let mut operation_head = vaults_protocol::signed_sync::GENESIS_HASH.to_owned();
            let mut operation_heads = vec![operation_head.clone()];
            let mut device_heads = std::collections::HashMap::<String, String>::new();
            for (expected_cursor, row) in (1_u64..).zip(operations) {
                if row["cursor"].as_u64() != Some(expected_cursor) {
                    return Err(
                        "operation cursor gap detected; local replica was preserved".to_owned()
                    );
                }
                let operation = &row["operation"];
                let actor = operation["deviceId"]
                    .as_str()
                    .ok_or("invalid signed operation")?;
                let key = device_keys
                    .get(actor)
                    .and_then(Value::as_str)
                    .ok_or("operation verification key is missing")?;
                let key: [u8; 32] = URL_SAFE_NO_PAD
                    .decode(key)
                    .map_err(|_| "operation verification key is invalid")?
                    .try_into()
                    .map_err(|_| "operation verification key is invalid")?;
                if actor == self.device_id && key != self.signing.verifying_key().to_bytes() {
                    return Err(
                        "current device verification key changed; local replica was preserved"
                            .to_owned(),
                    );
                }
                vaults_protocol::signed_sync::verify_operation(
                    operation,
                    &key,
                    &self.tenant_id,
                    &vault_id,
                    self.epoch,
                )
                .map_err(|error| format!("{error}; local replica was preserved"))?;
                let expected_predecessor = device_heads.get(actor).map(String::as_str);
                if operation["previousDeviceOpId"].as_str() != expected_predecessor {
                    return Err(
                        "device operation fork detected; local replica was preserved".to_owned(),
                    );
                }
                device_heads.insert(
                    actor.to_owned(),
                    operation["opId"]
                        .as_str()
                        .ok_or("invalid signed operation")?
                        .to_owned(),
                );
                operation_head =
                    vaults_protocol::signed_sync::next_operation_head(&operation_head, operation)
                        .map_err(str::to_owned)?;
                operation_heads.push(operation_head.clone());
            }
            let checkpoint_response = transport.checkpoint(&vault_id)?;
            let checkpoint_key = checkpoint_response["checkpointPublicKey"]
                .as_str()
                .ok_or("checkpoint verification key is missing")?
                .to_owned();
            let raw_key = URL_SAFE_NO_PAD
                .decode(&checkpoint_key)
                .map_err(|_| "checkpoint verification key is invalid")?;
            let raw_key: [u8; 32] = raw_key
                .try_into()
                .map_err(|_| "checkpoint verification key is invalid")?;
            let checkpoint = checkpoint_response["checkpoint"].clone();
            let checkpoint = (!checkpoint.is_null()).then_some(checkpoint);
            let cursor = sync["cursor"].as_u64().ok_or("invalid sync cursor")?;
            let previous = self.replica_store.load(&vault_id)?;
            if let Some(old) = &previous {
                if old
                    .checkpoint_public_key
                    .as_deref()
                    .is_some_and(|key| key != checkpoint_key)
                {
                    return Err(
                        "checkpoint verification key changed; local replica was preserved"
                            .to_owned(),
                    );
                }
                verify_remote_cursor_progress(old, checkpoint.as_ref(), cursor)?;
                if operations.len() < old.operations.len()
                    || operations[..old.operations.len()] != old.operations
                {
                    return Err(
                        "verified operation history changed; local replica was preserved"
                            .to_owned(),
                    );
                }
                if old
                    .acknowledged_operations
                    .iter()
                    .any(|id| !operations.iter().any(|row| row["operation"]["opId"] == *id))
                {
                    return Err("acknowledged operation missing from server history; local replica was preserved".to_owned());
                }
            }
            if let Some(candidate) = checkpoint.as_ref() {
                vaults_protocol::signed_sync::verify_checkpoint_signature(
                    candidate,
                    &raw_key,
                    &self.tenant_id,
                    &vault_id,
                    self.epoch,
                )
                .map_err(|error| format!("{error}; local replica was preserved"))?;
                crate::sync_transport::verify_checkpoint_history(
                    transport,
                    &crate::sync_transport::CheckpointScope {
                        tenant: &self.tenant_id,
                        vault: &vault_id,
                        epoch: self.epoch,
                        key: &raw_key,
                        operation_heads: &operation_heads,
                    },
                    previous
                        .as_ref()
                        .and_then(|replica| replica.checkpoint.as_ref()),
                    candidate,
                )?;
                if candidate["cursor"].as_u64() == Some(cursor)
                    && candidate["operationHeadHash"] != operation_head
                {
                    return Err(
                        "checkpoint operation head mismatch; local replica was preserved"
                            .to_owned(),
                    );
                }
            }
            let mut replica = Replica::new(self.tenant_id.clone(), vault_id.clone(), self.epoch);
            replica.retired = envelope_row["retired"].as_bool().unwrap_or(false);
            replica.retirement_choice =
                envelope_row["retirementChoice"].as_str().map(str::to_owned);
            replica.directory = URL_SAFE_NO_PAD.encode(&directory_bytes);
            replica.vault_envelope = URL_SAFE_NO_PAD.encode(envelope);
            replica.catalogue = URL_SAFE_NO_PAD.encode(catalogue);
            replica.cursor = cursor;
            replica.last_verified_sync_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "system clock is invalid")?
                    .as_secs(),
            );
            replica.checkpoint = checkpoint;
            replica.checkpoint_public_key = Some(checkpoint_key);
            replica.operations.clone_from(operations);
            replica.items = items;
            if let Some(old) = previous {
                replica.pending = old.pending;
                replica.conflicts = old.conflicts;
                replica.sync_error = old.sync_error;
            }
            for conflict in &mut replica.conflicts {
                conflict["remoteCursor"] = json!(cursor);
            }
            self.core
                .release(handle)
                .map_err(|_| "vault key could not be released")?;
            self.replica_store.commit(&replica)?;
            if let Some(head) = replica
                .operations
                .iter()
                .rev()
                .map(|row| &row["operation"])
                .find(|operation| operation["deviceId"] == self.device_id)
                .and_then(|operation| operation["opId"].as_str())
            {
                self.accepted_device_heads.insert(vault_id, head.to_owned());
            } else {
                self.accepted_device_heads.remove(&vault_id);
            }
        }
        Ok(())
    }

    fn reference(prefix: &str, id: &str) -> String {
        let digest = Sha256::digest(id.as_bytes());
        format!("{prefix}-{}", hex::encode(&digest[..5]).to_uppercase())
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        let r = self
            .client
            .get(format!("{}{}", self.origin, path))
            .header("Cookie", &self.cookie)
            .send()
            .map_err(|error| server_connection_error(&error))?;
        if !r.status().is_success() {
            return Err(format!("server rejected request ({})", r.status().as_u16()));
        }
        r.json().map_err(|_| "invalid server response".to_owned())
    }
    pub fn license_status(&self) -> Result<Value, String> {
        let response = self
            .license_status_request()?
            .send()
            .map_err(|error| server_connection_error(&error))?;
        if !response.status().is_success() {
            return Err(format!(
                "server rejected request ({})",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .map_err(|_| "invalid server response".to_owned())
    }

    /// Prepares a license request without keeping the session borrowed during I/O.
    ///
    /// # Errors
    /// Returns an error when the session is offline.
    pub fn license_status_request(&self) -> Result<reqwest::blocking::RequestBuilder, String> {
        if !self.online {
            return Err("license status requires a server connection".to_owned());
        }
        Ok(self
            .client
            .get(format!("{}/api/v1/license", self.origin))
            .header("Cookie", &self.cookie))
    }
    fn post_auth(
        &self,
        path: &str,
        method: reqwest::Method,
        body: &Value,
    ) -> Result<Value, String> {
        let r = self
            .client
            .request(method, format!("{}{}", self.origin, path))
            .header("Origin", &self.origin)
            .header("X-127V-CSRF", &self.csrf)
            .header("Cookie", &self.cookie)
            .json(body)
            .send()
            .map_err(|error| server_connection_error(&error))?;
        if !r.status().is_success() {
            return Err(format!("server rejected request ({})", r.status().as_u16()));
        }
        r.json().map_err(|_| "invalid server response".to_owned())
    }
    pub fn vault_list(&self) -> Result<Value, String> {
        let replicas = self.replica_store.list()?;
        Ok(Value::Array(
            replicas
                .iter()
                .map(|v| {
                    let id = &v.vault_id;
                    json!({"name":self.settings_data.names.get(id).map_or("Private", String::as_str),"code":Self::reference("V",id),"vaultId":id,"retired":v.retired,"retirementChoice":v.retirement_choice})
                })
                .collect(),
        ))
    }
    pub(crate) fn item_sync_status(&self, vault: &str, item: &str) -> Result<Value, String> {
        let replica = self
            .replica_store
            .load(vault)?
            .ok_or("local replica is unavailable")?;
        Ok(
            json!({"pending":replica.pending.iter().any(|mutation| mutation.operation["itemId"] == item),"error":replica.sync_error}),
        )
    }

    /// Read pending item labels and changed field names without returning values.
    pub fn sync_review(&mut self) -> Result<Value, String> {
        let mut rows = Vec::new();
        for replica in self.replica_store.list()? {
            for pending in &replica.pending {
                let item_id = pending.operation["itemId"]
                    .as_str()
                    .ok_or("invalid pending item")?;
                let local = self.decrypt_item_parts(
                    &replica.vault_id,
                    item_id,
                    pending.request["catalogue"]
                        .as_str()
                        .ok_or("invalid pending catalogue")?,
                    pending.request["index"]
                        .as_str()
                        .ok_or("invalid pending index")?,
                    pending.request["body"]
                        .as_str()
                        .ok_or("invalid pending body")?,
                )?;
                let base = match (&pending.base_catalogue, &pending.base_item) {
                    (Some(catalogue), Some(item)) => Some(self.decrypt_item_parts(
                        &replica.vault_id,
                        item_id,
                        catalogue,
                        &item.index,
                        &item.body,
                    )?),
                    _ => None,
                };
                let fields: Vec<_> = ["title", "website", "username", "password", "customFields"]
                    .into_iter()
                    .filter(|field| {
                        base.as_ref()
                            .is_none_or(|value| value[*field] != local[*field])
                    })
                    .collect();
                let conflict = replica
                    .conflicts
                    .iter()
                    .find(|row| row["operationId"] == pending.operation["opId"]);
                rows.push(json!({"vaultId":replica.vault_id,"itemId":item_id,
                    "operationId":pending.operation["opId"],"title":local["title"],
                    "fields":fields,"conflict":conflict,"error":replica.sync_error}));
            }
        }
        Ok(
            json!({"items":rows,"settingsPending":self.settings_record.pending.is_some(),"settingsConflict":self.settings_conflict,
                "unverifiedAcknowledgements":self.replica_store.list()?.iter().map(|replica|replica.acknowledged_operations.len()).sum::<usize>()}),
        )
    }

    pub fn replica_status(&self) -> Result<Value, String> {
        let replicas = self.replica_store.list()?;
        let last_verified_sync_at = replicas
            .iter()
            .map(|replica| replica.last_verified_sync_at)
            .collect::<Option<Vec<_>>>()
            .and_then(|times| times.into_iter().min());
        Ok(json!({
            "vaultCount": replicas.len(),
            "pending": replicas.iter().map(|r| r.pending.len()).sum::<usize>() + usize::from(self.settings_record.pending.is_some()),
            "conflicts": replicas.iter().map(|r| r.conflicts.len()).sum::<usize>() + usize::from(self.settings_conflict),
            "lastVerifiedSyncAt": last_verified_sync_at,
            "online": self.online,
            "offlineReason": self.offline_reason,
        }))
    }
    pub fn is_online(&self) -> bool {
        self.online
    }
    pub fn offline_reason(&self) -> Option<&str> {
        self.offline_reason.as_deref()
    }
    fn resolve_vault_id(&self, selector: &str) -> Result<String, String> {
        let listed = self.vault_list()?;
        let matches: Vec<&Value> = listed
            .as_array()
            .ok_or("invalid vault list")?
            .iter()
            .filter(|row| {
                row["vaultId"] == selector
                    || row["code"]
                        .as_str()
                        .is_some_and(|code| code.eq_ignore_ascii_case(selector))
                    || row["name"]
                        .as_str()
                        .is_some_and(|name| name.eq_ignore_ascii_case(selector))
            })
            .collect();
        if matches.len() != 1 {
            return Err(if matches.is_empty() {
                "vault not found"
            } else {
                "vault selector is ambiguous"
            }
            .to_owned());
        }
        matches[0]["vaultId"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "invalid vault list".to_owned())
    }
    pub fn vault_create(&mut self, name: &str) -> Result<Value, String> {
        if !self.online {
            return Err("vault creation requires an online session".to_owned());
        }
        if self.settings_conflict {
            return Err("resolve the vault settings conflict first".to_owned());
        }
        if name.trim().is_empty() || name.chars().count() > 80 {
            return Err("vault name must contain 1 to 80 characters".to_owned());
        }
        let current = self.get("/api/v1/vaults")?;
        let directory = bytes(&current, "directory")?;
        let base = uuid::Uuid::from_bytes(
            directory
                .get(36..52)
                .ok_or("invalid directory")?
                .try_into()
                .map_err(|_| "invalid directory")?,
        )
        .to_string();
        let made = self
            .core
            .create_private_vault(self.root, &directory)
            .map_err(|error| match error {
                vaults_crypto::ecf1::Error::LimitExceeded =>
                    "private vault limit reached (maximum 5); existing vaults and items are unchanged".to_owned(),
                _ => "vault encryption failed".to_owned(),
            })?;
        let vault_id = uuid::Uuid::from_bytes(
            made.vault
                .context
                .get(33..49)
                .ok_or("invalid vault")?
                .try_into()
                .map_err(|_| "invalid vault")?,
        )
        .to_string();
        let response=self.post_auth("/api/v1/vaults",reqwest::Method::POST,&json!({"requestId":uuid::Uuid::new_v4(),"baseDirectoryRevision":base,"directory":URL_SAFE_NO_PAD.encode(made.directory),"vaultEnvelope":URL_SAFE_NO_PAD.encode(made.vault.envelope),"catalogue":URL_SAFE_NO_PAD.encode(made.catalogue)}))?;
        self.hydrate_replicas()?;
        let metadata = self.rename_vault(&vault_id, name)?;
        Ok(
            json!({"name":name,"code":Self::reference("V",&vault_id),"vaultId":vault_id,"result":response,"settingsPending":metadata["pending"]}),
        )
    }
    pub fn vault_info(&mut self, selector: &str) -> Result<Value, String> {
        let vault_id = self.resolve_vault_id(selector)?;
        let item_count = self
            .item_list(&vault_id)?
            .as_array()
            .ok_or("invalid item list")?
            .len();
        Ok(
            json!({"name":self.settings_data.names.get(&vault_id).map_or("Private", String::as_str),"code":Self::reference("V",&vault_id),"vaultId":vault_id,"itemCount":item_count}),
        )
    }
    fn open_vault(&mut self, selector: &str) -> Result<(String, KeyHandle, Vec<u8>), String> {
        let vault_id = self.resolve_vault_id(selector)?;
        let replica = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        let directory_bytes = URL_SAFE_NO_PAD
            .decode(replica.directory)
            .map_err(|_| "local replica is invalid")?;
        let envelope = URL_SAFE_NO_PAD
            .decode(replica.vault_envelope)
            .map_err(|_| "local replica is invalid")?;
        let handle = if let Some(handle) = self.vault_handles.get(&vault_id).copied() {
            handle
        } else {
            let made = self
                .core
                .open_private_vault(
                    self.root,
                    &directory_bytes,
                    uuid_bytes(&vault_id)?,
                    &envelope,
                )
                .map_err(|error| format!("vault could not be opened ({})", error.code()))?;
            let handle = made.handle.ok_or("vault key unavailable")?;
            self.vault_handles.insert(vault_id.clone(), handle);
            handle
        };
        let catalogue = URL_SAFE_NO_PAD
            .decode(replica.catalogue)
            .map_err(|_| "local replica is invalid")?;
        Ok((vault_id, handle, catalogue))
    }
    pub fn item_list(&mut self, vault_selector: &str) -> Result<Value, String> {
        let (vault_id, vault, catalogue) = self.open_vault(vault_selector)?;
        let listed = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        let mut out = Vec::new();
        for row in &listed.items {
            let item_id = &row.item_id;
            let plain = self
                .core
                .decrypt_private_part(
                    vault,
                    &catalogue,
                    uuid_bytes(item_id)?,
                    &URL_SAFE_NO_PAD
                        .decode(&row.index)
                        .map_err(|_| "local replica is invalid")?,
                    4,
                )
                .map_err(|_| "item index verification failed".to_owned())?;
            let index: Value =
                serde_json::from_slice(&plain).map_err(|_| "item index is invalid".to_owned())?;
            out.push(json!({"code":Self::reference("I",item_id),"itemId":item_id,"title":index["title"],"website":index["website"],"itemType":index["itemType"],"favorite":index["favorite"] == true,"createdAt":row.created_at.or(index["createdAt"].as_u64()),"updatedAt":row.updated_at.or(index["updatedAt"].as_u64())}));
        }
        Ok(Value::Array(out))
    }
    pub fn item_list_all(&mut self) -> Result<Value, String> {
        let vaults = self.vault_list()?;
        let mut combined = Vec::new();
        for vault in vaults.as_array().ok_or("invalid vault list")? {
            if vault["retired"] == true {
                continue;
            }
            let vault_id = vault["vaultId"].as_str().ok_or("invalid vault list")?;
            for mut item in self
                .item_list(vault_id)?
                .as_array()
                .ok_or("invalid item list")?
                .clone()
            {
                item["vaultId"] = json!(vault_id);
                combined.push(item);
            }
        }
        Ok(Value::Array(combined))
    }
    #[allow(clippy::too_many_lines)]
    pub fn item_get(
        &mut self,
        vault_selector: &str,
        item_selector: &str,
        password_field: Option<&str>,
    ) -> Result<Value, String> {
        let listed = self.item_list(vault_selector)?;
        let matches: Vec<&Value> = listed
            .as_array()
            .ok_or("invalid item list")?
            .iter()
            .filter(|row| {
                row["itemId"] == item_selector
                    || row["code"]
                        .as_str()
                        .is_some_and(|code| code.eq_ignore_ascii_case(item_selector))
                    || row["title"]
                        .as_str()
                        .is_some_and(|title| title.eq_ignore_ascii_case(item_selector))
            })
            .collect();
        if matches.len() != 1 {
            return Err(if matches.is_empty() {
                "item not found"
            } else {
                "item selector is ambiguous"
            }
            .to_owned());
        }
        let item_id = matches[0]["itemId"]
            .as_str()
            .ok_or("invalid item list")?
            .to_owned();
        let (vault_id, vault, catalogue) = self.open_vault(vault_selector)?;
        let replica = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        let got = replica
            .items
            .iter()
            .find(|row| row.item_id == item_id)
            .ok_or("item not found")?;
        let plain = self
            .core
            .decrypt_private_part(
                vault,
                &catalogue,
                uuid_bytes(&item_id)?,
                &URL_SAFE_NO_PAD
                    .decode(&got.body)
                    .map_err(|_| "local replica is invalid")?,
                3,
            )
            .map_err(|_| "item verification failed".to_owned())?;
        let body: Value =
            serde_json::from_slice(&plain).map_err(|_| "item body is invalid".to_owned())?;
        if let Some(field) = password_field {
            if field == "password" {
                return body[field]
                    .as_str()
                    .map(|value| Value::String(value.to_owned()))
                    .ok_or_else(|| "password field not found".to_owned());
            }
            let fields = body["customFields"]
                .as_array()
                .ok_or("password field not found")?;
            let matches: Vec<&Value> = fields
                .iter()
                .filter(|candidate| {
                    candidate["type"] == "password"
                        && (candidate["id"] == field
                            || candidate["label"]
                                .as_str()
                                .is_some_and(|label| label.eq_ignore_ascii_case(field)))
                })
                .collect();
            if matches.len() != 1 {
                return Err(if matches.is_empty() {
                    "password field not found"
                } else {
                    "password field selector is ambiguous"
                }
                .to_owned());
            }
            return matches[0]["value"]
                .as_str()
                .map(|value| Value::String(value.to_owned()))
                .ok_or_else(|| "password field is not textual".to_owned());
        }
        let summary = matches[0];
        let custom_fields = body["customFields"]
            .as_array()
            .map(|fields| {
                fields
                    .iter()
                    .map(|field| {
                        let mut field = field.clone();
                        if field["type"] == "password" {
                            field["value"] = Value::String("[redacted]".to_owned());
                        }
                        field
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let item_type = custom_fields
            .iter()
            .find(|field| field["id"] == "__127vaults_item_type")
            .and_then(|field| field["value"].as_str())
            .unwrap_or("login");
        Ok(
            json!({"code":summary["code"],"itemId":item_id,"title":summary["title"],"itemType":item_type,"website":summary["website"],"username":body["username"],"password":"[redacted]","customFields":custom_fields}),
        )
    }
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    pub fn item_upsert(
        &mut self,
        vault_selector: &str,
        item_selector: Option<&str>,
        title: &str,
        website: &str,
        username: &str,
        password: &str,
        custom_fields: &[Value],
    ) -> Result<Value, String> {
        self.item_upsert_at_id(
            vault_selector,
            item_selector,
            None,
            title,
            website,
            username,
            password,
            custom_fields,
        )
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    fn item_upsert_at_id(
        &mut self,
        vault_selector: &str,
        item_selector: Option<&str>,
        create_id: Option<&str>,
        title: &str,
        website: &str,
        username: &str,
        password: &str,
        custom_fields: &[Value],
    ) -> Result<Value, String> {
        if item_selector.is_some() && create_id.is_some() {
            return Err("item operation is invalid".to_owned());
        }
        let target_vault = self.resolve_vault_id(vault_selector)?;
        // A successful online write removes its pending request, but the cached
        // operation history still predates it. Fresh creations must verify the
        // current server head before choosing their device predecessor. Do not
        // refresh over a queued draft or change an edit's reviewed baseline.
        if self.online
            && item_selector.is_none()
            && create_id.is_none()
            && self
                .replica_store
                .load(&target_vault)?
                .is_some_and(|replica| replica.pending.is_empty())
            && let Err(error) = self.hydrate_replicas()
            && error != "server connection failed"
            && error != "server request timed out"
        {
            return Err(error);
        }
        // Connectivity failures retain the durable queue path; TLS and
        // verification failures above must refuse before creating a request.
        if self
            .replica_store
            .load(&target_vault)?
            .is_some_and(|replica| replica.retired)
        {
            return Err("retired vault is read-only".to_owned());
        }
        let mut existing_created_at = Value::Null;
        let resolved_item = if let Some(selector) = item_selector {
            let vault_id = self.resolve_vault_id(vault_selector)?;
            if self.replica_store.load(&vault_id)?.is_some_and(|replica| {
                replica
                    .conflicts
                    .iter()
                    .any(|row| row["itemId"] == selector && row["kind"] == "delete-edit-divergence")
            }) {
                return Err(
                    "item was deleted remotely; discard the queued edit before changing it"
                        .to_owned(),
                );
            }
            let rows = self.item_list(vault_selector)?;
            let matches: Vec<&Value> = rows
                .as_array()
                .ok_or("invalid item list")?
                .iter()
                .filter(|row| {
                    row["itemId"] == selector
                        || row["code"]
                            .as_str()
                            .is_some_and(|code| code.eq_ignore_ascii_case(selector))
                        || row["title"]
                            .as_str()
                            .is_some_and(|title| title.eq_ignore_ascii_case(selector))
                })
                .collect();
            if matches.len() != 1 {
                return Err(if matches.is_empty() {
                    "item not found"
                } else {
                    "item selector is ambiguous"
                }
                .to_owned());
            }
            existing_created_at = matches[0]["createdAt"].clone();
            Some(
                matches[0]["itemId"]
                    .as_str()
                    .ok_or("invalid item list")?
                    .to_owned(),
            )
        } else {
            None
        };
        let (vault_id, vault, catalogue) = self.open_vault(vault_selector)?;
        let base = uuid::Uuid::from_bytes(
            catalogue
                .get(44..60)
                .ok_or("invalid catalogue")?
                .try_into()
                .map_err(|_| "invalid catalogue")?,
        )
        .to_string();
        let item = resolved_item.as_deref().map(uuid_bytes).transpose()?;
        let now = u64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "system time is invalid")?
                .as_millis(),
        )
        .map_err(|_| "system time is invalid")?;
        let item_type = custom_fields
            .iter()
            .find(|field| field["id"] == "__127vaults_item_type")
            .and_then(|field| field["value"].as_str())
            .unwrap_or("login");
        let created_at = if resolved_item.is_some() {
            existing_created_at
        } else {
            json!(now)
        };
        let favorite = custom_fields
            .iter()
            .any(|field| field["id"] == "__127vaults_favorite" && field["value"] == "true");
        let index = serde_json::to_vec(&json!({"title":title,"website":website,"itemType":item_type,"favorite":favorite,"createdAt":created_at,"updatedAt":now}))
            .map_err(|_| "invalid item")?;
        let body = serde_json::to_vec(
            &json!({"username":username,"password":password,"customFields":custom_fields}),
        )
        .map_err(|_| "invalid item")?;
        // Both index and body must fit before consuming either encryption slot.
        if self.core.remaining_creation_budget() < 2 {
            return Err("Encryption session limit reached. Lock and unlock, then retry this edit. Existing queued changes are preserved.".to_owned());
        }
        let made = if let Some(id) = create_id {
            self.core.upsert_private_item_at_id(
                vault,
                &catalogue,
                uuid_bytes(id)?,
                false,
                &index,
                &body,
            )
        } else {
            self.core
                .upsert_private_item(vault, &catalogue, item, &index, &body)
        }
        .map_err(|_| "item encryption failed".to_owned())?;
        let new_id = uuid::Uuid::from_bytes(made.item).to_string();
        let current_replica = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        let cursor = current_replica.cursor;
        let previous = current_replica
            .pending
            .iter()
            .rev()
            .filter(|entry| {
                !current_replica
                    .conflicts
                    .iter()
                    .any(|conflict| conflict["operationId"] == entry.operation["opId"])
            })
            .map(|entry| &entry.operation)
            .find(|operation| operation["deviceId"] == self.device_id)
            .and_then(|operation| operation["opId"].as_str())
            .or_else(|| {
                self.accepted_device_heads
                    .get(&vault_id)
                    .map(String::as_str)
            })
            .or_else(|| {
                current_replica
                    .operations
                    .iter()
                    .rev()
                    .map(|row| &row["operation"])
                    .find(|operation| operation["deviceId"] == self.device_id)
                    .and_then(|operation| operation["opId"].as_str())
            });
        let mut payload = Vec::new();
        for part in [&made.catalogue, &made.index, &made.body] {
            payload.extend_from_slice(
                &u32::try_from(part.len())
                    .map_err(|_| "item too large")?
                    .to_be_bytes(),
            );
            payload.extend_from_slice(part);
        }
        let operation_body = json!({"protocolVersion":1,"tenantId":self.tenant_id,"vaultId":vault_id,"deviceId":self.device_id,"epoch":self.epoch,"causalBase":cursor,"previousDeviceOpId":previous,"kind":if resolved_item.is_some(){"item.update"}else{"item.create"},"itemId":new_id,"payloadHash":hex::encode(Sha256::digest(payload))});
        let op_id = hex::encode(Sha256::digest(
            vaults_protocol::signed_sync::canonical_bytes(&operation_body)
                .map_err(str::to_owned)?,
        ));
        let mut signed = operation_body
            .as_object()
            .cloned()
            .ok_or("could not encode operation")?;
        signed.insert("opId".to_owned(), Value::String(op_id));
        let signature = URL_SAFE_NO_PAD.encode(
            self.signing
                .sign(
                    &vaults_protocol::signed_sync::canonical_bytes(&Value::Object(signed.clone()))
                        .map_err(str::to_owned)?,
                )
                .to_bytes(),
        );
        signed.insert("signature".to_owned(), Value::String(signature));
        let mut body = json!({"requestId":uuid::Uuid::new_v4(),"baseCatalogueRevision":base,"catalogue":URL_SAFE_NO_PAD.encode(&made.catalogue),"index":URL_SAFE_NO_PAD.encode(&made.index),"body":URL_SAFE_NO_PAD.encode(&made.body),"signedOperation":Value::Object(signed)});
        if resolved_item.is_none() {
            body.as_object_mut()
                .ok_or("invalid item request")?
                .insert("itemId".to_owned(), Value::String(new_id.clone()));
        }
        let operation = body["signedOperation"].clone();
        self.replica_store.update(&vault_id, |replica| {
            replica.catalogue = URL_SAFE_NO_PAD.encode(&made.catalogue);
            let next = ReplicaItem {
                item_id: new_id.clone(),
                index: URL_SAFE_NO_PAD.encode(&made.index),
                body: URL_SAFE_NO_PAD.encode(&made.body),
                created_at: created_at.as_u64(),
                updated_at: Some(now),
            };
            if let Some(existing) = replica.items.iter_mut().find(|row| row.item_id == new_id) {
                *existing = next;
            } else {
                replica.items.push(next);
            }
            replica.pending.push(PendingMutation {
                operation: operation.clone(),
                request: body.clone(),
                base_catalogue: Some(current_replica.catalogue.clone()),
                base_item: current_replica
                    .items
                    .iter()
                    .find(|row| row.item_id == new_id)
                    .cloned(),
            });
            Ok(())
        })?;
        if !self.online {
            return Ok(
                json!({"queued":true,"offline":true,"itemId":new_id,"operationId":operation["opId"]}),
            );
        }
        let path = if let Some(id) = resolved_item.as_deref() {
            format!("/api/v1/vaults/{vault_id}/items/{id}")
        } else {
            format!("/api/v1/vaults/{vault_id}/items")
        };
        let result = self.post_auth(
            &path,
            if resolved_item.is_some() {
                reqwest::Method::PUT
            } else {
                reqwest::Method::POST
            },
            &body,
        );
        match result {
            Ok(mut response) => {
                self.accepted_device_heads.insert(
                    vault_id.clone(),
                    operation["opId"]
                        .as_str()
                        .ok_or("invalid accepted operation")?
                        .to_owned(),
                );
                self.replica_store.update(&vault_id, |replica| {
                    replica.acknowledge(
                        operation["opId"]
                            .as_str()
                            .ok_or("invalid accepted operation")?,
                    )?;
                    replica
                        .pending
                        .retain(|entry| entry.operation["opId"] != operation["opId"]);
                    replica.sync_error = None;
                    Ok(())
                })?;
                response["itemId"] = json!(new_id);
                Ok(response)
            }
            Err(error) => {
                if error.contains("409") {
                    // Restore the verified view, but keep the original encrypted
                    // request so a later explicit rebase can recover this edit.
                    let mut rollback = current_replica;
                    rollback.sync_error = Some(error.clone());
                    rollback.pending.push(PendingMutation {
                        operation: operation.clone(),
                        request: body.clone(),
                        base_catalogue: Some(rollback.catalogue.clone()),
                        base_item: rollback
                            .items
                            .iter()
                            .find(|row| row.item_id == new_id)
                            .cloned(),
                    });
                    rollback.mark_stale(&operation, &new_id);
                    self.replica_store.commit(&rollback)?;
                } else {
                    self.replica_store.update(&vault_id, |replica| {
                        replica.sync_error = Some(error.clone());
                        Ok(())
                    })?;
                }
                Err(error)
            }
        }
    }

    /// Replace one quarantined operation after the user has reviewed a merge.
    /// If encryption fails before a replacement is queued, restore the old
    /// signed request. Once queued, the replacement is durable even if delivery
    /// fails, and its device predecessor excludes the retired operation.
    #[allow(clippy::too_many_arguments)]
    pub fn item_upsert_resolving(
        &mut self,
        vault_selector: &str,
        item_selector: &str,
        operation_id: &str,
        title: &str,
        website: &str,
        username: &str,
        password: &str,
        custom_fields: &[Value],
    ) -> Result<Value, String> {
        let vault_id = self.resolve_vault_id(vault_selector)?;
        let before = self
            .replica_store
            .load(&vault_id)?
            .ok_or("local replica is unavailable")?;
        before
            .pending
            .iter()
            .find(|entry| {
                entry.operation["opId"] == operation_id
                    && entry.operation["itemId"] == item_selector
            })
            .ok_or("pending conflict is unavailable")?;
        if before.conflicts.iter().any(|row| {
            row["operationId"] == operation_id && row["kind"] == "delete-edit-divergence"
        }) {
            return Err("deleted item cannot be merged; discard the queued edit".to_owned());
        }
        if !before
            .conflicts
            .iter()
            .any(|row| row["operationId"] == operation_id)
        {
            return Err("pending conflict is unavailable".to_owned());
        }
        self.replica_store.update(&vault_id, |replica| {
            replica
                .pending
                .retain(|entry| entry.operation["opId"] != operation_id);
            replica
                .conflicts
                .retain(|row| row["operationId"] != operation_id);
            Ok(())
        })?;
        let result = self.item_upsert(
            vault_selector,
            Some(item_selector),
            title,
            website,
            username,
            password,
            custom_fields,
        );
        if result.is_err() {
            let current = self
                .replica_store
                .load(&vault_id)?
                .ok_or("local replica is unavailable")?;
            let replacement_queued = current.pending.iter().any(|entry| {
                entry.operation["itemId"] == item_selector
                    && !before
                        .pending
                        .iter()
                        .any(|old| old.operation["opId"] == entry.operation["opId"])
            });
            if !replacement_queued {
                self.replica_store.commit(&before)?;
            }
        }
        result
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.online {
            let _ = self
                .client
                .delete(format!("{}/api/v1/session", self.origin))
                .header("Origin", &self.origin)
                .header("X-127V-CSRF", &self.csrf)
                .header("Cookie", &self.cookie)
                .send();
        }
        self.core.lock();
    }
}

#[cfg(test)]
#[path = "device_transport_tests.rs"]
pub(crate) mod device_transport_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removal_journal_preserves_exact_retry_request() {
        let dir = std::env::temp_dir().join(format!("127vaults-removal-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let journal = VaultRemovalJournal {
            source_vault_id: uuid::Uuid::new_v4().to_string(),
            choice: "archive".to_owned(),
            destination_vault_id: None,
            source_catalogue_revision: None,
            item_mappings: Vec::new(),
            request: json!({"requestId":uuid::Uuid::new_v4(),"settings":{"envelope":"ciphertext"}}),
        };
        save_removal_journal(&dir, &journal).unwrap();
        let loaded = load_removal_journal(&dir).unwrap().unwrap();
        assert_eq!(loaded.source_vault_id, journal.source_vault_id);
        assert_eq!(loaded.request, journal.request);
        fs::write(removal_journal_path(&dir), b"{").unwrap();
        assert!(load_removal_journal(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_journal_rejects_duplicate_destination_ids() {
        let source = uuid::Uuid::new_v4().to_string();
        let destination = uuid::Uuid::new_v4().to_string();
        let source_a = uuid::Uuid::new_v4().to_string();
        let source_b = uuid::Uuid::new_v4().to_string();
        let copied = uuid::Uuid::new_v4().to_string();
        let plan = VaultRemovalJournal {
            source_vault_id: source,
            choice: "move".to_owned(),
            destination_vault_id: Some(destination),
            source_catalogue_revision: Some(uuid::Uuid::new_v4().to_string()),
            item_mappings: vec![
                ItemMoveMapping {
                    source_item_id: source_a,
                    destination_item_id: copied.clone(),
                },
                ItemMoveMapping {
                    source_item_id: source_b,
                    destination_item_id: copied,
                },
            ],
            request: Value::Null,
        };
        assert!(plan.validate().is_err());
    }

    #[test]
    fn removal_settings_keep_archive_name_and_retarget_move_views() {
        let source = uuid::Uuid::new_v4().to_string();
        let destination = uuid::Uuid::new_v4().to_string();
        let collection_id = uuid::Uuid::new_v4().to_string();
        let mut settings = SettingsData::empty();
        settings.names.insert(source.clone(), "Source".to_owned());
        settings.collections.push(vault_settings::Collection {
            id: collection_id.clone(),
            name: "Group".to_owned(),
            vault_ids: vec![source.clone(), destination.clone()],
        });
        settings.default_view = Some(vault_settings::View::Vault(source.clone()));
        let archive = settings_after_archive(settings.clone(), &source);
        assert_eq!(
            archive.names.get(&source).map(String::as_str),
            Some("Source")
        );
        assert_eq!(archive.collections[0].vault_ids, vec![destination.clone()]);
        assert!(archive.default_view.is_none());
        let moved = settings_after_move(settings, &source, &destination);
        assert_eq!(moved.names.get(&source).map(String::as_str), Some("Source"));
        assert_eq!(moved.collections[0].vault_ids, vec![destination.clone()]);
        assert!(
            matches!(moved.default_view, Some(vault_settings::View::Vault(id)) if id == destination)
        );
    }

    #[test]
    fn device_proof_context_excludes_trailing_opaque_server_key() {
        let origin = b"https://127.0.0.1:12780";
        let mut binding = Vec::new();
        binding.extend_from_slice(&u16::try_from(origin.len()).unwrap().to_be_bytes());
        binding.extend_from_slice(origin);
        binding.extend_from_slice(&[1; 16 * 3]);
        binding.extend_from_slice(&1_u64.to_be_bytes());
        binding.extend_from_slice(&[2; 32]);
        binding.extend_from_slice(&[3; 32]);
        let actual = authentication_context_hash(&binding).unwrap();
        let mut expected = b"127Vaults/login-context/1\0".to_vec();
        expected.extend_from_slice(&binding[..binding.len() - 32]);
        assert_eq!(actual.as_slice(), Sha512::digest(expected).as_slice());
        let mut incorrect = b"127Vaults/login-context/1\0".to_vec();
        incorrect.extend_from_slice(&binding);
        assert_ne!(actual.as_slice(), Sha512::digest(incorrect).as_slice());
    }

    #[test]
    fn human_reference_is_stable_typed_and_not_name_derived() {
        let id = "64948ac2-0b82-46d7-8aae-db2645fe8b6b";
        assert_eq!(Session::reference("V", id), Session::reference("V", id));
        assert!(Session::reference("V", id).starts_with("V-"));
        assert!(Session::reference("I", id).starts_with("I-"));
        assert!(!Session::reference("V", id).contains("PRIVATE"));
    }

    #[test]
    fn client_transport_has_no_legacy_api_paths() {
        let source = include_str!("client.rs");
        assert!(!source.contains(&["/api", "/auth/"].concat()));
        assert!(!source.contains(&["/api", "/experimental/"].concat()));
        for path in [
            "/api/v1/ceremony",
            "/api/v1/auth/",
            "/api/v1/session",
            "/api/v1/vaults",
        ] {
            assert!(source.contains(path), "missing canonical route {path}");
        }
    }

    #[test]
    fn different_fields_rebase_and_same_field_changes_require_review() {
        let base =
            json!({"title":"A","website":"old","username":"u","password":"p","customFields":[]});
        let local =
            json!({"title":"Mine","website":"old","username":"u","password":"p","customFields":[]});
        let remote =
            json!({"title":"A","website":"new","username":"u","password":"p","customFields":[]});
        let merged = merge_item_fields(&base, &local, &remote).unwrap();
        assert_eq!(merged["title"], "Mine");
        assert_eq!(merged["website"], "new");
        let conflicting = json!({"title":"Theirs","website":"old","username":"u","password":"p","customFields":[]});
        assert_eq!(
            merge_item_fields(&base, &local, &conflicting).unwrap_err(),
            vec!["title"]
        );
    }

    #[test]
    fn offline_unlock_record_binds_new_profiles_to_origin_and_server() {
        let origin = "https://alice.asia.example.com";
        let mut record: OfflineUnlockRecord = serde_json::from_value(json!({
            "version": 2, "username": "alice1", "tenant_id": "11111111-1111-4111-8111-111111111111",
            "device_id": "22222222-2222-4222-8222-222222222222", "epoch": 1,
            "origin": origin, "server_id": "regional-identity", "descriptor": "", "envelope": ""
        }))
        .unwrap();
        assert!(record.matches_trust(origin, "regional-identity"));
        assert!(!record.matches_trust("https://bob.asia.example.com", "regional-identity"));
        assert!(!record.matches_trust(origin, "different-identity"));
        record.version = 1;
        assert!(!record.matches_trust(origin, "regional-identity"));
        record.origin = None;
        record.server_id = None;
        assert!(record.matches_trust(origin, "regional-identity"));
    }

    #[test]
    fn tenant_binding_is_create_only_and_rejects_profile_retargeting() {
        let dir =
            std::env::temp_dir().join(format!("127vaults-tenant-binding-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let binding = TenantBinding {
            version: 1,
            origin: "https://alice.example.com".to_owned(),
            server_id: "server-key".to_owned(),
            tenant_id: "11111111-1111-4111-8111-111111111111".to_owned(),
        };
        persist_tenant_binding(&dir, &binding).unwrap();
        persist_tenant_binding(&dir, &binding).unwrap();
        let switched = TenantBinding {
            tenant_id: "22222222-2222-4222-8222-222222222222".to_owned(),
            ..binding
        };
        assert!(check_tenant_binding(&dir, &switched).is_err());
        assert!(persist_tenant_binding(&dir, &switched).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
