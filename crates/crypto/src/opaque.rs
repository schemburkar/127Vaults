//! Frozen, experimental OPAQUE profile. It is not approved for real secrets.

use argon2_opaque::{Algorithm, Argon2, Params, Version};
use hkdf_opaque::Hkdf;
use hmac_opaque::{Hmac, Mac};
use opaque_ke::{
    CipherSuite, ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialFinalization, CredentialRequest,
    CredentialResponse, Identifiers, RegistrationRequest, RegistrationResponse, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup, TripleDh,
    errors::{InternalError, ProtocolError},
    generic_array::{ArrayLength, GenericArray},
    ksf::Ksf,
};
use rand_chacha::{ChaCha20Rng, rand_core::SeedableRng};
use sha2_opaque::{Digest, Sha512};
use zeroize::{Zeroize, Zeroizing};

pub const REGISTRATION_REQUEST_LEN: usize = 32;
pub const REGISTRATION_RESPONSE_LEN: usize = 64;
pub const REGISTRATION_UPLOAD_LEN: usize = 192;
pub const CREDENTIAL_REQUEST_LEN: usize = 96;
pub const CREDENTIAL_RESPONSE_LEN: usize = 320;
pub const CREDENTIAL_FINALIZATION_LEN: usize = 64;

pub struct Suite;
impl CipherSuite for Suite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = TripleDh<opaque_ke::Ristretto255, sha2_opaque::Sha512>;
    type Ksf = MvpKsf;
}

#[derive(Default)]
pub struct MvpKsf;
impl Ksf for MvpKsf {
    fn hash<L: ArrayLength<u8>>(
        &self,
        input: GenericArray<u8, L>,
    ) -> Result<GenericArray<u8, L>, InternalError> {
        let params =
            Params::new(65_536, 3, 1, Some(L::USIZE)).map_err(|_| InternalError::KsfError)?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut output = GenericArray::default();
        let mut memory = Vec::new();
        memory
            .try_reserve_exact(65_536)
            .map_err(|_| InternalError::KsfError)?;
        memory.resize(65_536, argon2_opaque::Block::default());
        let mut memory = Zeroizing::new(memory);
        argon2
            .hash_password_into_with_memory(&input, &[0; 16], &mut output, memory.as_mut_slice())
            .map_err(|_| InternalError::KsfError)?;
        Ok(output)
    }
}

#[derive(Clone, Copy)]
pub struct Binding<'a> {
    pub origin: &'a [u8],
    pub installation: [u8; 16],
    pub account: [u8; 16],
    pub device: [u8; 16],
    pub epoch: u64,
    pub attempt: [u8; 32],
    pub server_public_key: [u8; 32],
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Error {
    InvalidInput,
    AuthenticationFailed,
}

pub struct MessageWithState {
    pub message: Vec<u8>,
    pub state: Zeroizing<Vec<u8>>,
}
pub struct LoginFinish {
    pub message: Vec<u8>,
    pub session_key: Zeroizing<Vec<u8>>,
}

pub struct ApplicationKeys {
    pub root_tag: Zeroizing<[u8; 32]>,
    pub intermediate: Zeroizing<[u8; 32]>,
}

/// Derives domain-separated application keys from an OPAQUE session key.
///
/// # Errors
/// Rejects a malformed context or HKDF failure.
pub fn derive_application_keys(
    session_key: &[u8],
    binding: Binding<'_>,
) -> Result<ApplicationKeys, Error> {
    if session_key.len() != 64 {
        return Err(Error::InvalidInput);
    }
    let context_hash = Sha512::digest(fields(binding)?.context);
    let mut salt_input = b"127Vaults/session-salt/1\0".to_vec();
    salt_input.extend_from_slice(&context_hash);
    let salt = Sha512::digest(&salt_input);
    let hk = Hkdf::<Sha512>::new(Some(&salt), session_key);
    let mut root_tag = Zeroizing::new([0_u8; 32]);
    let mut intermediate = Zeroizing::new([0_u8; 32]);
    hk.expand(b"127Vaults/root-tag-key/1", root_tag.as_mut())
        .map_err(|_| Error::AuthenticationFailed)?;
    hk.expand(b"127Vaults/intermediate-key/1", intermediate.as_mut())
        .map_err(|_| Error::AuthenticationFailed)?;
    Ok(ApplicationKeys {
        root_tag,
        intermediate,
    })
}

