use super::profile;
use reqwest::blocking::Client;
use serde_json::Value;
use std::{fs, path::Path};

/// Receives an authenticated license response away from the desktop command thread.
pub fn fetch_license_status(request: reqwest::blocking::RequestBuilder) -> Result<Value, String> {
    let response = request
        .send()
        .map_err(|error| server_connection_error(&error))?;
    if !response.status().is_success() {
        return Err(format!(
            "server rejected request ({})",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .map_err(|_| "invalid server response".to_owned())
}

pub(super) fn post(
    client: &Client,
    origin: &str,
    path: &str,
    csrf: &str,
    cookie: &str,
    body: &Value,
) -> Result<reqwest::blocking::Response, String> {
    let response = client
        .post(format!("{origin}{path}"))
        .header("Origin", origin)
        .header("X-127V-CSRF", csrf)
        .header("Cookie", cookie)
        .json(body)
        .send()
        .map_err(|error| server_connection_error(&error))?;
    if !response.status().is_success() {
        return Err(format!(
            "server rejected request ({})",
            response.status().as_u16()
        ));
    }
    Ok(response)
}

pub(super) fn http_client(config_dir: &Path) -> Result<(Client, String, String, String), String> {
    let origin = profile(&config_dir.join("trust.conf"), "url")?
        .trim_end_matches('/')
        .to_owned();
    let server_id = profile(&config_dir.join("trust.conf"), "server_id")?;
    let device_id = profile(&config_dir.join("device.conf"), "device_id")?;
    let ca = fs::read(config_dir.join("installation-ca.pem"))
        .map_err(|_| "installation CA is missing".to_owned())?;
    let cert =
        reqwest::Certificate::from_pem(&ca).map_err(|_| "installation CA is invalid".to_owned())?;
    let client = Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(cert)
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "could not initialize HTTPS client".to_owned())?;
    Ok((client, origin, server_id, device_id))
}

pub(super) fn server_connection_error(error: &reqwest::Error) -> String {
    let mut source: Option<&dyn std::error::Error> = Some(&error);
    while let Some(current) = source {
        let detail = current.to_string().to_ascii_lowercase();
        if detail.contains("certificate") || detail.contains("unknownissuer") {
            return "server TLS certificate is not trusted by this device".to_owned();
        }
        source = current.source();
    }
    if error.is_timeout() {
        "server request timed out".to_owned()
    } else if error.is_connect() {
        "server connection failed".to_owned()
    } else {
        "server request failed".to_owned()
    }
}

pub(super) fn transport_unavailable(error: &str) -> bool {
    matches!(
        error,
        "server connection failed" | "server request timed out"
    )
}
