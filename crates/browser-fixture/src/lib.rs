//! Disposable fixture bridge only. No user input, decryption, or secret export.
use vaults_crypto::ecf1::{Core as Ecf1Core, Error as Ecf1Error, KeyHandle};
use vaults_crypto::secrets::{SecretBuffer, SecretHandle, SecretStore};
use wasm_bindgen::prelude::*;

/// An opaque token, never the stored bytes. The JS facade binds it to its owner.
#[wasm_bindgen]
pub struct FixtureToken {
    handle: SecretHandle,
}

#[wasm_bindgen]
pub struct FixtureCore {
    store: SecretStore,
}

#[wasm_bindgen]
impl FixtureCore {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self {
            store: SecretStore::new(1),
        }
    }

    /// # Errors
    /// Rejects creation while another fixture is active or handle IDs are exhausted.
    pub fn create_fixture(&mut self) -> Result<FixtureToken, JsError> {
        self.store
            .insert(SecretBuffer::new(
                b"127Vaults disposable WASM fixture".to_vec(),
            ))
            .map(|handle| FixtureToken { handle })
            .map_err(|_| JsError::new("Fixture unavailable. Lock before creating another."))
    }

    #[must_use]
    pub fn is_valid(&self, token: &FixtureToken) -> bool {
        self.store.get(token.handle).is_ok()
    }

    pub fn lock(&mut self) {
        self.store.lock();
    }

    #[must_use]
    pub fn interface_revision(&self) -> u16 {
        vaults_crypto::CORE_INTERFACE_REVISION
    }

    #[must_use]
    pub fn supported_formats(&self) -> Vec<u16> {
        vaults_crypto::SUPPORTED_CRYPTO_FORMATS.to_vec()
    }

    /// Candidate-only identifiers, never an approval for real secrets.
    #[must_use]
    pub fn experimental_formats(&self) -> Vec<u16> {
        vaults_crypto::EXPERIMENTAL_CRYPTO_FORMATS.to_vec()
    }

    #[must_use]
    pub fn experimental(&self) -> bool {
        true
    }
}

/// Returns the exact disposable ECF1 bytes used by native tests.
#[wasm_bindgen]
#[must_use]
pub fn experimental_ecf1_item_vector() -> Vec<u8> {
    vaults_crypto::ecf1::deterministic_item_vector()
}

#[cfg(test)]
mod registry_tests {
    use super::*;

    #[test]
    fn bridge_exposes_candidate_but_never_supports_it() {
        let core = FixtureCore::new();
        assert!(core.supported_formats().is_empty());
        assert_eq!(core.experimental_formats(), vec![1]);
        assert_eq!(
            experimental_ecf1_item_vector(),
            vaults_crypto::ecf1::deterministic_item_vector()
        );
    }
}

impl Default for FixtureCore {
    fn default() -> Self {
        Self::new()
    }
}

fn ecf1_error(error: Ecf1Error) -> JsError {
    JsError::new(error.code())
}

/// Disposable ECF1 result carrying public bytes plus an opaque root handle.
#[wasm_bindgen]
pub struct ExperimentalRoot {
    handle: KeyHandle,
    context: Vec<u8>,
    envelope: Vec<u8>,
}

#[wasm_bindgen]
impl ExperimentalRoot {
    #[must_use]
    pub fn context(&self) -> Vec<u8> {
        self.context.clone()
    }
    #[must_use]
    pub fn envelope(&self) -> Vec<u8> {
        self.envelope.clone()
    }
}

/// Disposable ECF1 result carrying public bytes plus an opaque vault handle.
#[wasm_bindgen]
pub struct ExperimentalVault {
    handle: KeyHandle,
    context: Vec<u8>,
    envelope: Vec<u8>,
}

#[wasm_bindgen]
impl ExperimentalVault {
    #[must_use]
    pub fn context(&self) -> Vec<u8> {
        self.context.clone()
    }
    #[must_use]
    pub fn envelope(&self) -> Vec<u8> {
        self.envelope.clone()
    }
}