/// Authenticates the bounded root descriptor/envelope response to the OPAQUE transcript.
///
/// # Errors
/// Rejects oversized fields, wrong message lengths, or invalid key material.
pub fn root_response_tag(
    key: &[u8],
    binding: Binding<'_>,
    request: &[u8],
    response: &[u8],
    finalization: &[u8],
    descriptor: &[u8],
    envelope: &[u8],
) -> Result<[u8; 64], Error> {
    if key.len() != 32
        || request.len() != CREDENTIAL_REQUEST_LEN
        || response.len() != CREDENTIAL_RESPONSE_LEN
        || finalization.len() != CREDENTIAL_FINALIZATION_LEN
        || descriptor.len() > 4096
        || envelope.len() > 16384
    {
        return Err(Error::InvalidInput);
    }
    let context_hash = Sha512::digest(fields(binding)?.context);
    let transcript = Sha512::new()
        .chain_update(request)
        .chain_update(response)
        .chain_update(finalization)
        .finalize();
    let descriptor_len = u16::try_from(descriptor.len()).map_err(|_| Error::InvalidInput)?;
    let envelope_len = u32::try_from(envelope.len()).map_err(|_| Error::InvalidInput)?;
    let mut mac = Hmac::<Sha512>::new_from_slice(key).map_err(|_| Error::InvalidInput)?;
    mac.update(b"127Vaults/root-response/1\0");
    mac.update(&context_hash);
    mac.update(&transcript);
    mac.update(&descriptor_len.to_be_bytes());
    mac.update(descriptor);
    mac.update(&envelope_len.to_be_bytes());
    mac.update(envelope);
    Ok(mac.finalize().into_bytes().into())
}

fn rng() -> Result<ChaCha20Rng, Error> {
    let mut seed = [0_u8; 32];
    getrandom::fill(&mut seed).map_err(|_| Error::AuthenticationFailed)?;
    let rng = ChaCha20Rng::from_seed(seed);
    seed.zeroize();
    Ok(rng)
}

/// Generates the persistent OPAQUE server setup using fail-closed system entropy.
///
/// # Errors
/// Returns `AuthenticationFailed` when entropy is unavailable.
pub fn server_setup() -> Result<Zeroizing<Vec<u8>>, Error> {
    Ok(Zeroizing::new(
        ServerSetup::<Suite>::new(&mut rng()?).serialize().to_vec(),
    ))
}

/// Extracts the public server pin from a serialized setup.
///
/// # Errors
/// Rejects malformed setup bytes.
pub fn server_public_key(setup: &[u8]) -> Result<[u8; 32], Error> {
    let setup = ServerSetup::<Suite>::deserialize(setup).map_err(map_protocol)?;
    setup
        .keypair()
        .public()
        .serialize()
        .as_slice()
        .try_into()
        .map_err(|_| Error::AuthenticationFailed)
}

/// Starts client registration; state remains client-side.
///
/// # Errors
/// Rejects invalid credentials or unavailable entropy.
pub fn client_registration_start(
    secret: &[u8],
    password: &[u8],
) -> Result<MessageWithState, Error> {
    let password = bounded_password(secret, password)?;
    let start = ClientRegistration::<Suite>::start(&mut rng()?, &password).map_err(map_protocol)?;
    Ok(MessageWithState {
        message: start.message.serialize().to_vec(),
        state: Zeroizing::new(start.state.serialize().to_vec()),
    })
}

/// Produces the server registration response without receiving either secret.
///
/// # Errors
/// Rejects malformed setup, request, or binding.
pub fn server_registration_start(
    setup: &[u8],
    request: &[u8],
    binding: Binding<'_>,
) -> Result<Vec<u8>, Error> {
    let setup = ServerSetup::<Suite>::deserialize(setup).map_err(map_protocol)?;
    let request = RegistrationRequest::<Suite>::deserialize(request).map_err(map_protocol)?;
    let fields = fields(binding)?;
    ServerRegistration::<Suite>::start(&setup, request, &fields.credential)
        .map(|r| r.message.serialize().to_vec())
        .map_err(map_protocol)
}

