//! Read-only Chromium native-messaging connector for active/local clients.
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

use crate::{agent, client};

const MAX_MESSAGE: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    id: u32,
    action: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    account_secret: String,
    #[serde(default)]
    master_password: String,
    #[serde(default)]
    vault_id: String,
    #[serde(default)]
    item_id: String,
    #[serde(default)]
    site_origin: String,
}

#[derive(Serialize)]
struct Response {
    id: u32,
    ok: bool,
    value: Value,
}

struct LocalSession {
    source: String,
    session: client::Session,
}

struct Host {
    local: Option<LocalSession>,
    last_activity: Instant,
}

impl Default for Host {
    fn default() -> Self {
        Self {
            local: None,
            last_activity: Instant::now(),
        }
    }
}

fn profile(source: &str) -> Result<PathBuf, String> {
    match source {
        "desktop" => dirs::config_dir()
            .map(|root| root.join("127Vaults"))
            .ok_or_else(|| "desktop profile is unavailable".to_owned()),
        "cli" => {
            let home = dirs::home_dir().ok_or("CLI profile is unavailable")?;
            let pointer = home.join(".127vaults-active");
            let configured = fs::read_to_string(pointer).unwrap_or_default();
            let path = PathBuf::from(configured.trim());
            if path.is_absolute() && path.join("device.conf").is_file() {
                Ok(path)
            } else {
                Ok(home.join(".127vaults"))
            }
        }
        _ => Err("unsupported connector source".to_owned()),
    }
}

fn configured(path: &Path) -> bool {
    path.join("trust.conf").is_file() && path.join("device.conf").is_file()
}