/// Disposable item result. Both fields are public ciphertext metadata/bytes.
#[wasm_bindgen]
pub struct ExperimentalEnvelope {
    context: Vec<u8>,
    envelope: Vec<u8>,
}
#[wasm_bindgen]
pub struct ExperimentalPrivateVault {
    vault: ExperimentalVault,
    directory: Vec<u8>,
    catalogue: Vec<u8>,
}
#[wasm_bindgen]
impl ExperimentalPrivateVault {
    #[must_use]
    pub fn vault(&self) -> ExperimentalVault {
        ExperimentalVault {
            handle: self.vault.handle,
            context: self.vault.context.clone(),
            envelope: self.vault.envelope.clone(),
        }
    }
    #[must_use]
    pub fn directory(&self) -> Vec<u8> {
        self.directory.clone()
    }
    #[must_use]
    pub fn catalogue(&self) -> Vec<u8> {
        self.catalogue.clone()
    }
}
#[wasm_bindgen]
pub struct ExperimentalPrivateItem {
    item: Vec<u8>,
    catalogue: Vec<u8>,
    index: Vec<u8>,
    body: Vec<u8>,
}
#[wasm_bindgen]
impl ExperimentalPrivateItem {
    #[must_use]
    pub fn item(&self) -> Vec<u8> {
        self.item.clone()
    }
    #[must_use]
    pub fn catalogue(&self) -> Vec<u8> {
        self.catalogue.clone()
    }
    #[must_use]
    pub fn index(&self) -> Vec<u8> {
        self.index.clone()
    }
    #[must_use]
    pub fn body(&self) -> Vec<u8> {
        self.body.clone()
    }
}

#[wasm_bindgen]
impl ExperimentalEnvelope {
    #[must_use]
    pub fn context(&self) -> Vec<u8> {
        self.context.clone()
    }
    #[must_use]
    pub fn envelope(&self) -> Vec<u8> {
        self.envelope.clone()
    }
}

/// Narrow disposable ECF1 bridge. It deliberately has no raw-key reader.
#[wasm_bindgen]
pub struct ExperimentalEcf1Core {
    core: Ecf1Core,
}

