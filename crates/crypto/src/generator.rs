//! Local secret generation. Every choice uses rejection-sampled cryptographic entropy.
use serde::Deserialize;
use std::sync::OnceLock;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Password,
    Passphrase,
    Pin,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(clippy::struct_excessive_bools)] // Independent user-selectable generator switches.
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    pub mode: Mode,
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub numbers: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
    pub words: usize,
    pub separator: String,
    pub capitalize: bool,
    pub append_number: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            mode: Mode::Password,
            length: 20,
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: true,
            exclude_ambiguous: false,
            words: 6,
            separator: " ".into(),
            capitalize: false,
            append_number: false,
        }
    }
}

fn wordlist() -> &'static [&'static str] {
    static WORDS: OnceLock<Vec<&'static str>> = OnceLock::new();
    WORDS.get_or_init(|| {
        include_str!("eff_large_wordlist.txt")
            .lines()
            .filter_map(|line| line.split_whitespace().nth(1))
            .collect()
    })
}

fn uniform(
    limit: usize,
    entropy: &mut impl FnMut() -> Result<u32, String>,
) -> Result<usize, String> {
    let bound = u32::try_from(limit).map_err(|_| "Invalid random bound".to_owned())?;
    if bound == 0 {
        return Err("Invalid random bound".into());
    }
    // The accepted range contains an exact multiple of bound equally likely values.
    let threshold = bound.wrapping_neg() % bound;
    loop {
        let value = entropy()?;
        if value >= threshold {
            return Ok((value % bound) as usize);
        }
    }
}

/// Generates a secret without storing it or contacting a server.
/// # Errors
/// Rejects invalid settings or unavailable operating-system/browser entropy.
pub fn generate(options: &Options) -> Result<String, String> {
    generate_with(options, &mut || {
        let mut bytes = [0; 4];
        getrandom::fill(&mut bytes).map_err(|_| "Secure randomness is unavailable".to_owned())?;
        Ok(u32::from_le_bytes(bytes))
    })
}

