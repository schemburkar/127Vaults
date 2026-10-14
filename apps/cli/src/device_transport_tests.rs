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
        accepted_device_heads: std::collections::HashMap::new(),
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
fn missing_server_item_distinguishes_a_queued_creation_from_an_edit() {
    for kind in ["item.create", "item.update"] {
        let mut session = session("http://127.0.0.1:1");
        let directory = session.core.create_empty_directory(session.root).unwrap();
        let vault = session
            .core
            .create_private_vault(session.root, &directory)
            .unwrap();
        let vault_id =
            uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
        let item_id = uuid::Uuid::new_v4().to_string();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let mut replica =
            crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
        replica.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
        replica.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
        replica.catalogue = URL_SAFE_NO_PAD.encode(&vault.catalogue);
        let operation = json!({"opId":operation_id,"itemId":item_id,"kind":kind});
        replica.pending.push(crate::replica::PendingMutation {
            operation: operation.clone(),
            request: json!({"ciphertext":"retained"}),
            base_catalogue: None,
            base_item: None,
        });
        replica.mark_stale(&operation, &item_id);
        session.replica_store.commit(&replica).unwrap();
        let (origin, worker) = fixture(vec![
            (
                200,
                json!({"directory":replica.directory,"vaultEnvelopes":[{"vaultId":vault_id,"envelope":replica.vault_envelope}]}),
            ),
            (200, json!({"catalogue":replica.catalogue,"indices":[]})),
            (
                200,
                json!({"cursor":0,"hasMore":false,"operations":[],"devicePublicKeys":{}}),
            ),
            (
                200,
                json!({"checkpoint":null,"checkpointPublicKey":URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[6;32]).verifying_key().to_bytes())}),
            ),
        ]);
        session.origin.clone_from(&origin);
        session.sync_transport = Some(HttpSyncTransport::new(
            session.client.clone(),
            origin,
            session.cookie.clone(),
            session.csrf.clone(),
        ));
        let result = session
            .conflict_compare(&vault_id, &item_id, &operation_id)
            .unwrap();
        assert_eq!(result["queuedCreate"], kind == "item.create");
        assert!(result["server"].is_null());
        assert_eq!(
            session
                .replica_store
                .load(&vault_id)
                .unwrap()
                .unwrap()
                .pending,
            replica.pending
        );
        assert!(
            worker
                .join()
                .unwrap()
                .iter()
                .all(|request| request.line.starts_with("GET "))
        );
        session.online = false;
        std::fs::remove_dir_all(&session.profile_dir).unwrap();
    }
}

