use atomic_write_file::AtomicWriteFile;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use vaults_crypto::ecf1::{Core, KeyHandle};

const MAX_RECORD: u64 = 48 * 1024;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsData {
    pub version: u32,
    #[serde(default)]
    pub names: BTreeMap<String, String>,
    #[serde(default)]
    pub collections: Vec<Collection>,
    #[serde(default)]
    pub default_view: Option<View>,
    #[serde(default)]
    pub removal_preference: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub vault_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    content = "id",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum View {
    All,
    Vault(String),
    Collection(String),
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PendingSettings {
    pub base_revision: Option<String>,
    pub envelope: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsRecord {
    pub version: u32,
    pub remote_revision: Option<String>,
    pub verified_envelope: Option<String>,
    pub pending: Option<PendingSettings>,
}

impl Default for SettingsRecord {
    fn default() -> Self {
        Self {
            version: 1,
            remote_revision: None,
            verified_envelope: None,
            pending: None,
        }
    }
}

impl Default for View {
    fn default() -> Self {
        Self::All
    }
}

impl SettingsData {
    pub fn empty() -> Self {
        Self {
            version: 1,
            ..Self::default()
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.names.len() > 256 || self.collections.len() > 64 {
            return Err("vault settings are invalid".to_owned());
        }
        for (id, name) in &self.names {
            if uuid::Uuid::parse_str(id).is_err()
                || name.trim().is_empty()
                || name.chars().count() > 80
            {
                return Err("vault settings are invalid".to_owned());
            }
        }
        let mut ids = std::collections::HashSet::new();
        for collection in &self.collections {
            if uuid::Uuid::parse_str(&collection.id).is_err()
                || !ids.insert(&collection.id)
                || collection.name.trim().is_empty()
                || collection.name.chars().count() > 80
                || collection.vault_ids.len() > 256
                || collection
                    .vault_ids
                    .iter()
                    .any(|id| uuid::Uuid::parse_str(id).is_err())
            {
                return Err("vault settings are invalid".to_owned());
            }
        }
        if self
            .removal_preference
            .as_deref()
            .is_some_and(|value| !matches!(value, "move" | "archive"))
        {
            return Err("vault settings are invalid".to_owned());
        }
        Ok(())
    }
}

pub struct SettingsStore {
    path: PathBuf,
}
impl SettingsStore {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join("vault-settings.json"),
        }
    }
    pub fn load(&self) -> Result<SettingsRecord, String> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SettingsRecord::default());
            }
            Err(_) => return Err("vault settings are unavailable".to_owned()),
        };
        if file
            .metadata()
            .map_err(|_| "vault settings are unavailable")?
            .len()
            > MAX_RECORD
        {
            return Err("vault settings exceed the size limit".to_owned());
        }
        let mut bytes = Vec::new();
        file.take(MAX_RECORD + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "vault settings are unavailable")?;
        if bytes.len() as u64 > MAX_RECORD {
            return Err("vault settings exceed the size limit".to_owned());
        }
        let record: SettingsRecord =
            serde_json::from_slice(&bytes).map_err(|_| "vault settings are invalid".to_owned())?;
        if record.version != 1
            || record.remote_revision.is_some() != record.verified_envelope.is_some()
            || record
                .verified_envelope
                .as_deref()
                .map(revision)
                .transpose()?
                != record.remote_revision
            || record.pending.as_ref().is_some_and(|p| {
                p.base_revision != record.remote_revision || revision(&p.envelope).is_err()
            })
        {
            return Err("vault settings are invalid".to_owned());
        }
        Ok(record)
    }
    pub fn commit(&self, record: &SettingsRecord) -> Result<(), String> {
        let bytes =
            serde_json::to_vec(record).map_err(|_| "vault settings could not be encoded")?;
        if bytes.len() as u64 > MAX_RECORD {
            return Err("vault settings exceed the size limit".to_owned());
        }
        fs::create_dir_all(self.path.parent().ok_or("vault settings path is invalid")?)
            .map_err(|_| "vault settings are unavailable")?;
        let mut file =
            AtomicWriteFile::open(&self.path).map_err(|_| "vault settings are unavailable")?;
        file.write_all(&bytes)
            .map_err(|_| "vault settings could not be saved")?;
        file.commit()
            .map_err(|_| "vault settings could not be saved".to_owned())
    }
}

pub fn revision(envelope: &str) -> Result<String, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(envelope)
        .map_err(|_| "vault settings envelope is invalid")?;
    let raw: [u8; 16] = bytes
        .get(76..92)
        .ok_or("vault settings envelope is invalid")?
        .try_into()
        .map_err(|_| "vault settings envelope is invalid")?;
    Ok(uuid::Uuid::from_bytes(raw).to_string())
}

pub fn decrypt(core: &Core, root: KeyHandle, envelope: &str) -> Result<SettingsData, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(envelope)
        .map_err(|_| "vault settings envelope is invalid")?;
    let plain = core
        .decrypt_account_settings(root, &bytes)
        .map_err(|_| "vault settings authentication failed")?;
    let data: SettingsData =
        serde_json::from_slice(&plain).map_err(|_| "vault settings are invalid")?;
    data.validate()?;
    Ok(data)
}

pub fn encrypt(core: &Core, root: KeyHandle, data: &SettingsData) -> Result<String, String> {
    data.validate()?;
    let plain = serde_json::to_vec(data).map_err(|_| "vault settings could not be encoded")?;
    let encrypted = core
        .encrypt_account_settings(root, &plain)
        .map_err(|_| "vault settings encryption failed")?;
    Ok(URL_SAFE_NO_PAD.encode(encrypted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_pending_settings_survive_restart_and_reject_tampering() {
        let mut template = [0u8; 77];
        template[0] = 1;
        for offset in [1, 17] {
            template[offset..offset + 16].fill(if offset == 1 { 1 } else { 2 });
            template[offset + 6] = 0x40;
            template[offset + 8] = 0x80;
        }
        template[65..69].copy_from_slice(&1u32.to_be_bytes());
        template[69..77].copy_from_slice(&1u64.to_be_bytes());
        let mut core = Core::new();
        let root = core
            .create_root(&template, b"fixture-password", &[9; 32])
            .unwrap()
            .handle
            .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut data = SettingsData::empty();
        data.names.insert(id, "Banking".to_owned());
        let envelope = encrypt(&core, root, &data).unwrap();
        let directory =
            std::env::temp_dir().join(format!("127vaults-settings-test-{}", uuid::Uuid::new_v4()));
        let store = SettingsStore::new(&directory);
        let record = SettingsRecord {
            version: 1,
            remote_revision: None,
            verified_envelope: None,
            pending: Some(PendingSettings {
                base_revision: None,
                envelope: envelope.clone(),
            }),
        };
        store.commit(&record).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(
            decrypt(&core, root, &loaded.pending.unwrap().envelope)
                .unwrap()
                .names,
            data.names
        );
        let mut bytes = URL_SAFE_NO_PAD.decode(envelope).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        assert!(decrypt(&core, root, &URL_SAFE_NO_PAD.encode(bytes)).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
