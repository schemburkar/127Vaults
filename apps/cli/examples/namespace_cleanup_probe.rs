// Synthetic OS-store acceptance helper. Refuses every non-cleanup namespace.
fn main() {
    let namespace =
        vaults_cli::namespace::Namespace::current().expect("Select cleanup test namespace");
    assert!(namespace.id().starts_with("test-cleanup-"));
    let entry = keyring::Entry::new(
        &namespace.service("127Vaults device identity"),
        "synthetic:synthetic",
    )
    .unwrap();
    match std::env::args().nth(1).as_deref() {
        Some("seed") => entry.set_password("synthetic-not-a-secret").unwrap(),
        Some("absent") => assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry))),
        Some("remove") => {
            let _ = entry.delete_credential();
        }
        _ => panic!("Use seed|absent|remove"),
    }
}
