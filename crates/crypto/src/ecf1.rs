//! Disposable ECF1 implementation. Never use with real credentials or durable data.
#![allow(clippy::many_single_char_names)]
use crate::private_vault::{
    Catalogue, CatalogueEntry, Directory, DirectoryEntry, RecordError, random_revision, sha256,
};
use argon2::{Algorithm, Argon2, Block, Params, Version};
use chacha20poly1305::{AeadInOut, KeyInit, XChaCha20Poly1305};
use hkdf::Hkdf;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"127VEXP\0";
const HEADER: usize = 157;
const CONTEXT: usize = 93;
const TEMPLATE: usize = 77;
const MAX_ENVELOPE: usize = 1_048_749;
const MAX_HANDLES: usize = 32;
const MAX_CREATIONS: u16 = 1_000;
const ARGON_BLOCKS: usize = 65_536;
const AAD_LABEL: &[u8] = b"127Vaults/ECF1/envelope\0";

/// Frozen bytes for the disposable ECF1 item interoperability fixture.
///
/// The inputs are compile-time fictitious values. This is safe to run on native
/// and WASM targets, but it does not approve ECF1 for real secrets.
#[must_use]
/// # Panics
/// Panics only if the frozen, compile-time-valid test-vector parameters become invalid.
pub fn deterministic_item_vector() -> Vec<u8> {
    let mut context = [0u8; CONTEXT];
    context[0] = 3;
    context[1..17].copy_from_slice(&fixture_uuid(1));
    context[33..49].copy_from_slice(&fixture_uuid(3));
    context[49..65].copy_from_slice(&fixture_uuid(4));
    context[65..81].copy_from_slice(&fixture_uuid(5));
    context[81..85].copy_from_slice(&1u32.to_be_bytes());
    context[85..93].copy_from_slice(&1u64.to_be_bytes());
    let key = derive(
        &[7; 32],
        b"127Vaults/ECF1/vault-subkeys",
        b"127Vaults/ECF1/item-body\0",
        &context,
    )
    .expect("frozen HKDF inputs are valid");
    seal_with_nonce(&context, &[0; 16], 0, 0, 0, &key, b"vector", &[6; 24])
        .expect("frozen ECF1 vector inputs are valid")
}

const fn fixture_uuid(seed: u8) -> [u8; 16] {
    let mut value = [seed; 16];
    value[6] = 0x40;
    value[8] = 0x80;
    value
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidInput,
    UnsupportedFormat,
    ContextMismatch,
    AuthenticationFailed,
    InvalidHandle,
    LimitExceeded,
    Busy,
    EntropyUnavailable,
    Cancelled,
    InternalError,
}

impl Error {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_INPUT",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::ContextMismatch => "CONTEXT_MISMATCH",
            Self::AuthenticationFailed => "AUTHENTICATION_FAILED",
            Self::InvalidHandle => "INVALID_HANDLE",
            Self::LimitExceeded => "LIMIT_EXCEEDED",
            Self::Busy => "BUSY",
            Self::EntropyUnavailable => "ENTROPY_UNAVAILABLE",
            Self::Cancelled => "CANCELLED",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct KeyHandle {
    instance: u64,
    id: u64,
}

static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    Root,
    Vault,
}

struct KeyEntry {
    bytes: Zeroizing<[u8; 32]>,
    kind: Kind,
    tenant: [u8; 16],
    account: [u8; 16],
    vault: [u8; 16],
    epoch: u64,
}

#[derive(Debug)]
pub struct Created {
    pub context: [u8; CONTEXT],
    pub envelope: Vec<u8>,
    pub handle: Option<KeyHandle>,
}
pub struct PrivateVaultCreated {
    pub vault: Created,
    pub directory: Vec<u8>,
    pub catalogue: Vec<u8>,
}
pub struct PrivateItemCreated {
    pub item: [u8; 16],
    pub catalogue: Vec<u8>,
    pub index: Vec<u8>,
    pub body: Vec<u8>,
}

pub struct Core {
    keys: BTreeMap<KeyHandle, KeyEntry>,
    instance: u64,
    next: u64,
    creations: u16,
    busy: bool,
    generation: u64,
}