/// Finishes client registration; returns only the upload safe for server storage.
///
/// # Errors
/// Rejects malformed state/response, invalid credentials, or unavailable resources.
pub fn client_registration_finish(
    state: &[u8],
    secret: &[u8],
    password: &[u8],
    response: &[u8],
    binding: Binding<'_>,
) -> Result<Vec<u8>, Error> {
    let state = ClientRegistration::<Suite>::deserialize(state).map_err(map_protocol)?;
    let response = RegistrationResponse::<Suite>::deserialize(response).map_err(map_protocol)?;
    let password = bounded_password(secret, password)?;
    let fields = fields(binding)?;
    let identifiers = Identifiers {
        client: Some(&fields.client),
        server: Some(&fields.server),
    };
    state
        .finish(
            &mut rng()?,
            &password,
            response,
            ClientRegistrationFinishParameters::new(identifiers, Some(&MvpKsf)),
        )
        .map(|r| r.message.serialize().to_vec())
        .map_err(map_protocol)
}

/// Validates and serializes an uploaded password record for persistence.
///
/// # Errors
/// Rejects malformed or noncanonical records.
pub fn server_registration_finish(upload: &[u8]) -> Result<Vec<u8>, Error> {
    let upload = RegistrationUpload::<Suite>::deserialize(upload).map_err(map_protocol)?;
    Ok(ServerRegistration::<Suite>::finish(upload)
        .serialize()
        .to_vec())
}

/// Starts login entirely on the client.
///
/// # Errors
/// Rejects invalid credentials or unavailable entropy.
pub fn client_login_start(secret: &[u8], password: &[u8]) -> Result<MessageWithState, Error> {
    let password = bounded_password(secret, password)?;
    let start = ClientLogin::<Suite>::start(&mut rng()?, &password).map_err(map_protocol)?;
    Ok(MessageWithState {
        message: start.message.serialize().to_vec(),
        state: Zeroizing::new(start.state.serialize().to_vec()),
    })
}

/// Starts the server login using a real record or `None` for the fake-record path.
///
/// # Errors
/// Rejects malformed messages, records, setup, or binding.
pub fn server_login_start(
    setup: &[u8],
    record: Option<&[u8]>,
    request: &[u8],
    binding: Binding<'_>,
) -> Result<MessageWithState, Error> {
    let setup = ServerSetup::<Suite>::deserialize(setup).map_err(map_protocol)?;
    let record = record
        .map(ServerRegistration::<Suite>::deserialize)
        .transpose()
        .map_err(map_protocol)?;
    let request = CredentialRequest::<Suite>::deserialize(request).map_err(map_protocol)?;
    let fields = fields(binding)?;
    let identifiers = Identifiers {
        client: Some(&fields.client),
        server: Some(&fields.server),
    };
    let start = ServerLogin::start(
        &mut rng()?,
        &setup,
        record,
        request,
        &fields.credential,
        ServerLoginParameters {
            context: Some(&fields.context),
            identifiers,
        },
    )
    .map_err(map_protocol)?;
    Ok(MessageWithState {
        message: start.message.serialize().to_vec(),
        state: Zeroizing::new(start.state.serialize().to_vec()),
    })
}

/// Finishes login on the client and returns the finalization plus application session key.
///
/// # Errors
/// Returns one generic failure for wrong secrets, tamper, or malformed state.
pub fn client_login_finish(
    state: &[u8],
    secret: &[u8],
    password: &[u8],
    response: &[u8],
    binding: Binding<'_>,
) -> Result<LoginFinish, Error> {
    let state = ClientLogin::<Suite>::deserialize(state).map_err(map_protocol)?;
    let response = CredentialResponse::<Suite>::deserialize(response).map_err(map_protocol)?;
    let password = bounded_password(secret, password)?;
    let fields = fields(binding)?;
    let identifiers = Identifiers {
        client: Some(&fields.client),
        server: Some(&fields.server),
    };
    let finish = state
        .finish(
            &mut rng()?,
            &password,
            response,
            ClientLoginFinishParameters::new(Some(&fields.context), identifiers, Some(&MvpKsf)),
        )
        .map_err(map_protocol)?;
    Ok(LoginFinish {
        message: finish.message.serialize().to_vec(),
        session_key: Zeroizing::new(finish.session_key.to_vec()),
    })
}

