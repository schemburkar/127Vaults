#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned IPC arguments.

use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use vaults_cli::{
    client::{Session, unlock_with_offline_fallback},
    enroll_device_with_status,
};

#[derive(Default)]
struct DesktopState {
    session: Mutex<Option<Session>>,
    enrollment: std::sync::Arc<Mutex<Value>>,
}

const PROFILE_FILES: [&str; 5] = [
    "trust.conf",
    "device.conf",
    "installation-ca.pem",
    "offline-unlock.json",
    "replicas.json",
];

fn is_profile(path: &Path) -> bool {
    path.join("trust.conf").is_file() && path.join("installation-ca.pem").is_file()
}

fn adopt_cli_profile(destination: &Path) -> Result<bool, String> {
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
    let Some(source) = candidates.into_iter().find(|path| is_profile(path)) else {
        return Ok(false);
    };
    fs::create_dir_all(destination)
        .map_err(|_| "desktop configuration directory could not be created".to_owned())?;
    for name in PROFILE_FILES {
        let from = source.join(name);
        let to = destination.join(name);
        if from.is_file() && !to.exists() {
            fs::copy(from, to)
                .map_err(|_| format!("desktop could not import {name} from the CLI profile"))?;
        }
    }
    let replica_source = source.join("replicas");
    let replica_destination = destination.join("replicas");
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
    if let Some(path) = std::env::var_os("VAULTS_CONFIG_DIR") {
        return Ok(PathBuf::from(path));
    }
    let destination = dirs::config_dir()
        .map(|root| root.join("127Vaults"))
        .ok_or_else(|| "desktop configuration location is unavailable".to_owned())?;
    adopt_cli_profile(&destination)?;
    Ok(destination)
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

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn cached_account_secret(config: &Path, username: &str) -> Option<String> {
    if cached_username(config)?.as_str() != username {
        return None;
    }
    let entry = keyring::Entry::new(
        "127Vaults account secret",
        &secret_cache_key(config, username)?,
    )
    .ok()?;
    let secret = String::from_utf8(entry.get_secret().ok()?).ok()?;
    (secret.len() == 64 && secret.bytes().all(|b| b.is_ascii_hexdigit())).then_some(secret)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn cached_account_secret(_config: &Path, _username: &str) -> Option<String> {
    None
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn remember_account_secret(config: &Path, username: &str, secret: &str) -> Result<(), String> {
    let key = secret_cache_key(config, username).ok_or("device identity is unavailable")?;
    let entry = keyring::Entry::new("127Vaults account secret", &key)
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

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn remember_account_secret(_config: &Path, _username: &str, _secret: &str) -> Result<(), String> {
    Err("OS credential storage is unavailable".to_owned())
}

#[tauri::command]
fn desktop_info() -> Result<Value, String> {
    let config = config_directory()?;
    let origin = profile(&config.join("trust.conf"), "url");
    Ok(json!({
        "configured": config.join("trust.conf").is_file() && config.join("device.conf").is_file(),
        "configurationPath": config,
        "registrationUrl": origin.map(|url| format!("{url}/?register=1")),
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
    action(guard.as_mut().ok_or("vault is locked")?)
}

#[tauri::command]
async fn unlock(
    state: tauri::State<'_, DesktopState>,
    username: String,
    account_secret: String,
    master_password: String,
) -> Result<Value, String> {
    // Password derivation, replica verification and the initial network request
    // can all be expensive. Keep them off the webview command thread so the
    // unlock progress UI remains responsive.
    let config = config_directory()?;
    let supplied_secret = !account_secret.is_empty();
    let secret = if account_secret.is_empty() {
        cached_account_secret(&config, &username)
            .ok_or("account secret is required on this device or after 30 days")?
    } else {
        account_secret
    };
    let (session, result) = tauri::async_runtime::spawn_blocking(move || {
        let mut session = unlock_with_offline_fallback(
            &config,
            &username,
            &secret,
            master_password.as_bytes(),
        )?;
        let online = session.is_online();
        let offline_reason = session.offline_reason().map(str::to_owned);
        let vaults = session.vault_list()?;
        let default_vault = session.default_vault()?;
        let vault = default_vault.clone().or_else(|| vaults
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["retired"] != true).or_else(|| rows.first()))
            .and_then(|row| row["vaultId"].as_str())
            .map(str::to_owned)).ok_or("no local vault is available")?;
        let settings = session.vault_settings();
        let default_view = settings["defaultView"].clone();
        let has_active_vault = vaults.as_array().is_some_and(|rows| rows.iter().any(|row| row["retired"] != true));
        let view_kind = if has_active_vault { default_view["kind"].as_str().unwrap_or("vault") } else { "all" };
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
        Ok::<_, String>((
            session,
            json!({"online":online,"offlineReason":offline_reason,"vaultId":initial_vault,"defaultVaultId":default_vault,"vaults":vaults,"items":items,"settings":settings,"viewKind":view_kind,"collectionId":collection_id,"secretRemembered":secret_remembered}),
        ))
    })
    .await
    .map_err(|_| "the secure unlock worker stopped unexpectedly".to_owned())??;
    *state
        .session
        .lock()
        .map_err(|_| "desktop vault state is unavailable")? = Some(session);
    Ok(result)
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
fn device_revoke(
    state: tauri::State<'_, DesktopState>,
    device_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| session.device_revoke(&device_id))
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
fn vault_default(
    state: tauri::State<'_, DesktopState>,
    vault_id: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
        Ok(json!({"defaultVaultId":session.set_default_vault(vault_id.as_deref())?}))
    })
}

#[tauri::command]
fn item_get(
    state: tauri::State<'_, DesktopState>,
    vault_id: String,
    item_id: String,
) -> Result<Value, String> {
    with_session(&state, |session| {
        session.item_get(&vault_id, &item_id, None)
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
    custom_fields: Vec<Value>,
    resolving_operation_id: Option<String>,
) -> Result<Value, String> {
    with_session(&state, |session| {
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
        session.conflict_draft(&vault_id, &item_id, &operation_id)
    })
}

#[tauri::command]
fn lock(state: tauri::State<'_, DesktopState>) -> Result<(), String> {
    state
        .session
        .lock()
        .map_err(|_| "desktop vault state is unavailable".to_owned())?
        .take();
    Ok(())
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
            let origin = profile(&callback_config.join("trust.conf"), "url").unwrap_or_default();
            if let Ok(mut value) = status.lock() {
                *value = json!({"state":"approval","code":code,"approvalUrl":format!("{origin}/?enrollDevice={code}")});
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            unlock,
            item_list,
            vault_create,
            device_list,
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
            vault_default,
            item_get,
            item_secret,
            item_save,
            sync,
            discard_local_changes,
            discard_conflict,
            conflict_draft,
            lock,
            begin_device_enrollment,
            device_enrollment_status
        ])
        .run(tauri::generate_context!())
        .expect("desktop POC runtime failed");
}
