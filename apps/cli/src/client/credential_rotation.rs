//! Existing server-authorized credential rotation. The journal contains encrypted/public data only.
use super::*;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use std::io::Write;
use vaults_protocol::signed_sync::canonical_bytes;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    version: u32,
    old_device_id: String,
    old_epoch: u64,
    record: OfflineUnlockRecord,
    settings: SettingsRecord,
}
fn path(config: &Path) -> std::path::PathBuf {
    config.join("pending-credential-rotation.json")
}
fn load(config: &Path) -> Result<Option<Pending>, String> {
    crate::namespace::validate_profile(&path(config))?;
    match fs::metadata(path(config)) {
        Ok(value) if value.len() > 65536 => {
            return Err("Credential rotation journal is invalid".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Credential rotation journal is unavailable".into()),
        _ => {}
    }
    let bytes = match fs::read(path(config)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Credential rotation journal is unavailable".into()),
    };
    if bytes.len() > 65536 {
        return Err("Credential rotation journal is invalid".into());
    }
    let pending: Pending =
        serde_json::from_slice(&bytes).map_err(|_| "Credential rotation journal is invalid")?;
    if pending.version != 1 || pending.old_epoch.checked_add(1) != Some(pending.record.epoch) {
        return Err("Credential rotation journal is invalid".into());
    }
    Ok(Some(pending))
}
fn reserve(config: &Path, pending: &Pending) -> Result<(), String> {
    crate::namespace::validate_profile(&path(config))?;
    let temporary = config.join(format!(".credential-rotation-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Could not prepare rotation journal")?;
        file.write_all(&serde_json::to_vec(pending).map_err(|_| "Invalid rotation journal")?)
            .and_then(|()| file.sync_all())
            .map_err(|_| "Could not save rotation journal")?;
        // Publish complete bytes atomically without replacing another process's intent.
        fs::hard_link(&temporary, path(config)).map_err(|_| "Could not reserve credential rotation")
    })();
    let _ = fs::remove_file(temporary);
    result.map_err(str::to_owned)
}
fn signed(label: &[u8], value: &Value, key: &SigningKey) -> Result<String, String> {
    let mut bytes = label.to_vec();
    bytes.extend(canonical_bytes(value).map_err(|_| "Invalid credential authorization")?);
    Ok(URL_SAFE_NO_PAD.encode(key.sign(&bytes).to_bytes()))
}
fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| "Invalid credential rotation response".into())
}

