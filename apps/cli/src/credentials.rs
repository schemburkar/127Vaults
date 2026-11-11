//! Interactive credential maintenance. Secrets are hidden input, never command arguments.
use super::{
    SecretPrompt, TerminalSecretPrompt, agent, client, effective_config_dir, file_profile_value,
    input, unlock_material,
};
use clap::Subcommand;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Debug, Subcommand)]
pub enum CredentialCommand {
    /// Change the master password using a fresh online device-authenticated session.
    RotatePassword {
        #[arg(long)]
        username: Option<String>,
        #[arg(long)]
        yes: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Change the account secret and replace this device identity; other devices need re-enrollment.
    RotateAccountSecret {
        #[arg(long)]
        username: Option<String>,
        #[arg(long)]
        yes: bool,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Inspect an interrupted credential rotation without printing secrets.
    Status {
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Verify new credentials online and finish an interrupted local rotation.
    Resume {
        #[arg(long)]
        username: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Discard a pending rotation only after the server verifies the old credentials.
    Abort {
        #[arg(long)]
        username: Option<String>,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
    /// Recover access on a fresh profile through approval by an existing trusted device.
    RecoverDevice {
        username: String,
        #[arg(long, default_value = ".127vaults")]
        config_dir: PathBuf,
    },
}
fn new_password(prompt: &mut dyn SecretPrompt) -> Result<Zeroizing<Vec<u8>>, String> {
    let password = Zeroizing::new(
        prompt
            .read_secret("New master password: ")
            .map_err(|_| "Secure terminal input failed")?,
    );
    let confirmation = Zeroizing::new(
        prompt
            .read_secret("Confirm new master password: ")
            .map_err(|_| "Secure terminal input failed")?,
    );
    if password.len() < 20
        || password.len() > 1024
        || password.as_slice() != confirmation.as_slice()
    {
        return Err("New passwords must match and contain 20–1024 UTF-8 bytes".into());
    }
    Ok(password)
}
fn new_secret(prompt: &mut dyn SecretPrompt) -> Result<Zeroizing<String>, String> {
    let secret = Zeroizing::new(
        prompt
            .read_secret("New account secret (64 hexadecimal characters): ")
            .map_err(|_| "Secure terminal input failed")?,
    );
    let confirmation = Zeroizing::new(
        prompt
            .read_secret("Confirm new account secret: ")
            .map_err(|_| "Secure terminal input failed")?,
    );
    if secret.len() != 64
        || secret.as_slice() != confirmation.as_slice()
        || !secret.iter().all(u8::is_ascii_hexdigit)
    {
        return Err("New account secrets must match and contain 64 hexadecimal characters".into());
    }
    Ok(Zeroizing::new(
        std::str::from_utf8(&secret)
            .map_err(|_| "Invalid account secret")?
            .to_owned(),
    ))
}
pub fn run(command: CredentialCommand) -> Result<String, String> {
    let (config, username, action, yes) = match command {
        CredentialCommand::Status { config_dir } => {
            return Ok(client::rotation_status(&effective_config_dir(&config_dir))?.to_string());
        }
        CredentialCommand::RecoverDevice {
            username,
            config_dir,
        } => {
            let config = effective_config_dir(&config_dir);
            if config.join("device.conf").exists() {
                return Err("Use a fresh profile for replacement enrollment. Keep the old profile and pending data intact.".into());
            }
            eprintln!(
                "Recovery requires your account secret, master password and approval from an existing trusted device. Lost encryption credentials cannot be reset by the server administrator."
            );
            println!("{}", super::enroll_device(&config, &username)?);
            let (secret, password) = unlock_material(&config, &username, false)?;
            agent::start(&config, &username, &secret, &password)?;
            return Ok("Replacement device approved and authenticated. Review and revoke the lost device from a trusted client.".into());
        }
        CredentialCommand::RotatePassword {
            username,
            yes,
            config_dir,
        } => (config_dir, username, "password", yes),
        CredentialCommand::RotateAccountSecret {
            username,
            yes,
            config_dir,
        } => (config_dir, username, "account-secret", yes),
        CredentialCommand::Resume {
            username,
            config_dir,
        } => (config_dir, username, "resume", false),
        CredentialCommand::Abort {
            username,
            config_dir,
        } => (config_dir, username, "abort", false),
    };
    let config = effective_config_dir(&config);
    let username = match username {
        Some(value) => value,
        None => file_profile_value(&config.join("device.conf"), "username")?,
    };
    let _ = agent::call(&config, "logout", serde_json::json!({}));
    if action == "resume" || action == "abort" {
        eprintln!(
            "Enter the {} credentials. The server must verify them online before local recovery proceeds.",
            if action == "resume" { "new" } else { "old" }
        );
        let (secret, password) = unlock_material(&config, &username, false)?;
        if action == "resume" {
            drop(client::resume_rotation(
                &config, &username, &secret, &password,
            )?);
        } else {
            client::abort_rotation(&config, &username, &secret, &password)?;
        }
        return Ok(
            "Credential rotation reconciled. Sign in again with the confirmed credentials.".into(),
        );
    }
    eprintln!(
        "Sync other devices first. This operation revokes online sessions. {}",
        if action == "account-secret" {
            "It also replaces device identities; other devices must be enrolled again. Save the new account secret in your recovery materials."
        } else {
            "All devices must sign in again with the new master password."
        }
    );
    if !yes && input("Type rotate to continue: ")? != "rotate" {
        return Err("Credential rotation cancelled".into());
    }
    let (secret, password) = unlock_material(&config, &username, true)?;
    let mut session = client::unlock(&config, &username, &secret, &password)?;
    let mut prompt = TerminalSecretPrompt;
    let result = if action == "password" {
        let next = new_password(&mut prompt)?;
        if next.as_slice() == password.as_slice() {
            return Err("Choose a different master password".into());
        }
        session.rotate_credentials(&username, action, &secret, &next)?
    } else {
        let next = new_secret(&mut prompt)?;
        if next.eq_ignore_ascii_case(&secret) {
            return Err("Choose a different account secret".into());
        }
        session.rotate_credentials(&username, action, &next, &password)?
    };
    Ok(result.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Prompt(Vec<Vec<u8>>);
    impl SecretPrompt for Prompt {
        fn read_secret(&mut self, _prompt: &str) -> std::io::Result<Vec<u8>> {
            Ok(self.0.remove(0))
        }
    }
    #[test]
    fn replacement_credentials_require_confirmation_and_bounded_valid_input() {
        assert!(new_password(&mut Prompt(vec![b"too short".to_vec(); 2])).is_err());
        assert!(
            new_password(&mut Prompt(vec![
                b"long fictitious password one".to_vec(),
                b"long fictitious password two".to_vec()
            ]))
            .is_err()
        );
        assert!(
            new_password(&mut Prompt(vec![
                b"long fictitious password one".to_vec();
                2
            ]))
            .is_ok()
        );
        assert!(new_secret(&mut Prompt(vec![vec![b'z'; 64]; 2])).is_err());
        assert!(new_secret(&mut Prompt(vec![vec![b'a'; 64]; 2])).is_ok());
    }
}
