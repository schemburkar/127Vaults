use clap::Parser;
use vaults_cli::{Cli, run};

fn main() {
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
