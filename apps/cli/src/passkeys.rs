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
    if summary["itemType"] != "passkey" || summary["website"] != site {
        return Err("passkey does not match site".to_owned());
    }
    Ok(meta)
}

impl Session {
    pub(crate) fn passkey_list(&mut self, site: &str) -> Result<Value, String> {
        let rows = self.item_list_all()?;
        let mut output = Vec::new();
        for row in rows.as_array().ok_or("invalid item list")? {
            let vault = row["vaultId"].as_str().ok_or("invalid vault identity")?;
            let item = row["itemId"].as_str().ok_or("invalid item identity")?;
            let summary = self.item_get(vault, item, None)?;
            if let Ok(meta) = metadata(&summary, site) {
                output.push(
                    json!({"vaultId":vault,"itemId":item,"title":summary["title"],"metadata":meta}),
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
        validate(meta, site)?;
        bytes(&json!(key), 64, 512)?;
        // Save only a new dedicated credential. No caller-provided item identity,
        // arbitrary fields or password-manager edit operation is accepted.
        if self.passkey_list(site)?.as_array().is_some_and(|rows| {
            rows.iter()
                .any(|r| r["metadata"]["credentialId"] == meta["credentialId"])
        }) {
            return Err("passkey already exists".to_owned());
        }
        self.item_upsert(vault, None, &format!("{} · {}", meta["rpId"].as_str().unwrap_or("Passkey"), meta["username"].as_str().unwrap_or("")), site, meta["username"].as_str().unwrap_or(""), "", &[
            json!({"id":"__127vaults_item_type","label":"Item type","type":"metadata","value":"passkey"}),
            json!({"id":META,"label":"Passkey","type":"metadata","value":meta.to_string()}),
            json!({"id":KEY,"label":"Passkey private key","type":"password","value":key}),
        ])
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
}
