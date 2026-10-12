//! Fictitious-data connector acceptance; never selects a default user profile.
use std::path::PathBuf;

fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let action = args.next().ok_or("expected start or stop")?;
    let profile = PathBuf::from(args.next().ok_or("expected explicit fixture profile")?);
    if !profile.is_absolute() || !profile.join("device.conf").is_file() {
        return Err("fixture profile must be absolute and enrolled".to_owned());
    }
    let device =
        std::fs::read_to_string(profile.join("device.conf")).map_err(|error| error.to_string())?;
    let server_id = std::env::var("VAULTS_INTERNAL_SERVER_ID")
        .map_err(|_| "explicit fictitious fixture server ID is required")?;
    uuid::Uuid::parse_str(&server_id).map_err(|_| "fixture server ID must be a UUID")?;
    if !device.contains(&format!("server_id={server_id}\n"))
        || !device.contains("username=owner_127\n")
    {
        return Err("this helper only accepts the isolated internal release fixture".to_owned());
    }
    match action.as_str() {
        "start" => {
            let executable = PathBuf::from(args.next().ok_or("expected packaged CLI executable")?);
            vaults_cli::start_connector_agent(
                &executable,
                &profile,
                "owner_127",
                &"07".repeat(32),
                b"fictitious password 127vaults",
            )?;
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
        _ => return Err("expected start or stop".to_owned()),
    }
    Ok(())
}
