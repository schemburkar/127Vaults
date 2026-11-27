//! Installation namespace shared by clients and the installer.
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Namespace(String);
pub struct ProcessLease(PathBuf);
impl Drop for ProcessLease {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn contract(key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(include_str!("namespace-contract.json"))
        .expect("embedded namespace contract must be valid")[key]
        .as_str()
        .expect("namespace contract field missing")
        .into()
}

impl Namespace {
    /// Record isolated running processes so cleanup never removes their data.
    /// # Errors
    /// Rejects unowned storage or an active cleanup operation.
    pub fn process_lease(&self) -> Result<Option<ProcessLease>, String> {
        if self.production() {
            return Ok(None);
        }
        self.prepare_profile(&self.root()?.join("cli"))?;
        let lock = self.root()?.join("cleanup.lock");
        if lock.exists() {
            return Err("Namespace cleanup is running".into());
        }
        let directory = self.root()?.join("processes");
        self.validate_profile(&directory)?;
        fs::create_dir_all(&directory).map_err(|_| "Cannot record namespace process")?;
        let file = directory.join(format!("{}.json", std::process::id()));
        self.validate_profile(&file)?;
        fs::write(
            &file,
            serde_json::to_vec(
                &serde_json::json!({"namespace":self.id(),"pid":std::process::id()}),
            )
            .map_err(|_| "Invalid process record")?,
        )
        .map_err(|_| "Cannot record namespace process")?;
        let lease = ProcessLease(file);
        if lock.exists() {
            return Err("Namespace cleanup is running".into());
        }
        Ok(Some(lease))
    }
    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn parse(name: &str, instance: Option<&str>) -> Result<Self, String> {
        match (name, instance) {
            ("production" | "development", None) => Ok(Self(name.into())),
            ("test", Some(id)) if !id.is_empty() && id.len() <= 40
                && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && !id.starts_with('-') && !id.ends_with('-') => Ok(Self(format!("test-{id}"))),
            _ => Err("Select production, development, or test with a lowercase VAULTS_TEST_INSTANCE (1-40 letters/digits/hyphens)".into()),
        }
    }

    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn current() -> Result<Self, String> {
        let compiled = option_env!("VAULTS_BUILD_NAMESPACE");
        let runtime = std::env::var("VAULTS_NAMESPACE").ok();
        let runtime_instance = std::env::var("VAULTS_TEST_INSTANCE").ok();
        Self::resolve(
            compiled,
            option_env!("VAULTS_BUILD_TEST_INSTANCE"),
            runtime.as_deref(),
            runtime_instance.as_deref(),
            cfg!(debug_assertions) && !cfg!(test),
        )
    }

    fn resolve(
        compiled: Option<&str>,
        compiled_instance: Option<&str>,
        runtime: Option<&str>,
        runtime_instance: Option<&str>,
        debug: bool,
    ) -> Result<Self, String> {
        if let (Some(a), Some(b)) = (compiled, runtime)
            && a != b
        {
            return Err("Build and runtime namespaces conflict".into());
        }
        if let (Some(a), Some(b)) = (compiled_instance, runtime_instance)
            && a != b
        {
            return Err("Build and runtime test instances conflict".into());
        }
        let name = runtime
            .or(compiled)
            .or(if cfg!(test) { Some("production") } else { None })
            .ok_or("Development builds require VAULTS_NAMESPACE=development or test")?;
        if debug && name == "production" {
            return Err("Debug builds cannot use the production namespace".into());
        }
        Self::parse(name, runtime_instance.or(compiled_instance))
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.0
    }
    #[must_use]
    pub fn production(&self) -> bool {
        self.0 == "production"
    }
    #[must_use]
    pub fn native_host(&self) -> String {
        if self.production() {
            contract("nativeHost")
        } else {
            format!("{}.{}", contract("nativeHost"), self.0.replace('-', "_"))
        }
    }
    #[must_use]
    pub fn name(&self) -> String {
        if self.production() {
            "127Vaults".into()
        } else if self.0 == "development" {
            contract("developmentName")
        } else {
            format!("127Vaults Test {}", &self.0[5..])
        }
    }
    #[must_use]
    pub fn service(&self, base: &str) -> String {
        if self.production() {
            base.into()
        } else {
            format!("{base} ({})", self.0)
        }
    }
    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn root(&self) -> Result<PathBuf, String> {
        let root = dirs::config_dir().ok_or("OS configuration directory unavailable")?;
        Ok(root.join(if self.production() {
            contract("productionRoot")
        } else {
            format!("{}/{}", contract("isolatedRoot"), self.0)
        }))
    }
    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn cli_directory(&self) -> Result<PathBuf, String> {
        if self.production() {
            Ok(PathBuf::from(".127vaults"))
        } else {
            Ok(self.root()?.join("cli"))
        }
    }
    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn active_pointer(&self) -> Result<PathBuf, String> {
        if self.production() {
            Ok(PathBuf::from(".127vaults-active"))
        } else {
            Ok(self.root()?.join("active-profile"))
        }
    }

