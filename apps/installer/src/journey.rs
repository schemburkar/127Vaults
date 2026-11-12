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
    pub fn save_public_ca(&self, root: &Path) -> Result<(std::path::PathBuf, String)> {
        let path = root.join("127vaults-public-ca.crt");
        let mut file = atomic_write_file::AtomicWriteFile::open(&path)?;
        file.write_all(self.ca_certificate.as_bytes())?;
        file.commit()?;
        Ok((path, self.ca_sha256.clone()))
    }
}
#[derive(Serialize)]
pub struct NextStep {
    pub component: String,
    pub package_state: &'static str,
    pub state: &'static str,
    pub readiness_basis: &'static str,
    pub action: &'static str,
}
pub fn next_step(product: Product, installed: bool) -> NextStep {
    NextStep {
        component: product.name().to_owned(),
        package_state: if installed {
            "installed"
        } else {
            "not-installed"
        },
        readiness_basis: "not-checked",
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
    let ready: Vec<String> = fs::read(root.join("setup-checklist.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let steps: Vec<_> = steps.iter().map(|step| {
        let confirmed = step.package_state == "installed" && ready.contains(&step.component);
        serde_json::json!({"component":step.component,"packageState":step.package_state,
            "state":if confirmed {"ready"} else {step.state},
            "readinessBasis":if confirmed {"user-confirmed; check current client status"} else {step.readiness_basis},"action":step.action})
    }).collect();
    let mut file = atomic_write_file::AtomicWriteFile::open(root.join("next-steps.json"))?;
    file.write_all(&serde_json::to_vec_pretty(
        &serde_json::json!({"version":1,"steps":steps}),
    )?)?;
    file.commit()?;
    Ok(())
}

pub fn progress_step(root: &Path, product: Product, installed: bool) -> NextStep {
    let mut step = next_step(product, installed);
    let ready: Vec<String> = fs::read(root.join("setup-checklist.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if installed && ready.iter().any(|name| name == product.name()) {
        step.state = "ready";
        step.readiness_basis = "user-confirmed; check current client status";
    }
    step
}

pub fn review(root: &Path, products: &[Product]) -> Result<()> {
    let previous: Vec<String> = fs::read(root.join("setup-checklist.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let mut ready = Vec::new();
    for product in products {
        cliclack::log::info(next_step(*product, true).action)?;
        if cliclack::confirm(format!("Is {} configured and working? This records your confirmation, not a live health check.", product.name()))
            .initial_value(previous.iter().any(|name| name == product.name())).interact()? {
            ready.push(product.name());
        }
    }
    let mut file = atomic_write_file::AtomicWriteFile::open(root.join("setup-checklist.json"))?;
    file.write_all(&serde_json::to_vec_pretty(&ready)?)?;
    file.commit()?;
    save_progress(
        root,
        &products
            .iter()
            .map(|product| next_step(*product, true))
            .collect::<Vec<_>>(),
    )
}

/// Launch only the installed Desktop with a public file; never pass setup credentials.
pub fn open_desktop(root: &Path) -> Result<()> {
    #[cfg(windows)]
    let executable = {
        let output = std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command",
            "$p=(Get-Item 'HKCU:\\Software\\127Vaults\\127Vaults Desktop' -ErrorAction Stop).GetValue(''); Join-Path $p 'vaults-desktop-poc.exe'"]).output()?;
        if !output.status.success() {
            return Err("Desktop installation not found; open it from your app launcher".into());
        }
        std::path::PathBuf::from(String::from_utf8(output.stdout)?.trim())
    };
    #[cfg(not(windows))]
    let executable = root.join("127vaults-desktop.AppImage");
    if !executable.is_absolute() || !executable.is_file() {
        return Err("Desktop launcher not found; open the installed Desktop app".into());
    }
    let mut command = std::process::Command::new(executable);
    let file = root.join("server-connection.127vaults-server");
    if file.is_file() {
        Connection::read(&file)?;
        command.arg("--connection-file").arg(file);
    }
    command.spawn()?;
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
    #[test]
    fn progress_never_turns_an_uninstalled_package_ready_and_survives_resume() {
        let root = std::env::temp_dir().join(format!("127v-progress-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("setup-checklist.json"), "[\"desktop\",\"cli\"]").unwrap();
        save_progress(
            &root,
            &[
                next_step(Product::Desktop, true),
                next_step(Product::Cli, false),
            ],
        )
        .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("next-steps.json")).unwrap()).unwrap();
        assert_eq!(value["steps"][0]["state"], "ready");
        assert!(
            value["steps"][0]["readinessBasis"]
                .as_str()
                .unwrap()
                .starts_with("user-confirmed")
        );
        assert_eq!(value["steps"][1]["state"], "not-installed");
        fs::remove_file(root.join("setup-checklist.json")).unwrap();
        fs::remove_file(root.join("next-steps.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