#[test]
fn sync_review_reads_durable_queue_without_network_values_or_mutation() {
    let mut session = session("http://127.0.0.1:1");
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let item = session.core.upsert_private_item(
        vault.vault.handle.unwrap(), &vault.catalogue, None,
        br#"{"title":"Queued fixture","website":"https://private.invalid"}"#,
        br#"{"username":"private-user","password":"private-password","customFields":[{"label":"Private custom","value":"private-custom-secret"}]}"#,
    ).unwrap();
    let item_id = uuid::Uuid::from_bytes(item.item).to_string();
    let operation_id = uuid::Uuid::new_v4().to_string();
    let mut replica = crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
    replica.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
    replica.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
    replica.catalogue = URL_SAFE_NO_PAD.encode(&item.catalogue);
    replica.pending.push(crate::replica::PendingMutation {
        operation: json!({"opId":operation_id,"itemId":item_id,"kind":"item.create"}),
        request: json!({"catalogue":replica.catalogue,"index":URL_SAFE_NO_PAD.encode(&item.index),"body":URL_SAFE_NO_PAD.encode(&item.body)}),
        base_catalogue: None, base_item: None,
    });
    session.replica_store.commit(&replica).unwrap();
    let path = session
        .profile_dir
        .join("replicas")
        .join(format!("{vault_id}.json"));
    let before = std::fs::read(&path).unwrap();
    let review = session.sync_review().unwrap();
    assert_eq!(review["items"][0]["operationId"], operation_id);
    assert_eq!(review["items"][0]["title"], "Queued fixture");
    assert_eq!(
        review["items"][0]["fields"],
        json!(["title", "website", "username", "password", "customFields"])
    );
    for value in [
        "private.invalid",
        "private-user",
        "private-password",
        "Private custom",
        "private-custom-secret",
    ] {
        assert!(!review.to_string().contains(value));
    }
    assert_eq!(std::fs::read(&path).unwrap(), before);
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn conflict_comparison_reads_verified_server_fields_without_sending_the_queue() {
    let mut session = session("http://127.0.0.1:1");
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let item = session
        .core
        .upsert_private_item(
            vault.vault.handle.unwrap(),
            &vault.catalogue,
            None,
            br#"{"title":"Server title","website":"https://fixture.invalid"}"#,
            br#"{"username":"fixture-user","password":"fixture-password","customFields":[]}"#,
        )
        .unwrap();
    let item_id = uuid::Uuid::from_bytes(item.item).to_string();
    let operation_id = uuid::Uuid::new_v4().to_string();
    let mut replica = crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
    replica.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
    replica.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
    replica.catalogue = URL_SAFE_NO_PAD.encode(&item.catalogue);
    replica.items.push(crate::replica::ReplicaItem {
        item_id: item_id.clone(),
        index: URL_SAFE_NO_PAD.encode(&item.index),
        body: URL_SAFE_NO_PAD.encode(&item.body),
        created_at: None,
        updated_at: None,
    });
    let operation = json!({"opId":operation_id,"itemId":item_id,"kind":"item.update"});
    replica.pending.push(crate::replica::PendingMutation {
        operation: operation.clone(),
        request: json!({"ciphertext":"pending untouched"}),
        base_catalogue: None,
        base_item: None,
    });
    replica.mark_stale(&operation, &item_id);
    let other_item_id = uuid::Uuid::new_v4().to_string();
    let other_operation =
        json!({"opId":uuid::Uuid::new_v4(),"itemId":other_item_id,"kind":"item.update"});
    let other_pending = crate::replica::PendingMutation {
        operation: other_operation.clone(),
        request: json!({"ciphertext":"unrelated pending bytes"}),
        base_catalogue: None,
        base_item: None,
    };
    replica.pending.push(other_pending.clone());
    replica.mark_stale(&other_operation, &other_item_id);
    session.replica_store.commit(&replica).unwrap();
    let responses = initial_snapshot_responses(&replica);
    let (origin, worker) = fixture([responses.clone(), responses].concat());
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    let result = session
        .conflict_compare(&vault_id, &item_id, &operation_id)
        .unwrap();
    assert_eq!(result["server"]["title"], "Server title");
    assert_eq!(result["server"]["password"], "fixture-password");
    assert_eq!(
        session
            .replica_store
            .load(&vault_id)
            .unwrap()
            .unwrap()
            .pending,
        replica.pending
    );
    session
        .resolve_conflict(&vault_id, &operation_id, "server")
        .unwrap();
    let resolved = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(resolved.pending, vec![other_pending]);
    assert_eq!(resolved.conflicts.len(), 1);
    assert_eq!(
        resolved.conflicts[0]["operationId"],
        other_operation["opId"]
    );
    assert!(
        worker
            .join()
            .unwrap()
            .iter()
            .all(|request| request.line.starts_with("GET "))
    );
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

fn initial_snapshot_responses(replica: &crate::replica::Replica) -> Vec<(u16, Value)> {
    let indices: Vec<_> = replica
        .items
        .iter()
        .map(|item| json!({"itemId":item.item_id,"envelope":item.index}))
        .collect();
    vec![
        (
            200,
            json!({"directory":replica.directory,"vaultEnvelopes":[{"vaultId":replica.vault_id,"envelope":replica.vault_envelope}]}),
        ),
        (
            200,
            json!({"catalogue":replica.catalogue,"indices":indices}),
        ),
        (
            200,
            json!({"cursor":0,"hasMore":false,"operations":[],"devicePublicKeys":{}}),
        ),
        (
            200,
            json!({"checkpoint":null,"checkpointPublicKey":URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[6;32]).verifying_key().to_bytes())}),
        ),
    ]
}

fn session_with_editable_item(origin: &str) -> (Session, String, String) {
    let mut session = session(origin);
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let handle = vault.vault.handle.unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let item = session
        .core
        .upsert_private_item(
            handle,
            &vault.catalogue,
            None,
            br#"{"title":"Original","website":"https://fixture.invalid","favorite":false}"#,
            br#"{"username":"fixture-user","password":"fixture-password","customFields":[]}"#,
        )
        .unwrap();
    let item_id = uuid::Uuid::from_bytes(item.item).to_string();
    let mut replica = crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
    replica.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
    replica.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
    replica.catalogue = URL_SAFE_NO_PAD.encode(&item.catalogue);
    replica.items.push(crate::replica::ReplicaItem {
        item_id: item_id.clone(),
        index: URL_SAFE_NO_PAD.encode(&item.index),
        body: URL_SAFE_NO_PAD.encode(&item.body),
        created_at: None,
        updated_at: None,
    });
    session.replica_store.commit(&replica).unwrap();
    (session, vault_id, item_id)
}

