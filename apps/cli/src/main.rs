use clap::Parser;
use vaults_cli::{Cli, run};

fn main() {
    match run(Cli::parse()) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("127vaults: {error}");
            std::process::exit(2);
        }
    }
}
