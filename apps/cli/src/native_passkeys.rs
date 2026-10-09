//! Native CTAP2 operations. Private credentials remain inside the vault process.
/// Native provider rollout is disabled; browser passkeys remain supported.
pub const WINDOWS_NATIVE_PASSKEYS_ENABLED: bool = false;
use crate::{agent, client::Session};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ciborium::value::Value as Cbor;
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
};
use rand_core::{OsRng, RngCore};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
};
use zeroize::Zeroizing;

fn field(map: &Cbor, number: i32) -> Result<&Cbor, String> {
    map.as_map()
        .and_then(|map| {
            map.iter()
                .find(|(key, _)| {
                    key.as_integer()
                        .is_some_and(|i| i128::from(i) == i128::from(number))
                })
                .map(|(_, value)| value)
        })
        .ok_or_else(|| "Missing CTAP field".to_owned())
}
fn text_field<'a>(map: &'a Cbor, name: &str) -> Result<&'a Cbor, String> {
    map.as_map()
        .and_then(|map| {
            map.iter()
                .find(|(key, _)| key.as_text() == Some(name))
                .map(|(_, value)| value)
        })
        .ok_or_else(|| "Missing CTAP entity field".to_owned())
}
fn text(value: &Cbor) -> Result<&str, String> {
    value
        .as_text()
        .filter(|s| s.len() <= 256)
        .ok_or_else(|| "Invalid CTAP text".to_owned())
}
fn bytes(value: &Cbor, min: usize, max: usize) -> Result<&[u8], String> {
    value
        .as_bytes()
        .filter(|b| (min..=max).contains(&b.len()))
        .map(Vec::as_slice)
        .ok_or_else(|| "Invalid CTAP bytes".to_owned())
}
fn integer(n: i32) -> Cbor {
    Cbor::Integer(n.into())
}
fn map(rows: Vec<(i32, Cbor)>) -> Cbor {
    Cbor::Map(rows.into_iter().map(|(k, v)| (integer(k), v)).collect())
}
fn encoded(value: &Cbor) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    ciborium::into_writer(value, &mut out).map_err(|_| "CTAP encoding failed")?;
    Ok(out)
}
fn descriptors(request: &Cbor, key: i32) -> Result<Vec<String>, String> {
    let Ok(value) = field(request, key) else {
        return Ok(Vec::new());
    };
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 64)
        .ok_or("Invalid credential list")?;
    rows.iter()
        .map(|row| {
            if text(text_field(row, "type")?)? != "public-key" {
                return Err("Invalid credential type".to_owned());
            }
            Ok(URL_SAFE_NO_PAD.encode(bytes(text_field(row, "id")?, 1, 1024)?))
        })
        .collect()
}
fn request(value: &Value) -> Result<(Cbor, String, String), String> {
    let raw = hex::decode(value["requestHex"].as_str().ok_or("Missing request")?)
        .map_err(|_| "Invalid request")?;
    if raw.is_empty() || raw.len() > 65536 {
        return Err("Request exceeds size limit".to_owned());
    }
    let mut reader = std::io::Cursor::new(&raw);
    let decoded: Cbor = ciborium::from_reader(&mut reader).map_err(|_| "Invalid CTAP request")?;
    if reader.position() != raw.len() as u64 {
        return Err("Trailing CTAP data".to_owned());
    }
    let create = value["operation"] == "create";
    if !create && value["operation"] != "get" {
        return Err("Invalid operation".to_owned());
    }
    let rp = if create {
        text(text_field(field(&decoded, 2)?, "id")?)?
    } else {
        text(field(&decoded, 1)?)?
    };
    let origin = format!("https://{rp}");
    let url = url::Url::parse(&origin).map_err(|_| "Invalid relying party")?;
    if url.host_str() != Some(rp) || url.origin().ascii_serialization() != origin {
        return Err("Invalid relying party".to_owned());
    }
    bytes(field(&decoded, if create { 1 } else { 2 })?, 32, 32)?;
    // Unsupported extensions fail closed rather than claiming their semantics.
    if let Ok(extensions) = field(&decoded, if create { 6 } else { 4 })
        && !extensions.as_map().is_some_and(Vec::is_empty)
    {
        return Err(
            "This native provider does not support the requested CTAP extension".to_owned(),
        );
    }
    let rp_owned = rp.to_owned();
    Ok((decoded, rp_owned, origin))
}