impl Default for Core {
    fn default() -> Self {
        Self::new()
    }
}
impl Core {
    #[must_use]
    pub fn new() -> Self {
        Self {
            keys: BTreeMap::new(),
            instance: NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed),
            next: 1,
            creations: 0,
            busy: false,
            generation: 0,
        }
    }
    pub fn lock(&mut self) {
        self.keys.clear();
        self.generation = self.generation.wrapping_add(1);
        self.busy = false;
    }
    /// Remaining encryptions in this core instance's bounded session budget.
    #[must_use]
    pub fn remaining_creation_budget(&self) -> u16 {
        MAX_CREATIONS.saturating_sub(self.creations)
    }
    /// # Errors
    /// Returns a bounded error for an absent or invalidated handle.
    pub fn release(&mut self, h: KeyHandle) -> Result<(), Error> {
        self.keys.remove(&h).map(drop).ok_or(Error::InvalidHandle)
    }

    /// # Errors
    /// Returns a bounded error when validation, entropy, allocation, or encryption fails.
    pub fn create_root(
        &mut self,
        template: &[u8],
        password: &[u8],
        account_secret: &[u8],
    ) -> Result<Created, Error> {
        if password.is_empty() || password.len() > 1024 || account_secret.len() != 32 {
            return Err(Error::InvalidInput);
        }
        let context = self.new_context(template, 1)?;
        let mut salt = [0u8; 16];
        fill(&mut salt)?;
        let mut root = Zeroizing::new([0u8; 32]);
        fill(root.as_mut())?;
        let key = derive_root(password, account_secret, &salt, &context)?;
        let envelope = seal(&context, &salt, 65_536, 3, 1, &key, root.as_ref())?;
        let handle = self.insert(KeyEntry {
            bytes: root,
            kind: Kind::Root,
            tenant: id(&context, 1),
            account: id(&context, 17),
            vault: [0; 16],
            epoch: epoch(&context),
        })?;
        self.creations += 1;
        Ok(Created {
            context,
            envelope,
            handle: Some(handle),
        })
    }
    /// Rewrap an existing root under new credentials without changing its vault keys.
    ///
    /// # Errors
    /// Rejects scope changes, skipped/replayed epochs, invalid credentials or exhausted resources.
    pub fn rewrap_root(
        &mut self,
        root: KeyHandle,
        template: &[u8],
        password: &[u8],
        account_secret: &[u8],
    ) -> Result<Created, Error> {
        if password.is_empty() || password.len() > 1024 || account_secret.len() != 32 {
            return Err(Error::InvalidInput);
        }
        let context = self.new_context(template, 1)?;
        let entry = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        if entry.kind != Kind::Root
            || entry.tenant != id(&context, 1)
            || entry.account != id(&context, 17)
            || entry.epoch.checked_add(1) != Some(epoch(&context))
        {
            return Err(Error::ContextMismatch);
        }
        let bytes = entry.bytes.clone();
        let mut salt = [0_u8; 16];
        fill(&mut salt)?;
        let key = derive_root(password, account_secret, &salt, &context)?;
        let envelope = seal(&context, &salt, 65_536, 3, 1, &key, bytes.as_ref())?;
        let handle = self.insert(KeyEntry {
            bytes,
            kind: Kind::Root,
            tenant: id(&context, 1),
            account: id(&context, 17),
            vault: [0; 16],
            epoch: epoch(&context),
        })?;
        self.creations += 1;
        Ok(Created {
            context,
            envelope,
            handle: Some(handle),
        })
    }
    /// # Errors
    /// Returns a bounded error; authentication failures expose no details.
    pub fn unwrap_root(
        &mut self,
        envelope: &[u8],
        expected: &[u8],
        password: &[u8],
        account_secret: &[u8],
    ) -> Result<KeyHandle, Error> {
        if password.is_empty() || password.len() > 1024 || account_secret.len() != 32 {
            return Err(Error::InvalidInput);
        }
        let parsed = parse(envelope, expected, 1)?;
        let key = derive_root(password, account_secret, &parsed.salt, &parsed.context)?;
        let plain = open(&parsed, &key)?;
        let bytes = array32(&plain)?;
        self.insert(KeyEntry {
            bytes: Zeroizing::new(bytes),
            kind: Kind::Root,
            tenant: id(expected, 1),
            account: id(expected, 17),
            vault: [0; 16],
            epoch: epoch(expected),
        })
    }
    /// # Errors
    /// Returns a bounded error for invalid scope, limits, entropy, or encryption failure.
    pub fn create_vault(&mut self, root: KeyHandle, template: &[u8]) -> Result<Created, Error> {
        let context = self.new_context(template, 2)?;
        let entry = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        if entry.kind != Kind::Root
            || entry.tenant != id(&context, 1)
            || entry.account != id(&context, 17)
        {
            return Err(Error::InvalidHandle);
        }
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/root-subkeys",
            b"127Vaults/ECF1/vault-wrap\0",
            &context,
        )?;
        let mut vault = Zeroizing::new([0u8; 32]);
        fill(vault.as_mut())?;
        let envelope = seal(&context, &[0; 16], 0, 0, 0, &key, vault.as_ref())?;
        let handle = self.insert(KeyEntry {
            bytes: vault,
            kind: Kind::Vault,
            tenant: id(&context, 1),
            account: id(&context, 17),
            vault: id(&context, 33),
            epoch: epoch(&context),
        })?;
        self.creations += 1;
        Ok(Created {
            context,
            envelope,
            handle: Some(handle),
        })
    }
    /// Appends a vault to an authenticated directory and creates its empty catalogue.
    /// # Errors
    /// Rejects an invalid empty directory, root scope, entropy failure, or record failure.
    pub fn create_private_vault(
        &mut self,
        root: KeyHandle,
        current_directory: &[u8],
    ) -> Result<PrivateVaultCreated, Error> {
        let r = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        let tenant = r.tenant;
        let account = r.account;
        let old = Directory::decode(current_directory, &r.bytes, tenant, account)
            .map_err(record_error)?;
        if old.entries.len() >= crate::private_vault::MAX_PRIVATE_VAULTS {
            return Err(Error::LimitExceeded);
        }
        let vault_id = random_revision().map_err(record_error)?;
        let mut t = [0u8; 77];
        t[0] = 2;
        t[1..17].copy_from_slice(&tenant);
        t[17..33].copy_from_slice(&account);
        t[33..49].copy_from_slice(&vault_id);
        t[49..65].copy_from_slice(&vault_id);
        t[65..69].copy_from_slice(&1u32.to_be_bytes());
        t[69..77].copy_from_slice(&1u64.to_be_bytes());
        let made = self.create_vault(root, &t)?;
        let h = made.handle.ok_or(Error::InternalError)?;
        let v = self.keys.get(&h).ok_or(Error::InternalError)?;
        let catalogue = Catalogue {
            tenant,
            vault: vault_id,
            epoch: 1,
            revision: random_revision().map_err(record_error)?,
            base: [0; 16],
            entries: Vec::new(),
        }
        .encode(&v.bytes)
        .map_err(record_error)?;
        let mut entries = old.entries;
        entries.push(DirectoryEntry {
            vault: vault_id,
            epoch: 1,
            envelope_revision: made.context[65..81]
                .try_into()
                .map_err(|_| Error::InternalError)?,
            envelope_sha256: sha256(&made.envelope),
        });
        entries.sort_by_key(|entry| entry.vault);
        let directory = Directory {
            tenant,
            account,
            revision: random_revision().map_err(record_error)?,
            base: old.revision,
            entries,
        }
        .encode(&self.keys.get(&root).ok_or(Error::InvalidHandle)?.bytes)
        .map_err(record_error)?;
        Ok(PrivateVaultCreated {
            vault: made,
            directory,
            catalogue,
        })
    }

    /// Adds an already password-root-wrapped offline vault to a newer directory.
    /// The wrapped key and vault ID are preserved, so queued item ciphertexts
    /// remain usable when another device concurrently creates a vault.
    /// # Errors
    /// Rejects an unauthenticated envelope/directory, duplicate vault, or limit.
    pub fn rebase_private_vault(
        &mut self,
        root: KeyHandle,
        current_directory: &[u8],
        envelope: &[u8],
    ) -> Result<Vec<u8>, Error> {
        let r = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        let old = Directory::decode(current_directory, &r.bytes, r.tenant, r.account)
            .map_err(record_error)?;
        let context: [u8; CONTEXT] = envelope
            .get(11..104)
            .ok_or(Error::InvalidInput)?
            .try_into()
            .map_err(|_| Error::InvalidInput)?;
        let vault_id = id(&context, 33);
        if old.entries.len() >= crate::private_vault::MAX_PRIVATE_VAULTS
            || old.entries.iter().any(|entry| entry.vault == vault_id)
            || id(&context, 49) != vault_id
            || epoch(&context) != 1
        {
            return Err(Error::InvalidInput);
        }
        let handle = self.unwrap_vault(root, envelope, &context)?;
        self.release(handle)?;
        let mut entries = old.entries;
        entries.push(DirectoryEntry {
            vault: vault_id,
            epoch: 1,
            envelope_revision: context[65..81]
                .try_into()
                .map_err(|_| Error::InternalError)?,
            envelope_sha256: sha256(envelope),
        });
        entries.sort_by_key(|entry| entry.vault);
        Directory {
            tenant: id(&context, 1),
            account: id(&context, 17),
            revision: random_revision().map_err(record_error)?,
            base: old.revision,
            entries,
        }
        .encode(&self.keys.get(&root).ok_or(Error::InvalidHandle)?.bytes)
        .map_err(record_error)
    }

    /// Opens one vault selected from an authenticated private directory.
    /// # Errors
    /// Rejects a directory, envelope, scope, revision, or digest mismatch.
    pub fn open_private_vault(
        &mut self,
        root: KeyHandle,
        directory: &[u8],
        vault_id: [u8; 16],
        envelope: &[u8],
    ) -> Result<Created, Error> {
        let r = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        let decoded =
            Directory::decode(directory, &r.bytes, r.tenant, r.account).map_err(record_error)?;
        let entry = decoded
            .entries
            .iter()
            .find(|entry| entry.vault == vault_id)
            .ok_or(Error::AuthenticationFailed)?;
        if sha256(envelope) != entry.envelope_sha256 {
            return Err(Error::AuthenticationFailed);
        }
        let mut context = [0u8; CONTEXT];
        context[0] = 2;
        context[1..17].copy_from_slice(&r.tenant);
        context[17..33].copy_from_slice(&r.account);
        context[33..49].copy_from_slice(&vault_id);
        context[49..65].copy_from_slice(&vault_id);
        context[65..81].copy_from_slice(&entry.envelope_revision);
        context[81..85].copy_from_slice(&1u32.to_be_bytes());
        context[85..93].copy_from_slice(&entry.epoch.to_be_bytes());
        drop(decoded);
        let handle = self.unwrap_vault(root, envelope, &context)?;
        Ok(Created {
            context,
            envelope: envelope.to_vec(),
            handle: Some(handle),
        })
    }
    /// Creates the authenticated empty account directory used during registration.
    /// # Errors
    /// Rejects an invalid root handle or unavailable entropy.
    pub fn create_empty_directory(&self, root: KeyHandle) -> Result<Vec<u8>, Error> {
        let r = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        Directory {
            tenant: r.tenant,
            account: r.account,
            revision: random_revision().map_err(record_error)?,
            base: [0; 16],
            entries: Vec::new(),
        }
        .encode(&r.bytes)
        .map_err(record_error)
    }
    /// Encrypts bounded account settings (vault labels and collections) with
    /// the user root key. The envelope carries its authenticated revision.
    ///
    /// # Errors
    /// Returns an error for an invalid root handle, oversized settings or encryption failure.
    pub fn encrypt_account_settings(
        &self,
        root: KeyHandle,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, Error> {
        let entry = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        if entry.kind != Kind::Root {
            return Err(Error::InvalidHandle);
        }
        let mut context = [0u8; CONTEXT];
        context[0] = 5;
        context[1..17].copy_from_slice(&entry.tenant);
        context[17..33].copy_from_slice(&entry.account);
        context[65..81].copy_from_slice(&random_revision().map_err(record_error)?);
        context[81..85].copy_from_slice(&1u32.to_be_bytes());
        context[85..93].copy_from_slice(&entry.epoch.to_be_bytes());
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/root-subkeys",
            b"127Vaults/ECF1/account-settings\0",
            &context,
        )?;
        seal(&context, &[0; 16], 0, 0, 0, &key, plaintext)
    }

    /// Authenticates and decrypts root-scoped settings from a stored envelope.
    ///
    /// # Errors
    /// Returns an error for an invalid root handle or unauthenticated envelope.
    pub fn decrypt_account_settings(
        &self,
        root: KeyHandle,
        envelope: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let entry = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        if entry.kind != Kind::Root || envelope.len() < HEADER {
            return Err(Error::InvalidHandle);
        }
        let context = envelope.get(11..104).ok_or(Error::InvalidInput)?;
        let parsed = parse(envelope, context, 5)?;
        if id(context, 1) != entry.tenant
            || id(context, 17) != entry.account
            || epoch(context) != entry.epoch
        {
            return Err(Error::ContextMismatch);
        }
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/root-subkeys",
            b"127Vaults/ECF1/account-settings\0",
            context,
        )?;
        open(&parsed, &key)
    }
    /// Encrypts and composes one complete create/update proposal in memory.
    /// # Errors
    /// Rejects invalid authenticated state, scope, mode, plaintext, or entropy.
    pub fn upsert_private_item(
        &mut self,
        vault: KeyHandle,
        old_catalogue: &[u8],
        item: Option<[u8; 16]>,
        index: &[u8],
        body: &[u8],
    ) -> Result<PrivateItemCreated, Error> {
        let item_id = match item {
            Some(existing) => existing,
            None => random_revision().map_err(record_error)?,
        };
        self.upsert_private_item_at_id(vault, old_catalogue, item_id, item.is_some(), index, body)
    }

    /// Encrypts a create at a caller-reserved random item ID, or an update at an existing ID.
    /// Reserving the ID before a multi-item move permits exact retry after interruption.
    /// # Errors
    /// Rejects an ID already present for create or absent for update, plus invalid state or input.
    pub fn upsert_private_item_at_id(
        &mut self,
        vault: KeyHandle,
        old_catalogue: &[u8],
        item_id: [u8; 16],
        update: bool,
        index: &[u8],
        body: &[u8],
    ) -> Result<PrivateItemCreated, Error> {
        let v = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        let tenant = v.tenant;
        let vault_id = v.vault;
        let ep = v.epoch;
        let mut old = Catalogue::decode(old_catalogue, &v.bytes, tenant, vault_id, ep)
            .map_err(record_error)?;
        let position = old.entries.iter().position(|e| e.item == item_id);
        if update != position.is_some() {
            return Err(Error::InvalidInput);
        }
        let template = |purpose: u8| {
            let mut t = [0u8; 77];
            t[0] = purpose;
            t[1..17].copy_from_slice(&tenant);
            t[33..49].copy_from_slice(&vault_id);
            t[49..65].copy_from_slice(&item_id);
            t[65..69].copy_from_slice(&1u32.to_be_bytes());
            t[69..77].copy_from_slice(&ep.to_be_bytes());
            t
        };
        let enc_index = self.encrypt_item(vault, &template(4), index)?;
        let enc_body = self.encrypt_item(vault, &template(3), body)?;
        let entry = CatalogueEntry {
            item: item_id,
            logical_revision: random_revision().map_err(record_error)?,
            index_revision: enc_index.context[65..81]
                .try_into()
                .map_err(|_| Error::InternalError)?,
            body_revision: enc_body.context[65..81]
                .try_into()
                .map_err(|_| Error::InternalError)?,
            index_length: u32::try_from(enc_index.envelope.len())
                .map_err(|_| Error::LimitExceeded)?,
            body_length: u32::try_from(enc_body.envelope.len())
                .map_err(|_| Error::LimitExceeded)?,
            index_sha256: sha256(&enc_index.envelope),
            body_sha256: sha256(&enc_body.envelope),
        };
        if let Some(p) = position {
            old.entries[p] = entry;
        } else {
            old.entries.push(entry);
            old.entries.sort_by_key(|e| e.item);
        }
        let base = old.revision;
        old.base = base;
        old.revision = random_revision().map_err(record_error)?;
        let catalogue = old
            .encode(&self.keys.get(&vault).ok_or(Error::InvalidHandle)?.bytes)
            .map_err(record_error)?;
        Ok(PrivateItemCreated {
            item: item_id,
            catalogue,
            index: enc_index.envelope,
            body: enc_body.envelope,
        })
    }
    /// Removes exactly one item from an authenticated catalogue.
    /// The returned catalogue advances the revision and preserves every sibling
    /// commitment. Existing ciphertext cannot be opened against this new state.
    /// # Errors
    /// Rejects an invalid handle, unauthenticated catalogue, or absent item.
    pub fn delete_private_item(
        &self,
        vault: KeyHandle,
        old_catalogue: &[u8],
        item: [u8; 16],
    ) -> Result<Vec<u8>, Error> {
        let key = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        if key.kind != Kind::Vault {
            return Err(Error::InvalidHandle);
        }
        let mut catalogue =
            Catalogue::decode(old_catalogue, &key.bytes, key.tenant, key.vault, key.epoch)
                .map_err(record_error)?;
        let position = catalogue
            .entries
            .iter()
            .position(|entry| entry.item == item)
            .ok_or(Error::InvalidInput)?;
        catalogue.entries.remove(position);
        catalogue.base = catalogue.revision;
        catalogue.revision = random_revision().map_err(record_error)?;
        catalogue.encode(&key.bytes).map_err(record_error)
    }

    /// Authenticates a catalogue, including an empty one, and returns its item IDs.
    /// # Errors
    /// Rejects an invalid vault handle, scope, catalogue encoding or authentication.
    pub fn verify_private_catalogue(
        &self,
        vault: KeyHandle,
        catalogue: &[u8],
    ) -> Result<Vec<[u8; 16]>, Error> {
        let key = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        if key.kind != Kind::Vault {
            return Err(Error::InvalidHandle);
        }
        let authenticated =
            Catalogue::decode(catalogue, &key.bytes, key.tenant, key.vault, key.epoch)
                .map_err(record_error)?;
        Ok(authenticated
            .entries
            .into_iter()
            .map(|entry| entry.item)
            .collect())
    }

    /// Authenticates an item against its vault catalogue and decrypts it.
    /// # Errors
    /// Rejects an invalid handle, catalogue, commitment, context or ciphertext.
    pub fn decrypt_private_part(
        &self,
        vault: KeyHandle,
        catalogue: &[u8],
        item: [u8; 16],
        envelope: &[u8],
        purpose: u8,
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let v = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        let m = Catalogue::decode(catalogue, &v.bytes, v.tenant, v.vault, v.epoch)
            .map_err(record_error)?;
        let e = m
            .entries
            .iter()
            .find(|e| e.item == item)
            .ok_or(Error::InvalidInput)?;
        let (length, digest, revision) = if purpose == 4 {
            (e.index_length, e.index_sha256, e.index_revision)
        } else if purpose == 3 {
            (e.body_length, e.body_sha256, e.body_revision)
        } else {
            return Err(Error::InvalidInput);
        };
        if usize::try_from(length).map_err(|_| Error::LimitExceeded)? != envelope.len()
            || sha256(envelope) != digest
        {
            return Err(Error::AuthenticationFailed);
        }
        let mut expected = [0u8; 93];
        expected[0] = purpose;
        expected[1..17].copy_from_slice(&v.tenant);
        expected[33..49].copy_from_slice(&v.vault);
        expected[49..65].copy_from_slice(&item);
        expected[65..81].copy_from_slice(&revision);
        expected[81..85].copy_from_slice(&1u32.to_be_bytes());
        expected[85..93].copy_from_slice(&v.epoch.to_be_bytes());
        self.decrypt_item(vault, envelope, &expected)
    }
    /// # Errors
    /// Returns a bounded error; authentication failures expose no details.
    pub fn unwrap_vault(
        &mut self,
        root: KeyHandle,
        envelope: &[u8],
        expected: &[u8],
    ) -> Result<KeyHandle, Error> {
        let parsed = parse(envelope, expected, 2)?;
        let entry = self.keys.get(&root).ok_or(Error::InvalidHandle)?;
        if entry.kind != Kind::Root
            || entry.tenant != id(expected, 1)
            || entry.account != id(expected, 17)
        {
            return Err(Error::InvalidHandle);
        }
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/root-subkeys",
            b"127Vaults/ECF1/vault-wrap\0",
            expected,
        )?;
        let bytes = array32(&open(&parsed, &key)?)?;
        self.insert(KeyEntry {
            bytes: Zeroizing::new(bytes),
            kind: Kind::Vault,
            tenant: id(expected, 1),
            account: id(expected, 17),
            vault: id(expected, 33),
            epoch: epoch(expected),
        })
    }
    /// # Errors
    /// Returns a bounded error for invalid scope, limits, entropy, or encryption failure.
    pub fn encrypt_item(
        &mut self,
        vault: KeyHandle,
        template: &[u8],
        plaintext: &[u8],
    ) -> Result<Created, Error> {
        let purpose = *template.first().ok_or(Error::InvalidInput)?;
        if !matches!(purpose, 3 | 4) {
            return Err(Error::InvalidInput);
        }
        check_plain(purpose, plaintext.len())?;
        let context = self.new_context(template, purpose)?;
        let entry = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        check_vault_scope(entry, &context)?;
        let label = if purpose == 3 {
            b"127Vaults/ECF1/item-body\0".as_slice()
        } else {
            b"127Vaults/ECF1/item-index\0".as_slice()
        };
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/vault-subkeys",
            label,
            &context,
        )?;
        let envelope = seal(&context, &[0; 16], 0, 0, 0, &key, plaintext)?;
        self.creations += 1;
        Ok(Created {
            context,
            envelope,
            handle: None,
        })
    }
    /// # Errors
    /// Returns a bounded error; authentication failures expose no details.
    pub fn decrypt_item(
        &self,
        vault: KeyHandle,
        envelope: &[u8],
        expected: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let purpose = *expected.first().ok_or(Error::InvalidInput)?;
        if !matches!(purpose, 3 | 4) {
            return Err(Error::InvalidInput);
        }
        let parsed = parse(envelope, expected, purpose)?;
        let entry = self.keys.get(&vault).ok_or(Error::InvalidHandle)?;
        check_vault_scope(entry, expected)?;
        let label = if purpose == 3 {
            b"127Vaults/ECF1/item-body\0".as_slice()
        } else {
            b"127Vaults/ECF1/item-index\0".as_slice()
        };
        let key = derive(
            entry.bytes.as_ref(),
            b"127Vaults/ECF1/vault-subkeys",
            label,
            expected,
        )?;
        open(&parsed, &key)
    }
    fn new_context(&mut self, t: &[u8], purpose: u8) -> Result<[u8; CONTEXT], Error> {
        if self.busy {
            return Err(Error::Busy);
        }
        if self.creations >= MAX_CREATIONS {
            return Err(Error::LimitExceeded);
        }
        validate_template(t, purpose)?;
        let mut c = [0u8; CONTEXT];
        c[..65].copy_from_slice(&t[..65]);
        fill(&mut c[65..81])?;
        c[71] = (c[71] & 0x0f) | 0x40;
        c[73] = (c[73] & 0x3f) | 0x80;
        c[81..].copy_from_slice(&t[65..]);
        validate_context(&c, purpose)?;
        Ok(c)
    }
    fn insert(&mut self, e: KeyEntry) -> Result<KeyHandle, Error> {
        if self.keys.len() >= MAX_HANDLES {
            return Err(Error::LimitExceeded);
        }
        let h = KeyHandle {
            instance: self.instance,
            id: self.next,
        };
        self.next = self.next.checked_add(1).ok_or(Error::LimitExceeded)?;
        self.keys.insert(h, e);
        Ok(h)
    }
}
fn record_error(e: RecordError) -> Error {
    match e {
        RecordError::InvalidInput => Error::InvalidInput,
        RecordError::AuthenticationFailed => Error::AuthenticationFailed,
    }
}

