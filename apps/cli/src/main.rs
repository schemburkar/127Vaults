use clap::Parser;
use vaults_cli::{Cli, run};

fn main() {
    let _lease = match vaults_cli::namespace::Namespace::current().and_then(|n| {
        if std::env::args().nth(1).as_deref() == Some("namespace-credentials") {
            Ok(None)
        } else {
            n.process_lease()
        }
    }) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("127vaults: {error}");
            std::process::exit(2);
        }
    };
    match run(Cli::parse()) {
        Ok(output) => {
            let output = zeroize::Zeroizing::new(output);
            println!("{}", output.as_str());
        }
        Err(error) => {
            eprintln!("127vaults: {error}");
            std::process::exit(2);
        }
    }
}