static USED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// Handles metadata preview or an OS-verified operation in the unlocked agent.
#[allow(clippy::too_many_lines)] // Keep the two CTAP response branches together.
pub(crate) fn dispatch(
    session: &mut Session,
    envelope: &Value,
    preview: bool,
) -> Result<Value, String> {
    if !WINDOWS_NATIVE_PASSKEYS_ENABLED {
        return Err("Native Windows passkeys are disabled; use the browser extension".to_owned());
    }
    let (request, rp, origin) = request(envelope)?;
    let create = envelope["operation"] == "create";
    let entries = session.passkey_list(&origin)?;
    let ids = descriptors(&request, if create { 5 } else { 3 })?;
    let eligible: Vec<_> = entries
        .as_array()
        .ok_or("Invalid passkey list")?
        .iter()
        .filter(|entry| {
            ids.is_empty()
                || ids
                    .iter()
                    .any(|id| entry["metadata"]["credentialId"] == *id)
        })
        .cloned()
        .collect();
    if preview {
        return Ok(json!({"rpId":rp,"vaults":session.vault_list()?,"entries":eligible}));
    }
    verify_os(envelope)?;
    let transaction = envelope["transaction"]
        .as_str()
        .ok_or("Missing transaction")?;
    uuid::Uuid::parse_str(transaction).map_err(|_| "Invalid transaction")?;
    let mut transactions = USED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| "Native provider unavailable")?;
    let operation_hash = hex::encode(Sha256::digest(
        hex::decode(envelope["requestHex"].as_str().ok_or("Missing request")?)
            .map_err(|_| "Invalid request")?,
    ));
    if transactions.len() >= 4096 || !transactions.insert(operation_hash) {
        return Err("Expired or repeated Windows operation".to_owned());
    }
    drop(transactions);
    let mut auth = Sha256::digest(rp.as_bytes()).to_vec();
    auth.push(if create { 0x4d } else { 0x0d });
    auth.extend([0_u8; 4]);
    let (response, cache) = if create {
        if !eligible.is_empty() && !ids.is_empty() {
            return Err("Credential excluded by website".to_owned());
        }
        let algorithms = field(&request, 4)?.as_array().ok_or("Missing algorithms")?;
        if !algorithms.iter().any(|entry| {
            text_field(entry, "alg")
                .ok()
                .and_then(Cbor::as_integer)
                .is_some_and(|alg| i128::from(alg) == -7)
        }) {
            return Err("ES256 is required".to_owned());
        }
        let user = field(&request, 3)?;
        let handle = bytes(text_field(user, "id")?, 1, 64)?;
        let username = text(text_field(user, "name")?)?;
        let display = text_field(user, "displayName")
            .ok()
            .and_then(Cbor::as_text)
            .unwrap_or(username);
        if display.len() > 256 {
            return Err("Invalid display name".to_owned());
        }
        let key = SigningKey::random(&mut OsRng);
        let private = Zeroizing::new(
            URL_SAFE_NO_PAD.encode(
                key.to_pkcs8_der()
                    .map_err(|_| "Key encoding failed")?
                    .as_bytes(),
            ),
        );
        let point = key.verifying_key().to_encoded_point(false);
        let mut id = [0_u8; 32];
        OsRng.fill_bytes(&mut id);
        let meta = json!({"version":1,"algorithm":-7,"signCount":0,"origin":origin,"rpId":rp,"credentialId":URL_SAFE_NO_PAD.encode(id),"userHandle":URL_SAFE_NO_PAD.encode(handle),"username":username,"displayName":display});
        let vault = envelope["vaultId"].as_str().ok_or("Choose a vault")?;
        let saved = session.passkey_save(vault, &origin, &meta, &private)?;
        auth.extend([0_u8; 16]);
        auth.extend([0, 32]);
        auth.extend(id);
        auth.extend(encoded(&map(vec![
            (1, integer(2)),
            (3, integer(-7)),
            (-1, integer(1)),
            (
                -2,
                Cbor::Bytes(point.x().ok_or("Invalid public key")?.to_vec()),
            ),
            (
                -3,
                Cbor::Bytes(point.y().ok_or("Invalid public key")?.to_vec()),
            ),
        ]))?);
        (
            map(vec![
                (1, Cbor::Text("none".to_owned())),
                (2, Cbor::Bytes(auth)),
                (3, Cbor::Map(Vec::new())),
            ]),
            json!({"metadata":meta,"itemId":saved["itemId"],"vaultId":vault,"queued":saved["queued"]==true}),
        )
    } else {
        let entry = eligible
            .iter()
            .find(|entry| {
                entry["itemId"] == envelope["itemId"] && entry["vaultId"] == envelope["vaultId"]
            })
            .ok_or("Choose a matching passkey")?;
        let mut secret = session.passkey_get(
            entry["vaultId"].as_str().ok_or("Invalid vault")?,
            entry["itemId"].as_str().ok_or("Invalid item")?,
            &origin,
        )?;
        let private = match secret["privateKey"].take() {
            Value::String(value) => Zeroizing::new(value),
            _ => return Err("Missing key".to_owned()),
        };
        let key_bytes = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(private.as_str())
                .map_err(|_| "Invalid private key")?,
        );
        let key = SigningKey::from_pkcs8_der(&key_bytes).map_err(|_| "Invalid key")?;
        let mut signed = auth.clone();
        signed.extend(bytes(field(&request, 2)?, 32, 32)?);
        let signature: Signature = key.sign(&signed);
        let meta = &entry["metadata"];
        let id = URL_SAFE_NO_PAD
            .decode(meta["credentialId"].as_str().ok_or("Invalid credential")?)
            .map_err(|_| "Invalid credential")?;
        let handle = URL_SAFE_NO_PAD
            .decode(meta["userHandle"].as_str().ok_or("Invalid user")?)
            .map_err(|_| "Invalid user")?;
        (
            map(vec![
                (
                    1,
                    Cbor::Map(vec![
                        (Cbor::Text("id".to_owned()), Cbor::Bytes(id)),
                        (
                            Cbor::Text("type".to_owned()),
                            Cbor::Text("public-key".to_owned()),
                        ),
                    ]),
                ),
                (2, Cbor::Bytes(auth)),
                (3, Cbor::Bytes(signature.to_der().as_bytes().to_vec())),
                (
                    4,
                    Cbor::Map(vec![
                        (Cbor::Text("id".to_owned()), Cbor::Bytes(handle)),
                        (
                            Cbor::Text("name".to_owned()),
                            Cbor::Text(meta["username"].as_str().unwrap_or("").to_owned()),
                        ),
                    ]),
                ),
            ]),
            json!(null),
        )
    };
    Ok(json!({"responseHex":hex::encode(encoded(&response)?),"cache":cache}))
}

