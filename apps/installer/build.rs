fn main() {
    println!("cargo:rerun-if-env-changed=VAULTS_PACKAGE_VERSION");
    let version = std::env::var("VAULTS_PACKAGE_VERSION")
        .unwrap_or_else(|_| std::env::var("CARGO_PKG_VERSION").expect("Cargo package version"));
    let parts: Vec<_> = version.split('.').collect();
    assert!(
        parts.len() == 3
            && parts.iter().all(|part| !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part.parse::<u32>().is_ok()),
        "Installer package version must be numeric X.Y.Z"
    );
    println!("cargo:rustc-env=VAULTS_INSTALLER_VERSION={version}");
}
