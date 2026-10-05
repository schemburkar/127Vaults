fn main() {
    if let Err(error) = vaults_cli::extension_host::run() {
        eprintln!("127vaults extension host: {error}");
        std::process::exit(2);
    }
}