pub fn rotation_status(config: &Path) -> Result<Value, String> {
    Ok(match load(config)? {
        Some(pending) => json!({"pending":true,"targetEpoch":pending.record.epoch,
            "guidance":"Use credential resume with the new credentials, or credential abort with the old credentials. Neither command bypasses server authentication."}),
        None => json!({"pending":false}),
    })
}
pub fn resume_rotation(
    config: &Path,
    username: &str,
    secret: &str,
    password: &[u8],
) -> Result<Session, String> {
    let pending = load(config)?.ok_or("No credential rotation is pending")?;
    if pending.record.username != username {
        return Err("Rotation belongs to another account".into());
    }
    let session = unlock_with_rotation_device(
        config,
        username,
        secret,
        password,
        Some(&pending.record.device_id),
        true,
    )?;
    if session.epoch != pending.record.epoch
        || session.device_id != pending.record.device_id
        || path(config).exists()
    {
        return Err(
            "The server has not confirmed the new credentials; the previous profile was preserved"
                .into(),
        );
    }
    Ok(session)
}
pub fn abort_rotation(
    config: &Path,
    username: &str,
    secret: &str,
    password: &[u8],
) -> Result<(), String> {
    let pending = load(config)?.ok_or("No credential rotation is pending")?;
    // Only a fresh, successful old-credential login can prove that discarding the intent is safe.
    let session = unlock_with_rotation_device(config, username, secret, password, None, false)?;
    if session.epoch != pending.old_epoch
        || session.device_id != pending.old_device_id
        || pending.record.username != username
    {
        return Err(
            "The server no longer confirms the old credentials; resume the rotation instead".into(),
        );
    }
    fs::remove_file(path(config)).map_err(|_| "Could not clear rotation journal")?;
    if pending.record.device_id != pending.old_device_id {
        let server = profile(&config.join("trust.conf"), "server_id")?;
        let _ = keyring::Entry::new(
            &crate::namespace::service("127Vaults device identity")?,
            &format!("{server}:{}", pending.record.device_id),
        )
        .map(|entry| entry.delete_credential());
    }
    Ok(())
}
// Called only after OPAQUE, root authentication and enrolled-device proof all succeeded online.
pub(super) fn finish_local(
    config: &Path,
    username: &str,
    descriptor: &[u8],
    envelope: &[u8],
    device: &str,
    core: &Core,
    root: KeyHandle,
) -> Result<(), String> {
    let Some(pending) = load(config)? else {
        return Ok(());
    };
    if pending.record.descriptor != URL_SAFE_NO_PAD.encode(descriptor)
        || pending.record.envelope != URL_SAFE_NO_PAD.encode(envelope)
    {
        return Ok(());
    }
    let origin = profile(&config.join("trust.conf"), "url")?
        .trim_end_matches('/')
        .to_owned();
    let server = profile(&config.join("trust.conf"), "server_id")?;
    if pending.record.username != username
        || pending.record.device_id != device
        || !pending.record.matches_trust(&origin, &server)
    {
        return Err("Rotation profile binding mismatch".into());
    }
    if let Some(settings) = &pending.settings.verified_envelope {
        vault_settings::decrypt(core, root, settings)?;
    }
    let _ = crate::remembered_secret::forget(config, username);
    save_offline_record(config, &pending.record)?;
    SettingsStore::new(config).commit(&pending.settings)?;
    let mut file = atomic_write_file::AtomicWriteFile::open(config.join("device.conf"))
        .map_err(|_| "Could not save rotated device profile")?;
    file.write_all(
        format!("version=1\ndevice_id={device}\nserver_id={server}\nusername={username}\n")
            .as_bytes(),
    )
    .map_err(|_| "Could not save rotated device profile")?;
    file.commit()
        .map_err(|_| "Could not save rotated device profile")?;
    fs::remove_file(path(config)).map_err(|_| "Could not clear completed rotation journal")?;
    Ok(())
}