fn fill(out: &mut [u8]) -> Result<(), Error> {
    getrandom::fill(out).map_err(|_| Error::EntropyUnavailable)
}
fn id(c: &[u8], o: usize) -> [u8; 16] {
    c[o..o + 16].try_into().expect("fixed validated context")
}
fn epoch(c: &[u8]) -> u64 {
    u64::from_be_bytes(c[85..93].try_into().expect("fixed validated context"))
}
fn valid_uuid(x: &[u8], revision: bool) -> bool {
    x.len() == 16
        && x.iter().any(|b| *b != 0)
        && x.iter().any(|b| *b != 0xff)
        && (x[8] & 0xc0) == 0x80
        && (if revision {
            (x[6] >> 4) == 4
        } else {
            matches!(x[6] >> 4, 4 | 7)
        })
}
fn validate_template(t: &[u8], p: u8) -> Result<(), Error> {
    if t.len() != TEMPLATE || t[0] != p {
        return Err(Error::InvalidInput);
    }
    let mut c = [0u8; CONTEXT];
    c[..65].copy_from_slice(&t[..65]);
    c[65..81].copy_from_slice(&[0, 0, 0, 0, 0, 0, 0x40, 0, 0x80, 0, 0, 0, 0, 0, 0, 1]);
    c[81..].copy_from_slice(&t[65..]);
    validate_context(&c, p)
}
fn validate_context(c: &[u8], p: u8) -> Result<(), Error> {
    if c.len() != CONTEXT
        || c[0] != p
        || !valid_uuid(&c[1..17], false)
        || !valid_uuid(&c[65..81], true)
        || c[81..85] != 1u32.to_be_bytes()
        || epoch(c) == 0
    {
        return Err(Error::InvalidInput);
    }
    let a = &c[17..33];
    let v = &c[33..49];
    let o = &c[49..65];
    let zero = [0u8; 16];
    let good = match p {
        1 | 5 => valid_uuid(a, false) && v == zero && o == zero,
        2 => valid_uuid(a, false) && valid_uuid(v, false) && o == v,
        3 | 4 => a == zero && valid_uuid(v, false) && valid_uuid(o, false),
        _ => false,
    };
    if good {
        Ok(())
    } else {
        Err(Error::InvalidInput)
    }
}
fn check_plain(p: u8, n: usize) -> Result<(), Error> {
    let ok = match p {
        1 | 2 => n == 32,
        3 => (1..=1_048_576).contains(&n),
        4 => (1..=65_536).contains(&n),
        5 => (1..=16_384).contains(&n),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(Error::LimitExceeded)
    }
}
fn check_vault_scope(e: &KeyEntry, c: &[u8]) -> Result<(), Error> {
    if e.kind == Kind::Vault && e.tenant == id(c, 1) && e.vault == id(c, 33) && e.epoch == epoch(c)
    {
        Ok(())
    } else {
        Err(Error::InvalidHandle)
    }
}
fn array32(v: &[u8]) -> Result<[u8; 32], Error> {
    v.try_into().map_err(|_| Error::AuthenticationFailed)
}
fn derive_root(p: &[u8], a: &[u8], s: &[u8; 16], c: &[u8]) -> Result<Zeroizing<[u8; 32]>, Error> {
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|_| Error::InternalError)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut mem = Zeroizing::new(Vec::<Block>::new());
    mem.try_reserve_exact(ARGON_BLOCKS)
        .map_err(|_| Error::InternalError)?;
    mem.resize(ARGON_BLOCKS, Block::default());
    let mut d = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into_with_memory(p, s, d.as_mut(), mem.as_mut_slice())
        .map_err(|_| Error::InternalError)?;
    mem.zeroize();
    debug_assert!(
        mem.iter()
            .all(|block| block.as_ref().iter().all(|word| *word == 0))
    );
    derive(d.as_ref(), a, b"127Vaults/ECF1/root-wrap\0", c)
}
fn derive(ikm: &[u8], salt: &[u8], label: &[u8], c: &[u8]) -> Result<Zeroizing<[u8; 32]>, Error> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut info = Vec::new();
    info.try_reserve_exact(label.len() + c.len())
        .map_err(|_| Error::InternalError)?;
    info.extend_from_slice(label);
    info.extend_from_slice(c);
    let mut k = Zeroizing::new([0u8; 32]);
    hk.expand(&info, k.as_mut())
        .map_err(|_| Error::InternalError)?;
    info.zeroize();
    Ok(k)
}
fn seal(
    c: &[u8; CONTEXT],
    salt: &[u8; 16],
    m: u32,
    t: u32,
    p: u8,
    key: &[u8; 32],
    plain: &[u8],
) -> Result<Vec<u8>, Error> {
    let mut nonce = [0u8; 24];
    fill(&mut nonce)?;
    seal_with_nonce(c, salt, m, t, p, key, plain, &nonce)
}

