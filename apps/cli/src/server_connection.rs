//! Portable public server connection files, shared by all desktop platforms.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerConnection {
    schema_version: u32,
    kind: String,
    pub server_name: String,
    pub server_url: String,
    pub installation_id: String,
    ca_certificate: String,
    ca_sha256: String,
}

impl ServerConnection {
    /// Parse a bounded public connection document without contacting its server.
    ///
    /// # Errors
    /// Rejects incompatible schemas, unsafe addresses and inconsistent public material.
    pub fn parse(source: &str) -> Result<Self, String> {
        if source.len() > 32768 {
            return Err("Connection file is too large".to_owned());
        }
        let file: Self = serde_json::from_str(source)
            .map_err(|_| "Select a valid 127Vaults server connection file".to_owned())?;
        let url = Url::parse(&file.server_url).map_err(|_| "Invalid server address".to_owned())?;
        let host = url.host_str().unwrap_or_default();
        super::validate_private_url(
            &file.server_url,
            host.ends_with(".ts.net").then_some(host),
            true,
        )?;
        if file.schema_version != 1
            || file.kind != "127vaults-server-connection"
            || file.server_name.trim().is_empty()
            || file.server_name.len() > 400
            || file.server_name.chars().any(char::is_control)
            || uuid::Uuid::parse_str(&file.installation_id).is_err()
            || file.ca_certificate.len() > 16384
            || !file
                .ca_certificate
                .starts_with("-----BEGIN CERTIFICATE-----")
            || !file
                .ca_certificate
                .trim_end()
                .ends_with("-----END CERTIFICATE-----")
            || file
                .ca_certificate
                .matches("-----BEGIN CERTIFICATE-----")
                .count()
                != 1
            || file.ca_certificate.contains("PRIVATE KEY")
            || hex::encode(Sha256::digest(file.ca_certificate.as_bytes())) != file.ca_sha256
        {
            return Err("Invalid server connection details or certificate fingerprint".to_owned());
        }
        Ok(file)
    }

    /// Verify the pinned HTTPS endpoint before saving create-only trust material.
    ///
    /// # Errors
    /// Fails on unavailable Tailscale peers, invalid TLS, filesystem failures or differing saved trust.
    pub fn establish(&self, config: &Path) -> Result<String, String> {
        let url = Url::parse(&self.server_url).map_err(|_| "Invalid server address".to_owned())?;
        let host = url.host_str().unwrap_or_default();
        let tailnet = host.ends_with(".ts.net")
            || host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| {
                let o = ip.octets();
                o[0] == 100 && (64..=127).contains(&o[1])
            });
        if tailnet
            && !super::tailscale::discover()?
                .iter()
                .any(|peer| peer.address == host || peer.name.eq_ignore_ascii_case(host))
        {
            return Err("Connect to the server's Tailscale network first".to_owned());
        }
        let temporary =
            std::env::temp_dir().join(format!("127vaults-connection-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&temporary)
            .map_err(|_| "Could not prepare public certificate".to_owned())?;
        let ca = temporary.join("ca.crt");
        let result = (|| {
            fs::write(&ca, &self.ca_certificate)
                .map_err(|_| "Could not read public certificate".to_owned())?;
            super::establish_trust(&super::TrustArgs {
                url: self.server_url.clone(),
                ca,
                server_id: self.installation_id.clone(),
                tailscale_name: host.ends_with(".ts.net").then(|| host.to_owned()),
                tailscale_ip: tailnet,
                config_dir: config.to_path_buf(),
            })
        })();
        let _ = fs::remove_file(temporary.join("ca.crt"));
        let _ = fs::remove_dir(&temporary);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file() -> serde_json::Value {
        let pem = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n";
        serde_json::json!({ "schemaVersion": 1, "kind": "127vaults-server-connection", "serverName": "Family server",
            "serverUrl": "https://192.168.1.10:12780", "installationId": "10000000-0000-4000-8000-000000000001",
            "caCertificate": pem, "caSha256": hex::encode(Sha256::digest(pem.as_bytes())) })
    }
    #[test]
    fn portable_connection_validates_schema_and_public_material() {
        assert!(ServerConnection::parse(&file().to_string()).is_ok());
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("caSha256", serde_json::json!("0".repeat(64))),
            ("serverUrl", serde_json::json!("http://192.168.1.10")),
            ("serverUrl", serde_json::json!("https://evil.example")),
            (
                "serverUrl",
                serde_json::json!("https://192.168.1.10/?token=secret"),
            ),
            ("installationId", serde_json::json!("invalid")),
            ("privateKey", serde_json::json!("secret")),
        ] {
            let mut changed = file();
            changed[field] = value;
            assert!(ServerConnection::parse(&changed.to_string()).is_err());
        }
        assert!(ServerConnection::parse(&" ".repeat(32769)).is_err());
        let duplicate = file().to_string().replacen('{', "{\"schemaVersion\":1,", 1);
        assert!(ServerConnection::parse(&duplicate).is_err());
    }
    #[test]
    fn invalid_certificate_never_persists_a_trust_profile() {
        let config =
            std::env::temp_dir().join(format!("127v-connection-test-{}", uuid::Uuid::new_v4()));
        assert!(
            ServerConnection::parse(&file().to_string())
                .unwrap()
                .establish(&config)
                .is_err()
        );
        assert!(!config.exists());
    }
}
