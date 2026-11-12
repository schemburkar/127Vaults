//! Role selection, portable connection handoff and resumable user-facing progress.
use clap::ValueEnum;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use vaults_installer::{Product, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Intent {
    Host,
    Join,
    Repair,
}
pub fn recommended(intent: Intent, existing: &[Product]) -> Vec<Product> {
    match intent {
        Intent::Host => vec![Product::Server, Product::Desktop, Product::Extension],
        Intent::Repair if !existing.is_empty() => existing.to_vec(),
        Intent::Join | Intent::Repair => vec![Product::Desktop, Product::Extension],
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    schema_version: u32,
    kind: String,
    pub server_name: String,
    pub server_url: String,
    installation_id: String,
    ca_certificate: String,
    ca_sha256: String,
}
impl Connection {
    pub fn read(path: &Path) -> Result<Self> {
        let mut bytes = Vec::new();
        fs::File::open(path)?.take(32769).read_to_end(&mut bytes)?;
        if bytes.len() > 32768 {
            return Err("Connection file is too large".into());
        }
        let value: Self = serde_json::from_slice(&bytes)?;
        let url = url::Url::parse(&value.server_url)?;
        if value.schema_version != 1
            || value.kind != "127vaults-server-connection"
            || value.server_name.is_empty()
            || value.server_name.len() > 400
            || value.server_name.chars().any(char::is_control)
            || url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || uuid::Uuid::parse_str(&value.installation_id).is_err()
            || value.ca_certificate.contains("PRIVATE KEY")
            || hex::encode(Sha256::digest(value.ca_certificate.as_bytes())) != value.ca_sha256
        {
            return Err("Invalid public server connection file".into());
        }
        reqwest::Certificate::from_pem(value.ca_certificate.as_bytes())?;
        Ok(value)
    }
    pub fn save(&self, root: &Path) -> Result<std::path::PathBuf> {
        let path = root.join("server-connection.127vaults-server");
        let mut file = atomic_write_file::AtomicWriteFile::open(&path)?;
        file.write_all(&serde_json::to_vec_pretty(self)?)?;
        file.commit()?;
        Ok(path)
    }
}
#[derive(Serialize)]
pub struct NextStep {
    pub component: String,
    pub state: &'static str,
    pub action: &'static str,
}
pub fn next_step(product: Product, installed: bool) -> NextStep {
    NextStep {
        component: product.name().to_owned(),
        state: if installed {
            "needs-setup"
        } else {
            "not-installed"
        },
        action: match product {
            Product::Server => {
                "Open your server web address to finish owner setup; use Server administration to check readiness."
            }
            Product::Desktop => {
                "Open Desktop, import the shared server connection, sign in and approve this device."
            }
            Product::Extension => {
                "Open your browser extension and connect it to an unlocked Desktop, CLI or web vault."
            }
            Product::Cli => "Enroll this CLI from an existing trusted device, then run login.",
            Product::Pwa => {
                "Open the private HTTPS web vault, establish browser trust, then choose Install app."
            }
        },
    }
}
pub fn save_progress(root: &Path, steps: &[NextStep]) -> Result<()> {
    let mut file = atomic_write_file::AtomicWriteFile::open(root.join("next-steps.json"))?;
    file.write_all(&serde_json::to_vec_pretty(
        &serde_json::json!({"version":1,"steps":steps}),
    )?)?;
    file.commit()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joining_never_recommends_server_and_repair_keeps_owned_components() {
        assert!(!recommended(Intent::Join, &[]).contains(&Product::Server));
        assert_eq!(
            recommended(Intent::Repair, &[Product::Cli]),
            vec![Product::Cli]
        );
        assert_eq!(next_step(Product::Desktop, true).state, "needs-setup");
        assert_eq!(next_step(Product::Desktop, false).state, "not-installed");
    }
}