fn verify_os(envelope: &Value) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|_| "Provider path unavailable")?
        .with_file_name("127vaults-passkey-provider.exe");
    let mut command = Command::new(exe);
    command
        .arg("--verify")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Native Windows verifier is not installed")?;
    child
        .stdin
        .take()
        .ok_or("Verifier input unavailable")?
        .write_all(envelope.to_string().as_bytes())
        .map_err(|_| "Verifier input failed")?;
    if !child.wait().map_err(|_| "Verifier failed")?.success() {
        return Err("Windows request or user verification signature failed".to_owned());
    }
    Ok(())
}

/// Receives one bounded native-provider message over inherited anonymous pipes.
///
/// # Errors
/// Returns a diagnostic if the desktop is locked or the request is invalid.
pub fn run_host() -> Result<(), String> {
    if !WINDOWS_NATIVE_PASSKEYS_ENABLED {
        return Err("Native Windows passkeys are disabled; use the browser extension".to_owned());
    }
    let mut input = String::new();
    std::io::stdin()
        .take(262_145)
        .read_to_string(&mut input)
        .map_err(|_| "Cannot read request")?;
    if input.len() > 262_144 {
        return Err("Request too large".to_owned());
    }
    let envelope: Value = serde_json::from_str(&input).map_err(|_| "Invalid native request")?;
    let config = dirs::config_dir()
        .ok_or("Desktop profile unavailable")?
        .join("127Vaults");
    if envelope["kind"] == "status" || envelope["kind"] == "cache" {
        let action = if envelope["kind"] == "status" {
            "status"
        } else {
            "native.cache"
        };
        let result = agent::call(&config, action, json!({}))?;
        println!("{result}");
        return Ok(());
    }
    let preview = envelope["preview"] == true;
    let result = agent::call(
        &config,
        if preview {
            "native.preview"
        } else {
            "native.perform"
        },
        json!({"passkey_metadata":envelope}),
    )?;
    println!("{result}");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn disabled_native_host_refuses_before_reading_requests() {
        assert!(super::run_host().unwrap_err().contains("disabled"));
    }

    use super::*;
    use p256::ecdsa::signature::Verifier;
    #[test]
    fn native_requests_bind_rp_and_reject_extensions_and_trailing_bytes() {
        let request = map(vec![
            (1, Cbor::Bytes(vec![1; 32])),
            (
                2,
                Cbor::Map(vec![(
                    Cbor::Text("id".to_owned()),
                    Cbor::Text("autofill.me".to_owned()),
                )]),
            ),
        ]);
        let mut message =
            json!({"operation":"create","requestHex":hex::encode(encoded(&request).unwrap())});
        let (_, rp, origin) = super::request(&message).unwrap();
        assert_eq!(rp, "autofill.me");
        assert_eq!(origin, "https://autofill.me");
        message["requestHex"] = json!(format!("{}00", message["requestHex"].as_str().unwrap()));
        assert!(super::request(&message).is_err());
        let bad = map(vec![
            (1, Cbor::Text("example.test/path".to_owned())),
            (2, Cbor::Bytes(vec![1; 32])),
        ]);
        assert!(
            super::request(
                &json!({"operation":"get","requestHex":hex::encode(encoded(&bad).unwrap())})
            )
            .is_err()
        );
    }
    #[test]
    fn native_signatures_use_standard_es256_der_and_import_existing_pkcs8() {
        let key = SigningKey::random(&mut OsRng);
        let imported = SigningKey::from_pkcs8_der(key.to_pkcs8_der().unwrap().as_bytes()).unwrap();
        let mut auth = Sha256::digest(b"autofill.me").to_vec();
        auth.extend([0x0d, 0, 0, 0, 0]);
        auth.extend([5_u8; 32]);
        let signature: Signature = imported.sign(&auth);
        assert!(
            key.verifying_key()
                .verify(
                    &auth,
                    &Signature::from_der(signature.to_der().as_bytes()).unwrap()
                )
                .is_ok()
        );
        auth[0] ^= 1;
        assert!(key.verifying_key().verify(&auth, &signature).is_err());
    }
}
