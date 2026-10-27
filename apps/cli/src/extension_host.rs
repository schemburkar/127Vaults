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
    website_value_matches(row["website"].as_str().unwrap_or(""), site)
        || row["customFields"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|field| {
                field["type"] == "url"
                    && field["id"]
                        .as_str()
                        .is_some_and(|id| id.starts_with("website-alias-"))
                    && website_value_matches(field["value"].as_str().unwrap_or(""), site)
            })
}

fn website_value_matches(website: &str, site: &str) -> bool {
    Some(website)
        .and_then(|website| {
            let website = website.trim();
            if website.is_empty()
                || website.starts_with("//")
                || website.contains('\\')
                || website.chars().any(char::is_whitespace)
            {
                return None;
            }
            let normalized = if website.contains("://") {
                website.to_owned()
            } else {
                format!("https://{website}")
            };
            url::Url::parse(&normalized).ok()
        })
        .is_some_and(|url| {
            let Ok(page) = url::Url::parse(site) else {
                return false;
            };
            let hosts_match = match (url.host_str(), page.host_str()) {
                (Some(saved), Some(current)) => {
                    saved == current
                        || (url.domain().is_some()
                            && page.domain().is_some()
                            && (saved.strip_prefix("www.") == Some(current)
                                || current.strip_prefix("www.") == Some(saved)))
                }
                _ => false,
            };
            url.scheme() == "https"
                && page.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && page.username().is_empty()
                && page.password().is_none()
                && url.host_str().is_some_and(|host| !host.contains('*'))
                && url.port_or_known_default() == page.port_or_known_default()
                && hosts_match
        })
}

#[test]
fn www_login_matching_includes_explicit_additional_websites() {
    let row = json!({"itemType":"login","itemId":"fixture","website":"console.twilio.com","customFields":[
        {"id":"website-alias-one","type":"url","value":"twilio.com"}
    ]});
    for site in [
        "https://twilio.com",
        "https://www.twilio.com",
        "https://console.twilio.com",
    ] {
        assert!(website_matches(&row, site));
        assert_eq!(login_entries(&row, "vault", site).len(), 1);
        assert!(entry_fields(&row, "", site).is_ok());
    }
    for site in [
        "https://evil.twilio.com",
        "https://twilio.com.evil.test",
        "http://www.twilio.com",
        "https://www.twilio.com:444",
    ] {
        assert!(!website_matches(&row, site));
        assert!(entry_fields(&row, "", site).is_err());
    }
}