impl Session {
    #[allow(clippy::too_many_lines)] // Keep the signed prepare/commit ceremony in protocol order.
    pub fn rotate_credentials(
        &mut self,
        username: &str,
        kind: &str,
        secret_hex: &str,
        password: &[u8],
    ) -> Result<Value, String> {
        if !self.online || !matches!(kind, "password" | "account-secret") {
            return Err("Credential rotation requires a fresh online login".into());
        }
        if load(&self.profile_dir)?.is_some() {
            return Err("Resolve the pending credential rotation first".into());
        }
        if password.len() < 20 || password.len() > 1024 {
            return Err("Master password must contain 20–1024 UTF-8 bytes".into());
        }
        let mut secret = zeroize::Zeroizing::new([0_u8; 32]);
        hex::decode_to_slice(secret_hex, &mut *secret)
            .map_err(|_| "Account secret must be 64 hexadecimal characters")?;
        if self.settings_record.pending.is_some()
            || self.settings_conflict
            || self
                .replica_store
                .list()?
                .iter()
                .any(|row| !row.pending.is_empty() || !row.conflicts.is_empty())
        {
            return Err(
                "Sync and resolve all local pending changes before rotating credentials".into(),
            );
        }
        let old: OfflineUnlockRecord = serde_json::from_slice(
            &fs::read(offline_record_path(&self.profile_dir))
                .map_err(|_| "Offline identity is unavailable")?,
        )
        .map_err(|_| "Offline identity is invalid")?;
        if old.epoch != self.epoch || old.device_id != self.device_id || old.username != username {
            return Err("Account profile mismatch".into());
        }
        let old_descriptor = URL_SAFE_NO_PAD
            .decode(&old.descriptor)
            .map_err(|_| "Invalid root descriptor")?;
        if old_descriptor.len() != 93 {
            return Err("Invalid root descriptor".into());
        }
        let account = uuid::Uuid::from_slice(&old_descriptor[17..33])
            .map_err(|_| "Invalid account identity")?
            .to_string();
        let next_epoch = self
            .epoch
            .checked_add(1)
            .ok_or("Credential epoch exhausted")?;
        let replacement = (kind == "account-secret").then(|| SigningKey::generate(&mut OsRng));
        let new_device = if replacement.is_some() {
            uuid::Uuid::new_v4().to_string()
        } else {
            self.device_id.clone()
        };
        let started = opaque::client_registration_start(&secret[..], password)
            .map_err(|_| "Credential preparation failed")?;
        let mut nonce_bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);
        let request = URL_SAFE_NO_PAD.encode(&started.message);
        let issued_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Invalid system clock")?
            .as_millis();
        let authorization = signed(
            b"127Vaults/credential-preparation/1\0",
            &json!({"origin":crate::http_origin(&self.origin)?,"kind":kind,
            "tenantId":self.tenant_id,"accountId":account,"deviceId":self.device_id,"credentialEpoch":self.epoch,
            "sessionBinding":sha(self.csrf.as_bytes()),"newDeviceId":new_device,"request":request,"nonce":nonce,"issuedAt":issued_at}),
            &self.signing,
        )?;
        let route = format!("/api/v1/devices/rotate-{kind}");
        let begun = post(&self.client, &self.origin, &format!("{route}/start"), &self.csrf, &self.cookie,
            &json!({"request":request,"deviceId":new_device,"nonce":nonce,"issuedAt":issued_at,"authorizationSignature":authorization}))?
            .json::<Value>().map_err(|_| "Invalid credential preparation response")?;
        let raw_binding = bytes(&begun, "binding")?;
        let (origin, tenant, account_bytes, device, epoch, attempt, server_key) =
            parse_binding(&raw_binding)?;
        if origin != crate::http_origin(&self.origin)?
            || uuid::Uuid::from_bytes(tenant).to_string() != self.tenant_id
            || uuid::Uuid::from_bytes(account_bytes).to_string() != account
            || uuid::Uuid::from_bytes(device).to_string() != new_device
            || epoch != next_epoch
        {
            return Err("Credential preparation identity mismatch".into());
        }
        let artifact = text(&begun, "registrationArtifact")?;
        let artifact_value: Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(artifact.split('.').next().unwrap_or_default())
                .map_err(|_| "Invalid rotation artifact")?,
        )
        .map_err(|_| "Invalid rotation artifact")?;
        let upload = opaque::client_registration_finish(
            &started.state,
            &secret[..],
            password,
            &bytes(&begun, "response")?,
            Binding {
                origin: origin.as_bytes(),
                installation: tenant,
                account: account_bytes,
                device,
                epoch,
                attempt,
                server_public_key: server_key,
            },
        )
        .map_err(|_| "Credential registration failed")?;
        let record = opaque::server_registration_finish(&upload)
            .map_err(|_| "Invalid registration record")?;
        let mut template = [0_u8; 77];
        template[0] = 1;
        template[1..17].copy_from_slice(&tenant);
        template[17..33].copy_from_slice(&account_bytes);
        template[65..69].copy_from_slice(&1_u32.to_be_bytes());
        template[69..77].copy_from_slice(&epoch.to_be_bytes());
        let wrapped = self
            .core
            .rewrap_root(self.root, &template, password, &secret[..])
            .map_err(|_| "Root rewrapping failed")?;
        let next_root = wrapped.handle.ok_or("Root handle unavailable")?;
        let (base_revision, remote_settings) = self.fetch_vault_settings()?;
        let settings_data = match remote_settings {
            Some(value) => vault_settings::decrypt(&self.core, self.root, &value)?,
            None => SettingsData::empty(),
        };
        let settings_envelope = vault_settings::encrypt(&self.core, next_root, &settings_data)?;
        let revision = vault_settings::revision(&settings_envelope)?;
        let settings =
            json!({"baseRevision":base_revision,"revision":revision,"envelope":settings_envelope});
        let signing = replacement.as_ref().unwrap_or(&self.signing);
        let public_key = signing.verifying_key().to_bytes();
        let mut activation = b"127Vaults/first-device-activation/1\0".to_vec();
        activation.extend(device);
        activation.extend(public_key);
        activation.extend(Sha512::digest(&record));
        activation.extend(Sha512::digest(wrapped.context));
        activation.extend(Sha512::digest(&wrapped.envelope));
        activation.extend(Sha512::digest([]));
        let candidate = json!({"accountId":account,"deviceId":new_device,"signingPublicKey":URL_SAFE_NO_PAD.encode(public_key),
            "opaqueUpload":URL_SAFE_NO_PAD.encode(&upload),"registrationArtifact":artifact,"activationSignature":URL_SAFE_NO_PAD.encode(signing.sign(&activation).to_bytes()),
            "wrappedRootDescriptor":URL_SAFE_NO_PAD.encode(wrapped.context),"wrappedRootEnvelope":URL_SAFE_NO_PAD.encode(&wrapped.envelope)});
        let authorization = signed(
            b"127Vaults/credential-rotation/1\0",
            &json!({"kind":kind,"tenantId":self.tenant_id,"accountId":account,
            "deviceId":self.device_id,"sessionId":text(&artifact_value,"sessionId")?,"credentialEpoch":epoch,"newDeviceId":new_device,
            "signingPublicKey":candidate["signingPublicKey"],"opaqueRecord":sha(&record),"descriptor":sha(&wrapped.context),"envelope":sha(&wrapped.envelope),
            "attempt":URL_SAFE_NO_PAD.encode(attempt),"settings":{"baseRevision":base_revision,"revision":revision,"envelope":sha(&URL_SAFE_NO_PAD.decode(&settings_envelope).map_err(|_| "Invalid settings")?)}}),
            &self.signing,
        )?;
        let pending = Pending {
            version: 1,
            old_device_id: self.device_id.clone(),
            old_epoch: self.epoch,
            record: OfflineUnlockRecord {
                version: 2,
                username: username.to_owned(),
                tenant_id: self.tenant_id.clone(),
                device_id: new_device.clone(),
                epoch,
                origin: Some(self.origin.clone()),
                server_id: old.server_id.clone(),
                descriptor: URL_SAFE_NO_PAD.encode(wrapped.context),
                envelope: URL_SAFE_NO_PAD.encode(&wrapped.envelope),
            },
            settings: SettingsRecord {
                version: 1,
                remote_revision: Some(revision),
                verified_envelope: Some(settings_envelope),
                pending: None,
            },
        };
        // Reserve recovery state before the first potentially ambiguous commit request.
        reserve(&self.profile_dir, &pending)?;
        if replacement.is_some() {
            crate::store_device_key(
                old.server_id
                    .as_deref()
                    .ok_or("Server identity unavailable")?,
                &new_device,
                signing.as_bytes(),
            )?;
        }
        let response = post(&self.client,&self.origin,&route,&self.csrf,&self.cookie,&json!({"candidate":candidate,"settings":settings,"authorizationSignature":authorization}))
            .map_err(|_| "Rotation outcome is unconfirmed. Keep your new credentials. Run credential resume with them, or credential abort with your old credentials after server verification.".to_owned())?
            .json::<Value>().map_err(|_| "Rotation outcome is unconfirmed; run credential resume with your new credentials")?;
        if response["credentialEpoch"] != epoch
            || response["deviceId"] != new_device
            || response["signInRequired"] != true
        {
            return Err(
                "Rotation outcome is unconfirmed; run credential resume with your new credentials"
                    .into(),
            );
        }
        finish_local(
            &self.profile_dir,
            username,
            &wrapped.context,
            &wrapped.envelope,
            &new_device,
            &self.core,
            next_root,
        )?;
        self.online = false;
        self.core.lock();
        Ok(
            json!({"rotated":kind,"credentialEpoch":epoch,"signInRequired":true,"otherDevicesRequireSignIn":true}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        process::{Command, Stdio},
    };
    #[test]
    fn password_rotation_matches_server_proofs_and_preserves_state_after_ambiguous_reply() {
        exercise_rotation("password");
    }
    #[test]
    #[ignore = "uses disposable entries in the real OS credential store"]
    fn os_store_account_secret_rotation_matches_server_proofs() {
        exercise_rotation("account-secret");
    }
    #[allow(clippy::too_many_lines)]
    fn exercise_rotation(kind: &'static str) {
        for ambiguous in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let tenant = uuid::Uuid::new_v4();
            let account = uuid::Uuid::new_v4();
            let device = uuid::Uuid::new_v4();
            let mut session = crate::client::device_transport_tests::session(&origin);
            session.tenant_id = tenant.to_string();
            session.device_id = device.to_string();
            let mut template = [0_u8; 77];
            template[0] = 1;
            template[1..17].copy_from_slice(tenant.as_bytes());
            template[17..33].copy_from_slice(account.as_bytes());
            template[65..69].copy_from_slice(&1_u32.to_be_bytes());
            template[69..77].copy_from_slice(&1_u64.to_be_bytes());
            let original = session
                .core
                .create_root(&template, b"old fictitious password", &[9; 32])
                .unwrap();
            session.root = original.handle.unwrap();
            let directory = session.profile_dir.clone();
            fs::write(
                directory.join("trust.conf"),
                format!("url={origin}\nserver_id={tenant}\n"),
            )
            .unwrap();
            fs::write(
                directory.join("device.conf"),
                format!("device_id={device}\nserver_id={tenant}\nusername=Owner\n"),
            )
            .unwrap();
            save_offline_record(
                &directory,
                &OfflineUnlockRecord {
                    version: 2,
                    username: "Owner".into(),
                    tenant_id: tenant.to_string(),
                    device_id: device.to_string(),
                    epoch: 1,
                    origin: Some(origin.clone()),
                    server_id: Some(tenant.to_string()),
                    descriptor: URL_SAFE_NO_PAD.encode(original.context),
                    envelope: URL_SAFE_NO_PAD.encode(&original.envelope),
                },
            )
            .unwrap();
            let old_bytes = fs::read(offline_record_path(&directory)).unwrap();
            let csrf = session.csrf.clone();
            let public = session.signing.verifying_key().to_bytes();
            let endpoint = origin.clone();
            let committed_device = std::sync::Arc::new(std::sync::Mutex::new(device.to_string()));
            let observed_device = committed_device.clone();
            let worker = std::thread::spawn(move || {
                let setup = opaque::server_setup().unwrap();
                let server_key = opaque::server_public_key(&setup).unwrap();
                let mut preparation = Value::Null;
                let mut artifact = Value::Null;
                for step in 0..3 {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut request_line = String::new();
                    reader.read_line(&mut request_line).unwrap();
                    let mut size = 0;
                    loop {
                        let mut line = String::new();
                        reader.read_line(&mut line).unwrap();
                        if line == "\r\n" {
                            break;
                        }
                        if let Some((key, value)) = line.split_once(':')
                            && key.eq_ignore_ascii_case("content-length")
                        {
                            size = value.trim().parse().unwrap();
                        }
                    }
                    let mut body = vec![0; size];
                    reader.read_exact(&mut body).unwrap();
                    let value: Value = if size == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&body).unwrap()
                    };
                    let response = if step == 0 {
                        assert!(request_line.contains(&format!("rotate-{kind}/start")));
                        preparation = value;
                        let next_device =
                            uuid::Uuid::parse_str(preparation["deviceId"].as_str().unwrap())
                                .unwrap();
                        *observed_device.lock().unwrap() = next_device.to_string();
                        let attempt = [7_u8; 32];
                        let binding = Binding {
                            origin: endpoint.as_bytes(),
                            installation: *tenant.as_bytes(),
                            account: *account.as_bytes(),
                            device: *next_device.as_bytes(),
                            epoch: 2,
                            attempt,
                            server_public_key: server_key,
                        };
                        let challenge = opaque::server_registration_start(
                            &setup,
                            &URL_SAFE_NO_PAD
                                .decode(preparation["request"].as_str().unwrap())
                                .unwrap(),
                            binding,
                        )
                        .unwrap();
                        let mut raw = (u16::try_from(endpoint.len()).unwrap())
                            .to_be_bytes()
                            .to_vec();
                        raw.extend(endpoint.as_bytes());
                        raw.extend(tenant.as_bytes());
                        raw.extend(account.as_bytes());
                        raw.extend(next_device.as_bytes());
                        raw.extend(2_u64.to_be_bytes());
                        raw.extend(attempt);
                        raw.extend(server_key);
                        artifact = json!({"attempt":URL_SAFE_NO_PAD.encode(attempt),"sessionId":"fixture-session","credentialEpoch":2});
                        json!({"response":URL_SAFE_NO_PAD.encode(challenge),"binding":URL_SAFE_NO_PAD.encode(raw),"registrationArtifact":format!("{}.fixture",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&artifact).unwrap()))})
                    } else if step == 1 {
                        assert!(request_line.contains("vault-settings"));
                        json!({"revision":null,"envelope":null})
                    } else {
                        let record = opaque::server_registration_finish(
                            &URL_SAFE_NO_PAD
                                .decode(value["candidate"]["opaqueUpload"].as_str().unwrap())
                                .unwrap(),
                        )
                        .unwrap();
                        let check = json!({"auth":{"tenantId":tenant,"accountId":account,"deviceId":device,"credentialEpoch":1,"sessionId":"fixture-session","csrf":csrf},
                            "origin":endpoint,"kind":kind,"preparation":preparation,"candidate":value["candidate"],"settings":value["settings"],
                            "authorizationSignature":value["authorizationSignature"],"artifact":artifact,"record":URL_SAFE_NO_PAD.encode(record),"currentPublicKey":URL_SAFE_NO_PAD.encode(public)});
                        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("../../scripts/cli-credential-wire-check.mjs");
                        let mut child = Command::new("node")
                            .arg(script)
                            .stdin(Stdio::piped())
                            .stdout(Stdio::null())
                            .spawn()
                            .unwrap();
                        child
                            .stdin
                            .take()
                            .unwrap()
                            .write_all(serde_json::to_string(&check).unwrap().as_bytes())
                            .unwrap();
                        assert!(child.wait().unwrap().success());
                        if ambiguous {
                            break;
                        }
                        json!({"credentialEpoch":2,"deviceId":value["candidate"]["deviceId"],"signInRequired":true})
                    };
                    let body = response.to_string();
                    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                }
            });
            let next_secret = if kind == "account-secret" {
                [8_u8; 32]
            } else {
                [9_u8; 32]
            };
            let next_password: &[u8] = if kind == "account-secret" {
                b"old fictitious password"
            } else {
                b"new fictitious password"
            };
            let result =
                session.rotate_credentials("Owner", kind, &hex::encode(next_secret), next_password);
            if ambiguous {
                assert!(result.unwrap_err().contains("unconfirmed"));
                assert_eq!(
                    fs::read(offline_record_path(&directory)).unwrap(),
                    old_bytes
                );
                let pending = load(&directory).unwrap().unwrap();
                assert_eq!(pending.record.epoch, 2);
                assert!(
                    !fs::read_to_string(path(&directory))
                        .unwrap()
                        .contains("new fictitious password")
                );
                assert_eq!(rotation_status(&directory).unwrap()["pending"], true);
            } else {
                assert_eq!(result.unwrap()["credentialEpoch"], 2);
                assert!(!path(&directory).exists());
                let record: OfflineUnlockRecord =
                    serde_json::from_slice(&fs::read(offline_record_path(&directory)).unwrap())
                        .unwrap();
                assert_eq!(record.epoch, 2);
                let mut core = Core::new();
                let root = core
                    .unwrap_root(
                        &URL_SAFE_NO_PAD.decode(record.envelope).unwrap(),
                        &URL_SAFE_NO_PAD.decode(record.descriptor).unwrap(),
                        next_password,
                        &next_secret,
                    )
                    .unwrap();
                assert!(
                    vault_settings::decrypt(
                        &core,
                        root,
                        SettingsStore::new(&directory)
                            .load()
                            .unwrap()
                            .verified_envelope
                            .as_deref()
                            .unwrap()
                    )
                    .is_ok()
                );
            }
            session.online = false;
            drop(session);
            worker.join().unwrap();
            if kind == "account-secret" {
                keyring::Entry::new(
                    &crate::namespace::service("127Vaults device identity").unwrap(),
                    &format!("{tenant}:{}", committed_device.lock().unwrap()),
                )
                .unwrap()
                .delete_credential()
                .unwrap();
            }
            fs::remove_dir_all(directory).unwrap();
        }
    }
}
