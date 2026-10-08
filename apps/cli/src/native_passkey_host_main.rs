fn main() {
    if let Err(error) = vaults_cli::native_passkeys::run_host() {
        eprintln!("127Vaults native passkeys: {error}");
        std::process::exit(2);
    }
}