#[test]
fn additional_websites_match_only_explicit_login_aliases() {
    let mut row = json!({"website":"https://primary.test","customFields":[
        {"id":"website-alias-one","type":"url","value":"https://other.test/login"},
        {"id":"document-link","type":"url","value":"https://drive.test/document"}
    ]});
    assert!(website_matches(&row, "https://other.test"));
    assert!(!website_matches(&row, "https://drive.test"));
    assert!(!website_matches(&row, "https://sub.other.test"));
    assert!(!website_matches(&row, "http://other.test"));
    assert!(!website_matches(&row, "https://other.test:444"));
    row["customFields"][0]["type"] = json!("text");
    assert!(!website_matches(&row, "https://other.test"));
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
        entries.push(json!({"vaultId":vault_id,"itemId":summary["itemId"],"entryId":"", "title":summary["title"],"website":if website_value_matches(summary["website"].as_str().unwrap_or(""),site) {summary["website"].clone()} else {json!(site)},"username":summary["username"]}));
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

pub(crate) fn list_entries(
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

fn legacy_agent(error: &str) -> bool {
    matches!(
        error,
        "unsupported agent command" | "read-only agent command denied"
    )
}

pub(crate) fn session_entries(
    session: &mut crate::client::Session,
    site: &str,
) -> Result<Value, String> {
    let site = site_origin(site)?;
    let rows = session.item_list_all()?;
    let mut entries = Vec::new();
    for row in rows.as_array().ok_or("Invalid local item list")? {
        let vault = row["vaultId"].as_str().ok_or("Invalid vault identity")?;
        let summary = session.item_get_known(vault, row, None)?;
        entries.extend(login_entries(&summary, vault, &site));
    }
    Ok(Value::Array(entries))
}

pub(crate) fn session_credential(
    session: &mut crate::client::Session,
    vault: &str,
    item: &str,
    entry: &str,
    site: &str,
) -> Result<Value, String> {
    let site = site_origin(site)?;
    if !valid_id(vault) || !valid_id(item) {
        return Err("Invalid item identity".to_owned());
    }
    let summary = session.item_get(vault, item, None)?;
    let (username, password_field) = entry_fields(&summary, entry, &site)?;
    let password = session.item_get_known(vault, &summary, Some(&password_field))?;
    Ok(
        json!({"itemId":item,"entryId":entry,"website":site,"username":username,"password":password}),
    )
}

impl Host {
    #[allow(clippy::too_many_lines)]
    fn dispatch(request: &mut Request) -> Result<Value, String> {
        if request.action == "open.desktop" {
            if request.source != "desktop" {
                return Err("Desktop source required".to_owned());
            }
            let executable = std::env::current_exe()
                .map_err(|_| "Desktop installation is unavailable")?
                .with_file_name(if cfg!(windows) {
                    "vaults-desktop-poc.exe"
                } else {
                    "vaults-desktop-poc"
                });
            if !executable.is_file() {
                return Err("Open 127Vaults Desktop directly; the connector has no adjacent Desktop application".to_owned());
            }
            open_desktop(&executable)?;
            return Ok(json!({"opened":true}));
        }
        if request.action == "unlock" {
            return Err("Unlock your client directly. The extension does not accept account secrets or master passwords.".to_owned());
        }
        if request.action == "sources" {
            let sources = ["desktop", "cli"].iter().map(|source| {
                let path = profile(source).ok();
                let configured = path.as_deref().is_some_and(configured);
                let status = path.as_deref().and_then(|path| agent::call(path, "extension.status", json!({})).or_else(|error| if legacy_agent(&error) { agent::call(path, "status", json!({})) } else { Err(error) }).ok());
                let active = status.is_some();
                let online = status.as_ref().and_then(|value| value["online"].as_bool());
                let sync = status.as_ref().map(|value| value["sync"].clone());
                let license = status.as_ref().map(|value| value["license"].clone());
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
            agent::call(&path, "extension.logins", json!({"website":site})).or_else(|error| {
                if !legacy_agent(&error) {
                    return Err(error);
                }
                list_entries(
                    &agent::call(&path, "item.list.all", json!({}))?,
                    &site,
                    |vault, item| {
                        agent::call(&path, "item.get", json!({"vault":vault,"item":item}))
                    },
                )
            })
        } else {
            agent::call(
                &path,
                "extension.get",
                json!({"vault":request.vault_id,"item":request.item_id,"entry_id":request.entry_id,"website":site}),
            ).or_else(|error| {
                if !legacy_agent(&error) { return Err(error); }
                let summary = agent::call(&path, "item.get", json!({"vault":request.vault_id,"item":request.item_id}))?;
                let (username, password_field) = entry_fields(&summary, &request.entry_id, &site)?;
                let password = agent::call(&path, "item.get", json!({"vault":request.vault_id,"item":request.item_id,"password_field":password_field}))?;
                Ok(json!({"itemId":request.item_id,"entryId":request.entry_id,"website":site,"username":username,"password":password}))
            })
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

fn open_desktop(executable: &Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The path comes only from this installed host, never from a web page.
        let result = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $exe=$env:VAULTS_DESKTOP_LAUNCH_PATH; $p=Get-Process | Where-Object { $_.ProcessName -eq 'vaults-desktop-poc' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $ok=(New-Object -ComObject WScript.Shell).AppActivate($p.Id); if (!$ok) { throw 'Could not focus Desktop' } } else { Start-Process -FilePath $exe -WindowStyle Normal }"])
            .env("VAULTS_DESKTOP_LAUNCH_PATH", executable)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status().map_err(|_| "Could not open Desktop")?;
        if !result.success() {
            return Err("Could not focus Desktop; open it directly".to_owned());
        }
    }
    #[cfg(not(windows))]
    {
        Command::new(executable)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not open Desktop")?;
    }
    Ok(())
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
    fn desktop_open_requires_desktop_source_and_cannot_supply_a_program() {
        let mut wrong_source: Request =
            serde_json::from_value(json!({"id":1,"action":"open.desktop","source":"cli"})).unwrap();
        assert_eq!(
            Host::dispatch(&mut wrong_source).unwrap_err(),
            "Desktop source required"
        );
        assert!(
            serde_json::from_value::<Request>(
                json!({"id":1,"action":"open.desktop","source":"desktop","program":"arbitrary.exe"})
            )
            .is_err()
        );
    }

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
    fn bare_websites_match_only_the_same_https_origin() {
        for saved in [
            "vercel.com",
            " VERCEL.COM ",
            "vercel.com/login",
            "https://vercel.com/login",
            "vercel.com:443",
        ] {
            let row = json!({"website":saved});
            assert!(website_matches(&row, "https://vercel.com"));
            for other in [
                "http://vercel.com",
                "https://app.vercel.com",
                "https://vercel.com.evil.test",
                "https://vercel.com:444",
            ] {
                assert!(!website_matches(&row, other), "{saved} -> {other}");
            }
        }
        assert!(website_matches(
            &json!({"website":"vercel.com:444/path"}),
            "https://vercel.com:444"
        ));
        for saved in [
            "",
            "//vercel.com",
            "http://vercel.com",
            "user@vercel.com",
            "https://user:pass@vercel.com",
            "*.vercel.com",
            "vercel.com\\@evil.test",
            "vercel.\tcom",
            "https:vercel.com",
        ] {
            assert!(
                !website_matches(&json!({"website":saved}), "https://vercel.com"),
                "{saved}"
            );
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
        let mut bare = summary.clone();
        bare["website"] = json!("accounts.example.test");
        bare["customFields"][1]["value"] = json!("accounts.example.test/other");
        let entries = list_entries(&rows, &origin, |_, _| Ok(bare.clone())).unwrap();
        assert_eq!(entries.as_array().unwrap().len(), 2);
        assert_eq!(entries[0]["website"], "accounts.example.test");
        assert!(entry_fields(&bare, "", &origin).is_ok());
        assert!(entry_fields(&bare, section, &origin).is_ok());
        assert!(entry_fields(&bare, "", "https://accounts.example.test.evil.test").is_err());
        assert!(entry_fields(&bare, section, "https://evil.accounts.example.test").is_err());
    }
}
