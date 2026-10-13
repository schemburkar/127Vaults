//! Chromium connector: read-only passwords and approved create-only passkeys.
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::Zeroize;

use crate::agent;

const MAX_MESSAGE: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    id: u32,
    action: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    vault_id: String,
    #[serde(default)]
    item_id: String,
    #[serde(default)]
    entry_id: String,
    #[serde(default)]
    site_origin: String,
    #[serde(default)]
    metadata: Value,
    #[serde(default)]
    private_key: String,
    #[serde(default)]
    verification_session: String,
}

#[derive(Serialize)]
struct Response {
    id: u32,
    ok: bool,
    value: Value,
}

struct Host;

fn profile(source: &str) -> Result<PathBuf, String> {
    match source {
        "desktop" => crate::desktop_profile_directory(),
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

fn website_matches(row: &Value, site: &str) -> bool {
    row["website"]
        .as_str()
        .and_then(|website| url::Url::parse(website).ok())
        .is_some_and(|url| url.origin().ascii_serialization() == site)
}

fn field_value<'a>(fields: &'a [Value], id: &str) -> Option<&'a str> {
    fields
        .iter()
        .find(|field| field["id"] == id)?
        .get("value")?
        .as_str()
}

fn entry_fields(summary: &Value, entry_id: &str, site: &str) -> Result<(String, String), String> {
    if entry_id.is_empty() {
        if summary["itemType"] != "login" || !website_matches(summary, site) {
            return Err("selected login does not match site".to_owned());
        }
        return Ok((
            summary["username"].as_str().unwrap_or("").to_owned(),
            "password".to_owned(),
        ));
    }
    if !valid_id(entry_id) {
        return Err("invalid related login identity".to_owned());
    }
    let fields = summary["customFields"]
        .as_array()
        .ok_or("related login is unavailable")?;
    let marker = format!("__127vaults_section:{entry_id}");
    if !fields.iter().any(|field| {
        field["id"] == marker
            && field["type"] == "metadata"
            && field["value"]
                .as_str()
                .is_some_and(|value| value.split('|').next() == Some("login"))
    }) {
        return Err("related login is unavailable".to_owned());
    }
    let prefix = format!("__127vaults_field:{entry_id}:");
    let website =
        field_value(fields, &format!("{prefix}website")).ok_or("related website is unavailable")?;
    if !website_matches(&json!({"website":website}), site) {
        return Err("related login does not match site".to_owned());
    }
    let username = field_value(fields, &format!("{prefix}username"))
        .unwrap_or("")
        .to_owned();
    let password_id = format!("{prefix}password");
    if !fields
        .iter()
        .any(|field| field["id"] == password_id && field["type"] == "password")
    {
        return Err("related password is unavailable".to_owned());
    }
    Ok((username, password_id))
}

fn login_entries(summary: &Value, vault_id: &str, site: &str) -> Vec<Value> {
    let mut entries = Vec::new();
    if summary["itemType"] == "login" && website_matches(summary, site) {
        entries.push(json!({"vaultId":vault_id,"itemId":summary["itemId"],"entryId":"", "title":summary["title"],"website":summary["website"],"username":summary["username"]}));
    }
    if let Some(fields) = summary["customFields"].as_array() {
        for marker in fields.iter().filter(|field| field["type"] == "metadata") {
            let Some(id) = marker["id"]
                .as_str()
                .and_then(|id| id.strip_prefix("__127vaults_section:"))
            else {
                continue;
            };
            if !valid_id(id)
                || marker["value"]
                    .as_str()
                    .is_none_or(|value| value.split('|').next() != Some("login"))
            {
                continue;
            }
            let Ok((username, _)) = entry_fields(summary, id, site) else {
                continue;
            };
            let website =
                field_value(fields, &format!("__127vaults_field:{id}:website")).unwrap_or("");
            let label = marker["value"]
                .as_str()
                .and_then(|value| value.split_once('|'))
                .map(|(_, label)| label)
                .filter(|label| !label.is_empty())
                .unwrap_or("Related login");
            entries.push(json!({"vaultId":vault_id,"itemId":summary["itemId"],"entryId":id,"title":label,"website":website,"username":username}));
        }
    }
    entries
}

