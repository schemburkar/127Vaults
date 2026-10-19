use flate2::read::GzDecoder;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};
use vaults_installer::{Result, safe_path};

const EXPANDED_LIMIT: u64 = 64 * 1024 * 1024 * 1024;

/// Extract regular files/directories only. Never follow archive links or replace files.
pub fn extract(source: &Path, target: &Path, node_only: bool) -> Result<()> {
    fs::create_dir(target)?;
    let mut expanded = 0_u64;
    let mut count = 0_u64;
    let mut write = |name: &Path, size: u64, reader: &mut dyn Read| -> Result<()> {
        if !safe_path(name) {
            return Err("Unsafe archive path".into());
        }
        count += 1;
        expanded = expanded.checked_add(size).ok_or("Archive too large")?;
        if count > 100_000 || expanded > EXPANDED_LIMIT {
            return Err("Archive expansion limit exceeded".into());
        }
        let destination = if node_only {
            let text = name.to_string_lossy();
            if !(text.ends_with("/bin/node") || text.ends_with("/node.exe")) {
                return Ok(());
            }
            target.join(if cfg!(windows) { "node.exe" } else { "node" })
        } else {
            target.join(name)
        };
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        if io::copy(&mut reader.take(size + 1), &mut file)? != size {
            return Err("Archive entry size mismatch".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    };
    if source.extension().is_some_and(|v| v == "zip") {
        let mut archive = zip::ZipArchive::new(File::open(source)?)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let path = PathBuf::from(entry.name());
            if !safe_path(&path) {
                return Err("Unsafe ZIP path".into());
            }
            if entry.is_dir() {
                continue;
            }
            if entry
                .unix_mode()
                .is_some_and(|m| m & 0o170_000 == 0o120_000)
            {
                return Err("Archive links are unsupported".into());
            }
            write(&path, entry.size(), &mut entry)?;
        }
    } else {
        let file = File::open(source)?;
        let reader: Box<dyn Read> = if source.extension().is_some_and(|v| v == "gz") {
            Box::new(GzDecoder::new(file))
        } else {
            Box::new(file)
        };
        for entry in tar::Archive::new(reader).entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            if !safe_path(&path) {
                return Err("Unsafe TAR path".into());
            }
            let kind = entry.header().entry_type();
            if kind.is_dir() {
                continue;
            }
            // Node distributions have npm symlinks; the private runtime needs only node.
            if node_only && (kind.is_symlink() || kind.is_hard_link()) {
                continue;
            }
            if !kind.is_file() {
                return Err("Archive contains unsupported links or special files".into());
            }
            write(&path, entry.size(), &mut entry)?;
        }
    }
    Ok(())
}

pub fn find(root: &Path, name: &str) -> Result<PathBuf> {
    let direct = root.join(name);
    if direct.is_file() {
        return Ok(root.to_owned());
    }
    let mut matches = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() && entry.path().join(name).is_file() {
            matches.push(entry.path());
        }
    }
    if matches.len() != 1 {
        return Err(format!("Expected one extracted {name}").into());
    }
    Ok(matches.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn rejects_zip_traversal_and_duplicate_files() {
        for names in [["../escape", "ok"], ["same", "./same"]] {
            let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
            fs::create_dir(&root).unwrap();
            let source = root.join("test.zip");
            let mut zip = zip::ZipWriter::new(File::create(&source).unwrap());
            for name in names {
                zip.start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                zip.write_all(b"test").unwrap();
            }
            zip.finish().unwrap();
            assert!(extract(&source, &root.join("out"), false).is_err());
            assert!(!root.join("escape").exists());
            fs::remove_dir_all(root).unwrap();
        }
    }
}