fn cached_username(path: &Path) -> Option<String> {
    let record: Value =
        serde_json::from_slice(&fs::read(path.join("account-secret-cache.json")).ok()?).ok()?;
    let username = record["username"].as_str()?;
    let expiry = record["expiresAt"].as_u64()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    (expiry > now).then(|| username.to_owned())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn cached_secret(path: &Path, username: &str) -> Option<String> {
    if cached_username(path)?.as_str() != username {
        return None;
    }
    let read_field = |file: &str, field: &str| {
        fs::read_to_string(path.join(file))
            .ok()?
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{field}=")).map(str::to_owned))
    };
    let server = read_field("trust.conf", "server_id")?;
    let device = read_field("device.conf", "device_id")?;
    let key = format!("{server}:{device}:{username}");
    let entry = keyring::Entry::new("127Vaults account secret", &key).ok()?;
    let secret = String::from_utf8(entry.get_secret().ok()?).ok()?;
    (secret.len() == 64 && secret.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(secret)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn cached_secret(_path: &Path, _username: &str) -> Option<String> {
    None
}

fn valid_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}

fn site_origin(value: &str) -> Result<String, String> {
    let parsed = url::Url::parse(value).map_err(|_| "site origin is invalid")?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("site origin is invalid".to_owned());
    }
    Ok(parsed.origin().ascii_serialization())
}

fn matching_items(rows: Value, site: &str) -> Result<Value, String> {
    let rows = rows.as_array().ok_or("local item list is invalid")?;
    Ok(Value::Array(
        rows.iter()
            .filter(|row| website_matches(row, site))
            .cloned()
            .collect(),
    ))
}

fn website_matches(row: &Value, site: &str) -> bool {
    row["website"]
        .as_str()
        .and_then(|website| url::Url::parse(website).ok())
        .is_some_and(|url| url.origin().ascii_serialization() == site)
}

fn list(session: &mut client::Session) -> Result<Value, String> {
    session.item_list_all()
}

fn credential(
    session: &mut client::Session,
    vault: &str,
    item: &str,
    site: &str,
) -> Result<Value, String> {
    let mut summary = session.item_get(vault, item, None)?;
    if summary["itemType"] != "login" {
        return Err("selected item is not a login".to_owned());
    }
    if !website_matches(&summary, site) {
        return Err("selected login does not match site".to_owned());
    }
    let password = session.item_get(vault, item, Some("password"))?;
    summary["password"] = password;
    Ok(summary)
}

impl Host {
    fn dispatch(&mut self, request: &mut Request) -> Result<Value, String> {
        if self.last_activity.elapsed() >= Duration::from_mins(30) {
            self.local = None;
        }
        if request.action == "sources" {
            let sources = ["desktop", "cli"].iter().map(|source| {
                let path = profile(source).ok();
                let configured = path.as_deref().is_some_and(configured);
                let status = path.as_deref().and_then(|path| agent::call(path, "status", json!({})).ok());
                let active = status.is_some();
                let online = status.as_ref().and_then(|value| value["online"].as_bool());
                let sync = if self.local.as_ref().is_some_and(|local| local.source == *source) {
                    self.local.as_ref().and_then(|local| local.session.replica_status().ok())
                } else if active {
                    path.as_deref().and_then(|path| agent::call(path, "replica.status", json!({})).ok())
                } else { None };
                let license = if active && online == Some(true) {
                    path.as_deref().and_then(|path| agent::call(path, "license.status", json!({})).ok())
                } else { None };
                let username_hint = if *source == "desktop" { path.as_deref().and_then(cached_username) } else { None };
                json!({"id":source,"configured":configured,"active":active,"online":online,"localUnlocked":self.local.as_ref().is_some_and(|local|local.source == *source),"usernameHint":username_hint,"sync":sync,"license":license})
            }).collect::<Vec<_>>();
            return Ok(json!({"version":1,"sources":sources}));
        }
        if request.action == "lock" {
            self.local = None;
            if matches!(request.source.as_str(), "desktop" | "cli")
                && let Ok(path) = profile(&request.source)
            {
                let _ = agent::call(&path, "logout", json!({}));
            }
            return Ok(json!({"locked":true}));
        }
        if !matches!(request.action.as_str(), "unlock" | "list" | "get") {
            return Err("unsupported read-only connector action".to_owned());
        }
        let path = profile(&request.source)?;
        if !configured(&path) {
            return Err("selected client is not enrolled".to_owned());
        }
        if request.action == "unlock" {
            let username = if request.username.trim().is_empty() && request.source == "desktop" {
                cached_username(&path).unwrap_or_default()
            } else {
                request.username.clone()
            };
            if username.trim().is_empty() {
                return Err("username is required".to_owned());
            }
            let secret = Zeroizing::new(
                if request.account_secret.is_empty() && request.source == "desktop" {
                    cached_secret(&path, &username).ok_or("account secret is required")?
                } else {
                    request.account_secret.clone()
                },
            );
            let session = client::unlock_offline(
                &path,
                &username,
                &secret,
                request.master_password.as_bytes(),
            )?;
            self.local = Some(LocalSession {
                source: request.source.clone(),
                session,
            });
            self.last_activity = Instant::now();
            return Ok(json!({"unlocked":true,"source":request.source,"online":false}));
        }
        if request.action == "get" && (!valid_id(&request.vault_id) || !valid_id(&request.item_id))
        {
            return Err("invalid item identity".to_owned());
        }
        let site = site_origin(&request.site_origin)?;
        if let Some(local) = self
            .local
            .as_mut()
            .filter(|local| local.source == request.source)
        {
            self.last_activity = Instant::now();
            return if request.action == "list" {
                matching_items(list(&mut local.session)?, &site)
            } else {
                credential(
                    &mut local.session,
                    &request.vault_id,
                    &request.item_id,
                    &site,
                )
            };
        }
        if request.action == "list" {
            matching_items(agent::call(&path, "item.list.all", json!({}))?, &site)
        } else {
            let summary = agent::call(
                &path,
                "item.get",
                json!({"vault":request.vault_id,"item":request.item_id}),
            )?;
            if summary["itemType"] != "login" {
                return Err("selected item is not a login".to_owned());
            }
            if !website_matches(&summary, &site) {
                return Err("selected login does not match site".to_owned());
            }
            let password = agent::call(
                &path,
                "item.get",
                json!({"vault":request.vault_id,"item":request.item_id,"password_field":"password"}),
            )?;
            let mut value = summary;
            value["password"] = password;
            Ok(value)
        }
    }
}

fn read_frame(reader: &mut impl Read) -> Result<Option<Vec<u8>>, String> {
    let mut length = [0_u8; 4];
    match reader.read_exact(&mut length) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(_) => return Err("native message header is invalid".to_owned()),
    }
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_MESSAGE {
        return Err("native message size is invalid".to_owned());
    }
    let mut bytes = vec![0_u8; length];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "native message is incomplete".to_owned())?;
    Ok(Some(bytes))
}

