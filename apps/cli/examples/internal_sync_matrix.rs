//! Explicit fictitious enrolled profiles only; no default-profile selection.
use serde_json::json;
use std::path::{Path, PathBuf};
use vaults_cli::client;

fn validate(profile: &Path) -> Result<String, String> {
    if !profile.is_absolute() {
        return Err("absolute fixture profile required".to_owned());
    }
    let server = std::env::var("VAULTS_INTERNAL_SERVER_ID")
        .map_err(|_| "explicit fixture server required")?;
    if server != "14725fef-f5b4-4cb8-afe0-77aa3d80b268" {
        return Err("unexpected fixture installation".to_owned());
    }
    let config = std::fs::read_to_string(profile.join("device.conf")).map_err(|e| e.to_string())?;
    if !config.contains("username=owner_127\n")
        || !config.contains(&format!("server_id={server}\n"))
    {
        return Err("profile must belong to the fictitious fixture".to_owned());
    }
    config
        .lines()
        .find_map(|line| line.strip_prefix("device_id=").map(str::to_owned))
        .ok_or("fixture device missing".to_owned())
}

fn open(profile: &Path, offline: bool) -> Result<client::Session, String> {
    let secret = "07".repeat(32);
    if offline {
        client::unlock_offline(
            profile,
            "owner_127",
            &secret,
            b"fictitious password 127vaults",
        )
    } else {
        client::unlock(
            profile,
            "owner_127",
            &secret,
            b"fictitious password 127vaults",
        )
    }
}

fn stale_creations(a: &Path, b: &Path, evidence: &Path, chained_edit: bool) -> Result<(), String> {
    if validate(a)? == validate(b)? {
        return Err("two distinct fixture devices required".to_owned());
    }
    let initial = open(a, false)?;
    let vault = initial
        .vault_list()?
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["retired"] != true))
        .and_then(|row| row["vaultId"].as_str())
        .ok_or("fixture vault missing")?
        .to_owned();
    drop(initial);
    let mut stale = open(a, true)?;
    let run = uuid::Uuid::new_v4();
    let mut titles = [
        format!("Sync matrix queued A {run}"),
        format!("Sync matrix queued B {run}"),
    ];
    let mut first_id = None;
    for title in &titles {
        let result = stale.item_upsert(
            &vault,
            None,
            title,
            "https://matrix.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )?;
        if result["queued"] != true {
            return Err("offline creation was not queued".to_owned());
        }
        if first_id.is_none() {
            first_id = result["itemId"].as_str().map(str::to_owned);
        }
    }
    if chained_edit {
        titles[0].push_str(" edited offline");
        stale.item_upsert(
            &vault,
            first_id.as_deref(),
            &titles[0],
            "https://matrix.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )?;
    }
    drop(stale);
    let mut peer = open(b, false)?;
    peer.item_upsert(
        &vault,
        None,
        &format!("Sync matrix peer {run}"),
        "https://peer.invalid",
        "fixture-user",
        "fixture-password",
        &[],
    )?;
    drop(peer);
    let mut resumed = open(a, false)?;
    let outcome = resumed.sync_now();
    let status = resumed.replica_status()?;
    let local = resumed.sync_review()?;
    let retained = titles.iter().all(|title| {
        local["items"]
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| row["title"].as_str() == Some(title)))
    });
    let mut peer = open(b, false)?;
    let rows = peer.item_list(&vault)?;
    let converged = titles.iter().all(|title| {
        rows.as_array()
            .is_some_and(|rows| rows.iter().any(|row| row["title"].as_str() == Some(title)))
    });
    let identity_preserved = !chained_edit
        || rows.as_array().is_some_and(|rows| {
            rows.iter().any(|row| {
                row["title"].as_str() == Some(&titles[0])
                    && row["itemId"].as_str() == first_id.as_deref()
            })
        });
    let passed = outcome.is_ok()
        && status["pending"] == 0
        && status["conflicts"] == 0
        && converged
        && identity_preserved;
    let report = json!({"scenario":"two offline creations on stale catalogue, peer advance, restart/replay",
        "passed":passed,"error":outcome.as_ref().err(),"pending":status["pending"],"conflicts":status["conflicts"],
        "peerReadBoth":converged,"bothDraftsStillQueued":retained,"chainedEdit":chained_edit,"identityPreserved":identity_preserved});
    record(evidence, &report)?;
    if passed {
        Ok(())
    } else {
        Err("stale queued creations did not converge; evidence and profiles retained".to_owned())
    }
}

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if args.len() == 4 && args[3] == Path::new("enroll") {
        return enroll_fixture(&args[0], &args[1]);
    }
    if args.len() == 4 && args[3] == Path::new("recover") {
        return recover(&args[0], &args[1], &args[2]);
    }
    if args.len() == 4 && args[3] == Path::new("chained") {
        return stale_creations(&args[0], &args[1], &args[2], true);
    }
    if args.len() == 4 && [Path::new("fields"), Path::new("server")].contains(&args[3].as_path()) {
        return field_conflicts(&args[0], &args[1], &args[2], args[3] == Path::new("server"));
    }
    if args.len() != 3 {
        if args.len() == 4 && args[3] == Path::new("types") {
            return type_roundtrips(&args[0], &args[1], &args[2]);
        }
        return Err("supply explicit fixture device A, B and evidence path".to_owned());
    }
    stale_creations(&args[0], &args[1], &args[2], false)
}

