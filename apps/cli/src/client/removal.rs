use crate::vault_settings::{self, SettingsData};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Write as _, path::Path};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VaultRemovalJournal {
    pub(super) source_vault_id: String,
    pub(super) choice: String,
    #[serde(default)]
    pub(super) destination_vault_id: Option<String>,
    #[serde(default)]
    pub(super) source_catalogue_revision: Option<String>,
    #[serde(default)]
    pub(super) item_mappings: Vec<ItemMoveMapping>,
    pub(super) request: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ItemMoveMapping {
    pub(super) source_item_id: String,
    pub(super) destination_item_id: String,
}

pub(super) fn removal_journal_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("vault-removal.json")
}

pub(super) fn save_removal_journal(
    config_dir: &Path,
    journal: &VaultRemovalJournal,
) -> Result<(), String> {
    journal.validate()?;
    let path = removal_journal_path(config_dir);
    let bytes = serde_json::to_vec(journal).map_err(|_| "vault removal could not be prepared")?;
    if bytes.len() > 32 * 1024 {
        return Err("vault removal journal is too large".to_owned());
    }
    let mut file = atomic_write_file::AtomicWriteFile::open(path)
        .map_err(|_| "vault removal journal is unavailable")?;
    file.write_all(&bytes)
        .map_err(|_| "vault removal journal could not be saved")?;
    file.commit()
        .map_err(|_| "vault removal journal could not be saved".to_owned())
}

pub(super) fn load_removal_journal(
    config_dir: &Path,
) -> Result<Option<VaultRemovalJournal>, String> {
    match fs::read(removal_journal_path(config_dir)) {
        Ok(bytes) => {
            if bytes.len() > 32 * 1024 {
                return Err("vault removal journal is too large".to_owned());
            }
            let journal: VaultRemovalJournal = serde_json::from_slice(&bytes)
                .map_err(|_| "vault removal journal is invalid".to_owned())?;
            journal.validate()?;
            Ok(Some(journal))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("vault removal journal is unavailable".to_owned()),
    }
}

impl VaultRemovalJournal {
    pub(super) fn validate(&self) -> Result<(), String> {
        let invalid = || "vault removal journal is invalid".to_owned();
        uuid::Uuid::parse_str(&self.source_vault_id).map_err(|_| invalid())?;
        match self.choice.as_str() {
            "archive" | "restore"
                if self.destination_vault_id.is_none()
                    && self.item_mappings.is_empty()
                    && self.request.is_object() =>
            {
                Ok(())
            }
            "move" => {
                let destination = self.destination_vault_id.as_deref().ok_or_else(invalid)?;
                uuid::Uuid::parse_str(destination).map_err(|_| invalid())?;
                if destination == self.source_vault_id
                    || self
                        .source_catalogue_revision
                        .as_deref()
                        .is_none_or(|revision| uuid::Uuid::parse_str(revision).is_err())
                    || self.item_mappings.len() > 100
                    || !(self.request.is_null() || self.request.is_object())
                {
                    return Err(invalid());
                }
                let mut sources = std::collections::HashSet::new();
                let mut destinations = std::collections::HashSet::new();
                for mapping in &self.item_mappings {
                    uuid::Uuid::parse_str(&mapping.source_item_id).map_err(|_| invalid())?;
                    uuid::Uuid::parse_str(&mapping.destination_item_id).map_err(|_| invalid())?;
                    if !sources.insert(&mapping.source_item_id)
                        || !destinations.insert(&mapping.destination_item_id)
                    {
                        return Err(invalid());
                    }
                }
                Ok(())
            }
            _ => Err(invalid()),
        }
    }
}

pub(super) fn settings_after_archive(mut settings: SettingsData, source: &str) -> SettingsData {
    for collection in &mut settings.collections {
        collection.vault_ids.retain(|id| id != source);
    }
    settings
        .collections
        .retain(|collection| !collection.vault_ids.is_empty());
    if matches!(&settings.default_view, Some(vault_settings::View::Vault(id)) if id == source)
        || matches!(&settings.default_view, Some(vault_settings::View::Collection(id)) if !settings.collections.iter().any(|collection| &collection.id == id))
    {
        settings.default_view = None;
    }
    settings
}

pub(super) fn settings_after_move(
    mut settings: SettingsData,
    source: &str,
    destination: &str,
) -> SettingsData {
    for collection in &mut settings.collections {
        for id in &mut collection.vault_ids {
            if id == source {
                destination.clone_into(id);
            }
        }
        collection.vault_ids.sort();
        collection.vault_ids.dedup();
    }
    if matches!(&settings.default_view, Some(vault_settings::View::Vault(id)) if id == source) {
        settings.default_view = Some(vault_settings::View::Vault(destination.to_owned()));
    }
    settings
}
