use atomic_write_file::AtomicWriteFile;
use std::{fs, fs::OpenOptions, io::Write, path::Path};
use vaults_installer::Result;

const SETTINGS: [&str; 4] = ["SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_FROM"];

pub fn guide(
    config_path: &Path,
    password_path: &Path,
    interactive: bool,
    mut start: impl FnMut() -> Result<()>,
) -> Result<()> {
    if !interactive {
        return Ok(());
    }
    let previous = fs::read_to_string(config_path)?;
    if has_settings(&previous) {
        cliclack::log::info("Existing enrollment email settings were preserved.")?;
        return Ok(());
    }
    cliclack::note(
        "Enrollment email",
        "Invited people verify their email before joining. Have your mail provider’s SMTP server, username, password and verified sender address ready. Choose a provider that supports SMTP over TLS on port 465. You can return to this step by rerunning the installer and choosing Server.",
    )?;
    if !cliclack::confirm("Set up enrollment email now?").interact()? {
        return Ok(());
    }
    let host: String = cliclack::input("SMTP server hostname")
        .validate(|value: &String| {
            host_valid(value)
                .then_some(())
                .ok_or("Enter a hostname such as smtp.example.com.")
        })
        .interact()?;
    let username: String = cliclack::input("SMTP username")
        .validate(|value: &String| {
            atom(value)
                .then_some(())
                .ok_or("Use letters, digits or @ . _ + - characters.")
        })
        .interact()?;
    let from: String = cliclack::input("Verified sender email address")
        .validate(|value: &String| {
            sender_valid(value)
                .then_some(())
                .ok_or("Enter a sender address such as vaults@example.com.")
        })
        .interact()?;
    let password = cliclack::password("SMTP password or app password")
        .validate(|value: &String| {
            password_valid(value)
                .then_some(())
                .ok_or("Use 1–512 printable ASCII characters without spaces.")
        })
        .interact()?;
    if apply(
        config_path,
        password_path,
        &previous,
        &host,
        &username,
        &from,
        &password,
        &mut start,
    )? {
        cliclack::log::success(
            "Enrollment email is configured. The server restarted successfully. Mail delivery will first be used when an invited person requests a code.",
        )?;
    }
    Ok(())
}

fn atom(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 254
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"@._+-".contains(&byte))
}

fn host_valid(value: &str) -> bool {
    value.len() <= 253
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn sender_valid(value: &str) -> bool {
    value.split_once('@').is_some_and(|(local, host)| {
        atom(value) && !local.is_empty() && host.contains('.') && host_valid(host)
    })
}

fn password_valid(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && value.bytes().all(|byte| (33..=126).contains(&byte))
}

fn has_settings(config: &str) -> bool {
    config.lines().any(|line| {
        let line = line
            .trim_start()
            .strip_prefix("export ")
            .unwrap_or(line.trim_start());
        line.split_once('=')
            .is_some_and(|(key, _)| SETTINGS.contains(&key.trim()))
    })
}

fn write_config(path: &Path, content: &str) -> Result<()> {
    let mut staged = AtomicWriteFile::open(path)?;
    staged.write_all(content.as_bytes())?;
    staged.commit()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply(
    config_path: &Path,
    password_path: &Path,
    previous: &str,
    host: &str,
    username: &str,
    from: &str,
    password: &str,
    start: &mut impl FnMut() -> Result<()>,
) -> Result<bool> {
    if has_settings(previous) || fs::read_to_string(config_path)? != previous {
        return Err(
            "Enrollment email settings changed. Reopen the installer to review them.".into(),
        );
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut secret = options.open(password_path).map_err(|_| "Could not create the protected SMTP password file. Any existing password file was preserved.")?;
    let written = secret
        .write_all(password.as_bytes())
        .and_then(|()| secret.sync_all());
    drop(secret);
    let updated = format!(
        "{}\nSMTP_HOST={host}\nSMTP_PORT=465\nSMTP_USERNAME={username}\nSMTP_FROM={from}\n",
        previous.trim_end_matches(['\r', '\n'])
    );
    if let Err(error) = written
        .map_err(Into::into)
        .and_then(|()| write_config(config_path, &updated))
    {
        fs::remove_file(password_path)?;
        return Err(error);
    }
    if start().is_err() {
        if fs::read_to_string(config_path)? != updated {
            return Err("Server startup failed and its settings changed during setup. Existing files were preserved.".into());
        }
        write_config(config_path, previous)?;
        fs::remove_file(password_path)?;
        start().map_err(|_| "Previous email settings were restored, but the server could not restart. Check server startup before retrying.")?;
        cliclack::log::warning(
            "Email setup could not start the server. Previous settings were restored. You can rerun the installer to try again.",
        )?;
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smtp_setup_preserves_config_and_rolls_back_after_a_failed_start() -> Result<()> {
        let work = std::env::temp_dir().join(format!("vaults-mail-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&work)?;
        let result = (|| {
            let config = work.join(".env");
            let secret = work.join("smtp-password");
            let previous = "VAULTS_PROJECT=fixture\r\n";
            fs::write(&config, previous)?;
            let mut attempts = 0;
            let configured = apply(
                &config,
                &secret,
                previous,
                "smtp.example.invalid",
                "fixture",
                "vault@example.invalid",
                "fixture-password",
                &mut || {
                    attempts += 1;
                    if attempts == 1 {
                        assert!(fs::read_to_string(&config)?.contains("SMTP_PORT=465"));
                        assert!(!fs::read_to_string(&config)?.contains("fixture-password"));
                        assert_eq!(fs::read_to_string(&secret)?, "fixture-password");
                        return Err("fixture start failure".into());
                    }
                    assert_eq!(fs::read_to_string(&config)?, previous);
                    assert!(!secret.exists());
                    Ok(())
                },
            )?;
            assert!(!configured);
            assert_eq!(attempts, 2);
            assert!(apply(
                &config,
                &secret,
                previous,
                "smtp.example.invalid",
                "fixture",
                "vault@example.invalid",
                "fixture-password",
                &mut || Ok(())
            )?);
            assert!(has_settings(&fs::read_to_string(config)?));
            assert_eq!(fs::read_to_string(secret)?, "fixture-password");
            Ok(())
        })();
        fs::remove_dir_all(work)?;
        result
    }

    #[test]
    fn smtp_inputs_cannot_add_compose_settings() {
        assert!(host_valid("smtp.example.invalid"));
        assert!(!host_valid("smtp.example.invalid\nX=bad"));
        assert!(!atom("${OTHER_SECRET}"));
        assert!(sender_valid("vaults+household@example.invalid"));
        assert!(!sender_valid("vaults@two@example.invalid"));
        assert!(has_settings(" export SMTP_FROM = already@example.invalid"));
        assert!(!password_valid("bad\npassword"));
    }
}