/// Verifies finalization server-side and returns the matching application session key.
///
/// # Errors
/// Returns one generic failure for tamper, replayed/wrong state, or binding changes.
pub fn server_login_finish(
    state: &[u8],
    finalization: &[u8],
    binding: Binding<'_>,
) -> Result<Zeroizing<Vec<u8>>, Error> {
    let state = ServerLogin::<Suite>::deserialize(state).map_err(map_protocol)?;
    let finalization =
        CredentialFinalization::<Suite>::deserialize(finalization).map_err(map_protocol)?;
    let fields = fields(binding)?;
    let identifiers = Identifiers {
        client: Some(&fields.client),
        server: Some(&fields.server),
    };
    state
        .finish(
            finalization,
            ServerLoginParameters {
                context: Some(&fields.context),
                identifiers,
            },
        )
        .map(|r| Zeroizing::new(r.session_key.to_vec()))
        .map_err(map_protocol)
}

fn bounded_password(secret: &[u8], password: &[u8]) -> Result<Zeroizing<Vec<u8>>, Error> {
    if secret.len() != 32 || password.is_empty() || password.len() > 1024 {
        return Err(Error::InvalidInput);
    }
    let mut out = Zeroizing::new(Vec::with_capacity(57 + password.len()));
    out.extend_from_slice(b"127Vaults/auth-input/1\0");
    out.extend_from_slice(secret);
    out.extend_from_slice(
        &(u16::try_from(password.len()).map_err(|_| Error::InvalidInput)?).to_be_bytes(),
    );
    out.extend_from_slice(password);
    Ok(out)
}

struct ProtocolFields {
    credential: Vec<u8>,
    client: Vec<u8>,
    server: Vec<u8>,
    context: Vec<u8>,
}

fn fields(binding: Binding<'_>) -> Result<ProtocolFields, Error> {
    if binding.origin.is_empty() || binding.origin.len() > 255 || !binding.origin.is_ascii() {
        return Err(Error::InvalidInput);
    }
    let mut credential = b"127Vaults/credential-id/1\0".to_vec();
    credential.extend_from_slice(&binding.installation);
    credential.extend_from_slice(&binding.account);
    let mut client = b"127Vaults/client-id/1\0".to_vec();
    client.extend_from_slice(&binding.installation);
    client.extend_from_slice(&binding.account);
    let mut server = b"127Vaults/server-id/1\0".to_vec();
    server.extend_from_slice(&binding.installation);
    server.extend_from_slice(&binding.server_public_key);
    let mut context = b"127Vaults/login-context/1\0".to_vec();
    let origin_len = u16::try_from(binding.origin.len()).map_err(|_| Error::InvalidInput)?;
    context.extend_from_slice(&origin_len.to_be_bytes());
    context.extend_from_slice(binding.origin);
    context.extend_from_slice(&binding.installation);
    context.extend_from_slice(&binding.account);
    context.extend_from_slice(&binding.device);
    context.extend_from_slice(&binding.epoch.to_be_bytes());
    context.extend_from_slice(&binding.attempt);
    Ok(ProtocolFields {
        credential,
        client,
        server,
        context,
    })
}

