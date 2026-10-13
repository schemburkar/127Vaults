use reqwest::{Method, StatusCode, blocking::Client};
use serde_json::{Value, json};

fn rejection(status: StatusCode) -> &'static str {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => "sync authorization was revoked",
        StatusCode::CONFLICT => "sync conflict",
        StatusCode::LOCKED => "sync is frozen by an integrity failure",
        _ => "sync transport rejected the request",
    }
}

pub trait SyncTransport {
    fn pull(&self, vault_id: &str, cursor: u64, limit: u16) -> Result<Value, String>;
    fn checkpoint(&self, vault_id: &str) -> Result<Value, String>;
    #[allow(dead_code)]
    fn submit(&self, vault_id: &str, operation: &Value) -> Result<Value, String>;
}

/// Collect bounded pages; signature and checkpoint verification happen before
/// committing the resulting history to the replica.
pub fn pull_history(transport: &impl SyncTransport, vault_id: &str) -> Result<Value, String> {
    let mut cursor = 0_u64;
    let mut operations = Vec::new();
    let mut keys = serde_json::Map::new();
    let mut size = 0_u64;
    loop {
        let page = transport.pull(vault_id, cursor, 500)?;
        let rows = page["operations"]
            .as_array()
            .ok_or("invalid sync response")?;
        let next = page["cursor"].as_u64().ok_or("invalid sync cursor")?;
        let more = page["hasMore"].as_bool().ok_or("invalid sync pagination")?;
        let page_keys = page["devicePublicKeys"]
            .as_object()
            .ok_or("operation verification keys are missing")?;
        let last = rows
            .last()
            .and_then(|row| row["cursor"].as_u64())
            .unwrap_or(cursor);
        if rows.len() > 500 || next != last || next < cursor || more && next <= cursor {
            return Err("invalid sync pagination; local replica was preserved".to_owned());
        }
        size += u64::try_from(
            serde_json::to_vec(rows)
                .map_err(|_| "invalid sync response")?
                .len(),
        )
        .map_err(|_| "sync history too large")?;
        if size > crate::replica::MAX_REPLICA_BYTES {
            return Err(
                "sync history exceeds local replica size; local replica was preserved".to_owned(),
            );
        }
        for (device, key) in page_keys {
            if keys.get(device).is_some_and(|previous| previous != key) {
                return Err(
                    "operation verification key changed between pages; local replica was preserved"
                        .to_owned(),
                );
            }
            keys.insert(device.clone(), key.clone());
        }
        operations.extend(rows.iter().cloned());
        if !more {
            return Ok(
                json!({"cursor":next,"operations":operations,"devicePublicKeys":keys,"hasMore":false}),
            );
        }
        cursor = next;
    }
}

#[derive(Clone)]
pub struct HttpSyncTransport {
    client: Client,
    origin: String,
    cookie: String,
    csrf: String,
}

impl HttpSyncTransport {
    pub fn new(client: Client, origin: String, cookie: String, csrf: String) -> Self {
        Self {
            client,
            origin,
            cookie,
            csrf,
        }
    }

    fn response(&self, method: &Method, path: &str, body: Option<&Value>) -> Result<Value, String> {
        let mut request = self
            .client
            .request(method.clone(), format!("{}{path}", self.origin))
            .header("Cookie", &self.cookie);
        if method != Method::GET {
            request = request
                .header("Origin", &self.origin)
                .header("X-127V-CSRF", &self.csrf);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .map_err(|_| "sync transport unavailable".to_owned())?;
        if !response.status().is_success() {
            return Err(rejection(response.status()).to_owned());
        }
        response
            .json()
            .map_err(|_| "invalid sync response".to_owned())
    }
}

impl SyncTransport for HttpSyncTransport {
    fn pull(&self, vault_id: &str, cursor: u64, limit: u16) -> Result<Value, String> {
        self.response(
            &Method::GET,
            &format!("/api/v1/vaults/{vault_id}/operations?cursor={cursor}&limit={limit}"),
            None,
        )
    }

    fn checkpoint(&self, vault_id: &str) -> Result<Value, String> {
        self.response(
            &Method::GET,
            &format!("/api/v1/vaults/{vault_id}/checkpoint"),
            None,
        )
    }

    fn submit(&self, vault_id: &str, operation: &Value) -> Result<Value, String> {
        self.response(
            &Method::POST,
            &format!("/api/v1/vaults/{vault_id}/operations"),
            Some(&json!({"operation":operation})),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Pages(RefCell<Vec<Value>>, RefCell<Vec<u64>>);

    impl SyncTransport for Pages {
        fn pull(&self, _: &str, cursor: u64, limit: u16) -> Result<Value, String> {
            assert_eq!(limit, 500);
            self.1.borrow_mut().push(cursor);
            Ok(self.0.borrow_mut().remove(0))
        }
        fn checkpoint(&self, _: &str) -> Result<Value, String> {
            panic!("pagination does not bypass the caller's verification")
        }
        fn submit(&self, _: &str, _: &Value) -> Result<Value, String> {
            panic!("history loading is read-only")
        }
    }

    fn page(start: u64, end: u64, more: bool, key: &str) -> Value {
        let rows: Vec<Value> = (start..=end)
            .map(|cursor| json!({"cursor":cursor}))
            .collect();
        json!({"cursor":end,"operations":rows,"hasMore":more,"devicePublicKeys":{"device":key}})
    }

    #[test]
    fn history_reads_past_first_page_without_submitting() {
        let transport = Pages(
            RefCell::new(vec![
                page(1, 500, true, "key"),
                page(501, 502, false, "key"),
            ]),
            RefCell::new(Vec::new()),
        );
        let history = pull_history(&transport, "vault").unwrap();
        assert_eq!(history["operations"].as_array().unwrap().len(), 502);
        assert_eq!(history["cursor"], 502);
        assert_eq!(*transport.1.borrow(), vec![0, 500]);
    }

    #[test]
    fn history_rejects_stalled_cursor_and_changed_verification_key() {
        let stalled = Pages(
            RefCell::new(vec![
                json!({"cursor":0,"operations":[],"hasMore":true,"devicePublicKeys":{}}),
            ]),
            RefCell::new(Vec::new()),
        );
        assert!(
            pull_history(&stalled, "vault")
                .unwrap_err()
                .contains("pagination")
        );
        let changed = Pages(
            RefCell::new(vec![
                page(1, 1, true, "first"),
                page(2, 2, false, "replacement"),
            ]),
            RefCell::new(Vec::new()),
        );
        assert!(
            pull_history(&changed, "vault")
                .unwrap_err()
                .contains("key changed")
        );
        let mut mismatch = page(1, 2, false, "key");
        mismatch["cursor"] = json!(3);
        let transport = Pages(RefCell::new(vec![mismatch]), RefCell::new(Vec::new()));
        assert!(
            pull_history(&transport, "vault")
                .unwrap_err()
                .contains("pagination")
        );
    }

    #[test]
    fn trait_keeps_operation_and_checkpoint_routes_out_of_command_handlers() {
        fn accepts_transport<T: SyncTransport>() {}
        accepts_transport::<HttpSyncTransport>();
    }

    #[test]
    fn revocation_and_conflict_are_distinct_safe_errors() {
        assert_eq!(
            rejection(StatusCode::FORBIDDEN),
            "sync authorization was revoked"
        );
        assert_eq!(rejection(StatusCode::CONFLICT), "sync conflict");
    }
}
