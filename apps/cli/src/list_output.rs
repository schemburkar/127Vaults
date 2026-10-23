//! Human-readable views of the existing list responses. Never render item bodies.
use std::io::IsTerminal as _;

use clap::{Args, ValueEnum};
use serde_json::Value;
use unicode_width::UnicodeWidthStr as _;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum ListFormat {
    #[default]
    Json,
    Table,
}

#[derive(Debug, Args)]
pub struct ListOutputArgs {
    /// Output format. JSON remains the default, including when redirected.
    #[arg(long, value_enum, default_value = "json")]
    pub format: ListFormat,
    /// Table width in columns. Defaults to COLUMNS or detected terminal width; 100 when redirected.
    #[arg(long, value_parser = clap::value_parser!(u16).range(24..=240), requires = "format")]
    pub width: Option<u16>,
}

impl ListOutputArgs {
    fn columns(&self) -> usize {
        let terminal_width = || {
            std::env::var("COLUMNS")
                .ok()
                .and_then(|s| s.parse::<u16>().ok())
                .filter(|width| (24..=240).contains(width))
                .or_else(|| {
                    terminal_size::terminal_size()
                        .map(|(terminal_size::Width(width), _)| width.clamp(24, 240))
                })
        };
        usize::from(
            self.width
                .or_else(|| {
                    std::io::stdout()
                        .is_terminal()
                        .then(terminal_width)
                        .flatten()
                })
                .unwrap_or(100),
        )
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.width.is_some() && self.format != ListFormat::Table {
            return Err("--width requires --format table".into());
        }
        Ok(())
    }
}

fn text<'a>(row: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    row[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
}

pub(crate) fn vaults(value: &Value, output: &ListOutputArgs) -> Result<String, String> {
    output.validate()?;
    if output.format == ListFormat::Json {
        return serde_json::to_string_pretty(value)
            .map_err(|_| "could not encode vault list".into());
    }
    let rows = value.as_array().ok_or("invalid vault list")?;
    if rows.is_empty() {
        return Ok("No vaults found.".into());
    }
    let rows = rows
        .iter()
        .map(|row| {
            vec![
                text(row, "name", "Private").to_owned(),
                text(row, "code", "-").to_owned(),
                if row["retired"] == true {
                    "Archived"
                } else {
                    "Active"
                }
                .into(),
            ]
        })
        .collect::<Vec<_>>();
    Ok(table(
        &["Name", "Code", "Status"],
        &rows,
        1,
        output.columns(),
    ))
}

pub(crate) fn items(
    value: &Value,
    output: &ListOutputArgs,
    all: bool,
    search: Option<&str>,
    favorites: bool,
    item_type: Option<&str>,
) -> Result<String, String> {
    output.validate()?;
    // Preserve the exact legacy JSON response when no filters were requested.
    if output.format == ListFormat::Json && search.is_none() && !favorites && item_type.is_none() {
        return serde_json::to_string_pretty(value)
            .map_err(|_| "could not encode item list".into());
    }
    let query = search.map(str::to_lowercase);
    let rows = value
        .as_array()
        .ok_or("invalid item list")?
        .iter()
        .filter(|row| {
            (!favorites || row["favorite"] == true)
                && item_type.is_none_or(|kind| text(row, "itemType", "login") == kind)
                && query.as_ref().is_none_or(|query| {
                    ["title", "website"]
                        .iter()
                        .any(|key| text(row, key, "").to_lowercase().contains(query))
                })
        })
        .collect::<Vec<_>>();
    if output.format == ListFormat::Json {
        return serde_json::to_string_pretty(&rows)
            .map_err(|_| "could not encode item list".into());
    }
    if rows.is_empty() {
        return Ok("No items found.".into());
    }
    let rows = rows
        .iter()
        .map(|row| {
            let mut cells = vec![
                text(row, "title", "Untitled").to_owned(),
                text(row, "website", "-").to_owned(),
                text(row, "code", "-").to_owned(),
                text(row, "itemType", "login").to_owned(),
            ];
            if all {
                cells.push(row["vaultId"].as_str().map_or_else(
                    || "-".into(),
                    |id| crate::client::Session::reference("V", id),
                ));
            }
            cells
        })
        .collect::<Vec<_>>();
    let headers = if all {
        &["Title", "Site", "Code", "Type", "Vault"][..]
    } else {
        &["Title", "Site", "Code", "Type"][..]
    };
    Ok(table(headers, &rows, 2, output.columns()))
}