fn list_entries(
    rows: &Value,
    site: &str,
    mut get: impl FnMut(&str, &str) -> Result<Value, String>,
) -> Result<Value, String> {
    let mut entries = Vec::new();
    for row in rows.as_array().ok_or("local item list is invalid")? {
        let vault = row["vaultId"].as_str().ok_or("invalid vault identity")?;
        let item = row["itemId"].as_str().ok_or("invalid item identity")?;
        let summary = get(vault, item)?;
        entries.extend(login_entries(&summary, vault, site));
    }
    Ok(Value::Array(entries))
}

impl Host {
    #[allow(clippy::too_many_lines)]
    fn dispatch(request: &mut Request) -> Result<Value, String> {
        if request.action == "unlock" {
            return Err("Unlock your client directly. The extension does not accept account secrets or master passwords.".to_owned());
        }
        if request.action == "sources" {
            let sources = ["desktop", "cli"].iter().map(|source| {
                let path = profile(source).ok();
                let configured = path.as_deref().is_some_and(configured);
                let status = path.as_deref().and_then(|path| agent::call(path, "status", json!({})).ok());
                let active = status.is_some();
                let online = status.as_ref().and_then(|value| value["online"].as_bool());
                let sync = if active {
                    path.as_deref().and_then(|path| agent::call(path, "replica.status", json!({})).ok())
                } else { None };
                let license = if active && online == Some(true) {
                    path.as_deref().and_then(|path| agent::call(path, "license.status", json!({})).ok())
                } else { None };
                json!({"id":source,"configured":configured,"active":active,"online":online,"localUnlocked":false,"sync":sync,"license":license})
            }).collect::<Vec<_>>();
            return Ok(json!({"version":1,"sources":sources}));
        }
        if request.action == "lock" {
            if matches!(request.source.as_str(), "desktop" | "cli")
                && let Ok(path) = profile(&request.source)
            {
                let _ = agent::call(&path, "logout", json!({}));
            }
            return Ok(json!({"locked":true}));
        }
        if request.action == "passkey.session" {
            if request.source != "desktop" {
                return Err("Desktop source required".to_owned());
            }
            let path = profile(&request.source)?;
            let status = agent::call(&path, "status", json!({}))?;
            if status["nativePasskeyProtocol"] != 4
                || status["unlocked"] != true
                || status["passkeyVerificationSession"]
                    .as_str()
                    .is_none_or(str::is_empty)
            {
                return Err(
                    "Unlock or restart the updated 127Vaults Desktop app to continue.".to_owned(),
                );
            }
            return Ok(json!({"verificationSession":status["passkeyVerificationSession"]}));
        }
        if request.action == "passkey.targets" {
            let path = profile(&request.source)?;
            return agent::call(
                &path,
                "passkey.targets",
                json!({"website":request.site_origin}),
            );
        }
        if request.action == "passkey.vaults" {
            let path = profile(&request.source)?;
            return agent::call(&path, "vault.list", json!({}));
        }
        if !matches!(
            request.action.as_str(),
            "list" | "get" | "passkey.list" | "passkey.get" | "passkey.save"
        ) {
            return Err("unsupported read-only connector action".to_owned());
        }
        let path = profile(&request.source)?;
        if !configured(&path) {
            return Err("selected client is not enrolled".to_owned());
        }
        if request.action == "get" && (!valid_id(&request.vault_id) || !valid_id(&request.item_id))
        {
            return Err("invalid item identity".to_owned());
        }
        let site = site_origin(&request.site_origin)?;
        if request.action.starts_with("passkey.") {
            return Self::passkey_request(request, &path, &site);
        }
        if request.action == "list" {
            list_entries(
                &agent::call(&path, "item.list.all", json!({}))?,
                &site,
                |vault, item| agent::call(&path, "item.get", json!({"vault":vault,"item":item})),
            )
        } else {
            let summary = agent::call(
                &path,
                "item.get",
                json!({"vault":request.vault_id,"item":request.item_id}),
            )?;
            let (username, password_field) = entry_fields(&summary, &request.entry_id, &site)?;
            let password = agent::call(
                &path,
                "item.get",
                json!({"vault":request.vault_id,"item":request.item_id,"password_field":password_field}),
            )?;
            Ok(
                json!({"itemId":request.item_id,"entryId":request.entry_id,"website":site,"username":username,"password":password}),
            )
        }
    }

