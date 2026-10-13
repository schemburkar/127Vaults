//! Fictitious-data connector acceptance; never selects a default user profile.
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

fn fixture_device(profile: &Path, server_id: &str) -> Result<String, String> {
    if !profile.is_absolute() || !profile.join("device.conf").is_file() {
        return Err("fixture profile must be absolute and enrolled".to_owned());
    }
    let device =
        std::fs::read_to_string(profile.join("device.conf")).map_err(|error| error.to_string())?;
    if !device.contains(&format!("server_id={server_id}\n"))
        || !device.contains("username=owner_127\n")
    {
        return Err("this helper only accepts the isolated internal release fixture".to_owned());
    }
    device
        .lines()
        .find_map(|line| line.strip_prefix("device_id=").map(str::to_owned))
        .ok_or_else(|| "fixture device ID is missing".to_owned())
}

fn start(executable: &Path, profile: &Path) -> Result<(), String> {
    vaults_cli::start_connector_agent(
        executable,
        profile,
        "owner_127",
        &"07".repeat(32),
        b"fictitious password 127vaults",
    )
}

fn verify_settings(
    profile: &Path,
    vault_name: &str,
    collection_name: &str,
    title: &str,
) -> Result<(), String> {
    let mut session = vaults_cli::client::unlock(
        profile,
        "owner_127",
        &"07".repeat(32),
        b"fictitious password 127vaults",
    )?;
    let vaults = session.vault_list()?;
    if !vaults.as_array().is_some_and(|rows| {
        rows.iter()
            .any(|row| row["name"].as_str() == Some(vault_name))
    }) {
        return Err("GUI-created encrypted vault name did not reach the second device".to_owned());
    }
    let settings = session.vault_settings();
    let collection_id = settings["collections"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["name"].as_str() == Some(collection_name))
        })
        .and_then(|row| row["id"].as_str())
        .ok_or("GUI-created collection did not reach the second device")?;
    let items = session.collection_items(collection_id)?;
    if !items["items"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["title"].as_str() == Some(title)))
    {
        return Err("GUI collection edit did not reach the second device".to_owned());
    }
    println!("Second device read GUI-created encrypted vault name, collection and saved item.");

    Ok(())
}

fn verify_conflict(profile: &Path, title: &str) -> Result<(), String> {
    let secret = "07".repeat(32);
    let password = b"fictitious password 127vaults";
    let mut offline = vaults_cli::client::unlock_offline(profile, "owner_127", &secret, password)?;
    if !offline
        .item_list_all()?
        .as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["title"].as_str() == Some(title)))
    {
        return Err("preserved pending fixture title is unavailable".to_owned());
    }
    drop(offline);
    let mut online = vaults_cli::client::unlock(profile, "owner_127", &secret, password)?;
    let result = online.sync_now()?;
    let conflicts = result["conflicts"].as_array().map_or(0, Vec::len);
    println!(
        "Fixture sync: pending={}, conflicts={conflicts}, rebased={}",
        result["pending"], result["rebased"]
    );
    if conflicts == 0 {
        return Err("same-title fixture change did not require conflict review".to_owned());
    }
    println!("Preserved second-device change requires review in the shared engine.");
    Ok(())
}

fn verify_sync_review(profile: &Path) -> Result<(), String> {
    let mut session = vaults_cli::client::unlock_offline(
        profile,
        "owner_127",
        &"07".repeat(32),
        b"fictitious password 127vaults",
    )?;
    let vaults = session.vault_list()?;
    let vault_id = vaults
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["retired"] != true))
        .and_then(|row| row["vaultId"].as_str())
        .ok_or("fixture vault unavailable")?;
    session.item_upsert(
        vault_id,
        None,
        "Synthetic sync review check",
        "https://review.invalid",
        "synthetic-review-user",
        "synthetic-review-password",
        &[],
    )?;
    drop(session);
    let mut reopened = vaults_cli::client::unlock_offline(
        profile,
        "owner_127",
        &"07".repeat(32),
        b"fictitious password 127vaults",
    )?;
    let review = reopened.sync_review()?;
    let row = review["items"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["title"] == "Synthetic sync review check")
        })
        .ok_or("durable queued item missing from review")?;
    if row["fields"]
        != serde_json::json!(["title", "website", "username", "password", "customFields"])
        || !row["conflict"].is_null()
    {
        return Err("review misclassified pending fields or invented a conflict".to_owned());
    }
    let serialized = review.to_string();
    if [
        "synthetic-review-password",
        "synthetic-review-user",
        "https://review.invalid",
    ]
    .iter()
    .any(|secret| serialized.contains(secret))
    {
        return Err("review disclosed a field value".to_owned());
    }
    println!(
        "Durable pending item labels and field names verified; values withheld and no conflict invented."
    );

    Ok(())
}

fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let action = args.next().ok_or("expected start or stop")?;
    let profile = PathBuf::from(args.next().ok_or("expected explicit fixture profile")?);
    let server_id = std::env::var("VAULTS_INTERNAL_SERVER_ID")
        .map_err(|_| "explicit fictitious fixture server ID is required")?;
    uuid::Uuid::parse_str(&server_id).map_err(|_| "fixture server ID must be a UUID")?;
    let device_id = fixture_device(&profile, &server_id)?;
    match action.as_str() {
        "review-check" => verify_sync_review(&profile)?,
        "conflict" => verify_conflict(&profile, &args.next().ok_or("expected fixture title")?)?,
        "inspect-title" => {
            let title = args.next().ok_or("expected fictitious title")?;
            let mut session = vaults_cli::client::unlock_offline(
                &profile,
                "owner_127",
                &"07".repeat(32),
                b"fictitious password 127vaults",
            )?;
            if !session
                .item_list_all()?
                .as_array()
                .is_some_and(|rows| rows.iter().any(|row| row["title"].as_str() == Some(&title)))
            {
                return Err(
                    "saved fictitious title is absent from the encrypted replica".to_owned(),
                );
            }
            println!("Explicit fictitious title found in the encrypted replica.");
        }
        "settings" => {
            let vault_name = args.next().ok_or("expected fictitious vault name")?;
            let collection_name = args.next().ok_or("expected fictitious collection name")?;
            let title = args.next().ok_or("expected fictitious item title")?;
            verify_settings(&profile, &vault_name, &collection_name, &title)?;
        }
        "start" => {
            let executable = PathBuf::from(args.next().ok_or("expected packaged CLI executable")?);
            start(&executable, &profile)?;
            if !vaults_cli::connector_agent_active(&profile) {
                return Err("fixture agent did not become active".to_owned());
            }
            println!("Fictitious offline connector agent active.");
        }
        "stop" => {
            vaults_cli::stop_connector_agent(&profile);
            if vaults_cli::connector_agent_active(&profile) {
                return Err("fixture agent remained active after lock".to_owned());
            }
            println!("Fictitious connector agent locked.");
        }
        "pair" => {
            let second = PathBuf::from(args.next().ok_or("expected second fixture profile")?);
            fixture_device(&second, &server_id)?;
            let executable = PathBuf::from(args.next().ok_or("expected packaged CLI executable")?);
            let legacy = keyring::Entry::new(
                "127Vaults CLI unlock lease",
                &format!("{server_id}:{device_id}"),
            )
            .map_err(|_| "fixture legacy keyring is unavailable")?;
            let mut saved_legacy = None;
            let result = (|| {
                start(&executable, &profile)?;
                if std::fs::read_to_string(profile.join("agent.conf"))
                    .unwrap_or_default()
                    .starts_with("version=1\n")
                {
                    saved_legacy = Some(Zeroizing::new(
                        legacy
                            .get_password()
                            .map_err(|_| "fixture legacy lease is unavailable")?,
                    ));
                }
                start(&executable, &second)?;
                if !vaults_cli::connector_agent_active(&profile)
                    || !vaults_cli::connector_agent_active(&second)
                {
                    return Err("concurrent fixture profiles invalidated one another".to_owned());
                }
                vaults_cli::stop_connector_agent(&second);
                if !vaults_cli::connector_agent_active(&profile) {
                    return Err("locking one fixture profile invalidated the other".to_owned());
                }
                Ok(())
            })();
            vaults_cli::stop_connector_agent(&second);
            // Recovery only for this fictitious legacy pair, including a failing baseline.
            if let Some(capability) = saved_legacy {
                legacy
                    .set_password(&capability)
                    .map_err(|_| "fixture legacy cleanup failed")?;
            }
            vaults_cli::stop_connector_agent(&profile);
            result?;
            println!("Concurrent fictitious agents stayed independent; both locked cleanly.");
        }
        _ => return Err("expected start, stop or pair".to_owned()),
    }
    Ok(())
}
