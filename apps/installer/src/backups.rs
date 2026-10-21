use crate::{discovery, prerequisites};
use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use vaults_installer::Result;

#[derive(Debug, Serialize, Deserialize)]
pub struct Recovery {
    pub format: u8,
    pub project: String,
    pub key_file: PathBuf,
    pub backup_root: PathBuf,
    #[serde(skip)]
    pub metadata: PathBuf,
    #[serde(skip)]
    pub saved: bool,
}

pub fn plan(home: &Path, directory: &Path, supplied_key: Option<&Path>) -> Result<Recovery> {
    let project = discovery::project(directory)?;
    let base = home.join(".127vaults");
    let metadata = base
        .join("installations")
        .join(&project)
        .join("recovery.json");
    let mut record = if metadata.exists() {
        let record: Recovery = serde_json::from_slice(&fs::read(&metadata)?)?;
        if record.format != 1
            || record.project != project
            || !record.key_file.is_absolute()
            || !record.backup_root.is_absolute()
        {
            return Err(
                "Invalid saved backup settings; preserve them and restore the matching key".into(),
            );
        }
        record
    } else {
        Recovery {
            format: 1,
            key_file: base.join("keys").join(format!("{project}.key")),
            backup_root: base.join("backups").join(&project),
            project,
            metadata: PathBuf::new(),
            saved: false,
        }
    };
    record.saved = metadata.exists();
    record.metadata = metadata;
    if let Some(key) = supplied_key {
        record.key_file = std::path::absolute(key)?;
    }
    if record.key_file.exists() {
        validate_key(&record.key_file)?;
    } else if supplied_key.is_some() || record.saved {
        return Err(format!("Saved backup key is missing: {}. Restore it from your safe copy; it will not be silently replaced",record.key_file.display()).into());
    }
    Ok(record)
}

fn validate_key(path: &Path) -> Result<()> {
    let info = fs::symlink_metadata(path)?;
    if !info.is_file() || info.file_type().is_symlink() || info.len() != 32 {
        return Err("Backup key must be a regular protected 32-byte file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if info.permissions().mode() & 0o077 != 0 {
            return Err("Backup key permissions must be owner-only".into());
        }
    }
    Ok(())
}

fn private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    if fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err("Backup directory cannot be a symbolic link".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(windows)]
    {
        let output = Command::new("whoami.exe")
            .args(["/user", "/fo", "csv", "/nh"])
            .output()?;
        let text = String::from_utf8(output.stdout)?;
        let sid = text
            .split('"')
            .find(|part| {
                part.starts_with("S-1-")
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
            })
            .ok_or("Cannot identify the backup key owner")?;
        prerequisites::run(Command::new("icacls.exe").arg(path).args([
            "/inheritance:r",
            "/grant:r",
            &format!("*{sid}:(OI)(CI)F"),
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
        ]))?;
    }
    Ok(())
}

pub fn prepare(record: &Recovery, node: &Path, bundle: &Path) -> Result<()> {
    private_directory(
        record
            .metadata
            .parent()
            .ok_or("Missing recovery directory")?,
    )?;
    if !record.key_file.exists() {
        if record.saved {
            return Err("Saved backup key disappeared; restore it before updating".into());
        }
        private_directory(record.key_file.parent().ok_or("Missing key directory")?)?;
        prerequisites::run(
            Command::new(node)
                .current_dir(bundle)
                .args(["server.mjs", "database", "keygen", "--output"])
                .arg(&record.key_file),
        )?;
    }
    validate_key(&record.key_file)?;
    private_directory(&record.backup_root)?;
    let mut file = AtomicWriteFile::open(&record.metadata)?;
    file.write_all(&serde_json::to_vec_pretty(record)?)?;
    file.commit()?;
    cliclack::note(
        "Backup and recovery",
        format!(
            "Backup key: {}\nEncrypted backups: {}\nSaved settings: {}\nKeep a safe copy of the key separate from your backups. It is needed to restore them. Never upload or share the key.",
            record.key_file.display(),
            record.backup_root.display(),
            record.metadata.display()
        ),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_per_installation_and_lost_recorded_keys_are_not_replaced() {
        let home = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let bundle = home.join("bundle");
        fs::create_dir_all(&bundle).unwrap();
        fs::write(
            bundle.join(".env"),
            "VAULTS_PROJECT=vaults-test-123456abcdef\n",
        )
        .unwrap();
        let record = plan(&home, &bundle, None).unwrap();
        assert!(record.key_file.starts_with(home.join(".127vaults/keys")));
        assert!(!record.key_file.exists());
        fs::create_dir_all(record.metadata.parent().unwrap()).unwrap();
        fs::write(&record.metadata, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(plan(&home, &bundle, None).is_err());
        fs::remove_dir_all(home).unwrap();
    }
}
