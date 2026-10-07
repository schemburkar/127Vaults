#![allow(clippy::missing_errors_doc, clippy::must_use_candidate)]
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FORMAT_VERSION: u32 = 1;
const MAX_REPLICA_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReplicaItem {
    pub item_id: String,
    pub index: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PendingMutation {
    pub operation: Value,
    pub request: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_catalogue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_item: Option<ReplicaItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Replica {
    pub version: u32,
    pub tenant_id: String,
    pub vault_id: String,
    #[serde(default)]
    pub retired: bool,
    #[serde(default)]
    pub retirement_choice: Option<String>,
    pub epoch: u64,
    pub directory: String,
    pub vault_envelope: String,
    pub catalogue: String,
    pub cursor: u64,
    #[serde(default)]
    pub last_verified_sync_at: Option<u64>,
    pub checkpoint: Option<Value>,
    #[serde(default)]
    pub checkpoint_public_key: Option<String>,
    pub operations: Vec<Value>,
    pub items: Vec<ReplicaItem>,
    pub pending: Vec<PendingMutation>,
    pub conflicts: Vec<Value>,
    pub sync_error: Option<String>,
}

impl Replica {
    pub fn new(tenant_id: String, vault_id: String, epoch: u64) -> Self {
        Self {
            version: FORMAT_VERSION,
            tenant_id,
            vault_id,
            retired: false,
            retirement_choice: None,
            epoch,
            directory: String::new(),
            vault_envelope: String::new(),
            catalogue: String::new(),
            cursor: 0,
            last_verified_sync_at: None,
            checkpoint: None,
            checkpoint_public_key: None,
            operations: Vec::new(),
            items: Vec::new(),
            pending: Vec::new(),
            conflicts: Vec::new(),
            sync_error: None,
        }
    }

    /// Quarantine a stale mutation without losing its signed request. The
    /// marker contains identifiers only; encrypted request bytes stay pending.
    pub fn mark_stale(&mut self, operation: &Value, item_id: &str) {
        let op_id = &operation["opId"];
        if self
            .conflicts
            .iter()
            .any(|row| row["operationId"] == *op_id)
        {
            return;
        }
        self.conflicts.push(serde_json::json!({
            "version":1,"kind":"stale-causal-base",
            "vaultId":self.vault_id,"itemId":item_id,
            "operationId":op_id,"causalBase":operation["causalBase"],
            "remoteCursor":self.cursor
        }));
    }

    fn validate(&self, expected_vault: &str) -> Result<(), String> {
        if self.version != FORMAT_VERSION {
            return Err("replica version is unsupported".to_owned());
        }
        if self.vault_id != expected_vault || uuid::Uuid::parse_str(&self.vault_id).is_err() {
            return Err("replica identity is invalid".to_owned());
        }
        if uuid::Uuid::parse_str(&self.tenant_id).is_err() || self.epoch == 0 {
            return Err("replica identity is invalid".to_owned());
        }
        if self
            .items
            .iter()
            .any(|item| uuid::Uuid::parse_str(&item.item_id).is_err())
        {
            return Err("replica item identity is invalid".to_owned());
        }
        Ok(())
    }
}

pub fn verify_remote_progress(
    previous: &Replica,
    checkpoint: Option<&Value>,
    cursor: u64,
) -> Result<(), String> {
    let checkpoint_cursor = checkpoint
        .and_then(|value| value["cursor"].as_u64())
        .unwrap_or(cursor);
    let previous_checkpoint_cursor = previous
        .checkpoint
        .as_ref()
        .and_then(|value| value["cursor"].as_u64())
        .unwrap_or(0);
    if cursor < previous.cursor
        || checkpoint_cursor < previous_checkpoint_cursor
        || (previous.checkpoint.is_some() && checkpoint.is_none())
    {
        return Err("checkpoint rollback or fork detected; local replica was preserved".to_owned());
    }
    if let (Some(old), Some(next)) = (previous.checkpoint.as_ref(), checkpoint)
        && next != old
        && next["previousCheckpointHash"]
            != vaults_protocol::signed_sync::checkpoint_hash(old).map_err(str::to_owned)?
    {
        return Err("checkpoint rollback or fork detected; local replica was preserved".to_owned());
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct ReplicaStore {
    directory: PathBuf,
}

impl ReplicaStore {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            directory: config_dir.join("replicas"),
        }
    }

    fn path(&self, vault_id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(vault_id).map_err(|_| "invalid vault identity".to_owned())?;
        Ok(self.directory.join(format!("{vault_id}.json")))
    }

    pub fn load(&self, vault_id: &str) -> Result<Option<Replica>, String> {
        let path = self.path(vault_id)?;
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("replica could not be opened".to_owned()),
        };
        if file
            .metadata()
            .map_err(|_| "replica could not be inspected")?
            .len()
            > MAX_REPLICA_BYTES
        {
            return Err("replica exceeds the size limit".to_owned());
        }
        let mut bytes = Vec::new();
        file.take(MAX_REPLICA_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "replica could not be read".to_owned())?;
        if bytes.len() as u64 > MAX_REPLICA_BYTES {
            return Err("replica exceeds the size limit".to_owned());
        }
        let replica: Replica =
            serde_json::from_slice(&bytes).map_err(|_| "replica is invalid".to_owned())?;
        replica.validate(vault_id)?;
        Ok(Some(replica))
    }

    pub fn list(&self) -> Result<Vec<Replica>, String> {
        let entries = match fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("replica directory is unavailable".to_owned()),
        };
        let mut replicas = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| "replica directory is invalid")?;
            let name = entry.file_name();
            let Some(vault_id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            replicas.push(
                self.load(vault_id)?
                    .ok_or("replica disappeared while loading")?,
            );
        }
        Ok(replicas)
    }

    pub fn commit(&self, replica: &Replica) -> Result<(), String> {
        replica.validate(&replica.vault_id)?;
        let bytes = serde_json::to_vec(replica).map_err(|_| "replica could not be encoded")?;
        if bytes.len() as u64 > MAX_REPLICA_BYTES {
            return Err("replica exceeds the size limit".to_owned());
        }
        fs::create_dir_all(&self.directory).map_err(|_| "replica directory is unavailable")?;
        let path = self.path(&replica.vault_id)?;
        let mut file =
            AtomicWriteFile::open(path).map_err(|_| "replica temporary file is unavailable")?;
        file.write_all(&bytes)
            .map_err(|_| "replica could not be committed")?;
        file.commit()
            .map_err(|_| "replica could not be replaced".to_owned())
    }

    pub fn update<T>(
        &self,
        vault_id: &str,
        change: impl FnOnce(&mut Replica) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut replica = self.load(vault_id)?.ok_or("local replica is unavailable")?;
        let result = change(&mut replica)?;
        self.commit(&replica)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_store() -> (PathBuf, ReplicaStore) {
        let root =
            std::env::temp_dir().join(format!("127vaults-replica-test-{}", uuid::Uuid::new_v4()));
        (root.clone(), ReplicaStore::new(&root))
    }

    #[test]
    fn round_trips_versioned_ciphertext_replica() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        let replica = Replica::new(uuid::Uuid::new_v4().to_string(), vault.clone(), 1);
        store.commit(&replica).unwrap();
        assert_eq!(store.load(&vault).unwrap(), Some(replica));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_replica_without_sync_time_remains_readable() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        let replica = Replica::new(uuid::Uuid::new_v4().to_string(), vault.clone(), 1);
        let mut value = serde_json::to_value(&replica).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("last_verified_sync_at");
        fs::create_dir_all(root.join("replicas")).unwrap();
        fs::write(
            root.join("replicas").join(format!("{vault}.json")),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        assert_eq!(
            store.load(&vault).unwrap().unwrap().last_verified_sync_at,
            None
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_fields_and_versions() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        fs::create_dir_all(root.join("replicas")).unwrap();
        fs::write(root.join("replicas").join(format!("{vault}.json")), format!(r#"{{"version":2,"tenant_id":"{}","vault_id":"{vault}","epoch":1,"directory":"","vault_envelope":"","catalogue":"","cursor":0,"checkpoint":null,"operations":[],"items":[],"pending":[],"conflicts":[],"sync_error":null,"surprise":true}}"#, uuid::Uuid::new_v4())).unwrap();
        assert!(store.load(&vault).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_update_preserves_last_committed_replica() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        let replica = Replica::new(uuid::Uuid::new_v4().to_string(), vault.clone(), 1);
        store.commit(&replica).unwrap();
        assert!(
            store
                .update::<()>(&vault, |candidate| {
                    candidate.cursor = 9;
                    Err("conflict".to_owned())
                })
                .is_err()
        );
        assert_eq!(store.load(&vault).unwrap().unwrap().cursor, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_update_atomically_replaces_an_existing_replica() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        store
            .commit(&Replica::new(
                uuid::Uuid::new_v4().to_string(),
                vault.clone(),
                1,
            ))
            .unwrap();
        store
            .update(&vault, |candidate| {
                candidate.cursor = 7;
                Ok(())
            })
            .unwrap();
        assert_eq!(store.load(&vault).unwrap().unwrap().cursor, 7);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_and_same_cursor_checkpoint_forks_are_rejected() {
        let vault = uuid::Uuid::new_v4().to_string();
        let mut old = Replica::new(uuid::Uuid::new_v4().to_string(), vault, 1);
        old.cursor = 4;
        old.checkpoint = Some(
            serde_json::json!({"protocolVersion":1,"tenantId":old.tenant_id,"vaultId":old.vault_id,"epoch":1,"cursor":4,"previousCheckpointHash":"genesis","operationHeadHash":"head","signature":"old"}),
        );
        let old_hash =
            vaults_protocol::signed_sync::checkpoint_hash(old.checkpoint.as_ref().unwrap())
                .unwrap();
        assert!(
            verify_remote_progress(
                &old,
                Some(&serde_json::json!({"cursor":3,"signature":"older"})),
                3
            )
            .is_err()
        );
        assert!(
            verify_remote_progress(
                &old,
                Some(&serde_json::json!({"cursor":4,"signature":"fork"})),
                4
            )
            .is_err()
        );
        assert!(
            verify_remote_progress(
                &old,
                Some(&serde_json::json!({"cursor":5,"previousCheckpointHash":old_hash,"signature":"next"})),
                5
            )
            .is_ok()
        );
        assert!(verify_remote_progress(&old, Some(&serde_json::json!({"cursor":4,"previousCheckpointHash":old_hash,"signature":"next"})), 4).is_ok());
        assert!(verify_remote_progress(&old, None, 4).is_err());
        let mut ahead = old.clone();
        ahead.cursor = 5;
        assert!(verify_remote_progress(&ahead, ahead.checkpoint.as_ref(), 6).is_ok());
    }

    #[test]
    fn stale_marker_preserves_exact_pending_request_across_restart() {
        let (root, store) = temporary_store();
        let vault = uuid::Uuid::new_v4().to_string();
        let item = uuid::Uuid::new_v4().to_string();
        let mut replica = Replica::new(uuid::Uuid::new_v4().to_string(), vault.clone(), 1);
        let operation = serde_json::json!({"opId":"stable-id","causalBase":4});
        let request = serde_json::json!({"requestId":"stable-request","body":"ciphertext"});
        replica.pending.push(PendingMutation {
            operation: operation.clone(),
            request: request.clone(),
            base_catalogue: Some("encrypted-catalogue".to_owned()),
            base_item: Some(ReplicaItem {
                item_id: item.clone(),
                index: "encrypted-index".to_owned(),
                body: "encrypted-body".to_owned(),
                created_at: None,
                updated_at: None,
            }),
        });
        replica.mark_stale(&operation, &item);
        replica.mark_stale(&operation, &item);
        store.commit(&replica).unwrap();
        let restored = store.load(&vault).unwrap().unwrap();
        assert_eq!(restored.pending[0].request, request);
        assert_eq!(
            restored.pending[0].base_item.as_ref().unwrap().body,
            "encrypted-body"
        );
        assert_eq!(restored.conflicts.len(), 1);
        assert_eq!(restored.conflicts[0]["itemId"], item);
        assert!(
            !serde_json::to_string(&restored.conflicts)
                .unwrap()
                .contains("ciphertext")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
