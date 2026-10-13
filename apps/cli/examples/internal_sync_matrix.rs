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
    if args.len() != 3 {
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
