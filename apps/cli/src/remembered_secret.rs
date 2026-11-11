//! Optional account-secret convenience. The secret and its expiry stay in the OS store.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: &str = "127Vaults CLI remembered account secret";
const TTL: u64 = 30 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    binding: String,
    expires_at: u64,
    secret: String,
}
impl Drop for Record {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn binding(config: &Path, username: &str) -> Result<String, String> {
    let directory = std::fs::canonicalize(config).map_err(|_| "Profile is unavailable")?;
    let trust = config.join("trust.conf");
    let device = config.join("device.conf");
    let fields = serde_json::to_vec(&serde_json::json!([
        directory,
        super::file_profile_value(&trust, "url")?,
        super::file_profile_value(&trust, "server_id")?,
        super::file_profile_value(&device, "device_id")?,
        username,
    ]))
    .map_err(|_| "Profile identity is invalid")?;
    Ok(hex::encode(Sha256::digest(fields)))
}
fn decode(bytes: &[u8], expected: &str, at: u64) -> Option<Record> {
    if bytes.len() > 2048 {
        return None;
    }
    let record: Record = serde_json::from_slice(bytes).ok()?;
    (record.version == 1
        && record.binding == expected
        && record.expires_at > at
        && record.expires_at <= at.saturating_add(TTL)
        && record.secret.len() == 64
        && record.secret.bytes().all(|b| b.is_ascii_hexdigit()))
    .then_some(record)
}
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
fn entry(binding: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, binding)
        .map_err(|_| "OS credential storage is unavailable".to_owned())
}

/// Read only an unexpired, identity-bound OS-protected secret. There is no file fallback.
///
/// # Errors
/// Fails when the profile identity or OS credential store is unavailable.
pub fn load(config: &Path, username: &str) -> Result<Option<Zeroizing<String>>, String> {
    let expected = binding(config, username)?;
    let entry = entry(&expected)?;
    let bytes = match entry.get_secret() {
        Ok(value) => Zeroizing::new(value),
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("OS credential storage is unavailable".to_owned()),
    };
    let Some(mut record) = decode(&bytes, &expected, now()) else {
        let _ = entry.delete_credential();
        return Ok(None);
    };
    Ok(Some(Zeroizing::new(std::mem::take(&mut record.secret))))
}

/// Remember a successfully verified account secret for at most thirty days.
///
/// # Errors
/// Fails closed if protection is unavailable; never writes a plaintext secret file.
pub fn remember(config: &Path, username: &str, secret: &str) -> Result<(), String> {
    if secret.len() != 64 || !secret.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Account secret must be 64 hexadecimal characters".to_owned());
    }
    let binding = binding(config, username)?;
    let record = Record {
        version: 1,
        binding: binding.clone(),
        expires_at: now().saturating_add(TTL),
        secret: secret.to_owned(),
    };
    let bytes = Zeroizing::new(
        serde_json::to_vec(&record).map_err(|_| "Could not protect account secret")?,
    );
    entry(&binding)?
        .set_secret(&bytes)
        .map_err(|_| "Account secret could not be protected by the OS".to_owned())
}

/// Delete this profile/account's remembered secret without deleting vault data.
///
/// # Errors
/// Reports an unavailable profile/store or an unconfirmed deletion.
pub fn forget(config: &Path, username: &str) -> Result<(), String> {
    match entry(&binding(config, username)?)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Account secret removal could not be confirmed".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "uses a disposable entry in the real OS credential store"]
    fn os_store_remember_expire_and_forget_never_creates_a_secret_file() {
        let directory =
            std::env::temp_dir().join(format!("127v-secret-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(
            directory.join("trust.conf"),
            "url=https://127.0.0.1:12780\nserver_id=fictitious-server\n",
        )
        .unwrap();
        std::fs::write(
            directory.join("device.conf"),
            "device_id=fictitious-device\nusername=Fixture\n",
        )
        .unwrap();
        let binding = binding(&directory, "Fixture").unwrap();
        let store = entry(&binding).unwrap();
        assert!(load(&directory, "Fixture").unwrap().is_none());
        remember(&directory, "Fixture", &"ab".repeat(32)).unwrap();
        assert_eq!(
            load(&directory, "Fixture").unwrap().unwrap().as_str(),
            "ab".repeat(32)
        );
        assert!(load(&directory, "Other").unwrap().is_none());
        let expired = Record {
            version: 1,
            binding,
            expires_at: now() - 1,
            secret: "ab".repeat(32),
        };
        store
            .set_secret(&serde_json::to_vec(&expired).unwrap())
            .unwrap();
        assert!(load(&directory, "Fixture").unwrap().is_none());
        assert!(matches!(store.get_secret(), Err(keyring::Error::NoEntry)));
        remember(&directory, "Fixture", &"cd".repeat(32)).unwrap();
        forget(&directory, "Fixture").unwrap();
        assert!(load(&directory, "Fixture").unwrap().is_none());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 2);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn protected_record_enforces_expiry_identity_and_bounds() {
        let record = Record {
            version: 1,
            binding: "profile-one".to_owned(),
            expires_at: 100 + TTL,
            secret: "ab".repeat(32),
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&record).unwrap());
        assert!(decode(&bytes, "profile-one", 100).is_some());
        assert!(decode(&bytes, "profile-two", 100).is_none());
        assert!(decode(&bytes, "profile-one", 100 + TTL).is_none());
        assert!(decode(&bytes, "profile-one", 99).is_none());
        assert!(decode(&vec![b' '; 2049], "profile-one", 100).is_none());
        assert!(decode(br#"{"secret":"invalid"}"#, "profile-one", 100).is_none());
    }
}
