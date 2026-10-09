//! Local HTTP fixtures exercise Session's real request/signature path. Production
//! clients still construct HTTPS-only, pinned-CA transports during unlock.
use super::*;
use ed25519_dalek::{Signature, Verifier};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const CURRENT: &str = "ab111111-1111-4111-8111-111111111111";
const TARGET: &str = "cd222222-2222-4222-8222-222222222222";
const ENROLLMENT: &str = "ef333333-3333-4333-8333-333333333333";

fn inspection() -> Value {
    json!({"accountId":CURRENT,"enrollmentId":ENROLLMENT,"newDeviceId":TARGET,
        "newDevicePublicKey":URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[7;32]).verifying_key().to_bytes()),
        "expiresAt":"2026-10-09T12:00:00.000Z"})
}

pub(crate) fn session(origin: &str) -> Session {
    let mut template = vec![0; 77];
    template[0] = 1;
    for offset in [1, 17] {
        template[offset..offset + 16].fill(if offset == 1 { 1 } else { 2 });
        template[offset + 6] = 0x40;
        template[offset + 8] = 0x80;
    }
    template[65..69].copy_from_slice(&1u32.to_be_bytes());
    template[69..77].copy_from_slice(&1u64.to_be_bytes());
    let mut core = Core::new();
    let root = core
        .create_root(&template, b"fixture-password", &[9; 32])
        .unwrap()
        .handle
        .unwrap();
    let directory =
        std::env::temp_dir().join(format!("127vaults-device-test-{}", uuid::Uuid::new_v4()));
    Session {
        client: Client::builder()
            .timeout(Duration::from_secs(10))
            .no_proxy()
            .build()
            .unwrap(),
        origin: origin.to_owned(),
        cookie: "fixture-session-cookie".to_owned(),
        csrf: "fixture-csrf".to_owned(),
        core,
        root,
        signing: SigningKey::from_bytes(&[8; 32]),
        tenant_id: CURRENT.to_owned(),
        device_id: CURRENT.to_owned(),
        epoch: 1,
        replica_store: ReplicaStore::new(&directory),
        profile_dir: directory.clone(),
        settings_store: SettingsStore::new(&directory),
        settings_record: SettingsRecord::default(),
        settings_data: SettingsData::empty(),
        settings_conflict: false,
        settings_remote: None,
        sync_transport: None,
        online: true,
        offline_reason: None,
        vault_handles: std::collections::HashMap::new(),
    }
}

struct Request {
    line: String,
    headers: std::collections::HashMap<String, String>,
    body: Value,
}

fn fixture(responses: Vec<(u16, Value)>) -> (String, JoinHandle<Vec<Request>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut received = Vec::new();
        for (status, value) in responses {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("fixture did not receive expected request: {error}"),
                }
            };
            // Windows can inherit the listener's nonblocking mode. Reads below
            // deliberately use blocking sockets with a bounded fixture timeout.
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut headers = std::collections::HashMap::new();
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                let (key, value) = header.trim_end().split_once(':').unwrap();
                headers.insert(key.to_ascii_lowercase(), value.trim().to_owned());
            }
            let length = headers
                .get("content-length")
                .map_or(0, |value| value.parse::<usize>().unwrap());
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).unwrap();
            let body = if bytes.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&bytes).unwrap()
            };
            received.push(Request {
                line: line.trim_end().to_owned(),
                headers,
                body,
            });
            let output = serde_json::to_vec(&value).unwrap();
            write!(socket,"HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",output.len()).unwrap();
            socket.write_all(&output).unwrap();
        }
        received
    });
    (origin, worker)
}

