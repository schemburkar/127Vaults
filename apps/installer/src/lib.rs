// Catalogue filenames have canonical, case-sensitive extensions.
#![allow(clippy::case_sensitive_file_extension_comparisons)]
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};
use url::Url;

pub const PACKAGE_VERSION: &str = env!("VAULTS_INSTALLER_VERSION");

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Invitation credentials stay in memory and never enter URLs sent over HTTP.
pub struct Invitation {
    pub origin: String,
    pub id: String,
    pub token: String,
    pub client_only: bool,
}

impl Invitation {
    /// # Errors
    /// Rejects malformed invitations, non-HTTPS URLs and embedded credentials.
    pub fn parse(input: &str) -> Result<Self> {
        let url = Url::parse(input).map_err(|_| "Invalid setup link")?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some_and(|q| q != "open=1")
            || !["/trial", "/trial.html", "/join", "/join.html"].contains(&url.path())
        {
            return Err(
                "Use the HTTPS setup link from Manage or your approved trial invitation".into(),
            );
        }
        let (id, token) = url
            .fragment()
            .and_then(|v| v.split_once('.'))
            .ok_or("Invalid setup link")?;
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || token.len() != 43
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Invalid setup link".into());
        }
        Ok(Self {
            origin: url.origin().ascii_serialization(),
            id: id.into(),
            token: token.into(),
            client_only: ["/join", "/join.html"].contains(&url.path()),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Product {
    Server,
    Desktop,
    Extension,
    Cli,
    Pwa,
}

impl Product {
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Server => "server",
            Self::Desktop => "desktop",
            Self::Extension => "extension",
            Self::Cli => "cli",
            Self::Pwa => "pwa",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub filename: String,
    pub sha256: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub supporting: bool,
}

impl Artifact {
    /// # Errors
    /// Rejects unsafe filenames, invalid digests, identifiers and unbounded sizes.
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty()
            || self.id.len() > 60
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || self.filename.is_empty()
            || self.filename.len() > 151
            || !self
                .filename
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            || !self
                .filename
                .starts_with(|c: char| c.is_ascii_alphanumeric())
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || self.size_bytes == 0
            || self.size_bytes > 32 * 1024 * 1024 * 1024
        {
            return Err("Invalid artifact metadata".into());
        }
        Ok(())
    }
}

/// Prefer native desktop packages; never accidentally pick supporting manifests.
/// # Errors
/// Rejects unsupported platforms, ambiguous/missing packages and invalid metadata.
pub fn select_artifact(
    assets: &[Artifact],
    product: Product,
    os: &str,
    arch: &str,
) -> Result<Artifact> {
    let platform = match os {
        "windows" => "windows",
        "linux" => "linux",
        "macos" => "macos",
        _ => return Err("Unsupported operating system".into()),
    };
    let mut candidates: Vec<_> = assets
        .iter()
        .filter(|a| {
            if a.supporting {
                return false;
            }
            if product == Product::Server {
                return a.id == "server" && arch == "x86_64" && ["windows", "linux"].contains(&os);
            }
            if a.product != product.name() {
                return false;
            }
            if product == Product::Extension {
                return a.filename.ends_with(".zip");
            }
            let arch_name = match arch {
                "x86_64" => "x64",
                "aarch64" => "arm64",
                _ => return false,
            };
            let platform_match = a.platform.starts_with(platform)
                || (os == "windows" && a.platform.starts_with("win32"))
                || (os == "macos" && a.platform.starts_with("darwin"));
            let architecture_match = a.platform.contains(arch_name)
                || a.filename.contains(arch_name)
                || (arch == "x86_64"
                    && !a.platform.contains("arm64")
                    && !a.filename.contains("arm64")
                    && ["windows", "linux"].contains(&a.platform.as_str()));
            platform_match
                && architecture_match
                && match product {
                    Product::Desktop => a.filename.ends_with(if os == "windows" {
                        ".exe"
                    } else if os == "macos" {
                        ".dmg"
                    } else {
                        ".AppImage"
                    }),
                    Product::Cli => a.filename.ends_with(".zip") || a.filename.ends_with(".tar.gz"),
                    _ => false,
                }
        })
        .collect();
    if candidates.len() != 1 {
        return Err(format!(
            "Expected one eligible {} package for {os}/{arch}, found {}",
            product.name(),
            candidates.len()
        )
        .into());
    }
    let asset = candidates.remove(0);
    asset.validate()?;
    Ok(asset.clone())
}

/// Portable path validation, including Windows paths when tests run on Unix.
#[must_use]
pub fn safe_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.to_string_lossy().contains(['\\', ':'])
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && path.to_string_lossy().split('/').all(|v| {
            let stem = v.split('.').next().unwrap_or_default().to_ascii_uppercase();
            v != ".."
                && (v == "." || !v.ends_with(['.', ' ']))
                && ![
                    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
                    "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
                    "LPT8", "LPT9",
                ]
                .contains(&stem.as_str())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invitation_never_accepts_credentials_or_plain_http() {
        let suffix = format!("{}.{:0<43}", "a".repeat(64), "token");
        let value =
            Invitation::parse(&format!("https://vaults.example/trial.html#{suffix}")).unwrap();
        assert_eq!(value.origin, "https://vaults.example");
        assert_eq!(value.id, "a".repeat(64));
        assert!(
            Invitation::parse(&format!(
                "https://vaults.example/trial.html?open=1#{suffix}"
            ))
            .is_ok()
        );
        for prefix in [
            "http://vaults.example/trial.html",
            "https://user@vaults.example/trial.html",
            "https://vaults.example/other",
            "https://vaults.example/trial.html?token=secret",
        ] {
            assert!(Invitation::parse(&format!("{prefix}#{suffix}")).is_err());
        }
    }
    #[test]
    fn archives_cannot_escape_on_either_platform() {
        for name in [
            "../secret",
            "/root",
            "C:/secret",
            "a/../../b",
            "a\\..\\b",
            "x:stream",
        ] {
            assert!(!safe_path(Path::new(name)), "{name}");
        }
        assert!(safe_path(Path::new("bundle/lib/install.mjs")));
    }
    #[test]
    fn selects_only_one_compatible_package() {
        let asset = Artifact {
            id: "desktop-windows-x64-0".into(),
            filename: "desktop.exe".into(),
            product: "desktop".into(),
            platform: "windows-x64".into(),
            sha256: "a".repeat(64),
            size_bytes: 1,
            supporting: false,
        };
        assert!(
            select_artifact(
                std::slice::from_ref(&asset),
                Product::Desktop,
                "windows",
                "x86_64"
            )
            .is_ok()
        );
        assert!(
            select_artifact(
                std::slice::from_ref(&asset),
                Product::Desktop,
                "linux",
                "x86_64"
            )
            .is_err()
        );
        assert!(
            select_artifact(
                &[asset.clone(), asset],
                Product::Desktop,
                "windows",
                "x86_64"
            )
            .is_err()
        );
    }
}
