use reqwest::blocking::{Client, Response};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::Duration,
};
use vaults_installer::{Artifact, Invitation, Result};

pub struct Api {
    client: Client,
    invitation: Invitation,
}
impl Api {
    pub fn new(invitation: Invitation) -> Result<Self> {
        Ok(Self {
            client: client()?,
            invitation,
        })
    }
    pub fn request(&self, action: &str, body: Option<&serde_json::Value>) -> Result<Response> {
        let client_action;
        let action = if self.invitation.client_only {
            client_action = if action == "installer" {
                "client-installer".to_owned()
            } else if action.starts_with("artifacts/") {
                format!("client-{action}")
            } else {
                return Err(
                    "Client download links cannot access server licensing or billing".into(),
                );
            };
            &client_action
        } else {
            action
        };
        let url = format!(
            "{}/api/trials/{}/{}",
            self.invitation.origin, self.invitation.id, action
        );
        let request = if let Some(value) = body {
            self.client.post(url).json(value)
        } else {
            self.client.get(url)
        };
        let response = request
            .bearer_auth(&self.invitation.token)
            .header("Origin", &self.invitation.origin)
            .header(
                "X-127Vaults-Installer-Version",
                env!("VAULTS_INSTALLER_VERSION"),
            )
            .send()
            .map_err(|_| "Unable to reach the private download service")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 404 => "Setup link unavailable; open Manage → Downloads and license and copy a fresh setup link",
                409 => "License binding or release access changed; inspect the private trial page",
                426 => "This installer is retired. Download the latest installer from your private trial page",
                429 => "Download service rate limit reached; retry later",
                _ => "Private download service is unavailable",
            }.into());
        }
        Ok(response)
    }
    pub fn download(&self, asset: &Artifact, path: &Path) -> Result<()> {
        asset.validate()?;
        verified_download(
            self.request(&format!("artifacts/{}", asset.id), None)?,
            path,
            &asset.sha256,
            asset.size_bytes,
        )
    }
}

pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(3600))
        .user_agent(concat!(
            "127vaults-install/",
            env!("VAULTS_INSTALLER_VERSION")
        ))
        .build()?)
}

pub fn verified_download(
    mut response: Response,
    path: &Path,
    expected: &str,
    limit: u64,
) -> Result<()> {
    response.error_for_status_ref()?;
    if path.exists() {
        return Err("Download destination already exists".into());
    }
    let partial = path.with_extension("partial");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let outcome = (|| -> Result<()> {
        let mut digest = Sha256::new();
        let mut total = 0;
        let mut buffer = vec![0; 65536];
        loop {
            let size = response.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            total += size as u64;
            if total > limit {
                return Err("Download exceeds its declared size".into());
            }
            digest.update(&buffer[..size]);
            file.write_all(&buffer[..size])?;
        }
        if total != limit || hex::encode(digest.finalize()) != expected {
            return Err("Download checksum or size mismatch".into());
        }
        file.sync_all()?;
        Ok(())
    })();
    drop(file);
    if let Err(error) = outcome {
        let _ = fs::remove_file(&partial);
        return Err(error);
    }
    if path.exists() {
        return Err("Download destination already exists".into());
    }
    fs::rename(partial, path)?;
    Ok(())
}

pub fn file_hash(path: &Path) -> Result<String> {
    let mut digest = Sha256::new();
    let mut file = File::open(path)?;
    let mut buffer = vec![0; 65536];
    loop {
        let size = file.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    fn response(bytes: &'static [u8]) -> Response {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request).unwrap();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            socket.write_all(bytes).unwrap();
        });
        Client::new()
            .get(format!("http://{address}"))
            .send()
            .unwrap()
    }
    #[test]
    fn download_never_commits_corrupt_truncated_or_oversized_payloads() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let path = root.join("package.zip");
        let digest = hex::encode(Sha256::digest(b"verified"));
        for (bytes, size) in [
            (b"tampered".as_slice(), 8),
            (b"short".as_slice(), 8),
            (b"too-long-payload".as_slice(), 8),
        ] {
            assert!(verified_download(response(bytes), &path, &digest, size).is_err());
            assert!(!path.exists());
            assert!(!path.with_extension("partial").exists());
        }
        verified_download(response(b"verified"), &path, &digest, 8).unwrap();
        assert_eq!(file_hash(&path).unwrap(), digest);
        assert_eq!(fs::read(&path).unwrap(), b"verified");
        fs::remove_dir_all(root).unwrap();
    }
}