    fn passkey_request(request: &Request, path: &Path, site: &str) -> Result<Value, String> {
        #[cfg(windows)]
        if crate::native_passkeys::WINDOWS_NATIVE_PASSKEYS_ENABLED
            && matches!(request.action.as_str(), "passkey.get" | "passkey.save")
        {
            return Err("Use the native Windows passkey provider; extension signing and creation are disabled on Windows".to_owned());
        }
        if request.action == "passkey.list" {
            return agent::call(path, "passkey.list", json!({"website":site}));
        }
        if !valid_id(&request.vault_id)
            || !request.item_id.is_empty() && !valid_id(&request.item_id)
            || request.action == "passkey.get" && !valid_id(&request.item_id)
        {
            return Err("invalid passkey identity".to_owned());
        }
        if request.source != "desktop" || request.verification_session.is_empty() {
            return Err("Unlock 127Vaults Desktop to continue.".to_owned());
        }
        let mut result = agent::call(
            path,
            &request.action,
            json!({"vault":request.vault_id,"item":request.item_id,"website":site,"verification_session":request.verification_session,"passkey_metadata":request.metadata,"password":request.private_key}),
        )?;
        if request.action == "passkey.save" {
            result["vaultId"] = json!(request.vault_id);
            result["source"] = json!(request.source);
        }
        Ok(result)
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
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();
    while let Some(mut bytes) = read_frame(&mut reader)? {
        let parsed = serde_json::from_slice::<Request>(&bytes);
        bytes.zeroize();
        let mut request = parsed.map_err(|_| "native request is invalid")?;
        let outcome = Host::dispatch(&mut request);
        request.private_key.zeroize();
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
        let mut request: Request =
            serde_json::from_value(json!({"id":1,"action":"item.edit","source":"cli"})).unwrap();
        assert!(Host::dispatch(&mut request).is_err());
        for action in [
            "device.list",
            "device.inspect",
            "device.approve",
            "device.revoke",
        ] {
            let mut request: Request =
                serde_json::from_value(json!({"id":1,"action":action,"source":"cli"})).unwrap();
            assert!(Host::dispatch(&mut request).is_err());
        }
    }

    #[test]
    fn refuses_extension_unlock_and_credential_fields() {
        let mut unlock: Request =
            serde_json::from_value(json!({"id":1,"action":"unlock","source":"desktop"})).unwrap();
        assert!(
            Host::dispatch(&mut unlock)
                .unwrap_err()
                .contains("Unlock your client directly")
        );
        for field in ["username", "accountSecret", "masterPassword"] {
            let mut request = json!({"id":1,"action":"passkey.get","source":"desktop"});
            request[field] = json!("synthetic-secret");
            assert!(serde_json::from_value::<Request>(request).is_err());
        }
    }

    #[test]
    fn only_exact_https_origin_items_are_listed() {
        let section = "87311a33-a992-4528-90aa-5ddc87646031";
        let rows = json!([{"vaultId":"876e252c-a31b-4a0a-9f30-d7d0cb85b658","itemId":"a0ca6518-8943-46f3-acbe-ac0b721f0932"}]);
        let summary = json!({"itemId":rows[0]["itemId"],"itemType":"login","title":"Primary","website":"https://accounts.example.test/login","username":"primary",
        "customFields":[
            {"id":format!("__127vaults_section:{section}"),"type":"metadata","value":"login|Second account"},
            {"id":format!("__127vaults_field:{section}:website"),"type":"url","value":"https://accounts.example.test/other"},
            {"id":format!("__127vaults_field:{section}:username"),"type":"text","value":"secondary"},
            {"id":format!("__127vaults_field:{section}:password"),"type":"password","value":"[redacted]"}
        ]});
        let origin = site_origin("https://accounts.example.test").unwrap();
        let filtered = list_entries(&rows, &origin, |_, _| Ok(summary.clone())).unwrap();
        assert_eq!(filtered.as_array().unwrap().len(), 2);
        assert_eq!(filtered[1]["entryId"], section);
        assert_eq!(filtered[1]["username"], "secondary");
        assert_eq!(
            entry_fields(&summary, section, &origin).unwrap().1,
            format!("__127vaults_field:{section}:password")
        );
        assert!(entry_fields(&summary, section, "https://evil.accounts.example.test").is_err());
        assert!(site_origin("http://accounts.example.test").is_err());
    }
}
