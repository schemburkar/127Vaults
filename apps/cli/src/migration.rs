//! Local plaintext password migration. Never sends source files to a server.
#![allow(clippy::missing_errors_doc)]
use serde_json::{Value, json};
use std::io::Read;

pub const MAX_BYTES: usize = 32 * 1024 * 1024;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn record(title: &str, website: &str, username: &str, password: &str, source: &Value) -> Value {
    let notes = [
        text(&source["details"], "notesPlain"),
        text(source, "notes"),
        text(source, "extra"),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or("");
    let mut fields = if notes.is_empty() {
        vec![]
    } else {
        vec![json!({"id":"migration-notes","label":"Notes","type":"note","value":notes})]
    };
    // Map vendor text fields individually instead of exposing the source JSON.
    for field in source["fields"].as_array().into_iter().flatten() {
        if let Some(value) = field["value"].as_str() {
            fields.push(json!({"id":format!("migration-field-{}",fields.len()),"label":text(field,"name"),"type":if field["type"] == 1 {"password"} else {"text"},"value":value}));
        }
    }
    for section in source["details"]["sections"]
        .as_array()
        .into_iter()
        .flatten()
    {
        for field in section["fields"].as_array().into_iter().flatten() {
            if let Some(value) = field["v"].as_str() {
                fields.push(json!({"id":format!("migration-field-{}",fields.len()),"label":text(field,"t"),"type":if field["k"] == "concealed" {"password"} else {"text"},"value":value}));
            }
        }
    }
    json!({"title":title,"website":website,"username":username,"password":password,"customFields":fields})
}

pub const SOURCE_VAULTS: &str = "__source_vaults__";

fn set_source(row: &mut Value, id: &str, name: &str) {
    row["sourceVault"] =
        json!({"id":id,"name":if name.trim().is_empty(){"Imported"}else{name.trim()}});
}

pub struct SourceVaultPlan {
    pub name: String,
    pub item_indices: Vec<usize>,
}

/// Plans separate destination vaults without mutating an installation.
pub fn source_plan(
    rows: &[Value],
    existing_names: &[String],
    existing_count: usize,
) -> Result<Vec<SourceVaultPlan>, String> {
    let mut plans: Vec<SourceVaultPlan> = Vec::new();
    let mut positions = std::collections::HashMap::new();
    let mut names: std::collections::HashSet<String> = existing_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    for (index, row) in rows.iter().enumerate() {
        let id = text(&row["sourceVault"], "id");
        let position = if let Some(position) = positions.get(id) {
            *position
        } else {
            let base = text(&row["sourceVault"], "name");
            let base = if base.trim().is_empty() {
                "Imported"
            } else {
                base
            };
            let mut name: String = base.chars().take(80).collect();
            let mut suffix = 2;
            while names.contains(&name.to_lowercase()) {
                name = format!(
                    "{} (imported {suffix})",
                    base.chars().take(60).collect::<String>()
                );
                suffix += 1;
            }
            names.insert(name.to_lowercase());
            let position = plans.len();
            positions.insert(id, position);
            plans.push(SourceVaultPlan {
                name,
                item_indices: Vec::new(),
            });
            position
        };
        plans[position].item_indices.push(index);
    }
    if existing_count + plans.len() > vaults_crypto::private_vault::MAX_PRIVATE_VAULTS {
        return Err("Source vaults exceed the ten-vault limit. Choose one existing destination instead; no vaults or items were imported.".into());
    }
    if plans
        .iter()
        .any(|plan| plan.item_indices.len() > vaults_crypto::private_vault::MAX_VAULT_ITEMS)
    {
        return Err(
            "A source vault contains more than 100 items. No vaults or items were imported.".into(),
        );
    }
    Ok(plans)
}

pub struct ImportReport {
    pub rows: Vec<Value>,
    pub vaults: Vec<Value>,
    pub skipped_items: usize,
    pub skipped_attachments: usize,
}

impl ImportReport {
    #[must_use]
    pub fn summary(&self) -> Value {
        json!({"availableVaults":self.vaults,"skippedItems":self.skipped_items,
            "skippedAttachments":self.skipped_attachments,"supportedItems":self.rows.len()})
    }
}

pub fn parse(bytes: &[u8], format: &str) -> Result<Vec<Value>, String> {
    let report = parse_selected(bytes, format, None)?;
    if report.rows.is_empty() {
        return Err("No supported login records match this import selection".into());
    }
    Ok(report.rows)
}

#[allow(clippy::too_many_lines)]
pub fn parse_selected(
    bytes: &[u8],
    format: &str,
    selected_vaults: Option<&[String]>,
) -> Result<ImportReport, String> {
    if bytes.len() > MAX_BYTES {
        return Err("Import exceeds 32 MiB".into());
    }
    let mut out = Vec::new();
    let mut skipped_items = 0;
    let mut skipped_attachments = 0;
    let mut vaults = Vec::new();
    match format {
        "lastpass" => {
            let rows = csv(std::str::from_utf8(bytes).map_err(|_| "CSV must be UTF-8")?)?;
            let header = rows.first().ok_or("CSV is empty")?;
            if header
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != header.len()
            {
                return Err("CSV has duplicate column names".into());
            }
            for required in [
                "url", "username", "password", "name", "extra", "grouping", "fav",
            ] {
                if !header.iter().any(|v| v == required) {
                    return Err("Expected a LastPass CSV export".into());
                }
            }
            for row in rows
                .iter()
                .skip(1)
                .filter(|row| row.iter().any(|v| !v.is_empty()))
            {
                if row.len() != header.len() {
                    return Err("CSV row has the wrong number of columns".into());
                }
                let source: Value = header
                    .iter()
                    .zip(row)
                    .map(|(k, v)| (k.clone(), json!(v)))
                    .collect();
                out.push(record(
                    text(&source, "name"),
                    text(&source, "url"),
                    text(&source, "username"),
                    text(&source, "password"),
                    &source,
                ));
                let group = text(&source, "grouping");
                set_source(
                    out.last_mut().ok_or("Missing imported record")?,
                    group,
                    group,
                );
            }
        }
        "bitwarden" => {
            let data: Value =
                serde_json::from_slice(bytes).map_err(|_| "Invalid Bitwarden JSON")?;
            if data["encrypted"] != false {
                return Err("Choose an unencrypted Bitwarden JSON export".into());
            }
            for item in data["items"].as_array().ok_or("Missing Bitwarden items")? {
                if item["type"] != 1
                    || item["login"]["fido2Credentials"]
                        .as_array()
                        .is_some_and(|a| !a.is_empty())
                    || item["attachments"]
                        .as_array()
                        .is_some_and(|a| !a.is_empty())
                {
                    return Err("This importer supports login records without passkeys or attachments. No records were imported.".into());
                }
                out.push(record(
                    text(item, "name"),
                    item["login"]["uris"][0]["uri"].as_str().unwrap_or(""),
                    text(&item["login"], "username"),
                    text(&item["login"], "password"),
                    item,
                ));
                let folder_id = text(item, "folderId");
                let folder_name = data["folders"]
                    .as_array()
                    .and_then(|folders| folders.iter().find(|folder| folder["id"] == folder_id))
                    .map_or("Unfiled", |folder| text(folder, "name"));
                set_source(
                    out.last_mut().ok_or("Missing imported record")?,
                    folder_id,
                    folder_name,
                );
            }
        }
        "1password" => {
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
                .map_err(|_| "Choose a 1Password .1pux export")?;
            // Attachment payloads are never opened or extracted.
            skipped_attachments = archive
                .file_names()
                .filter(|name| name.starts_with("files/") && !name.ends_with('/'))
                .count();
            let file = archive
                .by_name("export.data")
                .map_err(|_| "Missing 1Password export.data")?;
            let mut plain = zeroize::Zeroizing::new(Vec::new());
            file.take((MAX_BYTES + 1) as u64)
                .read_to_end(&mut plain)
                .map_err(|_| "Cannot read 1Password export")?;
            if plain.len() > MAX_BYTES {
                return Err("Expanded import exceeds 32 MiB".into());
            }
            let data: Value =
                serde_json::from_slice(&plain).map_err(|_| "Invalid 1Password export")?;
            for (account_index, account) in data["accounts"]
                .as_array()
                .ok_or("Missing 1Password accounts")?
                .iter()
                .enumerate()
            {
                for (vault_index, vault) in account["vaults"]
                    .as_array()
                    .ok_or("Missing 1Password vaults")?
                    .iter()
                    .enumerate()
                {
                    let source_id = format!(
                        "{}:{account_index}/{}:{vault_index}",
                        text(&account["attrs"], "uuid"),
                        text(&vault["attrs"], "uuid")
                    );
                    let items = vault["items"].as_array().ok_or("Missing 1Password items")?;
                    let supported = items
                        .iter()
                        .filter(|item| {
                            item["categoryUuid"] == "001"
                                && item["details"]["loginFields"].is_array()
                        })
                        .count();
                    vaults.push(json!({"id":source_id,"name":text(&vault["attrs"],"name"),"account":text(&account["attrs"],"name"),"records":supported}));
                    for item in vault["items"].as_array().ok_or("Missing 1Password items")? {
                        if item["categoryUuid"] != "001"
                            || !item["details"]["loginFields"].is_array()
                        {
                            skipped_items += 1;
                            continue;
                        }
                        if selected_vaults.is_some_and(|ids| !ids.contains(&source_id)) {
                            continue;
                        }
                        let fields = item["details"]["loginFields"]
                            .as_array()
                            .ok_or("Missing login fields")?;
                        let field = |kind| {
                            fields
                                .iter()
                                .find(|f| f["designation"] == kind)
                                .map_or("", |f| text(f, "value"))
                        };
                        out.push(record(
                            text(&item["overview"], "title"),
                            text(&item["overview"], "url"),
                            field("username"),
                            field("password"),
                            item,
                        ));
                        let source_id = format!(
                            "{}:{account_index}/{}:{vault_index}",
                            text(&account["attrs"], "uuid"),
                            text(&vault["attrs"], "uuid")
                        );
                        set_source(
                            out.last_mut().ok_or("Missing imported record")?,
                            &source_id,
                            text(&vault["attrs"], "name"),
                        );
                    }
                }
            }
        }
        "127vaults" => {
            let data: Value =
                serde_json::from_slice(bytes).map_err(|_| "Invalid 127Vaults JSON")?;
            if data["format"] != "127vaults-plaintext-v1" {
                return Err("Unsupported export version".into());
            }
            for (vault_index, vault) in data["vaults"]
                .as_array()
                .ok_or("Missing vaults")?
                .iter()
                .enumerate()
            {
                let items = vault["items"].as_array().ok_or("Missing items")?;
                let mut seen = std::collections::HashSet::new();
                for item in items
                    .iter()
                    .chain(vault["pendingDrafts"].as_array().into_iter().flatten())
                {
                    let identity = json!([item["itemId"], item["index"], item["body"]]).to_string();
                    if !seen.insert(identity) {
                        continue;
                    }
                    let mut row = item["body"].clone();
                    if !row.is_object() {
                        return Err("Invalid exported item body".into());
                    }
                    row["title"] = item["index"]["title"].clone();
                    row["website"] = item["index"]["website"].clone();
                    if !items.iter().any(|current| {
                        current["itemId"] == item["itemId"]
                            && current["index"] == item["index"]
                            && current["body"] == item["body"]
                    }) {
                        row["title"] = json!(format!("{} (recovered draft)", text(&row, "title")));
                    }
                    let source_id = format!("{}:{vault_index}", text(&vault["vault"], "vaultId"));
                    set_source(&mut row, &source_id, text(&vault["vault"], "name"));
                    out.push(row);
                }
            }
        }
        _ => return Err("Format must be 1password, lastpass, bitwarden, or 127vaults".into()),
    }
    if (out.is_empty() && format != "1password") || out.len() > 10000 {
        return Err("Import must contain 1–10000 records".into());
    }
    for row in &out {
        if ["title", "website", "username", "password"]
            .iter()
            .any(|key| !row[key].is_string())
            || !row["customFields"].is_array()
            || row.to_string().len() > 48000
        {
            return Err(
                "An imported record is invalid or too large; no records were imported".into(),
            );
        }
        let fields = row["customFields"]
            .as_array()
            .ok_or("Invalid custom fields")?;
        let mut ids = std::collections::HashSet::new();
        for field in fields {
            if ["id", "label", "type", "value"]
                .iter()
                .any(|key| !field[key].is_string())
                || !ids.insert(text(field, "id"))
                || !matches!(
                    text(field, "type"),
                    "text" | "password" | "url" | "date" | "email" | "number" | "note" | "metadata"
                )
            {
                return Err("Invalid imported custom field; no records were imported".into());
            }
        }
    }
    Ok(ImportReport {
        rows: out,
        vaults,
        skipped_items,
        skipped_attachments,
    })
}

// RFC 4180 quoting, escaped quotes and embedded newlines; reject malformed input.
fn csv(input: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = input.trim_start_matches('\u{feff}').chars().peekable();
    let mut quoted = false;
    let mut closed = false;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' if field.is_empty() && !closed => quoted = true,
                ',' => {
                    row.push(std::mem::take(&mut field));
                    closed = false;
                }
                '\n' | '\r' => {
                    if c == '\r' && chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    closed = false;
                }
                _ if closed || c == '"' => return Err("Malformed quoted CSV".into()),
                _ => field.push(c),
            }
        }
    }
    if quoted {
        return Err("Unterminated CSV field".into());
    }
    if !row.is_empty() || !field.is_empty() || closed {
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vendor_records_have_readable_notes_and_fields_without_raw_json() {
        let source = json!({"notes":"Readable notes","fields":[{"name":"PIN","value":"1234","type":1}],
            "details":{"sections":[{"fields":[{"t":"Text","k":"string","v":"value"}]}]},"vendorInternal":"not imported"});
        let row = record("A", "https://example.invalid", "user", "password", &source);
        assert_eq!(row["customFields"][0]["value"], "Readable notes");
        assert_eq!(row["customFields"][0]["type"], "note");
        assert_eq!(row["customFields"][1]["label"], "PIN");
        assert_eq!(row["customFields"][1]["type"], "password");
        assert_eq!(row["customFields"][2]["value"], "value");
        assert!(!row.to_string().contains("migration-source"));
        assert!(!row.to_string().contains("vendorInternal"));
        assert!(
            record("A", "", "", "", &json!({}))["customFields"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn source_vaults_preserve_grouping_and_do_not_merge_existing_names() {
        let data = br#"{"encrypted":false,"folders":[{"id":"a","name":"Personal"},{"id":"b","name":"Personal"}],"items":[{"type":1,"name":"One","folderId":"a","login":{}},{"type":1,"name":"Two","folderId":"b","login":{}},{"type":1,"name":"Three","folderId":"a","login":{}}]}"#;
        let rows = parse(data, "bitwarden").unwrap();
        let plans = source_plan(&rows, &["Personal".into()], 1).unwrap();
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].name, "Personal (imported 2)");
        assert_eq!(plans[1].name, "Personal (imported 3)");
        assert_eq!(plans[0].item_indices, vec![0, 2]);
        assert_eq!(plans[1].item_indices, vec![1]);
        assert!(source_plan(&rows, &[], 9).is_err());
        let oversized = vec![rows[0].clone(); 101];
        assert!(source_plan(&oversized, &[], 0).is_err());
    }

    #[test]
    fn lastpass_folders_become_source_groups_including_unfiled_items() {
        let rows = parse(
            b"url,username,password,extra,name,grouping,fav\na,u,p,,A,Work,0\nb,u,p,,B,,0\n",
            "lastpass",
        )
        .unwrap();
        let plans = source_plan(&rows, &[], 0).unwrap();
        assert_eq!(plans[0].name, "Work");
        assert_eq!(plans[1].name, "Imported");
    }
    #[test]
    fn csv_preserves_secrets_and_multiline_notes() {
        let rows = parse(b"url,username,password,extra,name,grouping,fav\r\nhttps://a,u,\"p,\"\"q\",\"line1\nline2\",A,g,0\r\n", "lastpass").unwrap();
        assert_eq!(rows[0]["password"], "p,\"q");
        assert!(
            rows[0]["customFields"][0]["value"]
                .as_str()
                .unwrap()
                .contains("line1\nline2")
        );
        assert!(csv("a,\"unterminated").is_err());
    }
    #[test]
    fn refuses_encrypted_and_unsupported_records_before_import() {
        assert!(parse(br#"{"encrypted":true,"items":[]}"#, "bitwarden").is_err());
        assert!(parse(br#"{"encrypted":false,"items":[{"type":2}]}"#, "bitwarden").is_err());
        let data = br#"{"encrypted":false,"items":[{"type":1,"name":"A","login":{"username":"u","password":"p","uris":[]}}]}"#;
        assert_eq!(parse(data, "bitwarden").unwrap()[0]["password"], "p");
    }

    #[test]
    fn onepassword_selection_precedes_capacity_checks_and_reports_mixed_content() {
        use std::io::Write as _;
        let login = json!({"categoryUuid":"001","overview":{"title":"Login"},"details":{"loginFields":[{"designation":"password","value":"secret"}]}});
        let data = json!({"accounts":[{"attrs":{"uuid":"account","name":"Account"},"vaults":[
            {"attrs":{"uuid":"large","name":"Large"},"items":vec![login.clone();101]},
            {"attrs":{"uuid":"small","name":"Small"},"items":[login,{"categoryUuid":"002"},{"categoryUuid":"001","details":{}}]}
        ]}]});
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer
            .start_file("export.data", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data.to_string().as_bytes()).unwrap();
        writer
            .start_file(
                "files/ignored.bin",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        writer.write_all(b"never imported").unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let all = parse_selected(&bytes, "1password", None).unwrap();
        assert_eq!(all.rows.len(), 102);
        assert!(source_plan(&all.rows, &[], 0).is_err());
        assert_eq!(all.vaults.len(), 2);
        assert_eq!(all.vaults[1]["records"], 1);
        assert_eq!(all.skipped_items, 2);
        assert_eq!(all.skipped_attachments, 1);
        assert!(!all.summary().to_string().contains("secret"));
        let selected =
            parse_selected(&bytes, "1password", Some(&["account:0/small:1".into()])).unwrap();
        assert_eq!(selected.rows.len(), 1);
        assert_eq!(
            source_plan(&selected.rows, &[], 0).unwrap()[0].name,
            "Small"
        );
        assert!(parse_selected(b"not a zip", "1password", None).is_err());
    }

    #[test]
    fn onepassword_zip_preserves_login_and_skips_attachments() {
        use std::io::Write as _;
        let make = |attachment: bool| {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            writer
                .start_file("export.data", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(br#"{"accounts":[{"attrs":{"uuid":"account"},"vaults":[{"attrs":{"uuid":"vault-one","name":"Test Vault"},"items":[{"categoryUuid":"001","overview":{"title":"Example","url":"https://example.invalid"},"details":{"notesPlain":"preserve notes","loginFields":[{"designation":"username","value":"user"},{"designation":"password","value":"secret"}]}}]}]}]}"#).unwrap();
            if attachment {
                writer
                    .start_file(
                        "files/attachment.txt",
                        zip::write::SimpleFileOptions::default(),
                    )
                    .unwrap();
                writer.write_all(b"attachment").unwrap();
            }
            writer.finish().unwrap().into_inner()
        };
        let rows = parse(&make(false), "1password").unwrap();
        assert_eq!(rows[0]["password"], "secret");
        let plans = source_plan(&rows, &[], 0).unwrap();
        assert_eq!(plans[0].name, "Test Vault");
        assert_eq!(plans[0].item_indices, vec![0]);
        assert!(
            rows[0]["customFields"][0]["value"]
                .as_str()
                .unwrap()
                .contains("preserve notes")
        );
        let report = parse_selected(&make(true), "1password", None).unwrap();
        assert_eq!(report.rows.len(), 1);
        assert_eq!(report.skipped_attachments, 1);
        let selection = vec!["account:0/vault-one:0".to_string()];
        assert_eq!(
            parse_selected(&make(true), "1password", Some(&selection))
                .unwrap()
                .rows
                .len(),
            1
        );
        assert!(
            parse_selected(&make(true), "1password", Some(&[]))
                .unwrap()
                .rows
                .is_empty()
        );
    }
}
