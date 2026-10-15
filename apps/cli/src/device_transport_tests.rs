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

#[test]
fn failed_second_vault_reload_does_not_discard_first_vault_queue() {
    let (mut session, first_id, item_id) = session_with_editable_item("http://127.0.0.1:1");
    let server = session.replica_store.load(&first_id).unwrap().unwrap();
    let second = session
        .core
        .create_private_vault(
            session.root,
            &URL_SAFE_NO_PAD.decode(&server.directory).unwrap(),
        )
        .unwrap();
    let second_id =
        uuid::Uuid::from_bytes(second.vault.context[33..49].try_into().unwrap()).to_string();
    let mut second_replica =
        crate::replica::Replica::new(session.tenant_id.clone(), second_id.clone(), 1);
    second_replica.directory = URL_SAFE_NO_PAD.encode(&second.directory);
    second_replica.vault_envelope = URL_SAFE_NO_PAD.encode(&second.vault.envelope);
    second_replica.catalogue = URL_SAFE_NO_PAD.encode(&second.catalogue);
    session.replica_store.commit(&second_replica).unwrap();
    session.online = false;
    session
        .item_upsert(
            &first_id,
            Some(&item_id),
            "Pending first vault",
            "https://fixture.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )
        .unwrap();
    let pending = session
        .replica_store
        .load(&first_id)
        .unwrap()
        .unwrap()
        .pending;
    let mut responses = initial_snapshot_responses(&server);
    responses[0] = (
        200,
        json!({"directory":URL_SAFE_NO_PAD.encode(second.directory),"vaultEnvelopes":[{"vaultId":first_id,"envelope":server.vault_envelope},{"vaultId":second_id,"envelope":second_replica.vault_envelope}]}),
    );
    responses.insert(2, (200, json!({"envelope":server.items[0].body})));
    responses.push((503, json!({"error":"unavailable"})));
    let (origin, worker) = fixture(responses);
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    session.online = true;
    assert!(session.discard_local_changes().unwrap_err().contains("503"));
    let refreshed = session.replica_store.load(&first_id).unwrap().unwrap();
    assert_eq!(refreshed.pending, pending);
    assert_eq!(
        refreshed.items, server.items,
        "first vault was authenticated before the second failed"
    );
    assert_eq!(
        session.replica_store.load(&second_id).unwrap().unwrap(),
        second_replica
    );
    assert_eq!(worker.join().unwrap().len(), 6);
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn global_server_reload_requires_complete_authenticated_replacements() {
    for scenario in ["missing-vault", "invalid-catalogue", "verified"] {
        let (mut session, vault_id, item_id) = session_with_editable_item("http://127.0.0.1:1");
        let server = session.replica_store.load(&vault_id).unwrap().unwrap();
        session.online = false;
        session
            .item_upsert(
                &vault_id,
                Some(&item_id),
                "Pending offline edit",
                "https://fixture.invalid",
                "fixture-user",
                "fixture-password",
                &[],
            )
            .unwrap();
        let before = session.replica_store.load(&vault_id).unwrap().unwrap();
        let responses = match scenario {
            "missing-vault" => vec![(
                200,
                json!({"directory":server.directory,"vaultEnvelopes":[]}),
            )],
            "invalid-catalogue" => vec![
                initial_snapshot_responses(&server)[0].clone(),
                (
                    200,
                    json!({"catalogue":URL_SAFE_NO_PAD.encode(b"not an authenticated catalogue"),"indices":[]}),
                ),
            ],
            _ => {
                let mut responses = initial_snapshot_responses(&server);
                responses.insert(2, (200, json!({"envelope":server.items[0].body})));
                responses
            }
        };
        let (origin, worker) = fixture(responses);
        session.origin.clone_from(&origin);
        session.sync_transport = Some(HttpSyncTransport::new(
            session.client.clone(),
            origin,
            session.cookie.clone(),
            session.csrf.clone(),
        ));
        session.online = true;
        let result = session.discard_local_changes();
        let after = session.replica_store.load(&vault_id).unwrap().unwrap();
        if scenario == "verified" {
            assert_eq!(result.unwrap()["discarded"], 1);
            assert!(after.pending.is_empty());
            assert!(after.conflicts.is_empty());
            assert_eq!(after.items, server.items);
            assert_eq!(after.catalogue, server.catalogue);
        } else {
            assert!(result.is_err());
            assert_eq!(
                after, before,
                "unverified global reload lost pending work: {scenario}"
            );
        }
        assert!(
            worker
                .join()
                .unwrap()
                .iter()
                .all(|request| request.line.starts_with("GET "))
        );
        std::fs::remove_dir_all(&session.profile_dir).unwrap();
    }
}

#[test]
fn global_server_reload_preserves_pending_work_until_refresh_is_verified() {
    for status in [401, 403, 503] {
        let (origin, worker) = fixture(vec![(status, json!({"error":"unavailable"}))]);
        let (mut session, vault_id, item_id) = session_with_editable_item(&origin);
        session.online = false;
        session
            .item_upsert(
                &vault_id,
                Some(&item_id),
                "Pending offline edit",
                "https://fixture.invalid",
                "fixture-user",
                "fixture-password",
                &[],
            )
            .unwrap();
        session.online = true;
        let before = session.replica_store.load(&vault_id).unwrap().unwrap();
        assert_eq!(before.pending.len(), 1);
        assert!(
            session
                .discard_local_changes()
                .unwrap_err()
                .contains(&status.to_string())
        );
        assert_eq!(
            session.replica_store.load(&vault_id).unwrap().unwrap(),
            before,
            "failed global reload lost pending ciphertext for {status}"
        );
        assert_eq!(session.is_online(), status == 503);
        if status != 503 {
            assert!(
                session
                    .offline_reason()
                    .unwrap()
                    .contains("no longer authorizes")
            );
        }
        assert_eq!(worker.join().unwrap().len(), 1);
        std::fs::remove_dir_all(&session.profile_dir).unwrap();
    }
}

#[test]
fn unchanged_settings_review_allows_both_explicit_choices() {
    for keep in ["server", "local"] {
        let mut session = session("http://127.0.0.1:1");
        let mut local = SettingsData::empty();
        local
            .names
            .insert(CURRENT.to_owned(), "Local pending".to_owned());
        let sealed = vault_settings::encrypt(&session.core, session.root, &local).unwrap();
        session.settings_data = local;
        session.settings_record.pending = Some(vault_settings::PendingSettings {
            base_revision: None,
            envelope: sealed,
        });
        session
            .settings_store
            .commit(&session.settings_record)
            .unwrap();
        let mut server = SettingsData::empty();
        server
            .names
            .insert(CURRENT.to_owned(), "Reviewed server".to_owned());
        let sealed = vault_settings::encrypt(&session.core, session.root, &server).unwrap();
        let revision = vault_settings::revision(&sealed).unwrap();
        session.settings_remote = Some((Some(revision.clone()), Some(sealed.clone())));
        session.settings_conflict = true;
        let remote = json!({"revision":revision,"envelope":sealed});
        let mut responses = vec![(200, remote.clone())];
        if keep == "local" {
            responses.extend([(200, remote), (200, json!({}))]);
        }
        let (origin, worker) = fixture(responses);
        session.origin = origin;
        session.resolve_vault_settings_conflict(keep).unwrap();
        assert!(!session.settings_conflict);
        assert!(session.settings_record.pending.is_none());
        assert_eq!(
            session.settings_data.names[CURRENT],
            if keep == "local" {
                "Local pending"
            } else {
                "Reviewed server"
            }
        );
        let requests = worker.join().unwrap();
        assert_eq!(requests.len(), if keep == "local" { 3 } else { 1 });
        assert!(requests[0].line.starts_with("GET /api/v1/vault-settings "));
        if keep == "local" {
            assert!(requests[2].line.starts_with("PUT /api/v1/vault-settings "));
        }
        std::fs::remove_dir_all(&session.profile_dir).unwrap();
    }
}

#[test]
fn settings_choice_rechecks_authorization_and_reviewed_revision_before_discard() {
    for keep in ["server", "local"] {
        for status in [401, 403, 200] {
            let mut session = session("http://127.0.0.1:1");
            let mut local = SettingsData::empty();
            local
                .names
                .insert(CURRENT.to_owned(), "Local pending".to_owned());
            let local_envelope =
                vault_settings::encrypt(&session.core, session.root, &local).unwrap();
            session.settings_data = local;
            session.settings_record.pending = Some(vault_settings::PendingSettings {
                base_revision: None,
                envelope: local_envelope,
            });
            session
                .settings_store
                .commit(&session.settings_record)
                .unwrap();
            let mut reviewed = SettingsData::empty();
            reviewed
                .names
                .insert(CURRENT.to_owned(), "Reviewed server".to_owned());
            let reviewed = vault_settings::encrypt(&session.core, session.root, &reviewed).unwrap();
            session.settings_conflict = true;
            session.settings_remote = Some((
                Some(vault_settings::revision(&reviewed).unwrap()),
                Some(reviewed),
            ));
            let mut newer = SettingsData::empty();
            newer
                .names
                .insert(CURRENT.to_owned(), "Newer server".to_owned());
            let newer = vault_settings::encrypt(&session.core, session.root, &newer).unwrap();
            let response = if status == 200 {
                json!({"revision":vault_settings::revision(&newer).unwrap(),"envelope":newer})
            } else {
                json!({"error":"unauthorized"})
            };
            let file = session.profile_dir.join("vault-settings.json");
            let preserved = std::fs::read(&file).unwrap();
            let (origin, worker) = fixture(vec![(status, response)]);
            session.origin = origin;
            let result = session.resolve_vault_settings_conflict(keep);
            assert!(
                result.is_err(),
                "stale settings choice must fail: {result:?}"
            );
            assert_eq!(std::fs::read(file).unwrap(), preserved);
            assert!(session.settings_conflict);
            assert_eq!(session.is_online(), status == 200);
            assert_eq!(worker.join().unwrap().len(), 1);
            std::fs::remove_dir_all(&session.profile_dir).unwrap();
        }
    }
}

#[test]
fn settings_authorization_failure_after_item_refresh_does_not_claim_online_sync() {
    for (status, reject_write) in [
        (401, false),
        (403, false),
        (401, true),
        (403, true),
        (503, false),
    ] {
        let mut session = session("http://127.0.0.1:1");
        let directory = session.core.create_empty_directory(session.root).unwrap();
        let mut settings = SettingsData::empty();
        settings
            .names
            .insert(CURRENT.to_owned(), "Pending fixture name".to_owned());
        let envelope = vault_settings::encrypt(&session.core, session.root, &settings).unwrap();
        session.settings_record.pending = Some(vault_settings::PendingSettings {
            base_revision: None,
            envelope,
        });
        session
            .settings_store
            .commit(&session.settings_record)
            .unwrap();
        let file = session.profile_dir.join("vault-settings.json");
        let preserved = std::fs::read(&file).unwrap();
        let mut responses = vec![(
            200,
            json!({"directory":URL_SAFE_NO_PAD.encode(directory),"vaultEnvelopes":[]}),
        )];
        if reject_write {
            responses.push((200, json!({"revision":null,"envelope":null})));
        }
        responses.push((status, json!({"error":"unavailable"})));
        let (origin, worker) = fixture(responses);
        session.origin = origin;
        let result = session.sync_now();
        if status == 503 {
            let result = result.unwrap();
            assert_eq!(result["online"], true);
            assert_eq!(result["vaultSettings"]["pending"], true);
            assert!(session.is_online());
        } else {
            assert!(
                result.is_err(),
                "settings authorization refusal must fail overall sync: {result:?}"
            );
            assert!(!session.is_online());
            assert_eq!(session.replica_status().unwrap()["online"], false);
            assert!(
                session
                    .offline_reason()
                    .unwrap()
                    .contains("no longer authorizes")
            );
        }
        assert_eq!(std::fs::read(file).unwrap(), preserved);
        assert_eq!(
            worker.join().unwrap().len(),
            if reject_write { 3 } else { 2 }
        );
        std::fs::remove_dir_all(&session.profile_dir).unwrap();
    }
}

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

fn session_with_real_missing_item_drafts(
    queued_create: bool,
) -> (
    Session,
    String,
    String,
    crate::replica::Replica,
    crate::replica::Replica,
) {
    let mut session = session("http://127.0.0.1:1");
    let directory = session.core.create_empty_directory(session.root).unwrap();
    let vault = session
        .core
        .create_private_vault(session.root, &directory)
        .unwrap();
    let vault_id =
        uuid::Uuid::from_bytes(vault.vault.context[33..49].try_into().unwrap()).to_string();
    let mut remote = crate::replica::Replica::new(session.tenant_id.clone(), vault_id.clone(), 1);
    remote.directory = URL_SAFE_NO_PAD.encode(&vault.directory);
    remote.vault_envelope = URL_SAFE_NO_PAD.encode(&vault.vault.envelope);
    remote.catalogue = URL_SAFE_NO_PAD.encode(&vault.catalogue);
    let mut local = remote.clone();
    let existing_id = if queued_create {
        None
    } else {
        let item = session
            .core
            .upsert_private_item(
                vault.vault.handle.unwrap(),
                &vault.catalogue,
                None,
                br#"{"title":"Original","website":"https://fixture.invalid","favorite":false}"#,
                br#"{"username":"fixture-user","password":"fixture-password","customFields":[]}"#,
            )
            .unwrap();
        let item_id = uuid::Uuid::from_bytes(item.item).to_string();
        local.catalogue = URL_SAFE_NO_PAD.encode(&item.catalogue);
        local.items.push(crate::replica::ReplicaItem {
            item_id: item_id.clone(),
            index: URL_SAFE_NO_PAD.encode(&item.index),
            body: URL_SAFE_NO_PAD.encode(&item.body),
            created_at: None,
            updated_at: None,
        });
        Some(item_id)
    };
    session.replica_store.commit(&local).unwrap();
    session.online = false;
    let first = session
        .item_upsert(
            &vault_id,
            existing_id.as_deref(),
            "Real first draft",
            "https://fixture.invalid",
            "first-user",
            "first-private-password",
            &[],
        )
        .unwrap();
    let sibling = session
        .item_upsert(
            &vault_id,
            None,
            "Real sibling draft",
            "https://fixture.invalid",
            "sibling-user",
            "sibling-private-password",
            &[],
        )
        .unwrap();
    let first_id = first["itemId"].as_str().unwrap().to_owned();
    let mut before = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(before.pending.len(), 2);
    assert_eq!(before.pending[1].operation["itemId"], sibling["itemId"]);
    assert_eq!(
        before.pending[0].operation["kind"],
        if queued_create {
            "item.create"
        } else {
            "item.update"
        }
    );
    for pending in before.pending.clone() {
        before.mark_stale(
            &pending.operation,
            pending.operation["itemId"].as_str().unwrap(),
        );
    }
    session.replica_store.commit(&before).unwrap();
    (session, vault_id, first_id, before, remote)
}

#[test]
fn sync_review_authenticates_long_queue_without_changing_requests() {
    let (mut session, vault_id, first_id, _, _) = session_with_real_missing_item_drafts(false);
    for index in 0..64 {
        session
            .item_upsert(
                &vault_id,
                Some(&first_id),
                &format!("Queued review {index}"),
                "https://fixture.invalid",
                "first-user",
                "first-private-password",
                &[],
            )
            .unwrap();
    }
    let before = session.replica_store.load(&vault_id).unwrap().unwrap();
    let review = session.sync_review().unwrap();
    let rows = review["items"].as_array().unwrap();
    assert_eq!(rows.len(), 66);
    assert_eq!(rows.last().unwrap()["title"], "Queued review 63");
    assert_eq!(rows.last().unwrap()["fields"], json!(["title"]));
    assert!(!review.to_string().contains("private-password"));
    assert_eq!(
        session
            .replica_store
            .load(&vault_id)
            .unwrap()
            .unwrap()
            .pending,
        before.pending
    );

    // Reusing the vault handle must not bypass authentication of any draft.
    let mut corrupt = before;
    let body = corrupt.pending[32].request["body"].as_str().unwrap();
    let mut bytes = URL_SAFE_NO_PAD.decode(body).unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    corrupt.pending[32].request["body"] = json!(URL_SAFE_NO_PAD.encode(bytes));
    session.replica_store.commit(&corrupt).unwrap();
    assert!(session.sync_review().is_err());
    assert_eq!(
        session
            .replica_store
            .load(&vault_id)
            .unwrap()
            .unwrap()
            .pending,
        corrupt.pending
    );
    std::fs::remove_dir_all(&session.profile_dir).unwrap();
}

#[test]
fn missing_server_item_keeps_real_encrypted_sibling_until_selected_discard() {
    for queued_create in [true, false] {
        let (mut session, vault_id, first_id, before, remote) =
            session_with_real_missing_item_drafts(queued_create);
        let operation_id = before.pending[0].operation["opId"].as_str().unwrap();
        let responses = initial_snapshot_responses(&remote);
        // Controlled authenticated empty-catalogue state, not a production
        // deletion endpoint. Actual native writes above produce both requests.
        let (origin, worker) = fixture([responses.clone(), responses].concat());
        session.origin.clone_from(&origin);
        session.sync_transport = Some(HttpSyncTransport::new(
            session.client.clone(),
            origin,
            session.cookie.clone(),
            session.csrf.clone(),
        ));
        session.online = true;
        let compared = session
            .conflict_compare(&vault_id, &first_id, operation_id)
            .unwrap();
        assert_eq!(compared["deleted"], true);
        assert_eq!(compared["queuedCreate"], queued_create);
        assert!(compared["server"].is_null());
        assert_eq!(
            session
                .replica_store
                .load(&vault_id)
                .unwrap()
                .unwrap()
                .pending,
            before.pending
        );
        let draft = session
            .conflict_draft(&vault_id, &first_id, operation_id)
            .unwrap();
        assert_eq!(draft["password"], "first-private-password");
        session
            .resolve_conflict(&vault_id, operation_id, "server")
            .unwrap();
        let after = session.replica_store.load(&vault_id).unwrap().unwrap();
        assert_eq!(after.pending, vec![before.pending[1].clone()]);
        assert_eq!(after.conflicts.len(), 1);
        assert_eq!(
            after.conflicts[0]["itemId"],
            before.pending[1].operation["itemId"]
        );
        let sibling_draft = session
            .conflict_draft(
                &vault_id,
                before.pending[1].operation["itemId"].as_str().unwrap(),
                after.pending[0].operation["opId"].as_str().unwrap(),
            )
            .unwrap();
        assert_eq!(sibling_draft["title"], "Real sibling draft");
        assert_eq!(sibling_draft["password"], "sibling-private-password");
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
fn create_id_collision_preserves_real_draft_and_peer_until_explicit_choice() {
    let (mut session, vault_id, first_id, mut before, mut remote) =
        session_with_real_missing_item_drafts(true);
    let operation_id = before.pending[0].operation["opId"]
        .as_str()
        .unwrap()
        .to_owned();
    // Only the colliding first creation is quarantined in this component case;
    // the second real signed request remains unrelated pending work.
    before
        .conflicts
        .retain(|row| row["operationId"] == operation_id);
    session.replica_store.commit(&before).unwrap();
    add_authenticated_collision(&mut session, &mut remote, &first_id);
    let snapshot = initial_snapshot_responses(&remote);
    let mut first_snapshot = snapshot.clone();
    first_snapshot.insert(2, (200, json!({"envelope":remote.items[0].body})));
    let (origin, worker) = fixture([first_snapshot, snapshot.clone(), snapshot].concat());
    session.origin.clone_from(&origin);
    session.sync_transport = Some(HttpSyncTransport::new(
        session.client.clone(),
        origin,
        session.cookie.clone(),
        session.csrf.clone(),
    ));
    session.online = true;
    session.hydrate_replicas().unwrap();
    assert_eq!(session.rebase_nonoverlapping_conflicts().unwrap(), 0);
    let classified = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(classified.pending, before.pending);
    assert_eq!(classified.conflicts.len(), 1);
    assert_eq!(classified.conflicts[0]["kind"], "create-id-collision");
    assert_eq!(classified.items, remote.items);
    let compared = session
        .conflict_compare(&vault_id, &first_id, &operation_id)
        .unwrap();
    assert_eq!(compared["deleted"], false);
    assert_eq!(compared["server"]["title"], "Peer at reserved ID");
    assert_eq!(compared["server"]["password"], "peer-collision-password");
    assert_eq!(
        session
            .conflict_draft(&vault_id, &first_id, &operation_id)
            .unwrap()["password"],
        "first-private-password"
    );
    assert_eq!(
        session
            .replica_store
            .load(&vault_id)
            .unwrap()
            .unwrap()
            .pending,
        before.pending
    );
    session
        .resolve_conflict(&vault_id, &operation_id, "server")
        .unwrap();
    let after = session.replica_store.load(&vault_id).unwrap().unwrap();
    assert_eq!(after.pending, vec![before.pending[1].clone()]);
    assert_eq!(after.items, remote.items);
    let sibling = &after.pending[0];
    let sibling_draft = session
        .decrypt_item_parts(
            &vault_id,
            sibling.operation["itemId"].as_str().unwrap(),
            sibling.request["catalogue"].as_str().unwrap(),
            sibling.request["index"].as_str().unwrap(),
            sibling.request["body"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(sibling_draft["password"], "sibling-private-password");
    assert_eq!(
        session.item_get(&vault_id, &first_id, None).unwrap()["title"],
        "Peer at reserved ID"
    );
    assert_eq!(
        session
            .item_get(&vault_id, &first_id, Some("password"))
            .unwrap(),
        "peer-collision-password"
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

fn add_authenticated_collision(
    session: &mut Session,
    remote: &mut crate::replica::Replica,
    item_id: &str,
) {
    let handle = session
        .core
        .open_private_vault(
            session.root,
            &URL_SAFE_NO_PAD.decode(&remote.directory).unwrap(),
            uuid::Uuid::parse_str(&remote.vault_id)
                .unwrap()
                .into_bytes(),
            &URL_SAFE_NO_PAD.decode(&remote.vault_envelope).unwrap(),
        )
        .unwrap()
        .handle
        .unwrap();
    let item = session
        .core
        .upsert_private_item_at_id(
            handle,
            &URL_SAFE_NO_PAD.decode(&remote.catalogue).unwrap(),
            uuid::Uuid::parse_str(item_id).unwrap().into_bytes(),
            false,
            br#"{"title":"Peer at reserved ID","website":"https://fixture.invalid","favorite":false}"#,
            br#"{"username":"peer-collision-user","password":"peer-collision-password","customFields":[]}"#,
        )
        .unwrap();
    remote.catalogue = URL_SAFE_NO_PAD.encode(&item.catalogue);
    remote.items.push(crate::replica::ReplicaItem {
        item_id: item_id.to_owned(),
        index: URL_SAFE_NO_PAD.encode(&item.index),
        body: URL_SAFE_NO_PAD.encode(&item.body),
        created_at: None,
        updated_at: None,
    });
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
