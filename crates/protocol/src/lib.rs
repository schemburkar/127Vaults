#![doc = "Versioned protocol-domain types shared by server and clients."]

/// Protocol versions are explicit so incompatible clients fail closed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtocolVersion(pub u16);

pub const INITIAL_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion(1);

/// Protocol versions accepted by this candidate implementation.
pub const CANDIDATE_PROTOCOL_VERSIONS: &[ProtocolVersion] = &[INITIAL_PROTOCOL_VERSION];

/// Returns the version only when it is explicitly present in the registry.
/// Unknown, zero, and future versions fail closed.
///
/// # Errors
/// Returns [`VersionError::Unsupported`] when `raw` is not registered.
pub fn require_candidate_protocol_version(raw: u16) -> Result<ProtocolVersion, VersionError> {
    let version = ProtocolVersion(raw);
    CANDIDATE_PROTOCOL_VERSIONS
        .contains(&version)
        .then_some(version)
        .ok_or(VersionError::Unsupported)
}

/// Bounded failure for protocol-version admission.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VersionError {
    /// The peer supplied a version absent from the explicit registry.
    Unsupported,
}

pub mod signed_sync {
    #![allow(clippy::missing_errors_doc)]
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use serde_json::{Map, Value};
    use sha2::{Digest, Sha256};

    pub const GENESIS_HASH: &str =
        "0000000000000000000000000000000000000000000000000000000000000000";

