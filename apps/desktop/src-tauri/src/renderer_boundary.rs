use serde_json::Value;

const PRIVATE_KEY: &str = "__127vaults_passkey_key";

pub fn allow_secret(summary: &Value, field: &str) -> Result<(), String> {
    let reserved = field == PRIVATE_KEY
        || summary["customFields"].as_array().is_some_and(|fields| {
            fields.iter().any(|row| {
                row["id"] == PRIVATE_KEY
                    && (row["id"] == field
                        || row["label"]
                            .as_str()
                            .is_some_and(|label| label.eq_ignore_ascii_case(field)))
            })
        });
    if reserved {
        Err("Passkey private keys are unavailable through item commands".into())
    } else {
        Ok(())
    }
}

// Conflict comparisons contain decrypted bodies rather than item summaries.
pub fn public_value(mut value: Value) -> Value {
    match &mut value {
        Value::Array(rows) => {
            rows.retain(|row| row["id"] != PRIVATE_KEY);
            for row in rows {
                *row = public_value(row.take());
            }
        }
        Value::Object(fields) => {
            for row in fields.values_mut() {
                *row = public_value(row.take());
            }
        }
        _ => {}
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn keys_and_their_label_aliases_are_not_renderer_secrets() {
        let summary = json!({"customFields":[{"id":PRIVATE_KEY,"label":"Passkey private key","type":"password"}]});
        assert!(allow_secret(&summary, PRIVATE_KEY).is_err());
        assert!(allow_secret(&summary, "PASSKEY PRIVATE KEY").is_err());
        assert!(allow_secret(&summary, "password").is_ok());
        assert!(allow_secret(&summary, "ordinary-secret").is_ok());
    }
    #[test]
    fn nested_conflict_values_keep_ordinary_fields_but_never_keys() {
        let value = public_value(
            json!({"server":{"customFields":[{"id":PRIVATE_KEY,"value":"synthetic-key"},{"id":"ordinary","value":"retained"}]}}),
        );
        assert_eq!(value["server"]["customFields"].as_array().unwrap().len(), 1);
        assert!(!value.to_string().contains("synthetic-key"));
    }
}