    /// Reject redirected paths and cross-namespace profiles before reading secrets.
    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn validate_profile(&self, path: &Path) -> Result<(), String> {
        let absolute = if path.is_absolute() {
            path.to_owned()
        } else {
            std::env::current_dir()
                .map_err(|_| "Working directory unavailable")?
                .join(path)
        };
        if absolute
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            return Err("Profile path must not contain parent traversal".into());
        }
        for ancestor in absolute.ancestors() {
            match fs::symlink_metadata(ancestor) {
                Ok(meta) => {
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if meta.file_attributes() & 0x400 != 0 {
                            return Err("Profile path contains a reparse point".into());
                        }
                    }
                    if meta.file_type().is_symlink() {
                        return Err("Profile path contains a symbolic link".into());
                    }
                    if meta.is_dir() {
                        match fs::read_to_string(ancestor.join("namespace-owner")) {
                            Ok(owner) if owner.trim() != self.id() => {
                                return Err("Profile belongs to a different namespace".into());
                            }
                            Ok(_) => {}
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                            Err(_) => return Err("Namespace ownership cannot be inspected".into()),
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("Profile path cannot be inspected".into()),
            }
        }
        if !self.production() && !absolute.starts_with(self.root()?) {
            return Err(
                "Development/test profiles must be inside their namespace root; migrate explicitly"
                    .into(),
            );
        }
        // Production must also reject an empty path inside another namespace.
        if self.production() {
            let base = dirs::config_dir()
                .ok_or("OS configuration directory unavailable")?
                .join(contract("isolatedRoot"));
            if absolute.starts_with(base) {
                return Err("Production cannot open development/test storage".into());
            }
        }
        Ok(())
    }

    /// Only deliberately classified production profiles may be imported automatically.
    #[must_use]
    pub fn can_import_profile(&self, path: &Path) -> bool {
        self.production()
            && self.validate_profile(path).is_ok()
            && fs::read_to_string(path.join("namespace-owner"))
                .is_ok_and(|owner| owner.trim() == self.id())
    }

    /// # Errors
    /// Rejects invalid namespace configuration, incompatible paths or unavailable storage.
    pub fn prepare_profile(&self, path: &Path) -> Result<(), String> {
        self.validate_profile(path)?;
        if !self.production() {
            if self.root()?.join("cleanup.lock").exists() {
                return Err("Namespace cleanup is running".into());
            }
            let root = self.root()?;
            if root.exists()
                && !root.join("namespace-owner").exists()
                && fs::read_dir(&root)
                    .map_err(|_| "Cannot inspect existing namespace storage")?
                    .next()
                    .is_some()
            {
                return Err("Existing namespace storage has no ownership marker; review and migrate it explicitly".into());
            }
            fs::create_dir_all(self.root()?).map_err(|_| "Cannot create namespace root")?;
            let marker = self.root()?.join("namespace-owner");
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(marker)
            {
                Ok(mut file) => file
                    .write_all(self.id().as_bytes())
                    .map_err(|_| "Cannot record namespace ownership")?,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err("Cannot record namespace ownership".into()),
            }
            self.validate_profile(path)?;
        }
        Ok(())
    }
}

/// # Errors
/// Rejects an unavailable or conflicting namespace.
pub fn service(base: &str) -> Result<String, String> {
    Ok(Namespace::current()?.service(base))
}
/// # Errors
/// Rejects incompatible or redirected profile paths.
pub fn validate_profile(path: &Path) -> Result<(), String> {
    Namespace::current()?.validate_profile(path)
}
#[must_use]
pub fn default_cli_directory() -> PathBuf {
    Namespace::current()
        .and_then(|n| n.cli_directory())
        .unwrap_or_else(|_| PathBuf::from("__namespace_configuration_required__"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packaged_test_instances_survive_browser_launch_and_reject_conflicts() {
        assert_eq!(
            Namespace::resolve(Some("test"), Some("one"), None, None, false)
                .unwrap()
                .id(),
            "test-one"
        );
        assert!(
            Namespace::resolve(Some("test"), Some("one"), Some("test"), Some("two"), false)
                .is_err()
        );
        assert!(
            Namespace::resolve(Some("production"), None, Some("development"), None, false).is_err()
        );
        assert!(Namespace::resolve(None, None, Some("production"), None, true).is_err());
        assert!(Namespace::resolve(Some("development"), Some("one"), None, None, false).is_err());
    }
    #[test]
    fn profile_import_requires_explicit_production_classification() {
        let directory = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "vaults-import-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&directory).unwrap();
        let production = Namespace::parse("production", None).unwrap();
        assert!(!production.can_import_profile(&directory));
        fs::write(directory.join("namespace-owner"), "development").unwrap();
        assert!(!production.can_import_profile(&directory));
        fs::write(directory.join("namespace-owner"), "production").unwrap();
        assert!(production.can_import_profile(&directory));
        assert!(
            !Namespace::parse("development", None)
                .unwrap()
                .can_import_profile(&directory)
        );
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn strict_selection_and_distinct_resources() {
        for (name, id) in [
            ("dev", None),
            ("test", None),
            ("test", Some("../prod")),
            ("test", Some("A")),
            ("production", Some("one")),
        ] {
            assert!(Namespace::parse(name, id).is_err());
        }
        let prod = Namespace::parse("production", None).unwrap();
        let dev = Namespace::parse("development", None).unwrap();
        let a = Namespace::parse("test", Some("one")).unwrap();
        let b = Namespace::parse("test", Some("two")).unwrap();
        assert_eq!(prod.service("secret"), "secret");
        assert_ne!(prod.service("secret"), dev.service("secret"));
        assert_ne!(a.root().unwrap(), b.root().unwrap());
        assert!(dev.validate_profile(&prod.root().unwrap()).is_err());
        assert!(prod.validate_profile(&dev.root().unwrap()).is_err());
        assert!(a.validate_profile(&b.root().unwrap()).is_err());
        assert!(
            a.validate_profile(&a.root().unwrap().join("../two"))
                .is_err()
        );
    }
}
