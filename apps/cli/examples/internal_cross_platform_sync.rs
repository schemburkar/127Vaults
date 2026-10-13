//! Cross-OS fictitious profile acceptance; never reads a default profile.
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use vaults_cli::client;

const SERVER: &str = "14725fef-f5b4-4cb8-afe0-77aa3d80b268";
const TYPES: [&str; 7] = ["login", "bank", "card", "wifi", "router", "ssh", "password"];
fn open(profile: &Path) -> Result<client::Session, String> {
    if !profile.is_absolute() {
        return Err("explicit absolute profile required".to_owned());
    }
    let expected = std::env::var("VAULTS_INTERNAL_SERVER_ID")
        .map_err(|_| "explicit fixture server required")?;
    let config = std::fs::read_to_string(profile.join("device.conf")).map_err(|e| e.to_string())?;
    if expected != SERVER
        || !config.contains(&format!("server_id={SERVER}\n"))
        || !config.contains("username=owner_127\n")
    {
        return Err("unexpected fixture profile".to_owned());
    }
    client::unlock(
        profile,
        "owner_127",
        &"07".repeat(32),
        b"fictitious password 127vaults",
    )
}
fn fields(kind: &str, peer: bool) -> Vec<Value> {
    vec![
        json!({"id":"__127vaults_item_type","label":"Type","type":"text","value":kind}),
        json!({"id":"matrix_text","label":"Matrix text","type":"text","value":if peer{"peer metadata"}else{"fixture metadata"}}),
        json!({"id":"matrix_secret","label":"Matrix secret","type":"password","value":"fixture custom secret"}),
    ]
}
fn publish(profile: &Path) -> Result<Value, String> {
    let mut session = open(profile)?;
    let vault = session.vault_list()?[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    let mut items = Vec::new();
    for kind in TYPES {
        let title = format!("Cross-OS fixture {kind} {}", uuid::Uuid::new_v4());
        let made = session.item_upsert(
            &vault,
            None,
            &title,
            "https://cross-os.invalid",
            "fixture-user",
            "fixture-password",
            &fields(kind, false),
        )?;
        session.sync_now()?;
        items.push(json!({"vaultId":vault,"itemId":made["itemId"],"title":title,"kind":kind}));
    }
    Ok(json!({"fixtureServer":SERVER,"writerOS":std::env::consts::OS,"items":items}))
}
fn history(profile: &Path) -> Result<Value, String> {
    let mut session = open(profile)?;
    let vault = session.vault_list()?[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    let made = session.item_upsert(
        &vault,
        None,
        "History revision 0",
        "https://history.invalid",
        "fixture-user",
        "fixture-password",
        &[],
    )?;
    session.sync_now()?;
    let item = made["itemId"]
        .as_str()
        .ok_or("fixture item missing")?
        .to_owned();
    for revision in 1..=501 {
        session.item_upsert(
            &vault,
            Some(&item),
            &format!("History revision {revision}"),
            "https://history.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )?;
        session.sync_now()?;
        if revision % 100 == 0 {
            println!("Verified history writes: {revision}");
            drop(session);
            session = open(profile)?;
        }
    }
    drop(session);
    let mut restarted = open(profile)?;
    if restarted.item_get(&vault, &item, None)?["title"] != "History revision 501" {
        return Err("fresh verified history did not reach the final revision".to_owned());
    }
    Ok(
        json!({"fixtureServer":SERVER,"vaultId":vault,"itemId":item,"operationsWritten":502,"freshUnlockFinalRevisionPassed":true,"os":std::env::consts::OS}),
    )
}
fn checkpoints(profile: &Path, peer: &Path) -> Result<Value, String> {
    let mut original = open(profile)?;
    let vault = original.vault_list()?[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    original.checkpoint_now(&vault)?;
    drop(original);
    let mut other = open(peer)?;
    other.checkpoint_now(&vault)?;
    other.checkpoint_now(&vault)?;
    drop(other);
    let result = open(profile).map(|_| ());
    Ok(
        json!({"fixtureServer":SERVER,"vaultId":vault,"missedPeerCheckpoints":2,"freshUnlockPassed":result.is_ok(),"error":result.err()}),
    )
}
fn history_read(profile: &Path) -> Result<Value, String> {
    let mut session = open(profile)?;
    let vault = session.vault_list()?[0]["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?
        .to_owned();
    let list = session.item_list(&vault)?;
    let row = list
        .as_array()
        .ok_or("fixture list missing")?
        .iter()
        .find(|row| {
            row["title"]
                .as_str()
                .is_some_and(|title| title.starts_with("History revision "))
        })
        .ok_or("history fixture item missing")?;
    let item = row["itemId"].as_str().ok_or("fixture item missing")?;
    if session.item_get(&vault, item, Some("password"))? != "fixture-password" {
        return Err("verified history body mismatch".to_owned());
    }
    let replica = vaults_cli::replica::ReplicaStore::new(profile)
        .load(&vault)?
        .ok_or("fixture replica missing")?;
    if replica.cursor <= 500 {
        return Err("history fixture did not cross the page boundary".to_owned());
    }
    Ok(
        json!({"fixtureServer":SERVER,"vaultId":vault,"itemId":item,"verifiedCursor":replica.cursor,"finalTitle":row["title"],"freshUnlockAndBodyReadPassed":true,"status":session.replica_status()?}),
    )
}
fn history_finish(profile: &Path) -> Result<Value, String> {
    let evidence = history_read(profile)?;
    if evidence["finalTitle"] != "History revision 499" {
        return Err("expected the retained session-limit fixture at revision 499".to_owned());
    }
    let vault = evidence["vaultId"]
        .as_str()
        .ok_or("fixture vault missing")?;
    let item = evidence["itemId"].as_str().ok_or("fixture item missing")?;
    let mut session = open(profile)?;
    for revision in 500..=501 {
        session.item_upsert(
            vault,
            Some(item),
            &format!("History revision {revision}"),
            "https://history.invalid",
            "fixture-user",
            "fixture-password",
            &[],
        )?;
        session.sync_now()?;
    }
    drop(session);
    let mut completed = history_read(profile)?;
    if completed["finalTitle"] != "History revision 501" {
        return Err("final resumed history revision missing".to_owned());
    }
    completed["resumedAfterSessionLimit"] = json!(true);
    completed["fixtureOperationsWrittenAcrossSessions"] = json!(502);
    Ok(completed)
}
fn check(profile: &Path, metadata: &mut Value, peer: bool) -> Result<(), String> {
    if metadata["fixtureServer"] != SERVER {
        return Err("unexpected fixture metadata".to_owned());
    }
    let rows = metadata["items"]
        .as_array()
        .filter(|rows| rows.len() == 7)
        .ok_or("expected seven typed fixture items")?;
    let mut session = open(profile)?;
    for row in rows {
        let vault = row["vaultId"].as_str().ok_or("fixture vault missing")?;
        let item = row["itemId"].as_str().ok_or("fixture item missing")?;
        let kind = row["kind"]
            .as_str()
            .filter(|kind| TYPES.contains(kind))
            .ok_or("unknown fixture type")?;
        let title = row["title"]
            .as_str()
            .filter(|title| title.starts_with("Cross-OS fixture "))
            .ok_or("unexpected fixture title")?;
        let value = session.item_get(vault, item, None)?;
        if value["title"] != title
            || value["itemType"] != kind
            || value["password"] != "[redacted]"
            || session.item_get(vault, item, Some("password"))? != "fixture-password"
            || session.item_get(vault, item, Some("matrix_secret"))? != "fixture custom secret"
        {
            return Err(format!("cross-OS field/disclosure check failed: {kind}"));
        }
        if peer {
            session.item_upsert(
                vault,
                Some(item),
                title,
                "https://cross-os.invalid",
                "fixture-peer-user",
                "fixture-password",
                &fields(kind, true),
            )?;
            session.sync_now()?;
        } else if value["username"] != "fixture-peer-user"
            || !value["customFields"].as_array().is_some_and(|fields| {
                fields
                    .iter()
                    .any(|field| field["id"] == "matrix_text" && field["value"] == "peer metadata")
            })
        {
            return Err(format!("cross-OS reverse fields missing: {kind}"));
        }
    }
    metadata[if peer { "peerOS" } else { "verifiedOS" }] = json!(std::env::consts::OS);
    metadata[if peer {
        "peerReadAndWritePassed"
    } else {
        "reverseReadPassed"
    }] = json!(true);
    Ok(())
}
fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mode = args.next().ok_or("expected publish, peer or verify")?;
    let profile = PathBuf::from(args.next().ok_or("explicit fixture profile required")?);
    let path = PathBuf::from(
        args.next()
            .ok_or("explicit metadata/evidence path required")?,
    );
    if !path.is_absolute() {
        return Err("absolute evidence path required".to_owned());
    }
    let mut evidence = if mode == "history-finish" {
        history_finish(&profile)?
    } else if mode == "history-read" {
        history_read(&profile)?
    } else if mode == "checkpoints" {
        checkpoints(
            &profile,
            &PathBuf::from(args.next().ok_or("explicit peer profile required")?),
        )?
    } else if mode == "history" {
        history(&profile)?
    } else if mode == "publish" {
        publish(&profile)?
    } else {
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
    };
    match mode.as_str() {
        "publish" | "history" | "history-read" | "history-finish" | "checkpoints" => {}
        "peer" => check(&profile, &mut evidence, true)?,
        "verify" => check(&profile, &mut evidence, false)?,
        _ => return Err("unknown fixture phase".to_owned()),
    }
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&evidence).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if mode == "checkpoints" && evidence["freshUnlockPassed"] != true {
        return Err("missed-checkpoint acceptance failed; evidence retained".to_owned());
    }
    println!(
        "Fictitious fixture {mode} completed on {}.",
        std::env::consts::OS
    );
    Ok(())
}