#[test]
fn consecutive_online_edits_chain_accepted_heads_without_refreshing_item_baselines() {
    let (origin, worker) = fixture(vec![
        (200, json!({"accepted":true})),
        (200, json!({"accepted":true})),
        (409, json!({"error":"BASE_CHANGED"})),
    ]);
    let (mut session, vault_id, item_id) = session_with_editable_item(&origin);
    session
        .item_upsert(
            &vault_id,
            Some(&item_id),
            "First edit",
            "https://fixture.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )
        .unwrap();
    let accepted = session.accepted_device_heads[&vault_id].clone();
    session
        .item_upsert(
            &vault_id,
            Some(&item_id),
            "Second edit",
            "https://fixture.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )
        .unwrap();
    let reviewed = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert!(
        session
            .item_upsert(
                &vault_id,
                Some(&item_id),
                "Stale reviewed edit",
                "https://fixture.invalid",
                "fixture-user",
                "fixture-password",
                &[]
            )
            .unwrap_err()
            .contains("409")
    );
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(
        requests
            .iter()
            .all(|request| request.line.starts_with("PUT "))
    );
    assert_eq!(
        requests[1].body["signedOperation"]["previousDeviceOpId"],
        accepted
    );
    assert_eq!(requests[0].body["signedOperation"]["opId"], accepted);
    assert_eq!(
        requests[1].body["baseCatalogueRevision"],
        uuid::Uuid::from_bytes(
            URL_SAFE_NO_PAD
                .decode(requests[0].body["catalogue"].as_str().unwrap())
                .unwrap()[44..60]
                .try_into()
                .unwrap()
        )
        .to_string()
    );
    let final_replica = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(final_replica.pending.len(), 1);
    assert_eq!(
        final_replica.pending[0].base_catalogue.as_ref(),
        Some(&reviewed.catalogue)
    );
    assert_eq!(
        final_replica.pending[0].base_item.as_ref(),
        Some(&reviewed.items[0])
    );
    assert_eq!(final_replica.conflicts.len(), 1);
    assert!(
        final_replica.operations.is_empty(),
        "TLS acceptance is not fabricated verified checkpoint history"
    );
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn acknowledged_write_cannot_be_replaced_by_pre_acknowledgement_server_history() {
    let (mut session, vault_id, item_id) = session_with_editable_item("http://127.0.0.1:1");
    let old = session.replica_store.load(&vault_id).unwrap().unwrap();
    let mut responses = initial_snapshot_responses(&old);
    responses.insert(2, (200, json!({"envelope":old.items[0].body})));
    responses.insert(0, (200, json!({"accepted":true})));
    let (origin, worker) = fixture(responses);
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    session
        .item_upsert(
            &vault_id,
            Some(&item_id),
            "Acknowledged edit",
            "https://fixture.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )
        .unwrap();
    let acknowledged = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert!(acknowledged.pending.is_empty());
    session.accepted_device_heads.clear(); // Process restart loses in-memory signing hints.
    let result = session.hydrate_replicas();
    worker.join().unwrap();
    assert!(
        result.is_err(),
        "Acknowledged local edit was replaced by pre-write server history"
    );
    assert_eq!(
        session.replica_store.load(&vault_id).unwrap().unwrap(),
        acknowledged
    );
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn acknowledged_write_is_pinned_by_verified_history_before_acknowledgement_is_cleared() {
    let (origin, receipt_worker) = fixture(vec![(200, json!({"accepted":true}))]);
    let (mut session, vault_id, item_id) = session_with_editable_item(&origin);
    session
        .item_upsert(
            &vault_id,
            Some(&item_id),
            "Acknowledged edit",
            "https://fixture.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )
        .unwrap();
    let request = receipt_worker.join().unwrap().pop().unwrap();
    let operation = request.body["signedOperation"].clone();
    let acknowledged = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(
        acknowledged.acknowledged_operations,
        vec![operation["opId"].as_str().unwrap().to_owned()]
    );
    let mut responses = initial_snapshot_responses(&acknowledged);
    responses[2] = (
        200,
        json!({"cursor":1,"hasMore":false,"operations":[{"cursor":1,"operation":operation}],"devicePublicKeys":{CURRENT:URL_SAFE_NO_PAD.encode(session.signing.verifying_key().to_bytes())}}),
    );
    let (origin, history_worker) = fixture(responses);
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    session.accepted_device_heads.clear();
    session.hydrate_replicas().unwrap();
    history_worker.join().unwrap();
    let verified = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert!(verified.acknowledged_operations.is_empty());
    assert_eq!(verified.operations.len(), 1);
    let mut alternative = operation.as_object().unwrap().clone();
    alternative.remove("opId");
    alternative.remove("signature");
    alternative.insert("payloadHash".to_owned(), json!("ac".repeat(32)));
    let op_id = hex::encode(Sha256::digest(
        vaults_protocol::signed_sync::canonical_bytes(&Value::Object(alternative.clone())).unwrap(),
    ));
    alternative.insert("opId".to_owned(), json!(op_id));
    let signature = URL_SAFE_NO_PAD.encode(
        session
            .signing
            .sign(
                &vaults_protocol::signed_sync::canonical_bytes(&Value::Object(alternative.clone()))
                    .unwrap(),
            )
            .to_bytes(),
    );
    alternative.insert("signature".to_owned(), json!(signature));
    let mut responses = initial_snapshot_responses(&verified);
    responses[2] = (
        200,
        json!({"cursor":1,"hasMore":false,"operations":[{"cursor":1,"operation":alternative}],"devicePublicKeys":{CURRENT:URL_SAFE_NO_PAD.encode(session.signing.verifying_key().to_bytes())}}),
    );
    let (origin, fork_worker) = fixture(responses);
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    assert!(
        session
            .hydrate_replicas()
            .unwrap_err()
            .contains("verified operation history changed")
    );
    fork_worker.join().unwrap();
    assert_eq!(
        session.replica_store.load(&vault_id).unwrap().unwrap(),
        verified
    );
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn comparison_and_server_choice_preserve_all_pending_work_when_refresh_fails() {
    let (origin, worker) = fixture(vec![
        (409, json!({"error":"BASE_CHANGED"})),
        (503, json!({"error":"unavailable"})),
    ]);
    let mut session = session(&origin);
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let item_id = uuid::Uuid::new_v4().to_string();
    let operation_id = uuid::Uuid::new_v4().to_string();
    let mut replica = crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
    replica.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
    replica.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
    replica.catalogue = URL_SAFE_NO_PAD.encode(&vault.catalogue);
    let operation = json!({"opId":operation_id,"itemId":item_id,"kind":"item.update"});
    replica.pending.push(crate::replica::PendingMutation {
        operation: operation.clone(),
        request: json!({"ciphertext":"preserve exact queued bytes"}),
        base_catalogue: None,
        base_item: None,
    });
    replica.mark_stale(&operation, &item_id);
    let unrelated_id = uuid::Uuid::new_v4().to_string();
    let unrelated = json!({"opId":uuid::Uuid::new_v4(),"itemId":unrelated_id,"kind":"item.update"});
    replica.pending.push(crate::replica::PendingMutation {
        operation: unrelated.clone(),
        request: json!({"ciphertext":"preserve unrelated draft"}),
        base_catalogue: None,
        base_item: None,
    });
    replica.mark_stale(&unrelated, &unrelated_id);
    session.replica_store.commit(&replica).unwrap();
    assert!(
        session
            .conflict_compare(&vault_id, &item_id, &operation_id)
            .unwrap_err()
            .contains("409")
    );
    assert_eq!(
        session.replica_store.load(&vault_id).unwrap().unwrap(),
        replica
    );
    assert!(
        session
            .resolve_conflict(&vault_id, &operation_id, "server")
            .unwrap_err()
            .contains("503")
    );
    assert_eq!(
        session.replica_store.load(&vault_id).unwrap().unwrap(),
        replica
    );
    session.online = false;
    assert!(
        session
            .resolve_conflict(&vault_id, &operation_id, "server")
            .unwrap_err()
            .contains("Reconnect")
    );
    assert_eq!(
        session.replica_store.load(&vault_id).unwrap().unwrap(),
        replica
    );
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        requests
            .iter()
            .all(|request| request.line.starts_with("GET /api/v1/vaults "))
    );
    session.online = false;
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn repeated_hydration_reuses_verified_ciphertext_without_skipping_remote_history() {
    let mut session = session("http://127.0.0.1:1");
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let handle = vault.vault.handle.unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let item = session
        .core
        .upsert_private_item(handle, &vault.catalogue, None, b"index", b"body")
        .unwrap();
    let item_id = uuid::Uuid::from_bytes(item.item).to_string();
    let directory_response = json!({"directory":URL_SAFE_NO_PAD.encode(&vault.directory),
        "vaultEnvelopes":[{"vaultId":vault_id,"envelope":URL_SAFE_NO_PAD.encode(&vault.vault.envelope)}]});
    let catalogue_response = json!({"catalogue":URL_SAFE_NO_PAD.encode(&item.catalogue),
        "indices":[{"itemId":item_id,"envelope":URL_SAFE_NO_PAD.encode(&item.index)}]});
    let sync = json!({"cursor":0,"hasMore":false,"operations":[],"devicePublicKeys":{}});
    let checkpoint = json!({"checkpoint":null,"checkpointPublicKey":
        URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[6;32]).verifying_key().to_bytes())});
    let (origin, worker) = fixture(vec![
        (200, directory_response.clone()),
        (200, catalogue_response.clone()),
        (200, json!({"envelope":URL_SAFE_NO_PAD.encode(&item.body)})),
        (200, sync.clone()),
        (200, checkpoint.clone()),
        (200, directory_response),
        (200, catalogue_response),
        (200, sync),
        (200, checkpoint),
    ]);
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    session.hydrate_replicas().unwrap();
    session.hydrate_replicas().unwrap();
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 9);
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.line.contains(&format!("/items/{item_id}?")))
            .count(),
        1
    );
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.line.contains("/operations?"))
            .count(),
        2
    );
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.line.contains("/checkpoint"))
            .count(),
        2
    );
    let replica = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(replica.items[0].body, URL_SAFE_NO_PAD.encode(&item.body));
    let profile = session.profile_dir.clone();
    session.online = false;
    drop(session);
    fs::remove_dir_all(profile).unwrap();
}

