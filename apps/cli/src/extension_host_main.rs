fn main() {
    if std::env::args().nth(1).as_deref() == Some("--namespace") {
        match vaults_cli::namespace::Namespace::current() {
            Ok(n) => println!(
                "{}",
                serde_json::json!({"namespace":n.id(),"nativeHost":n.native_host()})
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(2);
            }
        }
        return;
    }
    let _lease = match vaults_cli::namespace::Namespace::current().and_then(|n| n.process_lease()) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if let Err(error) = vaults_cli::extension_host::run() {
        eprintln!("127vaults extension host: {error}");
        std::process::exit(2);
    }
}
