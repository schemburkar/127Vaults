use std::{ffi::OsString, path::PathBuf};

fn resolve_profile(
    explicit: Option<OsString>,
    fallback: Option<PathBuf>,
) -> Result<PathBuf, String> {
    if let Some(value) = explicit {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("VAULTS_CONFIG_DIR must be an absolute desktop profile path".to_owned());
        }
        return Ok(path);
    }
    fallback
        .map(|root| root.join("127Vaults"))
        .ok_or_else(|| "desktop configuration location is unavailable".to_owned())
}

/// Returns the same desktop profile for the app and its native connector.
///
/// # Errors
/// Rejects relative explicit paths, which depend on the launching process's cwd.
pub fn desktop_profile_directory() -> Result<PathBuf, String> {
    resolve_profile(std::env::var_os("VAULTS_CONFIG_DIR"), dirs::config_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_profile_does_not_fall_back_to_another_user_profile() {
        let explicit = std::env::temp_dir().join("127vaults-fixture-profile");
        assert_eq!(
            resolve_profile(Some(explicit.clone().into_os_string()), None).unwrap(),
            explicit
        );
        assert!(
            resolve_profile(Some("relative-profile".into()), Some(std::env::temp_dir())).is_err()
        );
        assert!(resolve_profile(Some(OsString::new()), Some(std::env::temp_dir())).is_err());
    }

    #[test]
    fn default_profile_remains_in_the_os_configuration_directory() {
        let root = std::env::temp_dir();
        assert_eq!(
            resolve_profile(None, Some(root.clone())).unwrap(),
            root.join("127Vaults")
        );
        assert!(resolve_profile(None, None).is_err());
    }
}
