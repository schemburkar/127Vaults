//! Optional, separately confirmed browser trust. Never implied by --yes or Desktop import.
use std::{fs, path::Path, time::Duration};
use vaults_installer::Result;

#[cfg(windows)]
fn windows_command(check_only: bool) -> String {
    // The program is fixed; paths/hashes are data in child-only environment values.
    // No downloaded script execution or ExecutionPolicy override is required.
    format!(
        "& {{\n{}\n}} -CertificatePath $env:VAULTS_BROWSER_CA_FILE -ExpectedSha256 $env:VAULTS_BROWSER_CA_SHA256{}",
        include_str!("browser-trust.ps1"),
        if check_only { " -CheckOnly" } else { "" }
    )
}

pub fn guide(
    root: &Path,
    ca: &Path,
    origin: &str,
    expected: &str,
    interactive: bool,
) -> Result<()> {
    cliclack::note(
        "Browser HTTPS trust",
        format!(
            "Server: {origin}\nPublic CA: {}\nSHA-256 of exact CA file bytes: {expected}\nDesktop/CLI connection import trusts the CA only inside those apps. Browser sign-in, installed web apps and offline web setup need browser trust separately. Never bypass certificate warnings.",
            ca.display()
        ),
    )?;
    if !cfg!(windows) {
        cliclack::log::info(
            "Linux: verify this file hash with your administrator, then import the public CA in your browser's certificate Authorities settings. Distribution and managed-browser policies vary; use the setup guide. No OS/browser trust was changed. macOS instructions are documented for future distribution.",
        )?;
        return Ok(());
    }
    if !interactive {
        cliclack::log::info(
            "Browser trust was not changed. Rerun interactively to review the optional Windows current-user CA import, or follow setup-guide.html#browser-trust. --yes never approves a root certificate.",
        )?;
        return Ok(());
    }
    cliclack::log::warning(
        "Optional Windows current-user trust: Windows and participating browsers will trust certificates signed by this CA, beyond this one address. Continue only after confirming the file fingerprint through your trusted administrator/channel. This affects this Windows user only; no machine-wide store or browser policy is changed. Managed devices may require IT approval.",
    )?;
    if !cliclack::confirm("I verified this CA and want to add it to my Windows user's trusted roots for browser access").initial_value(false).interact()? {
        cliclack::log::info("Skipped browser trust. Desktop/CLI can still use their own verified connection; use an already trusted browser/device for approval.")?;
        return Ok(());
    }
    // Recheck the exact bytes and pinned HTTPS endpoint before touching Windows trust.
    if crate::transport::file_hash(ca)? != expected {
        return Err("Public CA changed; browser trust was not modified".into());
    }
    let certificate = reqwest::Certificate::from_pem(&fs::read(ca)?)?;
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(certificate)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .build()?;
    let url = url::Url::parse(origin)?.join("health/live")?;
    if client.get(url).send()?.status() != reqwest::StatusCode::OK {
        return Err("Cannot verify the server with this CA. Check the private network before adding browser trust".into());
    }
    #[cfg(windows)]
    {
        let script = root.join("configure-browser-trust.ps1");
        fs::write(&script, include_str!("browser-trust.ps1"))?;
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(windows_command(false))
            .env("VAULTS_BROWSER_CA_FILE", ca)
            .env("VAULTS_BROWSER_CA_SHA256", expected)
            .status()?;
        if !status.success() {
            return Err("Windows browser trust setup did not complete. Keep the existing server identity and follow the manual browser trust guide; do not bypass policy".into());
        }
    }
    #[cfg(not(windows))]
    let _ = root;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Command;
    #[test]
    fn validates_ca_without_changing_the_real_trust_store_and_rejects_changed_bytes() {
        let root =
            std::env::temp_dir().join(format!("127v-browser-trust-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let ca = root.join("public ca ' $test.crt");
        let result = Command::new("node")
            .args([
                "-e",
                "process.stdout.write(require('tls').rootCertificates[0])",
            ])
            .output()
            .unwrap();
        assert!(result.status.success());
        fs::write(&ca, result.stdout).unwrap();
        let hash = crate::transport::file_hash(&ca).unwrap();
        guide(&root, &ca, "https://127.0.0.1:1/", &hash, false).unwrap();
        assert!(!root.join("configure-browser-trust.ps1").exists());
        let check = |fingerprint: &str| {
            Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command"])
                .arg(windows_command(true))
                .env("VAULTS_BROWSER_CA_FILE", &ca)
                .env("VAULTS_BROWSER_CA_SHA256", fingerprint)
                .output()
                .unwrap()
        };
        let valid = check(&hash);
        let invalid = check(&"0".repeat(64));
        fs::write(
            &ca,
            "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n",
        )
        .unwrap();
        let private_key = check(&crate::transport::file_hash(&ca).unwrap());
        fs::remove_file(ca).unwrap();
        fs::remove_dir(root).unwrap();
        assert!(
            valid.status.success(),
            "{}",
            String::from_utf8_lossy(&valid.stderr)
        );
        assert!(String::from_utf8_lossy(&valid.stdout).contains("Trust store unchanged"));
        assert!(!invalid.status.success());
        assert!(!private_key.status.success());
    }
}