#[wasm_bindgen]
impl ExperimentalEcf1Core {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self {
            core: Ecf1Core::new(),
        }
    }

    /// # Errors
    /// Returns one fixed ECF1 code without provider details.
    pub fn create_root(
        &mut self,
        template: &[u8],
        password: &[u8],
        account_secret: &[u8],
    ) -> Result<ExperimentalRoot, JsError> {
        let made = self
            .core
            .create_root(template, password, account_secret)
            .map_err(ecf1_error)?;
        Ok(ExperimentalRoot {
            handle: made.handle.ok_or_else(|| JsError::new("INTERNAL_ERROR"))?,
            context: made.context.to_vec(),
            envelope: made.envelope,
        })
    }
    /// # Errors
    /// Rejects an invalid root handle or entropy failure.
    pub fn create_empty_directory(&self, root: &ExperimentalRoot) -> Result<Vec<u8>, JsError> {
        self.core
            .create_empty_directory(root.handle)
            .map_err(ecf1_error)
    }
    /// # Errors
    /// Rejects an invalid authenticated empty directory or root handle.
    pub fn create_private_vault(
        &mut self,
        root: &ExperimentalRoot,
        empty_directory: &[u8],
    ) -> Result<ExperimentalPrivateVault, JsError> {
        let made = self
            .core
            .create_private_vault(root.handle, empty_directory)
            .map_err(ecf1_error)?;
        Ok(ExperimentalPrivateVault {
            vault: ExperimentalVault {
                handle: made
                    .vault
                    .handle
                    .ok_or_else(|| JsError::new("INTERNAL_ERROR"))?,
                context: made.vault.context.to_vec(),
                envelope: made.vault.envelope,
            },
            directory: made.directory,
            catalogue: made.catalogue,
        })
    }
    /// # Errors
    /// Rejects an unauthenticated directory or mismatched vault envelope.
    pub fn open_private_vault(
        &mut self,
        root: &ExperimentalRoot,
        directory: &[u8],
        vault_id: &[u8],
        envelope: &[u8],
    ) -> Result<ExperimentalVault, JsError> {
        let id = vault_id
            .try_into()
            .map_err(|_| JsError::new("INVALID_INPUT"))?;
        let made = self
            .core
            .open_private_vault(root.handle, directory, id, envelope)
            .map_err(ecf1_error)?;
        Ok(ExperimentalVault {
            handle: made.handle.ok_or_else(|| JsError::new("INTERNAL_ERROR"))?,
            context: made.context.to_vec(),
            envelope: made.envelope,
        })
    }
    /// # Errors
    /// Rejects invalid state, scope, plaintext, or create/update mode.
    pub fn upsert_private_item(
        &mut self,
        vault: &ExperimentalVault,
        catalogue: &[u8],
        item: Option<Vec<u8>>,
        index: &[u8],
        body: &[u8],
    ) -> Result<ExperimentalPrivateItem, JsError> {
        let id = item
            .map(|x| x.try_into().map_err(|_| JsError::new("INVALID_INPUT")))
            .transpose()?;
        let made = self
            .core
            .upsert_private_item(vault.handle, catalogue, id, index, body)
            .map_err(ecf1_error)?;
        Ok(ExperimentalPrivateItem {
            item: made.item.to_vec(),
            catalogue: made.catalogue,
            index: made.index,
            body: made.body,
        })
    }
    /// # Errors
    /// Rejects a catalogue, commitment, context, or ciphertext failure.
    pub fn decrypt_private_part(
        &self,
        vault: &ExperimentalVault,
        catalogue: &[u8],
        item: &[u8],
        envelope: &[u8],
        purpose: u8,
    ) -> Result<Vec<u8>, JsError> {
        let id: [u8; 16] = item.try_into().map_err(|_| JsError::new("INVALID_INPUT"))?;
        self.core
            .decrypt_private_part(vault.handle, catalogue, id, envelope, purpose)
            .map(|x| x.to_vec())
            .map_err(ecf1_error)
    }
    /// # Errors
    /// Returns one fixed ECF1 code; password and key failures are indistinguishable.
    pub fn unwrap_root(
        &mut self,
        envelope: &[u8],
        expected_context: &[u8],
        password: &[u8],
        account_secret: &[u8],
    ) -> Result<ExperimentalRoot, JsError> {
        let handle = self
            .core
            .unwrap_root(envelope, expected_context, password, account_secret)
            .map_err(ecf1_error)?;
        Ok(ExperimentalRoot {
            handle,
            context: expected_context.to_vec(),
            envelope: envelope.to_vec(),
        })
    }
    /// # Errors
    /// Returns one fixed ECF1 code without secret values.
    pub fn create_vault(
        &mut self,
        root: &ExperimentalRoot,
        template: &[u8],
    ) -> Result<ExperimentalVault, JsError> {
        let made = self
            .core
            .create_vault(root.handle, template)
            .map_err(ecf1_error)?;
        Ok(ExperimentalVault {
            handle: made.handle.ok_or_else(|| JsError::new("INTERNAL_ERROR"))?,
            context: made.context.to_vec(),
            envelope: made.envelope,
        })
    }
    /// # Errors
    /// Returns one fixed ECF1 code; authentication failures are indistinguishable.
    pub fn unwrap_vault(
        &mut self,
        root: &ExperimentalRoot,
        envelope: &[u8],
        expected_context: &[u8],
    ) -> Result<ExperimentalVault, JsError> {
        let handle = self
            .core
            .unwrap_vault(root.handle, envelope, expected_context)
            .map_err(ecf1_error)?;
        Ok(ExperimentalVault {
            handle,
            context: expected_context.to_vec(),
            envelope: envelope.to_vec(),
        })
    }
    /// # Errors
    /// Returns one fixed ECF1 code without secret values.
    pub fn encrypt_item(
        &mut self,
        vault: &ExperimentalVault,
        template: &[u8],
        plaintext: &[u8],
    ) -> Result<ExperimentalEnvelope, JsError> {
        let made = self
            .core
            .encrypt_item(vault.handle, template, plaintext)
            .map_err(ecf1_error)?;
        Ok(ExperimentalEnvelope {
            context: made.context.to_vec(),
            envelope: made.envelope,
        })
    }
    /// # Errors
    /// Returns one fixed ECF1 code; authentication failures are indistinguishable.
    pub fn decrypt_item(
        &self,
        vault: &ExperimentalVault,
        envelope: &[u8],
        expected_context: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        self.core
            .decrypt_item(vault.handle, envelope, expected_context)
            .map(|p| p.to_vec())
            .map_err(ecf1_error)
    }
    pub fn lock(&mut self) {
        self.core.lock();
    }
    #[must_use]
    pub fn experimental(&self) -> bool {
        true
    }
}