    fn canonical(value: &Value, out: &mut String) -> Result<(), &'static str> {
        match value {
            Value::Null => out.push_str("null"),
            Value::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Value::Number(v) if v.as_i64().is_some() || v.as_u64().is_some() => {
                out.push_str(&v.to_string());
            }
            Value::String(v) => {
                out.push_str(&serde_json::to_string(v).map_err(|_| "invalid signed JSON")?);
            }
            Value::Array(values) => {
                out.push('[');
                for (i, v) in values.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    canonical(v, out)?;
                }
                out.push(']');
            }
            Value::Object(values) => {
                out.push('{');
                let mut keys: Vec<_> = values.keys().collect();
                keys.sort();
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(key).map_err(|_| "invalid signed JSON")?);
                    out.push(':');
                    canonical(&values[*key], out)?;
                }
                out.push('}');
            }
            Value::Number(_) => return Err("invalid signed JSON"),
        }
        Ok(())
    }

    pub fn canonical_bytes(value: &Value) -> Result<Vec<u8>, &'static str> {
        let mut encoded = String::new();
        canonical(value, &mut encoded)?;
        Ok(encoded.into_bytes())
    }

    fn body(value: &Value, fields: &[&str]) -> Result<Value, &'static str> {
        let source = value.as_object().ok_or("invalid signed object")?;
        let mut result = Map::new();
        for field in fields {
            result.insert(
                (*field).to_owned(),
                source.get(*field).ok_or("missing signed field")?.clone(),
            );
        }
        Ok(Value::Object(result))
    }

    fn verify(value: &Value, fields: &[&str], public_key: &[u8; 32]) -> Result<(), &'static str> {
        let mut encoded = String::new();
        canonical(&body(value, fields)?, &mut encoded)?;
        let signature = URL_SAFE_NO_PAD
            .decode(value["signature"].as_str().ok_or("invalid signature")?)
            .map_err(|_| "invalid signature")?;
        let signature = Signature::from_slice(&signature).map_err(|_| "invalid signature")?;
        VerifyingKey::from_bytes(public_key)
            .map_err(|_| "invalid public key")?
            .verify(encoded.as_bytes(), &signature)
            .map_err(|_| "signature verification failed")
    }

    pub fn checkpoint_hash(value: &Value) -> Result<String, &'static str> {
        let signed = body(
            value,
            &[
                "protocolVersion",
                "tenantId",
                "vaultId",
                "epoch",
                "cursor",
                "previousCheckpointHash",
                "operationHeadHash",
                "signature",
            ],
        )?;
        let mut encoded = String::new();
        canonical(&signed, &mut encoded)?;
        Ok(hex::encode(Sha256::digest(encoded.as_bytes())))
    }

    pub fn verify_checkpoint(
        value: &Value,
        public_key: &[u8; 32],
        tenant: &str,
        vault: &str,
        epoch: u64,
        previous: Option<&Value>,
    ) -> Result<(), &'static str> {
        if value["protocolVersion"] != 1
            || value["tenantId"] != tenant
            || value["vaultId"] != vault
            || value["epoch"] != epoch
        {
            return Err("checkpoint scope mismatch");
        }
        let cursor = value["cursor"]
            .as_u64()
            .ok_or("invalid checkpoint cursor")?;
        let expected_previous = previous
            .map(checkpoint_hash)
            .transpose()?
            .unwrap_or_else(|| GENESIS_HASH.to_owned());
        if value["previousCheckpointHash"] != expected_previous {
            return Err("checkpoint fork detected");
        }
        if previous
            .and_then(|v| v["cursor"].as_u64())
            .is_some_and(|old| cursor < old)
        {
            return Err("checkpoint rollback detected");
        }
        verify(
            value,
            &[
                "protocolVersion",
                "tenantId",
                "vaultId",
                "epoch",
                "cursor",
                "previousCheckpointHash",
                "operationHeadHash",
            ],
            public_key,
        )
    }

    pub fn verify_checkpoint_signature(
        value: &Value,
        public_key: &[u8; 32],
        tenant: &str,
        vault: &str,
        epoch: u64,
    ) -> Result<(), &'static str> {
        if value["protocolVersion"] != 1
            || value["tenantId"] != tenant
            || value["vaultId"] != vault
            || value["epoch"] != epoch
            || value["cursor"].as_u64().is_none()
        {
            return Err("checkpoint scope mismatch");
        }
        verify(
            value,
            &[
                "protocolVersion",
                "tenantId",
                "vaultId",
                "epoch",
                "cursor",
                "previousCheckpointHash",
                "operationHeadHash",
            ],
            public_key,
        )
    }

    pub fn verify_operation(
        value: &Value,
        public_key: &[u8; 32],
        tenant: &str,
        vault: &str,
        epoch: u64,
    ) -> Result<(), &'static str> {
        if value["protocolVersion"] != 1
            || value["tenantId"] != tenant
            || value["vaultId"] != vault
            || value["epoch"] != epoch
        {
            return Err("operation scope mismatch");
        }
        let mut fields = vec![
            "protocolVersion",
            "tenantId",
            "vaultId",
            "deviceId",
            "epoch",
            "causalBase",
            "previousDeviceOpId",
            "kind",
            "itemId",
            "payloadHash",
        ];
        if value.get("clientTime").is_some() {
            fields.push("clientTime");
        }
        let unsigned = body(value, &fields)?;
        let mut encoded = String::new();
        canonical(&unsigned, &mut encoded)?;
        if hex::encode(Sha256::digest(encoded.as_bytes()))
            != value["opId"].as_str().ok_or("invalid operation ID")?
        {
            return Err("operation ID verification failed");
        }
        fields.push("opId");
        verify(value, &fields, public_key)
    }

    pub fn next_operation_head(previous: &str, operation: &Value) -> Result<String, &'static str> {
        if previous.len() != 64 || !previous.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid operation head");
        }
        let value = serde_json::json!({"previousHead":previous,"opId":operation["opId"],"signature":operation["signature"]});
        let mut encoded = String::new();
        canonical(&value, &mut encoded)?;
        Ok(hex::encode(Sha256::digest(encoded.as_bytes())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;
    use sha2::{Digest, Sha256};

    #[test]
    fn unknown_versions_fail_closed() {
        assert_eq!(
            require_candidate_protocol_version(1),
            Ok(ProtocolVersion(1))
        );
        assert_eq!(
            require_candidate_protocol_version(0),
            Err(VersionError::Unsupported)
        );
        assert_eq!(
            require_candidate_protocol_version(2),
            Err(VersionError::Unsupported)
        );
        assert_eq!(
            require_candidate_protocol_version(u16::MAX),
            Err(VersionError::Unsupported)
        );
    }

    #[test]
    fn signed_operation_and_checkpoint_tampering_fail_closed() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let mut operation = json!({"protocolVersion":1,"tenantId":"tenant","vaultId":"vault","deviceId":"device","epoch":1,"causalBase":0,"previousDeviceOpId":null,"kind":"item.create","itemId":"item","payloadHash":"11".repeat(32)});
        let op_id = hex::encode(Sha256::digest(
            signed_sync::canonical_bytes(&operation).unwrap(),
        ));
        operation["opId"] = json!(op_id);
        operation["signature"] = json!(
            URL_SAFE_NO_PAD.encode(
                key.sign(&signed_sync::canonical_bytes(&operation).unwrap())
                    .to_bytes()
            )
        );
        assert!(
            signed_sync::verify_operation(
                &operation,
                &key.verifying_key().to_bytes(),
                "tenant",
                "vault",
                1
            )
            .is_ok()
        );
        operation["payloadHash"] = json!("22".repeat(32));
        assert!(
            signed_sync::verify_operation(
                &operation,
                &key.verifying_key().to_bytes(),
                "tenant",
                "vault",
                1
            )
            .is_err()
        );
    }
}
