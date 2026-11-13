//! Remove only OS credentials owned by an explicitly selected isolated profile.
use crate::{file_profile_value, namespace::Namespace};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path};

fn targets(profile: &Path) -> Result<Vec<(String, String)>, String> {
    let namespace = Namespace::current()?;
    if namespace.production() {
        return Err("Production credentials cannot be reset".into());
    }
    namespace.validate_profile(profile)?;
    for name in ["trust.conf", "device.conf", "account-secret-cache.json"] {
        namespace.validate_profile(&profile.join(name))?;
    }
    if !profile.join("device.conf").exists() {
        return Ok(vec![]);
    }
    let server = file_profile_value(&profile.join("trust.conf"), "server_id")?;
    let device = file_profile_value(&profile.join("device.conf"), "device_id")?;
    let user = file_profile_value(&profile.join("device.conf"), "username")?;
    let identity = format!("{server}:{device}");
    let canonical = fs::canonicalize(profile).map_err(|_| "Profile is unavailable")?;
    let profile_id = hex::encode(Sha256::digest(canonical.as_os_str().as_encoded_bytes()));
    let binding = serde_json::to_vec(&serde_json::json!([
        canonical,
        file_profile_value(&profile.join("trust.conf"), "url")?,
        server,
        device,
        user
    ]))
    .map_err(|_| "Invalid profile binding")?;
    let mut entries = BTreeSet::from([
        ("127Vaults device identity".to_owned(), identity.clone()),
        ("127Vaults CLI unlock lease".to_owned(), identity.clone()),
        (
            "127Vaults CLI unlock lease".to_owned(),
            format!("{identity}:profile-v2:{profile_id}"),
        ),
        (
            "127Vaults CLI remembered account secret".to_owned(),
            hex::encode(Sha256::digest(binding)),
        ),
        (
            "127Vaults account secret".to_owned(),
            format!("{identity}:{user}"),
        ),
    ]);
    if let Ok(bytes) = fs::read(profile.join("account-secret-cache.json")) {
        let cache: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid remembered account metadata")?;
        if let Some(user) = cache["username"].as_str() {
            entries.insert((
                "127Vaults account secret".to_owned(),
                format!("{identity}:{user}"),
            ));
        }
    }
    Ok(entries
        .into_iter()
        .map(|(service, account)| (namespace.service(&service), account))
        .collect())
}

pub fn run(profile: &Path, confirm: bool) -> Result<String, String> {
    let namespace = Namespace::current()?;
    let entries = targets(profile)?;
    if confirm {
        if !namespace.root()?.join("cleanup.lock").is_dir() {
            return Err(
                "Use scripts/namespace.mjs cleanup --confirm after stopping the namespace".into(),
            );
        }
        for (service, account) in &entries {
            let entry = keyring::Entry::new(service, account)
                .map_err(|_| "OS credential storage unavailable")?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {
                    return Err(
                        "OS credential removal could not be confirmed; profile retained".into(),
                    );
                }
            }
        }
    }
    Ok(serde_json::json!({"namespace":namespace.id(),"credentialTargets":entries.len(),"removed":confirm}).to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn production_credential_cleanup_is_refused() {
        assert!(super::targets(std::path::Path::new(".127vaults")).is_err());
    }
}
