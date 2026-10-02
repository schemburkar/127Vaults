//! Executable smoke demonstration; no real credentials or cryptographic claims.
use vaults_crypto::secrets::{SecretBuffer, SecretStore, SecretStoreError};

fn main() {
    let mut store = SecretStore::new(1);
    let first = store
        .insert(SecretBuffer::new(b"disposable-fixture".to_vec()))
        .unwrap();
    assert_eq!(
        format!("{:?}", store.get(first).unwrap()),
        "SecretBuffer([REDACTED])"
    );
    assert_eq!(store.get(first).unwrap().expose(), b"disposable-fixture");
    assert_eq!(
        store.insert(SecretBuffer::new(vec![0; 32])),
        Err(SecretStoreError::Capacity)
    );
    store.lock();
    assert!(matches!(
        store.get(first),
        Err(SecretStoreError::UnknownHandle)
    ));
    let second = store.insert(SecretBuffer::new(vec![0; 32])).unwrap();
    assert_ne!(first, second);
    let mut other = SecretStore::new(1);
    let foreign = other.insert(SecretBuffer::new(vec![0; 32])).unwrap();
    assert!(matches!(
        store.get(foreign),
        Err(SecretStoreError::UnknownHandle)
    ));
    store.release(second).unwrap();
    assert_eq!(store.release(second), Err(SecretStoreError::UnknownHandle));
    assert!(vaults_crypto::SUPPORTED_CRYPTO_FORMATS.is_empty());
    println!("Experimental secret-store smoke passed; no crypto formats available.");
}