fn enroll_fixture(a: &Path, b: &Path) -> Result<(), String> {
    validate(a)?;
    if !b.is_absolute() || b.exists() {
        return Err("new absolute fixture profile required".to_owned());
    }
    std::fs::create_dir(b).map_err(|e| e.to_string())?;
    for file in ["trust.conf", "installation-ca.pem"] {
        std::fs::copy(a.join(file), b.join(file)).map_err(|e| e.to_string())?;
    }
    let owner = open(a, false)?;
    let (sender, receiver) = std::sync::mpsc::channel();
    let enrolling = b.to_path_buf();
    let worker = std::thread::spawn(move || {
        vaults_cli::enroll_device_with_status(&enrolling, "owner_127", |code| {
            let _ = sender.send(code.to_owned());
        })
    });
    let code = receiver
        .recv_timeout(std::time::Duration::from_secs(20))
        .map_err(|e| e.to_string())?;
    owner.approve_device_code(&code)?;
    worker
        .join()
        .map_err(|_| "fixture enrollment worker panicked")??;
    validate(b)?;
    println!("Distinct fictitious device enrolled on this OS keyring.");
    Ok(())
}

fn recover(a: &Path, b: &Path, evidence: &Path) -> Result<(), String> {
    if validate(a)? == validate(b)? {
        return Err("two distinct fixture devices required".to_owned());
    }
    let mut local = open(a, true)?;
    let review = local.sync_review()?;
    let rows = review["items"]
        .as_array()
        .ok_or("pending review unavailable")?;
    if rows.len() != 2
        || rows.iter().any(|row| {
            !row["title"]
                .as_str()
                .is_some_and(|title| title.starts_with("Sync matrix queued "))
        })
    {
        return Err("recovery requires the preserved two-creation fixture".to_owned());
    }
    let titles: Vec<_> = rows
        .iter()
        .map(|row| row["title"].as_str().unwrap().to_owned())
        .collect();
    let vault = rows[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    drop(local);
    let mut resumed = open(a, false)?;
    let outcome = resumed.sync_now();
    let status = resumed.replica_status()?;
    let mut peer = open(b, false)?;
    let items = peer.item_list(&vault)?;
    let unique = titles.iter().all(|title| {
        items.as_array().is_some_and(|rows| {
            rows.iter()
                .filter(|row| row["title"].as_str() == Some(title))
                .count()
                == 1
        })
    });
    let passed = outcome.is_ok() && status["pending"] == 0 && status["conflicts"] == 0 && unique;
    let report = json!({"scenario":"recover preserved failed two-creation queue","passed":passed,"error":outcome.as_ref().err(),"pending":status["pending"],"conflicts":status["conflicts"],"peerReadBothExactlyOnce":unique});
    record(evidence, &report)?;
    if passed {
        Ok(())
    } else {
        Err("preserved queue recovery failed".to_owned())
    }
}

fn record(evidence: &Path, report: &serde_json::Value) -> Result<(), String> {
    std::fs::write(
        evidence,
        serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!("{report}");
    Ok(())
}

fn type_roundtrips(a: &Path, b: &Path, evidence: &Path) -> Result<(), String> {
    if validate(a)? == validate(b)? {
        return Err("distinct fixture devices required".to_owned());
    }
    let mut passed = Vec::new();
    let mut writer = open(a, false)?;
    let mut reader = open(b, false)?;
    for kind in ["login", "bank", "card", "wifi", "router", "ssh", "password"] {
        let vault = writer.vault_list()?[0]["vaultId"]
            .as_str()
            .ok_or("fixture vault missing")?
            .to_owned();
        let title = format!("Sync matrix {kind} {}", uuid::Uuid::new_v4());
        let fields = vec![
            json!({"id":"__127vaults_item_type","label":"Type","type":"text","value":kind}),
            json!({"id":"matrix_text","label":"Matrix text","type":"text","value":"fixture metadata"}),
            json!({"id":"matrix_secret","label":"Matrix secret","type":"password","value":"fixture custom secret"}),
        ];
        let made = writer.item_upsert(
            &vault,
            None,
            &title,
            "https://typed.invalid",
            "fixture-user",
            "fixture-password",
            &fields,
        )?;
        let item = made["itemId"]
            .as_str()
            .ok_or("fixture item missing")?
            .to_owned();
        writer.sync_now()?;
        reader.sync_now()?;
        let value = reader.item_get(&vault, &item, None)?;
        if value["itemType"] != kind
            || value["title"] != title
            || value["password"] != "[redacted]"
            || reader.item_get(&vault, &item, Some("password"))? != "fixture-password"
            || reader.item_get(&vault, &item, Some("matrix_secret"))? != "fixture custom secret"
        {
            return Err(format!(
                "typed forward roundtrip or disclosure failed: {kind}"
            ));
        }
        let mut changed = fields.clone();
        changed[1]["value"] = json!("peer metadata");
        reader.item_upsert(
            &vault,
            Some(&item),
            &title,
            "https://typed.invalid",
            "fixture-peer-user",
            "fixture-password",
            &changed,
        )?;
        reader.sync_now()?;
        writer.sync_now()?;
        let value = writer.item_get(&vault, &item, None)?;
        if value["username"] != "fixture-peer-user"
            || value["itemType"] != kind
            || !value["customFields"].as_array().is_some_and(|rows| {
                rows.iter()
                    .any(|row| row["id"] == "matrix_text" && row["value"] == "peer metadata")
            })
        {
            return Err(format!("typed reverse roundtrip failed: {kind}"));
        }
        passed.push(kind);
    }
    record(
        evidence,
        &json!({"scenario":"enabled non-passkey types, bidirectional encrypted fields and disclosure","passed":true,"types":passed,"passkeys":"separate ceremony gate"}),
    )
}

fn field_conflicts(a: &Path, b: &Path, evidence: &Path, keep_server: bool) -> Result<(), String> {
    if validate(a)? == validate(b)? {
        return Err("two distinct fixture devices required".to_owned());
    }
    let run = uuid::Uuid::new_v4();
    let base_title = format!("Sync matrix base {run}");
    let local_title = format!("Sync matrix local {run}");
    let server_title = format!("Sync matrix server {run}");
    let (vault, item) = create_conflict_baseline(a, &base_title)?;
    let mut offline = open(a, true)?;
    offline.item_upsert(
        &vault,
        Some(&item),
        &local_title,
        "https://fields.invalid",
        "fixture-user",
        "fixture-password",
        &[],
    )?;
    offline.item_upsert(
        &vault,
        Some(&item),
        &local_title,
        "https://fields.invalid",
        "fixture-user",
        "fixture-new-password",
        &[],
    )?;
    drop(offline);
    let mut peer = open(b, false)?;
    peer.item_upsert(
        &vault,
        Some(&item),
        &server_title,
        "https://fields.invalid",
        "fixture-user",
        "fixture-password",
        &[],
    )?;
    peer.sync_now()?;
    drop(peer);
    let mut resumed = open(a, false)?;
    let result = resumed.sync_now()?;
    let conflicts = result["conflicts"]
        .as_array()
        .ok_or("conflicts unavailable")?;
    if conflicts.len() != 1 {
        return Err("expected one title conflict after independent password rebase".to_owned());
    }
    let operation = conflicts[0]["operationId"]
        .as_str()
        .ok_or("conflict operation missing")?;
    let comparison = resumed.conflict_compare(&vault, &item, operation)?;
    if comparison["server"]["password"] != "fixture-new-password" {
        return Err("independent queued password was lost".to_owned());
    }
    if keep_server {
        resumed.discard_conflict(&vault, &item, operation)?;
    } else {
        resumed.item_upsert_resolving(
            &vault,
            &item,
            operation,
            &local_title,
            "https://fields.invalid",
            "fixture-user",
            "fixture-new-password",
            &[],
        )?;
        resumed.sync_now()?;
    }
    let status = resumed.replica_status()?;
    let mut peer = open(b, false)?;
    let actual = peer.item_get(&vault, &item, None)?;
    let secret = peer.item_get(&vault, &item, Some("password"))?;
    let expected = if keep_server {
        &server_title
    } else {
        &local_title
    };
    let passed = actual["title"].as_str() == Some(expected)
        && secret == "fixture-new-password"
        && status["pending"] == 0
        && status["conflicts"] == 0;
    record(
        evidence,
        &json!({"scenario":"two offline updates plus peer title change","passed":passed,"kept":if keep_server{"server title"}else{"selected local title"},"independentPasswordPreserved":secret=="fixture-new-password","pending":status["pending"],"conflicts":status["conflicts"]}),
    )?;
    if passed {
        Ok(())
    } else {
        Err("field conflict resolution did not preserve independent edits".to_owned())
    }
}

fn create_conflict_baseline(profile: &Path, title: &str) -> Result<(String, String), String> {
    let mut initial = open(profile, false)?;
    let vault = initial.vault_list()?[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    let made = initial.item_upsert(
        &vault,
        None,
        title,
        "https://fields.invalid",
        "fixture-user",
        "fixture-password",
        &[],
    )?;
    let item = made["itemId"]
        .as_str()
        .ok_or("fixture item missing")?
        .to_owned();
    initial.sync_now()?;
    drop(initial);
    Ok((vault, item))
}