// Vault names, titles and sites are untrusted text. Suppress terminal commands,
// line injection and bidirectional overrides before measuring or displaying them.
fn safe_text(value: &str) -> String {
    value.chars().map(|c| match c {
        '\n' | '\r' | '\t' | '\u{2028}' | '\u{2029}' => ' ',
        c if c.is_control() || matches!(c, '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}') => '?',
        c => c,
    }).collect()
}

fn fit(value: &str, width: usize) -> String {
    if value.width() <= width {
        return value.to_owned();
    }
    let mut clipped = String::new();
    for c in value.chars() {
        clipped.push(c);
        if clipped.width() > width.saturating_sub(1) {
            clipped.pop();
            break;
        }
    }
    clipped.push('…');
    clipped
}

fn table(headers: &[&str], rows: &[Vec<String>], code: usize, width: usize) -> String {
    let rows = rows
        .iter()
        .map(|row| row.iter().map(|s| safe_text(s)).collect::<Vec<_>>())
        .collect::<Vec<_>>();
    let mut widths = headers
        .iter()
        .enumerate()
        .map(|(i, header)| {
            rows.iter()
                .map(|row| row[i].width())
                .max()
                .unwrap_or(0)
                .max(header.width())
                .min(width)
        })
        .collect::<Vec<_>>();
    // Keep selection codes whole. At narrow widths, a labeled record layout is
    // clearer than squeezing five columns into unreadable fragments.
    let minimum = headers
        .iter()
        .enumerate()
        .map(|(i, h)| {
            if i == code || *h == "Vault" {
                widths[i]
            } else {
                h.width().max(8)
            }
        })
        .collect::<Vec<_>>();
    if minimum.iter().sum::<usize>() + 2 * (headers.len() - 1) > width {
        return rows
            .iter()
            .map(|row| {
                let mut lines = vec![row[code].clone()];
                for (i, header) in headers.iter().enumerate() {
                    if i != code {
                        let prefix = format!("  {header}: ");
                        lines.push(format!(
                            "{prefix}{}",
                            fit(&row[i], width.saturating_sub(prefix.width()))
                        ));
                    }
                }
                lines.join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
    }
    while widths.iter().sum::<usize>() + 2 * (headers.len() - 1) > width {
        let Some(i) = (0..widths.len())
            .filter(|&i| widths[i] > minimum[i])
            .max_by_key(|&i| widths[i])
        else {
            break;
        };
        widths[i] -= 1;
    }
    let line = |cells: &[String]| {
        cells
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                let cell = fit(cell, widths[i]);
                if i + 1 == cells.len() {
                    cell.clone()
                } else {
                    format!(
                        "{cell}{}",
                        " ".repeat(widths[i].saturating_sub(cell.width()))
                    )
                }
            })
            .collect::<Vec<_>>()
            .join("  ")
    };
    let mut lines = vec![line(
        &headers.iter().map(|h| (*h).to_owned()).collect::<Vec<_>>(),
    )];
    lines.push(
        widths
            .iter()
            .map(|&width| "-".repeat(width))
            .collect::<Vec<_>>()
            .join("  "),
    );
    lines.extend(rows.iter().map(|row| line(row)));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Cli, run};
    use clap::Parser;
    use serde_json::json;

    fn options(width: u16) -> ListOutputArgs {
        ListOutputArgs {
            format: ListFormat::Table,
            width: Some(width),
        }
    }

    fn sample() -> Value {
        json!([
            {"title":"Atlas Mail", "website":"https://atlas.example", "code":"I-187AADBE55", "itemType":"login", "favorite":true, "vaultId":"3f55b208-1d78-4fd1-849c-7622f230c19c"},
            {"title":"Travel Wi-Fi", "website":"", "code":"I-008310DDDE", "itemType":"wifi", "favorite":false, "vaultId":"7bc57a18-f9ba-4dab-8e22-0cc390c5c125"},
            {"title":"Legacy", "website":"https://notes.example", "code":"I-AAAAAAAAAA"}
        ])
    }

    #[test]
    fn readable_preview_has_stable_columns_and_narrow_selection_codes() {
        let vault_data = json!([
            {"name":"Personal", "code":"V-91E900D1C9", "retired":false},
            {"name":"Work", "code":"V-95840506C7", "retired":false}
        ]);
        let rendered = vaults(&vault_data, &options(80)).unwrap();
        assert_eq!(
            rendered,
            "Name      Code          Status\n--------  ------------  ------\nPersonal  V-91E900D1C9  Active\nWork      V-95840506C7  Active"
        );
        let item_data = json!([
            {"title":"Atlas Mail", "website":"atlas.example", "code":"I-187AADBE55", "itemType":"login"},
            {"title":"Northstar Notes", "website":"notes.example", "code":"I-008310DDDE", "itemType":"note"}
        ]);
        let rendered_items = items(&item_data, &options(80), false, None, false, None).unwrap();
        let narrow = items(&item_data, &options(24), false, Some("atlas"), false, None).unwrap();
        assert_eq!(
            narrow,
            "I-187AADBE55\n  Title: Atlas Mail\n  Site: atlas.example\n  Type: login"
        );
        println!(
            "CLI_PREVIEW_BEGIN\n$ 127vaults vault list --format table\n{rendered}\n\n$ 127vaults item list --vault Personal --format table\n{rendered_items}\n\n$ 127vaults item list --search atlas --format table --width 24\n{narrow}\nCLI_PREVIEW_END"
        );
    }

    #[test]
    fn default_and_explicit_json_keep_exact_legacy_shape_and_order() {
        let value = sample();
        let options = ListOutputArgs {
            format: ListFormat::Json,
            width: None,
        };
        assert_eq!(
            items(&value, &options, true, None, false, None).unwrap(),
            serde_json::to_string_pretty(&value).unwrap()
        );
        assert_eq!(
            vaults(&value, &options).unwrap(),
            serde_json::to_string_pretty(&value).unwrap()
        );
        assert_eq!(
            items(&json!([]), &options, false, None, false, None).unwrap(),
            "[]"
        );
    }

    #[test]
    fn filters_compose_and_use_only_index_metadata() {
        let options = ListOutputArgs {
            format: ListFormat::Json,
            width: None,
        };
        let value = sample();
        let filtered = items(
            &value,
            &options,
            true,
            Some("ATLAS.EXAMPLE"),
            true,
            Some("login"),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&filtered).unwrap(),
            json!([value[0]])
        );
        let legacy = items(
            &value,
            &options,
            false,
            Some("legacy"),
            false,
            Some("login"),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&legacy).unwrap(),
            json!([value[2]])
        );
        assert_eq!(
            items(&value, &options, false, Some("Atlas"), true, Some("wifi")).unwrap(),
            "[]"
        );
        let injected = json!([{"title":"Visible", "password":"DO-NOT-DISPLAY", "username":"hidden-user", "customFields":[{"value":"HIDDEN-CUSTOM"}]}]);
        let table = items(
            &injected,
            &super::tests::options(100),
            false,
            None,
            false,
            None,
        )
        .unwrap();
        assert!(!table.contains("DO-NOT-DISPLAY"));
        assert!(!table.contains("hidden-user"));
        assert!(!table.contains("HIDDEN-CUSTOM"));
        assert_eq!(
            items(
                &injected,
                &options,
                false,
                Some("DO-NOT-DISPLAY"),
                false,
                None
            )
            .unwrap(),
            "[]"
        );
    }

    #[test]
    fn every_supported_width_preserves_item_and_vault_codes() {
        let value = sample();
        for width in 24..=240 {
            let table = items(&value, &options(width), true, None, false, None).unwrap();
            for code in [
                "I-187AADBE55",
                "I-008310DDDE",
                "I-AAAAAAAAAA",
                "V-91E900D1C9",
                "V-95840506C7",
            ] {
                assert!(
                    table.contains(code),
                    "missing {code} at width {width}: {table}"
                );
            }
            assert!(
                table.lines().all(|line| line.width() <= usize::from(width)),
                "too wide at {width}: {table}"
            );
        }
    }

    #[test]
    fn wide_and_combining_unicode_remains_valid_and_fits() {
        let value = json!([{"title":"日本語のパスワード🔑 e\u{301} 👩‍💻".repeat(10), "website":"https://例え.example", "code":"I-0123456789", "itemType":"login"}]);
        for width in 24..=100 {
            let result = items(&value, &options(width), false, None, false, None).unwrap();
            assert!(result.contains("I-0123456789"));
            assert!(
                result
                    .lines()
                    .all(|line| line.width() <= usize::from(width)),
                "{width}: {result}"
            );
            assert!(result.contains('…'));
        }
    }

    #[test]
    fn table_blocks_terminal_escape_line_and_bidi_injection() {
        let value = json!([{"name":"One\nTwo\r\t\u{1b}[31mRED\u{7}\u{9b}hidden\u{202e}reversed\u{2066}isolated\u{2028}next", "code":"V-0123456789", "retired":true}]);
        let result = vaults(&value, &options(240)).unwrap();
        assert_eq!(result.lines().count(), 3);
        assert!(!result.chars().any(|c| c.is_control() && c != '\n'));
        assert!(!result.contains('\u{202e}'));
        assert!(!result.contains('\u{2066}'));
        assert!(!result.contains('\u{2028}'));
        assert!(result.contains("Archived"));
        assert!(result.contains("V-0123456789"));
    }

    #[test]
    fn empty_results_and_archived_vaults_are_clear() {
        assert_eq!(
            vaults(&json!([]), &options(24)).unwrap(),
            "No vaults found."
        );
        assert_eq!(
            items(
                &sample(),
                &options(24),
                false,
                Some("no match"),
                false,
                None
            )
            .unwrap(),
            "No items found."
        );
        let result = vaults(&json!([{"name":"Archive", "code":"V-0123456789", "retired":true}, {"name":"Private", "code":"V-9876543210", "retired":false}]), &options(24)).unwrap();
        assert!(result.contains("Status: Archived"));
        assert!(result.contains("Status: Active"));
    }

    #[test]
    fn format_and_filter_flags_parse_and_invalid_width_fails_before_agent_access() {
        for command in [vec!["vault", "list"], vec!["item", "list", "--all"]] {
            let mut args = vec!["127vaults"];
            args.extend(command);
            args.extend(["--format", "table", "--width", "24"]);
            assert!(Cli::try_parse_from(args).is_ok());
        }
        assert!(
            Cli::try_parse_from([
                "127vaults",
                "item",
                "list",
                "--search",
                "mail",
                "--favorites",
                "--type",
                "login",
                "--format",
                "json"
            ])
            .is_ok()
        );
        for args in [
            vec!["127vaults", "item", "list", "--format", "yaml"],
            vec![
                "127vaults",
                "vault",
                "list",
                "--format",
                "table",
                "--width",
                "23",
            ],
            vec![
                "127vaults",
                "item",
                "list",
                "--format",
                "table",
                "--width",
                "241",
            ],
            vec!["127vaults", "item", "list", "--type", "invalid"],
            vec!["127vaults", "item", "list", "--width", "40"],
        ] {
            assert!(Cli::try_parse_from(args).is_err());
        }
        let cli = Cli::try_parse_from([
            "127vaults",
            "item",
            "list",
            "--format",
            "json",
            "--width",
            "40",
        ])
        .unwrap();
        assert_eq!(run(cli).unwrap_err(), "--width requires --format table");
    }
}
