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

#[tauri::command]
fn desktop_info() -> Result<Value, String> {
    let config = config_directory()?;
    let origin = profile(&config.join("trust.conf"), "url");
    Ok(json!({
        "configured": config.join("trust.conf").is_file() && config.join("device.conf").is_file(),
        "configurationPath": config,
        "registrationUrl": origin.map(|url| format!("{url}/?register=1")),
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
    let (session, result) = tauri::async_runtime::spawn_blocking(move || {
        let mut session = unlock_with_offline_fallback(
            &config,
            &username,
            &account_secret,
            master_password.as_bytes(),
        )?;
        let online = session.is_online();
        let vaults = session.vault_list()?;
        let vault = vaults
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row["vaultId"].as_str())
            .ok_or("no local vault is available")?
            .to_owned();
        let items = session.item_list(&vault)?;
        Ok::<_, String>((
            session,
            json!({"online":online,"vaultId":vault,"items":items}),
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
fn sync(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| {
        let result = session.sync_now()?;
        let vault = session
            .vault_list()?
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row["vaultId"].as_str())
            .ok_or("no local vault is available")?
            .to_owned();
        let items = session.item_list(&vault)?;
        Ok(json!({"accepted": result["accepted"], "conflicts":result["conflicts"], "items": items}))
    })
}

#[tauri::command]
fn discard_local_changes(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    with_session(&state, |session| {
        let result = session.discard_local_changes()?;
        let vault = session
            .vault_list()?
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row["vaultId"].as_str())
            .ok_or("no local vault is available")?
            .to_owned();
        Ok(json!({"discarded":result["discarded"],"items":session.item_list(&vault)?}))
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
