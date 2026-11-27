use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

use vaults_cli::client;

#[allow(clippy::too_many_lines)]
fn main() -> Result<(), String> {
    let secret = "07".repeat(32);
    let password = b"fictitious password 127vaults";
    if let Some(mode) = std::env::args().nth(1) {
        if mode == "stale-create" {
            let config = Path::new(".tools/api010-device-b");
            let clone = Path::new(".tools/api010-device-b-stale");
            fs::create_dir_all(clone.join("replicas")).map_err(|e| e.to_string())?;
            for name in [
                "trust.conf",
                "installation-ca.pem",
                "device.conf",
                "offline-unlock.json",
            ] {
                fs::copy(config.join(name), clone.join(name)).map_err(|e| e.to_string())?;
            }
            for entry in fs::read_dir(config.join("replicas")).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                fs::copy(entry.path(), clone.join("replicas").join(entry.file_name()))
                    .map_err(|e| e.to_string())?;
            }
            let mut stale = client::unlock_offline(clone, "owner_127", &secret, password)?;
            let mut online = client::unlock(config, "owner_127", &secret, password)?;
            let vault = online.vault_list()?[0]["vaultId"]
                .as_str()
                .ok_or("vault missing")?
                .to_owned();
            let rows = online.item_list(&vault)?;
            let item = &rows[0];
            let item_id = item["itemId"].as_str().ok_or("item missing")?;
            let body = online.item_get(&vault, item_id, None)?;
            let item_password = online.item_get(&vault, item_id, Some("password"))?;
            online.item_upsert(
                &vault,
                Some(item_id),
                body["title"].as_str().ok_or("title missing")?,
                "https://advance-catalogue.invalid",
                body["username"].as_str().ok_or("username missing")?,
                item_password.as_str().ok_or("password missing")?,
                &[],
            )?;
            let new_title = format!("API010-CREATE-{}", uuid::Uuid::new_v4());
            let new_password = uuid::Uuid::new_v4().to_string();
            if stale.item_upsert(
                &vault,
                None,
                &new_title,
                "https://new.invalid",
                "new-user",
                &new_password,
                &[],
            )?["queued"]
                != true
            {
                return Err("stale create was not queued".to_owned());
            }
            drop(stale);
            drop(online);
            let mut resumed = client::unlock(clone, "owner_127", &secret, password)?;
            let outcome = resumed.sync_now()?;
            if outcome["rebased"] != 1
                || outcome["conflicts"]
                    .as_array()
                    .is_none_or(|rows| !rows.is_empty())
            {
                return Err(format!("stale create did not rebase: {outcome}"));
            }
            drop(resumed);
            let mut fresh = client::unlock(config, "owner_127", &secret, password)?;
            if !fresh
                .item_list(&vault)?
                .as_array()
                .ok_or("item list missing")?
                .iter()
                .any(|row| row["title"] == new_title)
            {
                return Err("rebased create did not converge".to_owned());
            }
            println!("offline create on a stale catalogue: rebased and converged");
            return Ok(());
        }
        if mode == "verify-integrity" {
            let config = Path::new(".tools/api010-device-b");
            let replica_path = fs::read_dir(config.join("replicas"))
                .map_err(|e| e.to_string())?
                .next()
                .ok_or("replica missing")?
                .map_err(|e| e.to_string())?
                .path();
            let before = fs::read(&replica_path).map_err(|e| e.to_string())?;
            let rejected = client::unlock(config, "owner_127", &secret, password);
            if !rejected.is_err_and(|error| error.contains("signature")) {
                return Err("tampered operation was not rejected".to_owned());
            }
            if fs::read(&replica_path).map_err(|e| e.to_string())? != before {
                return Err("integrity failure changed the verified replica".to_owned());
            }
            let mut offline = client::unlock_offline(config, "owner_127", &secret, password)?;
            let vault = offline.vault_list()?[0]["vaultId"]
                .as_str()
                .ok_or("vault missing")?
                .to_owned();
            let rows = offline.item_list(&vault)?;
            let item_id = rows[0]["itemId"].as_str().ok_or("item missing")?;
            if offline.item_get(&vault, item_id, None)?["title"].is_null() {
                return Err("last verified item became unreadable".to_owned());
            }
            println!(
                "integrity failure: tampered operation rejected; last verified replica unchanged and readable"
            );
            return Ok(());
        }
        let config = Path::new(".tools/api010-device-a");
        let mut offline = match mode.as_str() {
            "prepare-revocation" => client::unlock_offline(config, "owner_127", &secret, password)?,
            "verify-revocation" => {
                client::unlock_with_offline_fallback(config, "owner_127", &secret, password)?
            }
            _ => return Err("unknown acceptance mode".to_owned()),
        };
        let vault_id = offline.vault_list()?[0]["vaultId"]
            .as_str()
            .ok_or("missing vault")?
            .to_owned();
        let rows = offline.item_list(&vault_id)?;
        let item = rows
            .as_array()
            .ok_or("invalid item list")?
            .iter()
            .find(|row| {
                row["title"]
                    .as_str()
                    .is_some_and(|title| title.starts_with("API010-"))
            })
            .ok_or("acceptance item missing")?;
        let item_id = item["itemId"].as_str().ok_or("item ID missing")?.to_owned();
        if mode == "prepare-revocation" {
            let original = offline.item_get(&vault_id, &item_id, None)?;
            let item_password = offline.item_get(&vault_id, &item_id, Some("password"))?;
            offline.item_upsert(
                &vault_id,
                Some(&item_id),
                &format!(
                    "{}-queued",
                    original["title"].as_str().ok_or("title missing")?
                ),
                original["website"].as_str().ok_or("website missing")?,
                original["username"].as_str().ok_or("username missing")?,
                item_password.as_str().ok_or("password missing")?,
                &[],
            )?;
            println!("pending edit queued before revocation");
        } else {
            if !offline
                .sync_now()
                .is_err_and(|error| error.contains("offline"))
            {
                return Err("revoked device unexpectedly retained sync authority".to_owned());
            }
            if offline.item_get(&vault_id, &item_id, None)?["title"].is_null() {
                return Err("verified local item was not readable".to_owned());
            }
            let replica: serde_json::Value = serde_json::from_slice(
                &fs::read(config.join("replicas").join(format!("{vault_id}.json")))
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if replica["pending"].as_array().is_none_or(Vec::is_empty)
                || replica["checkpoint"].is_null()
            {
                return Err("revoked replica lost pending work or checkpoint".to_owned());
            }
            println!("revocation: pending request and verified item remain readable offline");
        }
        return Ok(());
    }
    // Optional isolated release fixture; historical defaults remain unchanged.
    let external = std::env::var_os("VAULTS_INTERNAL_CLIENT_ROOT").map(PathBuf::from);
    let enroll_only = std::env::var("VAULTS_INTERNAL_ENROLL_ONLY").as_deref() == Ok("1");
    if enroll_only && external.as_ref().is_none_or(|base| !base.is_absolute()) {
        return Err("enrollment-only mode requires an absolute new external fixture".to_owned());
    }
    let server_id = if external.is_some() {
        let value = std::env::var("VAULTS_INTERNAL_SERVER_ID")
            .map_err(|_| "explicit fixture server ID is required")?;
        uuid::Uuid::parse_str(&value).map_err(|_| "fixture server ID must be a UUID")?;
        value
    } else {
        "127vaults-local".to_owned()
    };
    let trust_source = if let Some(base) = &external {
        fs::create_dir(base)
            .map_err(|_| "release client fixture directory must be new".to_owned())?;
        let trust = base.join("trust");
        vaults_cli::establish_trust(&vaults_cli::TrustArgs {
            url: std::env::var("VAULTS_INTERNAL_CLIENT_URL")
                .map_err(|_| "missing release fixture URL")?,
            ca: PathBuf::from(
                std::env::var_os("VAULTS_INTERNAL_CLIENT_CA").ok_or("missing fixture CA")?,
            ),
            server_id: server_id.clone(),
            tailscale_name: None,
            tailscale_ip: false,
            config_dir: trust.clone(),
        })?;
        trust
    } else {
        PathBuf::from(".127vaults-cli")
    };
    let config_owned = external.as_ref().map_or_else(
        || PathBuf::from(".tools/api010-device-a"),
        |base| base.join("device-a"),
    );
    let config = config_owned.as_path();
    fs::create_dir_all(config).map_err(|error| error.to_string())?;
    fs::copy(trust_source.join("trust.conf"), config.join("trust.conf"))
        .map_err(|error| error.to_string())?;
    fs::copy(
        trust_source.join("installation-ca.pem"),
        config.join("installation-ca.pem"),
    )
    .map_err(|error| error.to_string())?;
    let device_id = "22222222-2222-4222-8222-222222222222";
    fs::write(
        config.join("device.conf"),
        format!("version=1\ndevice_id={device_id}\nserver_id={server_id}\nusername=owner_127\n"),
    )
    .map_err(|error| error.to_string())?;
    let entry = keyring::Entry::new(
        "127Vaults device identity",
        &format!("{server_id}:{device_id}"),
    )
    .map_err(|error| error.to_string())?;
    match entry.get_secret() {
        Ok(existing) if existing != [9_u8; 32] => {
            return Err("fixture device key already has a different value".to_owned());
        }
        Ok(_) => {}
        Err(_) => entry
            .set_secret(&[9_u8; 32])
            .map_err(|error| error.to_string())?,
    }
    let mut session = paced_unlock(config, "owner_127", &secret, password)?;
    let vaults = session.vault_list()?;
    println!(
        "{}: {} vault(s)",
        config.display(),
        vaults.as_array().map_or(0, Vec::len)
    );
    let second_owned = external.as_ref().map_or_else(
        || PathBuf::from(".tools/api010-device-b"),
        |base| base.join("device-b"),
    );
    let second = second_owned.as_path();
    fs::create_dir_all(second).map_err(|error| error.to_string())?;
    fs::copy(trust_source.join("trust.conf"), second.join("trust.conf"))
        .map_err(|error| error.to_string())?;
    fs::copy(
        trust_source.join("installation-ca.pem"),
        second.join("installation-ca.pem"),
    )
    .map_err(|error| error.to_string())?;
    if !second.join("device.conf").exists() {
        let (sender, receiver) = mpsc::channel();
        let enrolling = second.to_path_buf();
        let worker = thread::spawn(move || {
            vaults_cli::enroll_device_with_status(&enrolling, "owner_127", |code| {
                let _ = sender.send(code.to_owned());
            })
        });
        let code = receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|error| error.to_string())?;
        session.approve_device_code(&code)?;
        worker
            .join()
            .map_err(|_| "enrollment worker panicked".to_owned())??;
    }
    let other = paced_unlock(second, "owner_127", &secret, password)?;
    println!(
        "{}: {} vault(s)",
        second.display(),
        other.vault_list()?.as_array().map_or(0, Vec::len)
    );
    drop(other);
    if enroll_only {
        println!("Two distinct fictitious device profiles enrolled and unlocked.");
        return Ok(());
    }
    let vault_id = vaults[0]["vaultId"]
        .as_str()
        .ok_or("missing vault")?
        .to_owned();
    let marker = format!("API010-{}", uuid::Uuid::new_v4());
    let item_title = format!("{marker}-base");
    let fixture_password = "api010-fiction-secret";
    session.item_upsert(
        &vault_id,
        None,
        &item_title,
        "https://base.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    let rows = session.item_list(&vault_id)?;
    let item_id = rows
        .as_array()
        .ok_or("invalid item list")?
        .iter()
        .find(|row| row["title"] == item_title)
        .and_then(|row| row["itemId"].as_str())
        .ok_or("created item missing")?
        .to_owned();
    drop(session);

    let mut a = paced_unlock(config, "owner_127", &secret, password)?;
    let mut b = paced_unlock(second, "owner_127", &secret, password)?;
    b.item_upsert(
        &vault_id,
        Some(&item_id),
        &item_title,
        "https://remote.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    let local_title = format!("{marker}-local");
    ensure_conflict(a.item_upsert(
        &vault_id,
        Some(&item_id),
        &local_title,
        "https://base.invalid",
        "base-user",
        fixture_password,
        &[],
    ))?;
    let first_sync = a.sync_now()?;
    if first_sync["rebased"] != 1
        || first_sync["conflicts"]
            .as_array()
            .is_none_or(|rows| !rows.is_empty())
    {
        return Err(format!("different-field rebase failed: {first_sync}"));
    }
    drop(a);
    drop(b);
    let mut b = paced_unlock(second, "owner_127", &secret, password)?;
    let merged = b.item_get(&vault_id, &item_id, None)?;
    if merged["title"] != local_title || merged["website"] != "https://remote.invalid" {
        return Err("different-field changes did not converge".to_owned());
    }
    println!("different-field online rebase: converged");

    let mut a = paced_unlock(config, "owner_127", &secret, password)?;
    let server_title = format!("{marker}-server");
    b.item_upsert(
        &vault_id,
        Some(&item_id),
        &server_title,
        "https://remote.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    let mine_title = format!("{marker}-mine");
    ensure_conflict(a.item_upsert(
        &vault_id,
        Some(&item_id),
        &mine_title,
        "https://remote.invalid",
        "base-user",
        fixture_password,
        &[],
    ))?;
    let replica_path = config.join("replicas").join(format!("{vault_id}.json"));
    let before: serde_json::Value =
        serde_json::from_slice(&fs::read(&replica_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let pending = before["pending"][0]["request"].clone();
    let operation_id = before["pending"][0]["operation"]["opId"]
        .as_str()
        .ok_or("missing operation")?
        .to_owned();
    let conflict = a.sync_now()?;
    if conflict["conflicts"][0]["kind"] != "same-field"
        || conflict["conflicts"][0]["fields"][0] != "title"
    {
        return Err(format!("same-field conflict missing: {conflict}"));
    }
    let after: serde_json::Value =
        serde_json::from_slice(&fs::read(&replica_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if after["pending"][0]["request"] != pending {
        return Err("pending request changed after rejection".to_owned());
    }
    if a.conflict_draft(&vault_id, &item_id, &operation_id)?["title"] != mine_title {
        return Err("queued draft was lost".to_owned());
    }
    drop(a);
    let mut a = paced_unlock(config, "owner_127", &secret, password)?;
    a.item_upsert_resolving(
        &vault_id,
        &item_id,
        &operation_id,
        &mine_title,
        "https://remote.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    drop(a);
    drop(b);
    let mut b = paced_unlock(second, "owner_127", &secret, password)?;
    if b.item_get(&vault_id, &item_id, None)?["title"] != mine_title {
        return Err("reviewed merge did not converge".to_owned());
    }
    println!(
        "same-field conflict: pending preserved across restart and reviewed replacement converged"
    );

    let mut offline = client::unlock_offline(config, "owner_127", &secret, password)?;
    b.item_upsert(
        &vault_id,
        Some(&item_id),
        &mine_title,
        "https://offline-remote.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    let offline_title = format!("{marker}-offline");
    let queued = offline.item_upsert(
        &vault_id,
        Some(&item_id),
        &offline_title,
        "https://remote.invalid",
        "base-user",
        fixture_password,
        &[],
    )?;
    if queued["queued"] != true {
        return Err("offline edit was not queued".to_owned());
    }
    drop(offline);
    let mut a = paced_unlock(config, "owner_127", &secret, password)?;
    let result = a.sync_now()?;
    if result["rebased"] != 1 {
        return Err(format!("offline rebase failed: {result}"));
    }
    let retry = a.sync_now()?;
    if retry["accepted"] != 0 || retry["rebased"] != 0 {
        return Err("retry was not idempotent".to_owned());
    }
    drop(a);
    drop(b);
    let mut b = paced_unlock(second, "owner_127", &secret, password)?;
    let final_item = b.item_get(&vault_id, &item_id, None)?;
    if final_item["title"] != offline_title
        || final_item["website"] != "https://offline-remote.invalid"
    {
        return Err("offline changes did not converge".to_owned());
    }
    let replica_text = fs::read_to_string(&replica_path).map_err(|e| e.to_string())?;
    for value in [
        &marker,
        fixture_password,
        "base-user",
        "https://offline-remote.invalid",
    ] {
        if replica_text.contains(value) {
            return Err("plaintext appeared in replica".to_owned());
        }
    }
    println!("offline queued rebase: converged; idempotent retry; replica ciphertext-only");
    b.checkpoint_now(&vault_id)?;
    drop(b);
    let a = paced_unlock(config, "owner_127", &secret, password)?;
    let pinned: serde_json::Value =
        serde_json::from_slice(&fs::read(&replica_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if pinned["checkpoint"].is_null() || pinned["checkpoint_public_key"].is_null() {
        return Err("signed checkpoint was not pinned".to_owned());
    }
    if a.vault_list()?.as_array().is_none_or(Vec::is_empty) {
        return Err("vault disappeared after checkpoint".to_owned());
    }
    println!("signed checkpoint: verified and pinned on second device");
    Ok(())
}

fn paced_unlock(
    config: &Path,
    username: &str,
    secret: &str,
    password: &[u8],
) -> Result<client::Session, String> {
    match client::unlock(config, username, secret, password) {
        Err(error) if error.contains("(429)") => {
            println!("authentication rate limit: waiting for the next window");
            thread::sleep(Duration::from_secs(61));
            client::unlock(config, username, secret, password)
        }
        result => result,
    }
}

fn ensure_conflict(result: Result<serde_json::Value, String>) -> Result<(), String> {
    match result {
        Err(error) if error.contains("409") => Ok(()),
        other => Err(format!("expected stale edit rejection, got {other:?}")),
    }
}
