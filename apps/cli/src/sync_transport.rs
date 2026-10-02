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
