#![doc = "Cryptographic boundary for 127Vaults."]

pub mod ecf1;
pub mod generator;
pub mod opaque;
pub mod private_vault;
pub mod secrets;

#[cfg(test)]
fn random_test_bytes() -> [u8; 32] {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).expect("test entropy");
    bytes
}

/// Classification of a cryptographic format identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CryptoFormatStatus {
    /// The identifier is unknown and must not be decoded.
    Unknown,
    /// The identifier is reserved for disposable interoperability fixtures only.
    Experimental,
    /// The identifier is approved for durable data and real secrets.
    Supported,
}

/// Feasibility revision only. No content cryptographic format is supported yet.
pub const CORE_INTERFACE_REVISION: u16 = 1;
pub const SUPPORTED_CRYPTO_FORMATS: &[u16] = &[];
/// Disposable format capability. It is intentionally excluded from stable formats.
pub const EXPERIMENTAL_CRYPTO_FORMATS: &[u16] = &[1];

/// Returns the registry status without implying that a known candidate is safe.
#[must_use]
pub fn crypto_format_status(version: u16) -> CryptoFormatStatus {
    if SUPPORTED_CRYPTO_FORMATS.contains(&version) {
        CryptoFormatStatus::Supported
    } else if EXPERIMENTAL_CRYPTO_FORMATS.contains(&version) {
        CryptoFormatStatus::Experimental
    } else {
        CryptoFormatStatus::Unknown
    }
}

/// Production admission check. This deliberately rejects ECF1 while the stable list is empty.
#[must_use]
pub fn accepts_real_secret_format(version: u16) -> bool {
    crypto_format_status(version) == CryptoFormatStatus::Supported
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_keeps_experimental_distinct_from_supported() {
        assert!(SUPPORTED_CRYPTO_FORMATS.is_empty());
        assert_eq!(crypto_format_status(1), CryptoFormatStatus::Experimental);
        assert_eq!(crypto_format_status(0), CryptoFormatStatus::Unknown);
        assert_eq!(crypto_format_status(u16::MAX), CryptoFormatStatus::Unknown);
        assert!(!accepts_real_secret_format(1));
    }
}

/// Marker type for bytes the server may store without interpreting.
///
/// This is intentionally not a cryptographic implementation. Algorithms and
/// serialization will be added only after the key hierarchy ADR is accepted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Ciphertext(Vec<u8>);

impl Ciphertext {
    #[must_use]
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}