fn write_frame(writer: &mut impl Write, response: &Response) -> Result<(), String> {
    let bytes = serde_json::to_vec(response).map_err(|_| "native response could not be encoded")?;
    if bytes.len() > MAX_MESSAGE {
        return Err("native response is too large".to_owned());
    }
    let length = u32::try_from(bytes.len()).map_err(|_| "native response is too large")?;
    writer
        .write_all(&length.to_le_bytes())
        .map_err(|_| "native output failed")?;
    writer
        .write_all(&bytes)
        .map_err(|_| "native output failed")?;
    writer
        .flush()
        .map_err(|_| "native output failed".to_owned())
}

/// Runs the length-framed native host over stdin/stdout.
///
/// # Errors
/// Returns a safe diagnostic if framing or output fails.
pub fn run() -> Result<(), String> {
    let mut host = Host::default();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();
    while let Some(mut bytes) = read_frame(&mut reader)? {
        let parsed = serde_json::from_slice::<Request>(&bytes);
        bytes.zeroize();
        let mut request = parsed.map_err(|_| "native request is invalid")?;
        let outcome = host.dispatch(&mut request);
        request.account_secret.zeroize();
        request.master_password.zeroize();
        let response = match outcome {
            Ok(value) => Response {
                id: request.id,
                ok: true,
                value,
            },
            Err(error) => Response {
                id: request.id,
                ok: false,
                value: Value::String(error),
            },
        };
        write_frame(&mut writer, &response)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_round_trip_and_size_limit() {
        let request = br#"{"id":1,"action":"sources"}"#;
        let mut input = Vec::new();
        input.extend_from_slice(&u32::try_from(request.len()).unwrap().to_le_bytes());
        input.extend_from_slice(request);
        assert_eq!(
            read_frame(&mut input.as_slice()).unwrap(),
            Some(request.to_vec())
        );
        let oversized_bytes = (u32::try_from(MAX_MESSAGE).unwrap() + 1).to_le_bytes();
        let mut oversized = oversized_bytes.as_slice();
        assert!(read_frame(&mut oversized).is_err());
    }

    #[test]
    fn rejects_mutation_actions() {
        let mut host = Host::default();
        let mut request: Request =
            serde_json::from_value(json!({"id":1,"action":"item.edit","source":"cli"})).unwrap();
        assert!(host.dispatch(&mut request).is_err());
    }

    #[test]
    fn only_exact_https_origin_items_are_listed() {
        let rows = json!([
            {"website":"https://accounts.example.test/login","itemId":"one"},
            {"website":"https://accounts.example.test:444/login","itemId":"two"},
            {"website":"https://evil.accounts.example.test/","itemId":"three"}
        ]);
        let origin = site_origin("https://accounts.example.test").unwrap();
        let filtered = matching_items(rows, &origin).unwrap();
        assert_eq!(filtered.as_array().unwrap().len(), 1);
        assert_eq!(filtered[0]["itemId"], "one");
        assert!(site_origin("http://accounts.example.test").is_err());
    }
}
