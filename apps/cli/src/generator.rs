use clap::Subcommand;
use vaults_crypto::generator::{Mode, Options, generate};

#[derive(Debug, Subcommand)]
pub enum GenerateCommand {
    /// Generate a password; every enabled character set is required.
    Password {
        #[arg(long, default_value_t = 20)]
        length: usize,
        #[arg(long)]
        no_lowercase: bool,
        #[arg(long)]
        no_uppercase: bool,
        #[arg(long)]
        no_numbers: bool,
        #[arg(long)]
        no_symbols: bool,
        #[arg(long)]
        exclude_ambiguous: bool,
    },
    /// Generate independently sampled EFF words. Default: six words with spaces.
    Passphrase {
        #[arg(long, default_value_t = 6)]
        words: usize,
        /// Between words; use " " for spaces or "" for no separator.
        #[arg(long, default_value = " ", allow_hyphen_values = true)]
        separator: String,
        #[arg(long)]
        capitalize: bool,
        /// Append one random digit.
        #[arg(long)]
        number: bool,
    },
    /// Generate numeric digits, including possible leading zeroes.
    Pin {
        #[arg(long, default_value_t = 6)]
        length: usize,
    },
}

pub fn generate_command(command: GenerateCommand) -> Result<String, String> {
    let options = match command {
        GenerateCommand::Password {
            length,
            no_lowercase,
            no_uppercase,
            no_numbers,
            no_symbols,
            exclude_ambiguous,
        } => Options {
            length,
            lowercase: !no_lowercase,
            uppercase: !no_uppercase,
            numbers: !no_numbers,
            symbols: !no_symbols,
            exclude_ambiguous,
            ..Options::default()
        },
        GenerateCommand::Passphrase {
            words,
            separator,
            capitalize,
            number,
        } => Options {
            mode: Mode::Passphrase,
            words,
            separator,
            capitalize,
            append_number: number,
            ..Options::default()
        },
        GenerateCommand::Pin { length } => Options {
            mode: Mode::Pin,
            length,
            ..Options::default()
        },
    };
    generate(&options)
}

/// Shared desktop command boundary; validates options before using the crypto core.
/// # Errors
/// Rejects malformed options, invalid settings or unavailable entropy.
pub fn generate_secret(options: serde_json::Value) -> Result<String, String> {
    let options =
        serde_json::from_value(options).map_err(|_| "Invalid generator options".to_owned())?;
    generate(&options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Cli, run};
    use clap::Parser;

    #[test]
    fn standalone_commands_need_no_profile() {
        for args in [
            vec!["127vaults", "generate", "password", "--length", "24"],
            vec![
                "127vaults",
                "generate",
                "passphrase",
                "--words",
                "6",
                "--separator",
                "-",
                "--number",
            ],
            vec!["127vaults", "generate", "pin", "--length", "8"],
        ] {
            assert!(!run(Cli::try_parse_from(args).unwrap()).unwrap().is_empty());
        }
        assert!(generate_secret(serde_json::json!({"mode":"pin","length":-1})).is_err());
        assert!(generate_secret(serde_json::json!({"mode":"unknown"})).is_err());
        assert!(generate_secret(serde_json::json!({"length":20,"typo":true})).is_err());
    }
}
