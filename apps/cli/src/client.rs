#![allow(clippy::missing_errors_doc, clippy::must_use_candidate)]
use std::{fs, path::Path};

use crate::{
    replica::{PendingMutation, Replica, ReplicaItem, ReplicaStore, verify_remote_progress},
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
    vault_handles: std::collections::HashMap<String, KeyHandle>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OfflineUnlockRecord {
    version: u32,
    username: String,
    tenant_id: String,
    device_id: String,
    epoch: u64,
    descriptor: String,
    envelope: String,
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
    if record.version != 1
        || record.username != username
        || record.epoch == 0
        || uuid::Uuid::parse_str(&record.tenant_id).is_err()
        || uuid::Uuid::parse_str(&record.device_id).is_err()
    {
        return Err("offline unlock record is invalid".to_owned());
    }
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
    let (_, origin, server_id, _) = http_client(config_dir)?;
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
        vault_handles: std::collections::HashMap::new(),
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
        .map_err(|_| "server request failed".to_owned())?;
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
        .map_err(|_| "server unavailable".to_owned())?;
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
        vault_handles: std::collections::HashMap::new(),
    };
    session.hydrate_replicas()?;
    session.sync_vault_settings()?;
    save_offline_record(
        config_dir,
        &OfflineUnlockRecord {
            version: 1,
            username: username.to_owned(),
            tenant_id: session.tenant_id.clone(),
            device_id: session.device_id.clone(),
            epoch,
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
            .map_err(|offline_error| format!("{online_error}; {offline_error}")),
    }
}

impl Session {
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

    pub fn sync_vault_settings(&mut self) -> Result<Value, String> {
        if !self.online {
            return Err("vault settings sync unavailable while offline".to_owned());
        }
        let remote = self.get("/api/v1/vault-settings")?;
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
        if let Some(pending) = self.settings_record.pending.clone() {
            if pending.base_revision != revision {
                self.settings_conflict = true;
                self.settings_remote = Some((revision, envelope));
                return Ok(self.vault_settings());
            }
            let next_revision = vault_settings::revision(&pending.envelope)?;
            self.post_auth("/api/v1/vault-settings", reqwest::Method::PUT,
                &json!({"baseRevision":revision,"revision":next_revision,"envelope":pending.envelope}))?;
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
        if !self.online || !self.settings_conflict {
            return Err("vault settings conflict is unavailable".to_owned());
        }
        let (revision, envelope) = self
            .settings_remote
            .clone()
            .ok_or("vault settings conflict is unavailable")?;
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
                existing.name = name.to_owned();
                existing.vault_ids = ids;
            } else {
                if editing { return Err("collection is unavailable".to_owned()); }
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
            .and_then(|rows| rows.iter().find(|row| row["vaultId"] == id))
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
        use std::io::Write as _;
        file.write_all(id.as_bytes())
            .map_err(|_| "default vault preference could not be saved")?;
        file.commit()
            .map_err(|_| "default vault preference could not be saved")?;
        Ok(Some(id))
    }
    /// Approves a new device using this authenticated trusted device.
    pub fn approve_device_code(&self, code: &str) -> Result<(), String> {
        if !self.online {
            return Err("device approval requires an online session".to_owned());
        }
        let inspected = self.post_auth(
            "/api/v1/device-enrollment/inspect",
            reqwest::Method::POST,
            &json!({"code":code}),
        )?;
        let enrollment_id = inspected["enrollmentId"]
            .as_str()
            .ok_or("invalid enrollment inspection")?;
        let binding = json!({
            "accountId":inspected["accountId"],
            "enrollmentId":enrollment_id,
            "newDeviceId":inspected["newDeviceId"],
            "newDevicePublicKey":inspected["newDevicePublicKey"],
            "expiresAt":inspected["expiresAt"]
        });
        let bytes =
            vaults_protocol::signed_sync::canonical_bytes(&binding).map_err(str::to_owned)?;
        let signature = URL_SAFE_NO_PAD.encode(self.signing.sign(&bytes).to_bytes());
        self.post_auth(
            &format!("/api/v1/device-enrollment/{enrollment_id}/approval"),
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
        let settings = self
            .sync_vault_settings()
            .unwrap_or_else(|error| json!({"pending":true,"error":error}));
        Ok(
            json!({"accepted":accepted,"rebased":rebased,"pending":pending,"online":true,"conflicts":conflicts,"vaultSettings":settings}),
        )
    }

    #[allow(clippy::too_many_lines)]
    fn rebase_nonoverlapping_conflicts(&mut self) -> Result<u64, String> {
        let mut rebased = 0;
        for replica in self.replica_store.list()? {
            for conflict in replica.conflicts.clone() {
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
        let draft = self.conflict_draft(vault_id, item_id, operation_id)?;
        let before = self
            .replica_store
            .load(vault_id)?
            .ok_or("local replica is unavailable")?;
        self.discard_conflict(vault_id, item_id, operation_id)?;
        let result = self.item_upsert(
            vault_id,
            None,
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
                let body_response = self.get(&format!(
                    "/api/v1/vaults/{vault_id}/items/{item_id}?catalogueRevision={revision}"
                ))?;
                let body = bytes(&body_response, "envelope")?;
                self.core
                    .decrypt_private_part(handle, &catalogue, uuid_bytes(&item_id)?, &body, 3)
                    .map_err(|_| "item verification failed")?;
                items.push(ReplicaItem {
                    item_id,
                    index: URL_SAFE_NO_PAD.encode(index),
                    body: URL_SAFE_NO_PAD.encode(body),
                });
            }
            let transport = self
                .sync_transport
                .as_ref()
                .ok_or("sync transport unavailable")?;
            let sync = transport.pull(&vault_id, 0, 500)?;
            if sync["hasMore"] == true {
                return Err("replica hydration exceeds the sync page limit".to_owned());
            }
            let operations = sync["operations"]
                .as_array()
                .ok_or("invalid sync response")?;
            let device_keys = sync["devicePublicKeys"]
                .as_object()
                .ok_or("operation verification keys are missing")?;
            let mut operation_head = vaults_protocol::signed_sync::GENESIS_HASH.to_owned();
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
                verify_remote_progress(old, checkpoint.as_ref(), cursor)?;
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
                if let Some(old) = previous
                    .as_ref()
                    .and_then(|replica| replica.checkpoint.as_ref())
                    && candidate != old
                {
                    vaults_protocol::signed_sync::verify_checkpoint(
                        candidate,
                        &raw_key,
                        &self.tenant_id,
                        &vault_id,
                        self.epoch,
                        Some(old),
                    )
                    .map_err(|error| format!("{error}; local replica was preserved"))?;
                }
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
            replica.directory = URL_SAFE_NO_PAD.encode(&directory_bytes);
            replica.vault_envelope = URL_SAFE_NO_PAD.encode(envelope);
            replica.catalogue = URL_SAFE_NO_PAD.encode(catalogue);
            replica.cursor = cursor;
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
            .map_err(|_| "server request failed".to_owned())?;
        if !r.status().is_success() {
            return Err(format!("server rejected request ({})", r.status().as_u16()));
        }
        r.json().map_err(|_| "invalid server response".to_owned())
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
            .map_err(|_| "server request failed".to_owned())?;
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
                    json!({"name":self.settings_data.names.get(id).map(String::as_str).unwrap_or("Private"),"code":Self::reference("V",id),"vaultId":id})
                })
                .collect(),
        ))
    }
    pub fn is_online(&self) -> bool {
        self.online
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
            .map_err(|_| "vault encryption failed".to_owned())?;
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
            json!({"name":self.settings_data.names.get(&vault_id).map(String::as_str).unwrap_or("Private"),"code":Self::reference("V",&vault_id),"vaultId":vault_id,"itemCount":item_count}),
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
            out.push(json!({"code":Self::reference("I",item_id),"itemId":item_id,"title":index["title"],"website":index["website"]}));
        }
        Ok(Value::Array(out))
    }
    pub fn item_list_all(&mut self) -> Result<Value, String> {
        let vaults = self.vault_list()?;
        let mut combined = Vec::new();
        for vault in vaults.as_array().ok_or("invalid vault list")? {
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
        Ok(
            json!({"code":summary["code"],"itemId":item_id,"title":summary["title"],"website":summary["website"],"username":body["username"],"password":"[redacted]","customFields":custom_fields}),
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
        let made = self
            .core
            .upsert_private_item(
                vault,
                &catalogue,
                item,
                serde_json::to_string(&json!({"title":title,"website":website}))
                    .map_err(|_| "invalid item")?
                    .as_bytes(),
                serde_json::to_string(
                    &json!({"username":username,"password":password,"customFields":custom_fields}),
                )
                .map_err(|_| "invalid item")?
                .as_bytes(),
            )
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
            .map(|entry| &entry.operation)
            .chain(
                current_replica
                    .operations
                    .iter()
                    .rev()
                    .map(|row| &row["operation"]),
            )
            .find(|operation| operation["deviceId"] == self.device_id)
            .and_then(|operation| operation["opId"].as_str());
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
            Ok(response) => {
                self.replica_store.update(&vault_id, |replica| {
                    replica
                        .pending
                        .retain(|entry| entry.operation["opId"] != operation["opId"]);
                    replica.sync_error = None;
                    Ok(())
                })?;
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
mod tests {
    use super::*;

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
}
