//! Narrow passkey connector operations; generic item editing stays unavailable.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};

use crate::client::Session;
pub(crate) const META: &str = "__127vaults_passkey";
pub(crate) const KEY: &str = "__127vaults_passkey_key";

fn bytes(value: &Value, min: usize, max: usize) -> Result<(), String> {
    let text = value.as_str().ok_or("invalid passkey bytes")?;
    let decoded = URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| "invalid passkey bytes")?;
    if decoded.len() < min || decoded.len() > max || URL_SAFE_NO_PAD.encode(decoded) != text {
        return Err("invalid passkey bytes".to_owned());
    }
    Ok(())
}

pub(crate) fn validate(meta: &Value, site: &str) -> Result<(), String> {
    let url = url::Url::parse(site).map_err(|_| "invalid passkey origin")?;
    if url.scheme() != "https"
        || url.origin().ascii_serialization() != site
        || meta["version"] != 1
        || meta["algorithm"] != -7
        || meta["signCount"] != 0
        || meta["origin"] != site
        || meta["rpId"].as_str() != url.host_str()
        || ["username", "displayName"]
            .iter()
            .any(|name| meta[name].as_str().is_none_or(|v| v.chars().count() > 256))
    {
        return Err("invalid passkey metadata".to_owned());
    }
    bytes(&meta["credentialId"], 32, 32)?;
    bytes(&meta["userHandle"], 1, 64)
}

fn metadata(summary: &Value, site: &str) -> Result<Value, String> {
    let fields = summary["customFields"]
        .as_array()
        .ok_or("passkey is unavailable")?;
    let rows: Vec<_> = fields.iter().filter(|f| f["id"] == META).collect();
    if rows.len() != 1 || rows[0]["type"] != "metadata" {
        return Err("passkey is unavailable".to_owned());
    }
    let meta: Value = serde_json::from_str(
        rows[0]["value"]
            .as_str()
            .ok_or("invalid passkey metadata")?,
    )
    .map_err(|_| "invalid passkey metadata")?;
    validate(&meta, site)?;
    if !same_site(&summary["website"], site) {
        return Err("passkey does not match site".to_owned());
    }
    Ok(meta)
}

fn same_site(website: &Value, site: &str) -> bool {
    website
        .as_str()
        .and_then(|s| url::Url::parse(s).ok())
        .is_some_and(|url| url.origin().ascii_serialization() == site)
}

impl Session {
    pub(crate) fn passkey_list(&mut self, site: &str) -> Result<Value, String> {
        let rows = self.item_list_all()?;
        let mut output = Vec::new();
        for row in rows.as_array().ok_or("invalid item list")? {
            if !same_site(&row["website"], site) {
                continue;
            }
            let vault = row["vaultId"].as_str().ok_or("invalid vault identity")?;
            let item = row["itemId"].as_str().ok_or("invalid item identity")?;
            let summary = self.item_get(vault, item, None)?;
            if let Ok(meta) = metadata(&summary, site) {
                output.push(
                    json!({"vaultId":vault,"vaultName":self.vault_info(vault)?["name"],"itemId":item,"title":summary["title"],"metadata":meta,"sync":self.item_sync_status(vault,item)?}),
                );
            }
        }
        Ok(json!(output))
    }

    pub(crate) fn passkey_get(
        &mut self,
        vault: &str,
        item: &str,
        site: &str,
    ) -> Result<Value, String> {
        let summary = self.item_get(vault, item, None)?;
        let meta = metadata(&summary, site)?;
        let key = self.item_get(vault, item, Some(KEY))?;
        bytes(&key, 64, 512)?;
        Ok(json!({"metadata":meta,"privateKey":key}))
    }

    pub(crate) fn passkey_save(
        &mut self,
        vault: &str,
        site: &str,
        meta: &Value,
        key: &str,
    ) -> Result<Value, String> {
        self.passkey_save_into(vault, None, site, meta, key)
    }

    pub(crate) fn passkey_targets(&mut self, site: &str) -> Result<Value, String> {
        let rows = self.item_list_all()?;
        let mut targets = Vec::new();
        for row in rows.as_array().ok_or("Invalid items")? {
            if row["itemType"] != "login" || !same_site(&row["website"], site) {
                continue;
            }
            let vault = row["vaultId"].as_str().ok_or("Invalid vault")?;
            let item = row["itemId"].as_str().ok_or("Invalid item")?;
            let summary = self.item_get(vault, item, None)?;
            if summary["customFields"]
                .as_array()
                .is_some_and(|fields| fields.iter().any(|f| f["id"] == META))
            {
                continue;
            }
            targets.push(json!({"vaultId":vault,"itemId":item,"title":summary["title"],"username":summary["username"]}));
        }
        Ok(json!(targets))
    }