impl Default for ExperimentalEcf1Core {
    fn default() -> Self {
        Self::new()
    }
}

/// Runs the frozen OPAQUE profile with compile-time fictitious values only.
/// This is dependency/profile evidence, not a login API.
///
/// # Errors
/// Returns one generic failure if the frozen profile does not complete.
#[wasm_bindgen]
pub fn experimental_opaque_profile_self_test() -> Result<Vec<u32>, JsError> {
    use vaults_crypto::opaque::{Binding, deterministic_protocol_vector};
    let binding = Binding {
        origin: b"https://127.0.0.1:12780",
        installation: [1; 16],
        account: [2; 16],
        device: [3; 16],
        epoch: 1,
        attempt: [4; 32],
        server_public_key: [5; 32],
    };
    deterministic_protocol_vector(
        &[7; 32],
        b"fictitious password only",
        binding,
        [8; 32],
        [9; 32],
    )
    .and_then(|sizes| {
        sizes
            .into_iter()
            .map(|size| {
                u32::try_from(size).map_err(|_| vaults_crypto::opaque::Error::AuthenticationFailed)
            })
            .collect()
    })
    .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))
}

#[wasm_bindgen]
pub struct ExperimentalAuthStep {
    message: Vec<u8>,
    state: Vec<u8>,
}
#[wasm_bindgen]
impl ExperimentalAuthStep {
    #[must_use]
    pub fn message(&self) -> Vec<u8> {
        self.message.clone()
    }
    #[must_use]
    pub fn state(&self) -> Vec<u8> {
        self.state.clone()
    }
}

#[wasm_bindgen]
pub struct ExperimentalLoginFinish {
    message: Vec<u8>,
    session_key: Vec<u8>,
}
#[wasm_bindgen]
impl ExperimentalLoginFinish {
    #[must_use]
    pub fn message(&self) -> Vec<u8> {
        self.message.clone()
    }
    #[must_use]
    pub fn session_key(&self) -> Vec<u8> {
        self.session_key.clone()
    }
}

fn auth_error(_: vaults_crypto::opaque::Error) -> JsError {
    JsError::new("AUTHENTICATION_FAILED")
}
fn binding(bytes: &[u8]) -> Result<vaults_crypto::opaque::Binding<'_>, JsError> {
    if bytes.len() < 2 {
        return Err(JsError::new("AUTHENTICATION_FAILED"));
    }
    let origin_len = usize::from(u16::from_be_bytes([bytes[0], bytes[1]]));
    if origin_len == 0 || origin_len > 255 || bytes.len() != 2 + origin_len + 16 * 3 + 8 + 32 * 2 {
        return Err(JsError::new("AUTHENTICATION_FAILED"));
    }
    let mut at = 2;
    let origin = &bytes[at..at + origin_len];
    at += origin_len;
    let installation = bytes[at..at + 16]
        .try_into()
        .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?;
    at += 16;
    let account = bytes[at..at + 16]
        .try_into()
        .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?;
    at += 16;
    let device = bytes[at..at + 16]
        .try_into()
        .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?;
    at += 16;
    let epoch = u64::from_be_bytes(
        bytes[at..at + 8]
            .try_into()
            .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?,
    );
    at += 8;
    let attempt = bytes[at..at + 32]
        .try_into()
        .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?;
    at += 32;
    let server_public_key = bytes[at..at + 32]
        .try_into()
        .map_err(|_| JsError::new("AUTHENTICATION_FAILED"))?;
    Ok(vaults_crypto::opaque::Binding {
        origin,
        installation,
        account,
        device,
        epoch,
        attempt,
        server_public_key,
    })
}