#[test]
fn session_inspect_approve_and_revoke_use_authenticated_canonical_requests() {
    let binding = inspection();
    let (origin, worker) = fixture(vec![
        (
            200,
            json!({"devices":[{"deviceId":TARGET,"status":"active"}]}),
        ),
        (200, binding.clone()),
        (200, binding.clone()),
        (200, json!({"approved":true})),
        (
            200,
            json!({"deviceId":TARGET,"status":"revoked","lostLastDevice":false}),
        ),
    ]);
    let mut session = session(&origin);
    let listed = session.device_list().unwrap();
    assert_eq!(listed["currentDeviceId"], CURRENT);
    let review = session.inspect_device_code("abcdefgh").unwrap();
    assert!(review.get("newDevicePublicKey").is_none());
    let approved = session
        .approve_reviewed_device(
            "abcdefgh",
            ENROLLMENT,
            TARGET,
            review["fingerprint"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(approved["approved"], true);
    assert_eq!(approved["enrollmentComplete"], false);
    assert_eq!(
        session.device_revoke(&TARGET.to_ascii_uppercase()).unwrap()["status"],
        "revoked"
    );
    session.online = false;
    let requests = worker.join().unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|request| request.line.as_str())
            .collect::<Vec<_>>(),
        vec![
            "GET /api/v1/devices HTTP/1.1",
            "POST /api/v1/device-enrollment/inspect HTTP/1.1",
            "POST /api/v1/device-enrollment/inspect HTTP/1.1",
            "POST /api/v1/device-enrollment/ef333333-3333-4333-8333-333333333333/approval HTTP/1.1",
            "POST /api/v1/devices/revoke HTTP/1.1"
        ]
    );
    for request in &requests {
        assert_eq!(request.headers["cookie"], "fixture-session-cookie");
        if request.line.starts_with("POST") {
            assert_eq!(request.headers["origin"], origin);
            assert_eq!(request.headers["x-127v-csrf"], "fixture-csrf");
        }
    }
    assert_eq!(requests[1].body, json!({"code":"ABCDEFGH"}));
    assert_eq!(requests[2].body, json!({"code":"ABCDEFGH"}));
    assert_eq!(requests[4].body, json!({"deviceId":TARGET}));
    assert_eq!(requests[3].body.as_object().unwrap().len(), 1);
    let bytes = URL_SAFE_NO_PAD
        .decode(requests[3].body["approvalSignature"].as_str().unwrap())
        .unwrap();
    session
        .signing
        .verifying_key()
        .verify(
            &vaults_protocol::signed_sync::canonical_bytes(&binding).unwrap(),
            &Signature::from_slice(&bytes).unwrap(),
        )
        .unwrap();
}

#[test]
fn changed_enrollment_never_sends_an_approval_signature() {
    for field in ["enrollmentId", "newDeviceId", "newDevicePublicKey"] {
        let binding = inspection();
        let review = crate::devices::EnrollmentInspection::parse(binding.clone())
            .unwrap()
            .review()
            .unwrap();
        let mut changed = binding;
        changed[field] = if field == "newDevicePublicKey" {
            json!(URL_SAFE_NO_PAD.encode([99; 32]))
        } else {
            json!(CURRENT)
        };
        let (origin, worker) = fixture(vec![(200, changed)]);
        let mut session = session(&origin);
        assert!(
            session
                .approve_reviewed_device(
                    "ABCDEFGH",
                    ENROLLMENT,
                    TARGET,
                    review["fingerprint"].as_str().unwrap()
                )
                .unwrap_err()
                .contains("enrollment changed")
        );
        session.online = false;
        assert_eq!(worker.join().unwrap().len(), 1);
    }
}

#[test]
fn offline_device_management_and_uppercase_self_revoke_fail_before_network_access() {
    let mut session = session("http://127.0.0.1:1");
    assert!(
        session
            .device_revoke(&CURRENT.to_ascii_uppercase())
            .unwrap_err()
            .contains("current device")
    );
    session.online = false;
    assert!(session.device_list().unwrap_err().contains("offline"));
    assert!(
        session
            .device_revoke(TARGET)
            .unwrap_err()
            .contains("offline")
    );
    assert!(
        session
            .inspect_device_code("ABCDEFGH")
            .unwrap_err()
            .contains("online")
    );
    assert!(
        session
            .approve_reviewed_device("ABCDEFGH", ENROLLMENT, TARGET, &"0".repeat(64))
            .unwrap_err()
            .contains("online")
    );
}

#[test]
fn expired_unauthorized_and_unavailable_enrollment_responses_never_claim_success_or_emit_server_details()
 {
    for status in [401, 403, 409, 429, 503] {
        let (origin, worker) = fixture(vec![(
            status,
            json!({"error":"fixture-internal-credential-value"}),
        )]);
        let mut session = session(&origin);
        let error = session
            .approve_reviewed_device("ABCDEFGH", ENROLLMENT, TARGET, &"0".repeat(64))
            .unwrap_err();
        assert!(error.contains(&status.to_string()));
        assert!(!error.contains("fixture-internal"));
        session.online = false;
        assert_eq!(worker.join().unwrap().len(), 1);
    }
}