fn generate_with(
    options: &Options,
    entropy: &mut impl FnMut() -> Result<u32, String>,
) -> Result<String, String> {
    match options.mode {
        Mode::Password => {
            let mut groups = Vec::new();
            for (enabled, alphabet) in [
                (options.lowercase, "abcdefghijklmnopqrstuvwxyz"),
                (options.uppercase, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
                (options.numbers, "0123456789"),
                (options.symbols, "!@#$%^&*()-_=+[]{};:,.?/~"),
            ] {
                if enabled {
                    groups.push(
                        alphabet
                            .bytes()
                            .filter(|byte| !options.exclude_ambiguous || !b"Il1O0o".contains(byte))
                            .collect::<Vec<_>>(),
                    );
                }
            }
            if groups.is_empty()
                || !(4..=128).contains(&options.length)
                || options.length < groups.len()
            {
                return Err("Choose at least one character set and a length from 4 to 128".into());
            }
            let alphabet: Vec<_> = groups.iter().flatten().copied().collect();
            // Reject whole candidates to preserve uniformity while requiring each selected class.
            loop {
                let mut value = Zeroizing::new(Vec::with_capacity(options.length));
                for _ in 0..options.length {
                    value.push(alphabet[uniform(alphabet.len(), entropy)?]);
                }
                if groups
                    .iter()
                    .all(|group| value.iter().any(|byte| group.contains(byte)))
                {
                    return String::from_utf8(value.to_vec())
                        .map_err(|_| "Generation failed".into());
                }
            }
        }
        Mode::Passphrase => {
            if !(3..=20).contains(&options.words)
                || options.separator.chars().count() > 8
                || options.separator.chars().any(char::is_control)
            {
                return Err(
                    "Choose 3 to 20 words and a separator of at most 8 printable characters".into(),
                );
            }
            let words = wordlist();
            let mut result = Zeroizing::new(String::new());
            for index in 0..options.words {
                if index > 0 {
                    result.push_str(&options.separator);
                }
                let word = words[uniform(words.len(), entropy)?];
                if options.capitalize {
                    result.push(char::from(word.as_bytes()[0]).to_ascii_uppercase());
                    result.push_str(&word[1..]);
                } else {
                    result.push_str(word);
                }
            }
            if options.append_number {
                result.push(char::from(b"0123456789"[uniform(10, entropy)?]));
            }
            Ok(result.to_string())
        }
        Mode::Pin => {
            if !(4..=32).contains(&options.length) {
                return Err("Choose a PIN length from 4 to 32".into());
            }
            let mut result = Zeroizing::new(String::new());
            for _ in 0..options.length {
                result.push(char::from(b"0123456789"[uniform(10, entropy)?]));
            }
            Ok(result.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejection_sampling_and_entropy_failure() {
        let mut draws = [0, 5, 6, 19].into_iter(); // threshold for ten is six.
        assert_eq!(uniform(10, &mut || Ok(draws.next().unwrap())).unwrap(), 6);
        assert_eq!(uniform(10, &mut || Ok(draws.next().unwrap())).unwrap(), 9);
        assert!(generate_with(&Options::default(), &mut || Err("entropy failed".into())).is_err());
    }

    #[test]
    fn passwords_require_every_selected_class() {
        for _ in 0..64 {
            let value = generate(&Options {
                exclude_ambiguous: true,
                ..Options::default()
            })
            .unwrap();
            assert_eq!(value.len(), 20);
            assert!(value.bytes().any(|b| b.is_ascii_lowercase() || b == b'-'));
            assert!(value.bytes().any(|b| b.is_ascii_uppercase()));
            assert!(value.bytes().any(|b| b.is_ascii_digit()));
            assert!(value.bytes().any(|b| b.is_ascii_punctuation()));
            assert!(!value.bytes().any(|b| b"Il1O0o".contains(&b)));
        }
        let options = Options {
            lowercase: false,
            uppercase: false,
            symbols: false,
            ..Options::default()
        };
        assert!(
            generate(&options)
                .unwrap()
                .bytes()
                .all(|b| b.is_ascii_digit())
        );
        assert!(
            generate(&Options {
                numbers: false,
                ..options
            })
            .is_err()
        );
    }

    #[test]
    fn password_rejects_candidates_missing_a_selected_class() {
        let options = Options {
            length: 4,
            ..Options::default()
        };
        let size = 26 + 26 + 10 + "!@#$%^&*()-_=+[]{};:,.?/~".len();
        let mut draws = [0, 0, 0, 0, 0, 26, 52, 62].into_iter();
        let value = generate_with(&options, &mut || {
            Ok(u32::try_from(size * 1000 + draws.next().unwrap()).unwrap())
        })
        .unwrap();
        assert_eq!(value, "aA0!");
        assert!(draws.next().is_none());
    }

    #[test]
    fn phrases_use_complete_unique_dictionary_and_options() {
        let words = wordlist();
        assert_eq!(words.len(), 7776);
        assert_eq!(
            words.iter().collect::<std::collections::HashSet<_>>().len(),
            7776
        );
        assert!(
            words
                .iter()
                .all(|w| w.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'))
        );
        let value = generate(&Options {
            mode: Mode::Passphrase,
            separator: " ".into(),
            capitalize: true,
            append_number: true,
            ..Options::default()
        })
        .unwrap();
        assert!(value.as_bytes().last().unwrap().is_ascii_digit());
        let value = &value[..value.len() - 1];
        assert_eq!(value.split(' ').count(), 6);
        for word in value.split(' ') {
            assert!(word.as_bytes()[0].is_ascii_uppercase());
            assert!(words.contains(&word.to_ascii_lowercase().as_str()));
        }
        assert!(
            generate(&Options {
                mode: Mode::Passphrase,
                separator: "\n".into(),
                ..Options::default()
            })
            .is_err()
        );
    }

    #[test]
    fn pins_preserve_leading_zeroes_and_validate_bounds() {
        let options = Options {
            mode: Mode::Pin,
            length: 6,
            ..Options::default()
        };
        assert_eq!(generate_with(&options, &mut || Ok(10)).unwrap(), "000000");
        for length in [0, 3, 33, usize::MAX] {
            assert!(
                generate(&Options {
                    length,
                    ..options.clone()
                })
                .is_err()
            );
        }
        for mode in [Mode::Password, Mode::Passphrase] {
            assert!(
                generate(&Options {
                    mode,
                    length: 0,
                    words: 0,
                    ..Options::default()
                })
                .is_err()
            );
        }
    }
}