/// Split OPAQUE bridge usable by browser (`web`) and server (`nodejs`) bindings.
#[wasm_bindgen]
pub struct ExperimentalOpaqueBridge;
#[wasm_bindgen]
#[allow(clippy::missing_errors_doc, clippy::needless_pass_by_value)] // WASM ABI maps owned optional byte arrays.
impl ExperimentalOpaqueBridge {
    pub fn server_setup() -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::server_setup()
            .map(|v| v.to_vec())
            .map_err(auth_error)
    }
    pub fn server_public_key(setup: &[u8]) -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::server_public_key(setup)
            .map(|v| v.to_vec())
            .map_err(auth_error)
    }
    pub fn client_registration_start(
        secret: &[u8],
        password: &[u8],
    ) -> Result<ExperimentalAuthStep, JsError> {
        vaults_crypto::opaque::client_registration_start(secret, password)
            .map(|v| ExperimentalAuthStep {
                message: v.message,
                state: v.state.to_vec(),
            })
            .map_err(auth_error)
    }
    pub fn server_registration_start(
        setup: &[u8],
        request: &[u8],
        binding_bytes: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::server_registration_start(setup, request, binding(binding_bytes)?)
            .map_err(auth_error)
    }
    pub fn client_registration_finish(
        state: &[u8],
        secret: &[u8],
        password: &[u8],
        response: &[u8],
        binding_bytes: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::client_registration_finish(
            state,
            secret,
            password,
            response,
            binding(binding_bytes)?,
        )
        .map_err(auth_error)
    }
    pub fn server_registration_finish(upload: &[u8]) -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::server_registration_finish(upload).map_err(auth_error)
    }
    pub fn client_login_start(
        secret: &[u8],
        password: &[u8],
    ) -> Result<ExperimentalAuthStep, JsError> {
        vaults_crypto::opaque::client_login_start(secret, password)
            .map(|v| ExperimentalAuthStep {
                message: v.message,
                state: v.state.to_vec(),
            })
            .map_err(auth_error)
    }
    pub fn server_login_start(
        setup: &[u8],
        record: Option<Vec<u8>>,
        request: &[u8],
        binding_bytes: &[u8],
    ) -> Result<ExperimentalAuthStep, JsError> {
        vaults_crypto::opaque::server_login_start(
            setup,
            record.as_deref(),
            request,
            binding(binding_bytes)?,
        )
        .map(|v| ExperimentalAuthStep {
            message: v.message,
            state: v.state.to_vec(),
        })
        .map_err(auth_error)
    }
    pub fn client_login_finish(
        state: &[u8],
        secret: &[u8],
        password: &[u8],
        response: &[u8],
        binding_bytes: &[u8],
    ) -> Result<ExperimentalLoginFinish, JsError> {
        vaults_crypto::opaque::client_login_finish(
            state,
            secret,
            password,
            response,
            binding(binding_bytes)?,
        )
        .map(|v| ExperimentalLoginFinish {
            message: v.message,
            session_key: v.session_key.to_vec(),
        })
        .map_err(auth_error)
    }
    pub fn server_login_finish(
        state: &[u8],
        finalization: &[u8],
        binding_bytes: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        vaults_crypto::opaque::server_login_finish(state, finalization, binding(binding_bytes)?)
            .map(|v| v.to_vec())
            .map_err(auth_error)
    }
}