#[test]
#[ignore = "requires pnpm test:device-management --rust and its disposable TLS/PostgreSQL fixture"]
#[allow(clippy::too_many_lines)] // Keep the ordered live enrollment ceremony in one test.
fn live_tls_postgres_device_lifecycle() {
    let origin =
        std::env::var("VAULTS_DEVICE_FIXTURE_ORIGIN").expect("missing fixture HTTPS origin");
    assert!(origin.starts_with("https://127.0.0.1:"));
    let ca =
        fs::read(std::env::var("VAULTS_DEVICE_FIXTURE_CA").expect("missing fixture CA")).unwrap();
    let mut session = session(&origin);
    session.client = Client::builder()
        .https_only(true)
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_pem(&ca).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    session.device_id = std::env::var("VAULTS_DEVICE_FIXTURE_CURRENT_ID")
        .expect("missing fixture current device ID");
    session.cookie = format!("__Host-127v-session={}", "x".repeat(43));
    let signing = SigningKey::from_bytes(&[7; 32]);
    let proposed = uuid::Uuid::new_v4().to_string();
    let public_key = URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes());
    let request = json!({"deviceId":proposed,"publicKey":public_key,"purpose":"enrollment-request","username":"DeviceOwner"});
    let request_signature = URL_SAFE_NO_PAD.encode(
        signing
            .sign(&vaults_protocol::signed_sync::canonical_bytes(&request).unwrap())
            .to_bytes(),
    );
    let send = |path: &str, body: &Value| {
        let response = session
            .client
            .post(format!("{origin}{path}"))
            .json(body)
            .send()
            .unwrap();
        assert!(
            response.status().is_success(),
            "fixture rejected request: {}",
            response.status()
        );
        response.json::<Value>().unwrap()
    };
    let started = send(
        "/api/v1/device-enrollment",
        &json!({"username":"DeviceOwner","newDeviceId":proposed,
        "newDevicePublicKey":public_key,"requestSignature":request_signature}),
    );
    let enrollment_id = started["enrollmentId"].as_str().unwrap();
    let code = started["code"].as_str().unwrap();
    let poll_path = format!("/api/v1/device-enrollment/{enrollment_id}/poll");
    let poll_body = json!({"pollToken":started["pollToken"]});
    assert_eq!(send(&poll_path, &poll_body)["status"], "pending");
    let review = session.inspect_device_code(code).unwrap();
    let fingerprint = crate::devices::key_fingerprint(&signing.verifying_key().to_bytes());
    assert_eq!(review["deviceId"], proposed);
    assert_eq!(review["fingerprint"], fingerprint);
    assert!(
        session
            .approve_reviewed_device(code, enrollment_id, &proposed, &"0".repeat(64))
            .unwrap_err()
            .contains("enrollment changed")
    );
    assert_eq!(
        session
            .approve_reviewed_device(code, enrollment_id, &proposed, &fingerprint)
            .unwrap()["approved"],
        true
    );
    let approved = send(&poll_path, &poll_body);
    let binding = &approved["binding"];
    let bytes = URL_SAFE_NO_PAD
        .decode(approved["approvalSignature"].as_str().unwrap())
        .unwrap();
    session
        .signing
        .verifying_key()
        .verify(
            &vaults_protocol::signed_sync::canonical_bytes(binding).unwrap(),
            &Signature::from_slice(&bytes).unwrap(),
        )
        .unwrap();
    let mut possession = binding.clone();
    possession["purpose"] = json!("device-possession");
    let proof = URL_SAFE_NO_PAD.encode(
        signing
            .sign(&vaults_protocol::signed_sync::canonical_bytes(&possession).unwrap())
            .to_bytes(),
    );
    let receipt = send(
        &format!("/api/v1/device-enrollment/{enrollment_id}/complete"),
        &json!({"pollToken":started["pollToken"],"possessionSignature":proof}),
    );
    assert_eq!(receipt["deviceId"], proposed);
    assert_eq!(receipt["credentialEpoch"], 1);
    assert!(
        session.device_list().unwrap()["devices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|device| device["deviceId"] == proposed && device["status"] == "active")
    );
    assert!(
        session
            .approve_reviewed_device(code, enrollment_id, &proposed, &fingerprint)
            .unwrap_err()
            .contains("409")
    );
    assert!(
        session
            .device_revoke(&session.device_id.to_ascii_uppercase())
            .unwrap_err()
            .contains("current device")
    );
    assert_eq!(
        session
            .device_revoke(&proposed.to_ascii_uppercase())
            .unwrap()["status"],
        "revoked"
    );
    assert!(
        session.device_list().unwrap()["devices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|device| device["deviceId"] == proposed && device["status"] == "revoked")
    );
    session.online = false;
    println!("DEVICE_FIXTURE_RESULT={}", json!({"deviceId":proposed}));
}