    #[allow(clippy::too_many_lines)]
    pub(crate) fn passkey_save_into(
        &mut self,
        vault: &str,
        target: Option<&str>,
        site: &str,
        meta: &Value,
        key: &str,
    ) -> Result<Value, String> {
        validate(meta, site)?;
        bytes(&json!(key), 64, 512)?;
        // Attachment is limited to a matching login without an existing key.
        if self.passkey_list(site)?.as_array().is_some_and(|rows| {
            rows.iter()
                .any(|r| r["metadata"]["credentialId"] == meta["credentialId"])
        }) {
            return Err("passkey already exists".to_owned());
        }
        let mut fields = vec![
            json!({"id":"__127vaults_item_type","label":"Item type","type":"metadata","value":"passkey"}),
            json!({"id":META,"label":"Passkey","type":"metadata","value":meta.to_string()}),
            json!({"id":KEY,"label":"Passkey private key","type":"password","value":key}),
        ];
        let mut title = meta["rpId"].as_str().unwrap_or("Passkey").to_owned();
        let account = meta["username"].as_str().unwrap_or("");
        if !account.is_empty() {
            title.push_str(" · ");
            title.push_str(account);
        }
        let mut website = site.to_owned();
        let mut username = account.to_owned();
        let mut password = zeroize::Zeroizing::new(String::new());
        if let Some(item) = target {
            let original = self.item_get(vault, item, None)?;
            if original["itemType"] != "login" || !same_site(&original["website"], site) {
                return Err("Choose a login for this website".to_owned());
            }
            let old = original["customFields"].as_array().ok_or("Invalid login")?;
            if old.iter().any(|f| f["id"] == META || f["id"] == KEY) {
                return Err("This login already has a passkey; choose another item".to_owned());
            }
            fields.remove(0);
            let mut preserved = old.clone();
            for field in &mut preserved {
                if field["type"] == "password" {
                    field["value"] = self.item_get(vault, item, field["id"].as_str())?;
                }
            }
            fields.extend(preserved);
            original["title"]
                .as_str()
                .unwrap_or("")
                .clone_into(&mut title);
            original["website"]
                .as_str()
                .unwrap_or(site)
                .clone_into(&mut website);
            original["username"]
                .as_str()
                .unwrap_or("")
                .clone_into(&mut username);
            self.item_get(vault, item, Some("password"))?
                .as_str()
                .unwrap_or("")
                .clone_into(&mut password);
        }
        let saved = self.item_upsert(
            vault, target, &title, &website, &username, &password, &fields,
        );
        match saved {
            Ok(mut saved) => {
                let item = saved["itemId"]
                    .as_str()
                    .ok_or("Saved passkey identity is unavailable")?;
                let sync = self.item_sync_status(vault, item)?;
                saved["queued"] = sync["pending"].clone();
                saved["sync"] = sync;
                saved["vaultId"] = json!(vault);
                Ok(saved)
            }
            Err(error) if !error.contains("409") => {
                // A failed delivery can still leave a durable encrypted item.
                // Return offline success only after finding that exact key ID
                // in the selected vault; never claim an uncertain save.
                let rows = self.passkey_list(site)?;
                let item = rows.as_array().and_then(|rows| {
                    rows.iter().find(|row| {
                        row["vaultId"] == vault
                            && row["metadata"]["credentialId"] == meta["credentialId"]
                    })
                });
                match item {
                    Some(item) => {
                        Ok(json!({"itemId":item["itemId"],"queued":true,"syncError":error}))
                    }
                    None => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_cross_origin_and_invalid_credentials() {
        let meta = json!({"version":1,"algorithm":-7,"signCount":0,"origin":"https://login.example.test","rpId":"login.example.test","credentialId":URL_SAFE_NO_PAD.encode([1;32]),"userHandle":"AQ","username":"alice","displayName":"Alice"});
        assert!(validate(&meta, "https://login.example.test").is_ok());
        assert!(validate(&meta, "https://evil.test").is_err());
        assert!(validate(&meta, "http://login.example.test").is_err());
        let mut wrong = meta;
        wrong["credentialId"] = json!("AB");
        assert!(validate(&wrong, "https://login.example.test").is_err());
    }
    #[test]
    fn a_login_can_hold_a_passkey_without_changing_its_type_or_url_path() {
        let meta = json!({"version":1,"algorithm":-7,"signCount":0,"origin":"https://example.test","rpId":"example.test","credentialId":URL_SAFE_NO_PAD.encode([1;32]),"userHandle":"AQ","username":"alice","displayName":"Alice"});
        let summary = json!({"itemType":"login","website":"https://example.test/account","customFields":[{"id":META,"type":"metadata","value":meta.to_string()}]});
        assert_eq!(metadata(&summary, "https://example.test").unwrap(), meta);
        assert!(metadata(&summary, "https://evil.test").is_err());
    }
}