/// Deterministic protocol vector used to verify the exact cross-boundary profile.
/// Production callers must replace seeds with fail-closed OS/browser entropy.
///
/// # Errors
/// Returns `InvalidInput` for bounded input violations and
/// `AuthenticationFailed` for any protocol failure.
pub fn deterministic_protocol_vector(
    secret: &[u8],
    password: &[u8],
    binding: Binding<'_>,
    client_seed: [u8; 32],
    server_seed: [u8; 32],
) -> Result<[usize; 6], Error> {
    let mut password = bounded_password(secret, password)?;
    let fields = fields(binding)?;
    let identifiers = Identifiers {
        client: Some(&fields.client),
        server: Some(&fields.server),
    };
    let mut client_rng = ChaCha20Rng::from_seed(client_seed);
    let mut server_rng = ChaCha20Rng::from_seed(server_seed);
    let setup = ServerSetup::<Suite>::new(&mut server_rng);
    let registration =
        ClientRegistration::<Suite>::start(&mut client_rng, &password).map_err(map_protocol)?;
    let registration_request = registration.message.serialize();
    let response =
        ServerRegistration::<Suite>::start(&setup, registration.message, &fields.credential)
            .map_err(map_protocol)?;
    let registration_response = response.message.serialize();
    let upload = registration
        .state
        .finish(
            &mut client_rng,
            &password,
            response.message,
            ClientRegistrationFinishParameters::new(identifiers, Some(&MvpKsf)),
        )
        .map_err(map_protocol)?;
    let registration_upload = upload.message.serialize();
    let record = ServerRegistration::<Suite>::finish(upload.message);
    let login = ClientLogin::<Suite>::start(&mut client_rng, &password).map_err(map_protocol)?;
    let request = login.message.serialize();
    let challenge = ServerLogin::start(
        &mut server_rng,
        &setup,
        Some(record),
        login.message,
        &fields.credential,
        ServerLoginParameters {
            context: Some(&fields.context),
            identifiers,
        },
    )
    .map_err(map_protocol)?;
    let response = challenge.message.serialize();
    let finish = login
        .state
        .finish(
            &mut client_rng,
            &password,
            challenge.message,
            ClientLoginFinishParameters::new(Some(&fields.context), identifiers, Some(&MvpKsf)),
        )
        .map_err(map_protocol)?;
    let finalization = finish.message.serialize();
    challenge
        .state
        .finish(
            finish.message,
            ServerLoginParameters {
                context: Some(&fields.context),
                identifiers,
            },
        )
        .map_err(map_protocol)?;
    password.zeroize();
    Ok([
        registration_request.len(),
        registration_response.len(),
        registration_upload.len(),
        request.len(),
        response.len(),
        finalization.len(),
    ])
}

fn map_protocol<T>(_error: ProtocolError<T>) -> Error {
    Error::AuthenticationFailed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding<'static> {
        Binding {
            origin: b"https://127.0.0.1:12780",
            installation: [1; 16],
            account: [2; 16],
            device: [3; 16],
            epoch: 1,
            attempt: [4; 32],
            server_public_key: [5; 32],
        }
    }
    #[test]
    fn exact_profile_round_trip() {
        assert_eq!(
            deterministic_protocol_vector(
                &crate::random_test_bytes(),
                &crate::random_test_bytes(),
                binding(),
                crate::random_test_bytes(),
                crate::random_test_bytes()
            )
            .unwrap(),
            [32, 64, 192, 96, 320, 64]
        );
    }
    #[test]
    fn input_bounds_are_rejected() {
        let secret = crate::random_test_bytes();
        assert_eq!(
            bounded_password(&secret[..31], b"x").unwrap_err(),
            Error::InvalidInput
        );
        assert_eq!(
            bounded_password(&secret, b"").unwrap_err(),
            Error::InvalidInput
        );
        assert_eq!(
            bounded_password(&secret, &vec![0; 1025]).unwrap_err(),
            Error::InvalidInput
        );
    }

    #[test]
    fn split_production_boundary_and_context_tamper() {
        let account_secret = crate::random_test_bytes();
        let password = crate::random_test_bytes();
        let setup = server_setup().unwrap();
        let mut binding = binding();
        binding.server_public_key = server_public_key(&setup).unwrap();
        let registration = client_registration_start(&account_secret, &password).unwrap();
        let response = server_registration_start(&setup, &registration.message, binding).unwrap();
        let upload = client_registration_finish(
            &registration.state,
            &account_secret,
            &password,
            &response,
            binding,
        )
        .unwrap();
        let record = server_registration_finish(&upload).unwrap();
        let login = client_login_start(&account_secret, &password).unwrap();
        let challenge = server_login_start(&setup, Some(&record), &login.message, binding).unwrap();
        let finish = client_login_finish(
            &login.state,
            &account_secret,
            &password,
            &challenge.message,
            binding,
        )
        .unwrap();
        let server_key = server_login_finish(&challenge.state, &finish.message, binding).unwrap();
        assert_eq!(&*finish.session_key, &*server_key);
        let mut tampered = finish.message.clone();
        tampered[0] ^= 1;
        assert_eq!(
            server_login_finish(&challenge.state, &tampered, binding).unwrap_err(),
            Error::AuthenticationFailed
        );
    }
}