#[test]
fn cached_bodies_require_current_commitments_and_authenticated_ciphertext() {
    let mut session = session("http://127.0.0.1:1");
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let handle = vault.vault.handle.unwrap();
    let item = session
        .core
        .upsert_private_item(handle, &vault.catalogue, None, b"index", b"body")
        .unwrap();
    let item_id = uuid::Uuid::from_bytes(item.item).to_string();
    let cached = ReplicaItem {
        item_id: item_id.clone(),
        index: URL_SAFE_NO_PAD.encode(&item.index),
        body: URL_SAFE_NO_PAD.encode(&item.body),
        created_at: None,
        updated_at: None,
    };
    let reuse = |core: &Core, catalogue: &[u8], index: &[u8], cached: Option<&ReplicaItem>| {
        verified_cached_item_body(core, handle, catalogue, &item_id, index, cached)
    };
    assert_eq!(
        reuse(&session.core, &item.catalogue, &item.index, Some(&cached)),
        Some(item.body.clone())
    );
    assert!(reuse(&session.core, &item.catalogue, &item.index, None).is_none());
    assert!(
        reuse(
            &session.core,
            &item.catalogue,
            b"different index",
            Some(&cached)
        )
        .is_none()
    );
    let mut tampered = cached.clone();
    let mut body = item.body.clone();
    *body.last_mut().unwrap() ^= 1;
    tampered.body = URL_SAFE_NO_PAD.encode(body);
    assert!(reuse(&session.core, &item.catalogue, &item.index, Some(&tampered)).is_none());
    tampered.body = "invalid base64!".to_owned();
    assert!(reuse(&session.core, &item.catalogue, &item.index, Some(&tampered)).is_none());
    let changed = session
        .core
        .upsert_private_item(
            handle,
            &item.catalogue,
            Some(item.item),
            b"index",
            b"changed body",
        )
        .unwrap();
    tampered = cached.clone();
    tampered.index = URL_SAFE_NO_PAD.encode(&changed.index);
    assert!(
        reuse(
            &session.core,
            &changed.catalogue,
            &changed.index,
            Some(&tampered)
        )
        .is_none()
    );
    session.core.lock();
    assert!(reuse(&session.core, &item.catalogue, &item.index, Some(&cached)).is_none());
    session.online = false;
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
