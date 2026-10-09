use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

use crate::client::{self, Session};

static PASSKEY_SESSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
fn passkey_session() -> &'static str {
    PASSKEY_SESSION.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

const IDLE_TTL: Duration = Duration::from_mins(30);
const CAPABILITY_SERVICE: &str = "127Vaults CLI unlock lease";

#[derive(Serialize, Deserialize)]
struct Startup {
    account_secret: String,
    master_password: String,
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
    operation_id: Option<String>,
    #[serde(default)]
    keep: Option<String>,
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

fn profile(path: &Path, key: &str) -> Result<String, String> {
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
    keyring::Entry::new(CAPABILITY_SERVICE, &identity(config_dir)?)
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
                | "logout"
                | "vault.list"
                | "replica.status"
                | "license.status"
                | "item.list"
                | "item.list.all"
                | "item.get"
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
    let result = match request.action.as_str() {
        "status" => Ok(
            json!({"authenticated":session.is_online(),"unlocked":true,"online":session.is_online(),"idleTimeoutSeconds":IDLE_TTL.as_secs(),"nativePasskeyProtocol":4,"passkeyVerificationSession":passkey_session()}),
        ),
        "logout" => Ok(json!({"loggedOut":true})),
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
            draft["password"] = json!("[redacted]");
            if let Some(fields) = draft["customFields"].as_array_mut() {
                for field in fields {
                    if field["type"] == "password" {
                        field["value"] = json!("[redacted]");
                    }
                }
            }
            Ok(json!({"operationId":operation,"draft":draft}))
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

pub fn serve(config_dir: &Path, username: &str, read_only: bool) -> Result<String, String> {
    let mut line = Zeroizing::new(String::new());
    std::io::stdin()
        .read_line(&mut line)
        .map_err(|_| "could not receive unlock material")?;
    let mut startup: Startup =
        serde_json::from_str(&line).map_err(|_| "invalid unlock material")?;
    line.zeroize();
    let password = Zeroizing::new(startup.master_password.as_bytes().to_vec());
    let secret = Zeroizing::new(startup.account_secret.clone());
    startup.master_password.zeroize();
    startup.account_secret.zeroize();
    let mut session = if read_only {
        client::unlock_offline(config_dir, username, &secret, &password)?
    } else {
        client::unlock_with_offline_fallback(config_dir, username, &secret, &password)?
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
    entry(config_dir)?
        .set_password(&capability)
        .map_err(|_| "could not protect local agent capability")?;
    fs::write(
        state_path(config_dir),
        format!(
            "version=1\nport={}\n",
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
    let mut last = Instant::now();
    while last.elapsed() < IDLE_TTL {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut input = Zeroizing::new(String::new());
                BufReader::new(stream.try_clone().map_err(|_| "local agent failed")?)
                    .read_line(&mut input)
                    .map_err(|_| "local agent failed")?;
                let mut request: Request =
                    serde_json::from_str(&input).map_err(|_| "invalid local agent request")?;
                input.zeroize();
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
                writeln!(
                    stream,
                    "{}",
                    serde_json::to_string(&response).map_err(|_| "local agent failed")?
                )
                .map_err(|_| "local agent failed")?;
                if stop {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break,
        }
    }
    let _ = entry(config_dir)?.delete_credential();
    let _ = fs::remove_file(state_path(config_dir));
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
    if ready.trim() != "ready" {
        return Err("local unlock agent did not start".to_owned());
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
pub fn call(config_dir: &Path, action: &str, fields: Value) -> Result<Value, String> {
    let state = fs::read_to_string(state_path(config_dir))
        .map_err(|_| "not logged in; run login first".to_owned())?;
    let port = state
        .lines()
        .find_map(|line| line.strip_prefix("port="))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or("invalid local agent state")?;
    let capability = entry(config_dir)?
        .get_password()
        .map_err(|_| "not logged in; run login first".to_owned())?;
    let mut value = fields.as_object().cloned().unwrap_or_default();
    value.insert("capability".to_owned(), Value::String(capability));
    value.insert("action".to_owned(), Value::String(action.to_owned()));
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|_| "unlock session expired; run login again".to_owned())?;
    let mut outbound = Value::Object(value);
    serde_json::to_writer(&mut stream, &outbound).map_err(|_| "local agent unavailable")?;
    writeln!(stream).map_err(|_| "local agent unavailable")?;
    if let Some(object) = outbound.as_object_mut() {
        for name in ["capability", "password"] {
            if let Some(Value::String(secret)) = object.get_mut(name) {
                secret.zeroize();
            }
        }
    }
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|_| "local agent unavailable")?;
    let response: Response =
        serde_json::from_str(&line).map_err(|_| "invalid local agent response")?;
    if response.ok {
        Ok(response.value)
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
    use super::*;

    #[test]
    fn connector_agent_denies_all_device_management_before_dispatch() {
        let mut session = crate::client::device_transport_tests::session("http://127.0.0.1:1");
        for action in [
            "device.list",
            "device.inspect",
            "device.approve",
            "device.revoke",
        ] {
            let mut request: Request = serde_json::from_value(
                json!({"capability":"fixture","action":action,"password":"synthetic-secret"}),
            )
            .unwrap();
            assert_eq!(
                dispatch(&mut session, &mut request, true).unwrap_err(),
                "read-only agent command denied"
            );
            assert!(request.password.unwrap().bytes().all(|byte| byte == 0));
        }
    }
}
