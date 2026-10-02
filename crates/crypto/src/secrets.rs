//! In-memory feasibility component, not a key hierarchy or WASM ABI.
use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use zeroize::Zeroizing;

/// Owned bytes wiped on drop by `zeroize`. Caller copies are not erased.
/// No Clone, serialization, or plaintext Debug implementation is provided.
pub struct SecretBuffer(Zeroizing<Vec<u8>>);

impl SecretBuffer {
    /// Takes ownership of a caller-created buffer without cloning its contents.
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// Explicit native-core access. Do not export this accessor through WASM.
    #[must_use]
    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for SecretBuffer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretBuffer([REDACTED])")
    }
}

/// Local capability within one store only; not an identity or network credential.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SecretHandle(usize);

static NEXT_HANDLE: AtomicUsize = AtomicUsize::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SecretStoreError {
    Capacity,
    HandleExhausted,
    UnknownHandle,
}

/// Bounded, single-core-instance secret ownership. Handles are never reused.
/// Handles are unique within this native process or WASM instance.
pub struct SecretStore {
    entries: BTreeMap<SecretHandle, SecretBuffer>,
    capacity: usize,
}

impl SecretStore {
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            capacity,
        }
    }

    /// # Errors
    /// Returns an error when capacity or the non-reusable handle space is exhausted.
    pub fn insert(&mut self, secret: SecretBuffer) -> Result<SecretHandle, SecretStoreError> {
        if self.entries.len() >= self.capacity {
            return Err(SecretStoreError::Capacity);
        }
        let handle = SecretHandle(
            NEXT_HANDLE
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| SecretStoreError::HandleExhausted)?,
        );
        self.entries.insert(handle, secret);
        Ok(handle)
    }

    /// # Errors
    /// Rejects missing, released, or lock-invalidated handles.
    pub fn get(&self, handle: SecretHandle) -> Result<&SecretBuffer, SecretStoreError> {
        self.entries
            .get(&handle)
            .ok_or(SecretStoreError::UnknownHandle)
    }

    /// # Errors
    /// Rejects handles already released or invalidated by lock.
    pub fn release(&mut self, handle: SecretHandle) -> Result<(), SecretStoreError> {
        self.entries
            .remove(&handle)
            .map(drop)
            .ok_or(SecretStoreError::UnknownHandle)
    }

    /// Drops owned secrets and invalidates all handles; IDs are never reused.
    pub fn lock(&mut self) {
        self.entries.clear();
    }
}
