//! Disposable live check against the fictitious API010 owner and enrolled devices.
//! Run only on the local acceptance stack: cargo run -p vaults-cli --example `vault_removal_acceptance`
use std::{fs, path::Path};
use vaults_cli::client;

fn profile(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for file in ["trust.conf", "installation-ca.pem", "device.conf"] {
        fs::copy(source.join(file), target.join(file)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() -> Result<(), String> {
    let a = Path::new(".tools/removal-device-a");
    let b = Path::new(".tools/removal-device-b");
    profile(Path::new(".tools/api010-device-a"), a)?;
    profile(Path::new(".tools/api010-device-b"), b)?;
    let secret = "07".repeat(32);
    let password = b"fictitious password 127vaults";
    let mut first = client::unlock(a, "owner_127", &secret, password)?;
    let suffix = uuid::Uuid::new_v4().to_string();
    let source = first.vault_create(&format!("Move source {suffix}"))?["vaultId"]
        .as_str()
        .ok_or("source missing")?
        .to_owned();
    let destination = first.vault_create(&format!("Move destination {suffix}"))?["vaultId"]
        .as_str()
        .ok_or("destination missing")?
        .to_owned();
    first.item_upsert(&source, None, "Fictitious card", "", "", "", &[
        serde_json::json!({"id":"__127vaults_item_type","label":"Item type","type":"metadata","value":"card"}),
        serde_json::json!({"id":"card_number","label":"Card number","type":"password","value":"4111111111111111"}),
    ])?;
    let moved = first.move_vault(&source, &destination)?;
    if moved["choice"] != "move"
        || moved["itemCount"] != 1
        || first.removal_status()?["pending"] != false
    {
        return Err("move result is invalid".to_owned());
    }
    if first
        .vault_list()?
        .as_array()
        .ok_or("vault list invalid")?
        .iter()
        .find(|row| row["vaultId"] == source)
        .ok_or("source missing")?["retired"]
        != true
    {
        return Err("source was not retired".to_owned());
    }
    let item = first.item_list(&destination)?;
    let copied = item
        .as_array()
        .ok_or("item list invalid")?
        .iter()
        .find(|row| row["title"] == "Fictitious card")
        .ok_or("copy missing")?;
    if first.item_get(
        &destination,
        copied["itemId"].as_str().ok_or("item ID missing")?,
        None,
    )?["itemType"]
        != "card"
    {
        return Err("typed copy was not preserved".to_owned());
    }
    let archive = first.vault_create(&format!("Archive source {suffix}"))?["vaultId"]
        .as_str()
        .ok_or("archive source missing")?
        .to_owned();
    first.item_upsert(&archive, None, "Fictitious note", "", "", "fiction", &[])?;
    if first.archive_vault(&archive)?["choice"] != "archive" {
        return Err("archive failed".to_owned());
    }
    if first.restore_archived_vault(&archive)?["restored"] != true {
        return Err("restore failed".to_owned());
    }
    drop(first);
    let mut second = client::unlock(b, "owner_127", &secret, password)?;
    if second
        .item_list(&destination)?
        .as_array()
        .ok_or("second device list invalid")?
        .iter()
        .filter(|row| row["title"] == "Fictitious card")
        .count()
        != 1
    {
        return Err("second device did not see exactly one destination copy".to_owned());
    }
    println!("move, archive, restore, and second-device copy verification passed");
    Ok(())
}