#[allow(clippy::too_many_arguments)]
fn seal_with_nonce(
    c: &[u8; CONTEXT],
    salt: &[u8; 16],
    m: u32,
    t: u32,
    p: u8,
    key: &[u8; 32],
    plain: &[u8],
    nonce: &[u8; 24],
) -> Result<Vec<u8>, Error> {
    check_plain(c[0], plain.len())?;
    let l = plain.len().checked_add(16).ok_or(Error::LimitExceeded)?;
    let total = HEADER.checked_add(l).ok_or(Error::LimitExceeded)?;
    if total > MAX_ENVELOPE {
        return Err(Error::LimitExceeded);
    }
    let mut out = Vec::new();
    out.try_reserve_exact(total)
        .map_err(|_| Error::InternalError)?;
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&1u16.to_be_bytes());
    out.push(1);
    out.extend_from_slice(c);
    out.extend_from_slice(salt);
    out.extend_from_slice(&m.to_be_bytes());
    out.extend_from_slice(&t.to_be_bytes());
    out.push(p);
    out.extend_from_slice(nonce);
    out.extend_from_slice(
        &u32::try_from(l)
            .map_err(|_| Error::LimitExceeded)?
            .to_be_bytes(),
    );
    out.extend_from_slice(plain);
    let mut aad = Vec::from(AAD_LABEL);
    aad.extend_from_slice(&out[..HEADER]);
    let cipher = XChaCha20Poly1305::new(key.into());
    let tag = cipher
        .encrypt_inout_detached(nonce.into(), &aad, (&mut out[HEADER..]).into())
        .map_err(|_| Error::InternalError)?;
    out.extend_from_slice(&tag);
    aad.zeroize();
    Ok(out)
}
struct Parsed<'a> {
    context: [u8; CONTEXT],
    salt: [u8; 16],
    nonce: [u8; 24],
    ciphertext: &'a [u8],
    header: &'a [u8],
}
fn parse<'a>(e: &'a [u8], expected: &[u8], purpose: u8) -> Result<Parsed<'a>, Error> {
    if e.len() > MAX_ENVELOPE || e.len() < HEADER + 16 {
        return Err(Error::InvalidInput);
    }
    if &e[..8] != MAGIC || e[8..10] != 1u16.to_be_bytes() || e[10] != 1 {
        return Err(Error::UnsupportedFormat);
    }
    let context: [u8; CONTEXT] = e[11..104].try_into().map_err(|_| Error::InvalidInput)?;
    validate_context(&context, purpose)?;
    if expected.len() != CONTEXT || context != expected {
        return Err(Error::ContextMismatch);
    }
    let salt: [u8; 16] = e[104..120].try_into().map_err(|_| Error::InvalidInput)?;
    let m = u32::from_be_bytes(e[120..124].try_into().map_err(|_| Error::InvalidInput)?);
    let t = u32::from_be_bytes(e[124..128].try_into().map_err(|_| Error::InvalidInput)?);
    let lanes = e[128];
    if (purpose == 1 && (m, t, lanes) != (65_536, 3, 1))
        || (purpose != 1 && (salt != [0; 16] || m != 0 || t != 0 || lanes != 0))
    {
        return Err(Error::InvalidInput);
    }
    let l = usize::try_from(u32::from_be_bytes(
        e[153..157].try_into().map_err(|_| Error::InvalidInput)?,
    ))
    .map_err(|_| Error::InvalidInput)?;
    if HEADER.checked_add(l) != Some(e.len())
        || check_plain(purpose, l.checked_sub(16).ok_or(Error::InvalidInput)?).is_err()
    {
        return Err(Error::InvalidInput);
    }
    Ok(Parsed {
        context,
        salt,
        nonce: e[129..153].try_into().map_err(|_| Error::InvalidInput)?,
        ciphertext: &e[HEADER..],
        header: &e[..HEADER],
    })
}
fn open(p: &Parsed<'_>, key: &[u8; 32]) -> Result<Zeroizing<Vec<u8>>, Error> {
    let n = p
        .ciphertext
        .len()
        .checked_sub(16)
        .ok_or(Error::InvalidInput)?;
    let mut out = Zeroizing::new(Vec::new());
    out.try_reserve_exact(n).map_err(|_| Error::InternalError)?;
    out.extend_from_slice(&p.ciphertext[..n]);
    let tag: [u8; 16] = p.ciphertext[n..]
        .try_into()
        .map_err(|_| Error::InvalidInput)?;
    let mut aad = Vec::from(AAD_LABEL);
    aad.extend_from_slice(p.header);
    let cipher = XChaCha20Poly1305::new(key.into());
    let result = cipher.decrypt_inout_detached(
        (&p.nonce).into(),
        &aad,
        (&mut out[..]).into(),
        (&tag).into(),
    );
    aad.zeroize();
    result.map_err(|_| Error::AuthenticationFailed)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;
    fn uuid(seed: u8) -> [u8; 16] {
        let mut x = [seed; 16];
        x[6] = 0x40;
        x[8] = 0x80;
        x
    }
    #[test]
    fn credential_rotation_rewraps_same_root_and_preserves_old_vaults() {
        let old_password = crate::random_test_bytes();
        let old_secret = crate::random_test_bytes();
        let new_password = crate::random_test_bytes();
        let new_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let original = core
            .create_root(&template(1), &old_password, &old_secret)
            .unwrap();
        let root = original.handle.unwrap();
        let vault = core.create_vault(root, &template(2)).unwrap();
        let mut next = template(1);
        next[69..77].copy_from_slice(&2u64.to_be_bytes());
        let wrapped = core
            .rewrap_root(root, &next, &new_password, &new_secret)
            .unwrap();
        assert!(
            core.unwrap_root(
                &wrapped.envelope,
                &wrapped.context,
                &old_password,
                &old_secret
            )
            .is_err()
        );
        let renewed = core
            .unwrap_root(
                &wrapped.envelope,
                &wrapped.context,
                &new_password,
                &new_secret,
            )
            .unwrap();
        assert!(
            core.unwrap_vault(renewed, &vault.envelope, &vault.context)
                .is_ok()
        );
        assert!(
            core.rewrap_root(root, &template(1), &new_password, &new_secret)
                .is_err()
        );
        next[1..17].copy_from_slice(&uuid(9));
        assert!(
            core.rewrap_root(root, &next, &new_password, &new_secret)
                .is_err()
        );
    }
    fn template(p: u8) -> [u8; TEMPLATE] {
        let mut t = [0; TEMPLATE];
        t[0] = p;
        t[1..17].copy_from_slice(&uuid(1));
        match p {
            1 => t[17..33].copy_from_slice(&uuid(2)),
            2 => {
                t[17..33].copy_from_slice(&uuid(2));
                t[33..49].copy_from_slice(&uuid(3));
                t[49..65].copy_from_slice(&uuid(3));
            }
            3 | 4 => {
                t[33..49].copy_from_slice(&uuid(3));
                t[49..65].copy_from_slice(&uuid(4));
            }
            _ => {}
        }
        t[65..69].copy_from_slice(&1u32.to_be_bytes());
        t[69..77].copy_from_slice(&1u64.to_be_bytes());
        t
    }
    #[test]
    fn hierarchy_round_trip_and_rejections() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut c = Core::new();
        let r = c
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        let rh = r.handle.unwrap();
        let mut foreign = Core::new();
        assert_eq!(
            foreign.create_vault(rh, &template(2)).unwrap_err(),
            Error::InvalidHandle
        );
        let v = c.create_vault(rh, &template(2)).unwrap();
        let vh = v.handle.unwrap();
        let item = c.encrypt_item(vh, &template(3), b"secret").unwrap();
        assert_eq!(
            &*c.decrypt_item(vh, &item.envelope, &item.context).unwrap(),
            b"secret"
        );
        let mut bad = item.envelope.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(
            c.decrypt_item(vh, &bad, &item.context).unwrap_err(),
            Error::AuthenticationFailed
        );
        let mut wrong = item.context;
        wrong[49] ^= 1;
        assert!(matches!(
            c.decrypt_item(vh, &item.envelope, &wrong),
            Err(Error::InvalidInput | Error::ContextMismatch)
        ));
        c.lock();
        assert_eq!(
            c.decrypt_item(vh, &item.envelope, &item.context)
                .unwrap_err(),
            Error::InvalidHandle
        );
    }
    #[test]
    fn bounded_creation_budget_does_not_invalidate_existing_ciphertext() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let root = core
            .create_root(&template(1), &password, &account_secret)
            .unwrap()
            .handle
            .unwrap();
        let vault = core
            .create_vault(root, &template(2))
            .unwrap()
            .handle
            .unwrap();
        let saved = core
            .encrypt_item(vault, &template(3), b"synthetic saved item")
            .unwrap();
        while core.remaining_creation_budget() > 0 {
            core.encrypt_item(vault, &template(3), b"synthetic stress item")
                .unwrap();
        }
        assert_eq!(
            core.encrypt_item(vault, &template(3), b"new edit")
                .unwrap_err(),
            Error::LimitExceeded
        );
        assert_eq!(
            core.decrypt_item(vault, &saved.envelope, &saved.context)
                .unwrap()
                .as_slice(),
            b"synthetic saved item"
        );
    }
    #[test]
    fn private_publication_composes_exact_records() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut c = Core::new();
        let r = c
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        let rh = r.handle.unwrap();
        let empty = c.create_empty_directory(rh).unwrap();
        let made = c.create_private_vault(rh, &empty).unwrap();
        let vault_id: [u8; 16] = made.vault.context[33..49].try_into().unwrap();
        c.lock();
        let reopened_root = c
            .unwrap_root(&r.envelope, &r.context, &password, &account_secret)
            .unwrap();
        let reopened = c
            .open_private_vault(
                reopened_root,
                &made.directory,
                vault_id,
                &made.vault.envelope,
            )
            .unwrap();
        let vh = reopened.handle.unwrap();
        let mut tampered_directory = made.directory.clone();
        *tampered_directory.last_mut().unwrap() ^= 1;
        assert_eq!(
            c.open_private_vault(
                reopened_root,
                &tampered_directory,
                vault_id,
                &made.vault.envelope
            )
            .unwrap_err(),
            Error::AuthenticationFailed
        );
        let proposal = c
            .upsert_private_item(
                vh,
                &made.catalogue,
                None,
                b"{\"title\":\"Example\"}",
                b"{\"password\":\"fake\"}",
            )
            .unwrap();
        let v = c.keys.get(&vh).unwrap();
        let m = Catalogue::decode(&proposal.catalogue, &v.bytes, v.tenant, v.vault, 1).unwrap();
        assert_eq!(m.entries.len(), 1);
        assert_eq!(m.entries[0].item, proposal.item);
        let mut reserved = proposal.item;
        reserved[15] ^= 1;
        let copied = c
            .upsert_private_item_at_id(
                vh,
                &proposal.catalogue,
                reserved,
                false,
                b"{\"title\":\"Copy\"}",
                b"{\"password\":\"fake\"}",
            )
            .unwrap();
        assert_eq!(copied.item, reserved);
        assert!(matches!(
            c.upsert_private_item_at_id(vh, &copied.catalogue, reserved, false, b"{}", b"{}"),
            Err(Error::InvalidInput)
        ));
        assert_eq!(sha256(&proposal.index), m.entries[0].index_sha256);
        assert_eq!(sha256(&proposal.body), m.entries[0].body_sha256);
        assert_eq!(
            &*c.decrypt_private_part(vh, &proposal.catalogue, proposal.item, &proposal.index, 4)
                .unwrap(),
            b"{\"title\":\"Example\"}"
        );
        let mut bad = proposal.body;
        bad[0] ^= 1;
        assert_eq!(
            c.decrypt_private_part(vh, &proposal.catalogue, proposal.item, &bad, 3)
                .unwrap_err(),
            Error::AuthenticationFailed
        );
    }
    #[test]
    fn private_item_deletion_authenticates_and_preserves_siblings() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let root = core
            .create_root(&template(1), &password, &account_secret)
            .unwrap()
            .handle
            .unwrap();
        let directory = core.create_empty_directory(root).unwrap();
        let vault = core.create_private_vault(root, &directory).unwrap();
        let handle = vault.vault.handle.unwrap();
        let first = core
            .upsert_private_item(handle, &vault.catalogue, None, b"first", b"secret one")
            .unwrap();
        let second = core
            .upsert_private_item(handle, &first.catalogue, None, b"second", b"secret two")
            .unwrap();
        let budget = core.remaining_creation_budget();
        let deleted = core
            .delete_private_item(handle, &second.catalogue, first.item)
            .unwrap();
        assert_eq!(core.remaining_creation_budget(), budget);
        assert_eq!(
            core.verify_private_catalogue(handle, &deleted).unwrap(),
            vec![second.item]
        );
        assert_eq!(&deleted[60..76], &second.catalogue[44..60]);
        assert_ne!(&deleted[44..60], &second.catalogue[44..60]);
        assert_eq!(
            &*core
                .decrypt_private_part(handle, &deleted, second.item, &second.body, 3)
                .unwrap(),
            b"secret two"
        );
        assert!(
            core.decrypt_private_part(handle, &deleted, first.item, &first.body, 3)
                .is_err()
        );
        assert!(
            core.delete_private_item(handle, &deleted, first.item)
                .is_err()
        );
        let mut tampered = second.catalogue.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(
            core.delete_private_item(handle, &tampered, first.item)
                .is_err()
        );
        let empty = core
            .delete_private_item(handle, &deleted, second.item)
            .unwrap();
        assert!(
            core.verify_private_catalogue(handle, &empty)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn private_directory_keeps_existing_vault_when_appending() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let root = core
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        let handle = root.handle.unwrap();
        let empty = core.create_empty_directory(handle).unwrap();
        let first = core.create_private_vault(handle, &empty).unwrap();
        let second = core.create_private_vault(handle, &first.directory).unwrap();
        let first_id = first.vault.context[33..49].try_into().unwrap();
        let second_id = second.vault.context[33..49].try_into().unwrap();
        assert_ne!(first_id, second_id);
        assert!(
            core.open_private_vault(handle, &second.directory, first_id, &first.vault.envelope)
                .is_ok()
        );
        assert!(
            core.open_private_vault(handle, &second.directory, second_id, &second.vault.envelope)
                .is_ok()
        );
    }
    #[test]
    fn private_vault_capacity_refuses_without_invalidating_existing_vaults() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let root = core
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        let handle = root.handle.unwrap();
        let mut directory = core.create_empty_directory(handle).unwrap();
        let mut vaults = Vec::new();
        for _ in 0..crate::private_vault::MAX_PRIVATE_VAULTS {
            let made = core.create_private_vault(handle, &directory).unwrap();
            directory = made.directory;
            vaults.push(made.vault);
        }
        assert_eq!(
            core.create_private_vault(handle, &directory).err(),
            Some(Error::LimitExceeded)
        );
        for vault in vaults {
            let id = vault.context[33..49].try_into().unwrap();
            assert!(
                core.open_private_vault(handle, &directory, id, &vault.envelope)
                    .is_ok()
            );
        }
    }
    #[test]
    fn account_settings_are_root_scoped_and_authenticated() {
        let password = crate::random_test_bytes();
        let account_secret = crate::random_test_bytes();
        let mut core = Core::new();
        let root = core
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        let handle = root.handle.unwrap();
        let sealed = core
            .encrypt_account_settings(handle, b"{\"version\":1}")
            .unwrap();
        assert_eq!(
            core.decrypt_account_settings(handle, &sealed)
                .unwrap()
                .as_slice(),
            b"{\"version\":1}"
        );
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(
            core.decrypt_account_settings(handle, &tampered)
                .unwrap_err(),
            Error::AuthenticationFailed
        );
        core.lock();
        assert_eq!(
            core.decrypt_account_settings(handle, &sealed).unwrap_err(),
            Error::InvalidHandle
        );
    }
    #[test]
    fn parser_bounds_and_wrong_secret() {
        let password = crate::random_test_bytes();
        let mut wrong_password = password;
        wrong_password[0] ^= 1;
        let account_secret = crate::random_test_bytes();
        let mut c = Core::new();
        let r = c
            .create_root(&template(1), &password, &account_secret)
            .unwrap();
        assert_eq!(
            c.unwrap_root(&r.envelope, &r.context, &wrong_password, &account_secret)
                .unwrap_err(),
            Error::AuthenticationFailed
        );
        let mut trailing = r.envelope.clone();
        trailing.push(0);
        assert_eq!(
            c.unwrap_root(&trailing, &r.context, &password, &account_secret)
                .unwrap_err(),
            Error::InvalidInput
        );
        for offset in [8, 9, 10] {
            let mut unknown = r.envelope.clone();
            unknown[offset] ^= 1;
            assert_eq!(
                c.unwrap_root(&unknown, &r.context, &password, &account_secret)
                    .unwrap_err(),
                Error::UnsupportedFormat
            );
        }
    }
    #[test]
    fn disposable_item_vector() {
        assert_eq!(ARGON_BLOCKS * Block::SIZE, 64 * 1024 * 1024);
        let envelope = deterministic_item_vector();
        let actual = envelope.iter().fold(String::new(), |mut output, byte| {
            write!(output, "{byte:02x}").expect("writing to a String cannot fail");
            output
        });
        assert_eq!(
            actual,
            "313237564558500000010103010101010101400180010101010101010000000000000000000000000000000003030303030340038003030303030303040404040404400480040404040404040505050505054005800505050505050500000001000000000000000100000000000000000000000000000000000000000000000000060606060606060606060606060606060606060606060606000000162aa12cd9f1af16180a40d607836b6a66b9528de3c2ae"
        );
    }
}
