//! Local plaintext password migration. Never sends source files to a server.
#![allow(clippy::missing_errors_doc)]
use serde_json::{Value, json};
use std::io::Read;

pub const MAX_BYTES: usize = 32 * 1024 * 1024;

// 1PUX v3 uses typed value objects, unlike the legacy t/k/v section format.
// Never serialize an unknown object into a visible text field: it may contain secrets.
fn onepassword_type(item: &Value) -> Option<&'static str> {
    if item["categoryUuid"] == "006" || item["state"] == "archived" {
        return None;
    }
    if !item["overview"].is_object() || !item["details"].is_object() {
        return None;
    }
    Some(match text(item, "categoryUuid") {
        "001" => "login",
        "002" => "card",
        "003" => "note",
        "004" | "108" => "identity",
        "005" => "password",
        "100" | "103" | "104" => "license",
        "101" => "bank",
        "102" => "database",
        "105" | "107" => "membership",
        "106" => "passport",
        "109" => "wifi",
        "110" | "114" => "ssh",
        "111" => "email",
        "113" => "medical",
        "112" => "api",
        _ => "custom",
    })
}

fn imported_field(fields: &mut Vec<Value>, label: &str, kind: &str, value: &str) {
    fields.push(json!({"id":format!("migration-field-{}",fields.len()),
        "label":if label.is_empty(){"Imported field"}else{label},"type":kind,"value":value}));
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        _ => None,
    }
}

fn form_field_type(field: &Value) -> &'static str {
    match field["fieldType"]
        .as_str()
        .unwrap_or_else(|| text(field, "type"))
    {
        "P" => "password",
        "E" => "email",
        "U" => "url",
        "N" => "number",
        "A" => "note",
        "TEL" => "phone",
        _ => "text",
    }
}

fn primary_field(kind: &str, id: &str) -> Option<(&'static str, &'static str)> {
    Some(match (kind, id) {
        ("card", "ccnum") => ("card_number", "password"),
        ("card", "cardholder") => ("cardholder", "text"),
        ("card", "expiry") => ("expiry", "text"),
        ("card", "cvv") => ("cvv", "password"),
        ("card", "pin") => ("card_pin", "password"),
        ("bank", "bankName") => ("bank_name", "text"),
        ("bank", "accountNo") => ("account_number", "password"),
        ("bank", "telephonePin") => ("bank_pin", "password"),
        ("wifi", "network_name" | "ssid") => ("ssid", "text"),
        ("wifi", "wireless_security") => ("wifi_security", "text"),
        ("identity", "firstname") => ("firstname", "text"),
        ("identity", "lastname") => ("lastname", "text"),
        ("identity", "birthdate") => ("birthdate", "date"),
        ("identity", "defphone") => ("phone", "phone"),
        ("identity", "number") => ("identity_number", "password"),
        ("passport", "fullname") => ("fullname", "text"),
        ("passport", "number") | ("license", "number" | "reg_code") => ("number", "password"),
        ("passport", "country") => ("country", "text"),
        ("passport", "issue_date") => ("issued", "date"),
        ("passport", "expiry_date") => ("expiry", "date"),
        ("license", "fullname" | "name") => ("name", "text"),
        ("membership", "org_name") => ("organization", "text"),
        ("membership", "member_name") => ("member_name", "text"),
        ("membership", "membership_no" | "membership_number") => ("member_id", "password"),
        ("ssh" | "database" | "api", "hostname" | "server") => ("host", "text"),
        ("ssh" | "database", "port") => ("port", "number"),
        ("database", "database") => ("database", "text"),
        ("api", "credential") => ("credential", "password"),
        _ => return None,
    })
}

// Match the existing UI authenticator's supported configurations. Preserve the
// original setup string; parsing must never rewrite the user's export value.
pub(crate) fn supported_totp(value: &str) -> bool {
    if value.len() > 2048 {
        return false;
    }
    let mut secret = value.trim().to_owned();
    if secret.to_ascii_lowercase().starts_with("otpauth:") {
        let Ok(uri) = url::Url::parse(&secret) else {
            return false;
        };
        if uri.scheme() != "otpauth" || uri.host_str() != Some("totp") {
            return false;
        }
        let params = uri
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        let algorithm = params
            .get("algorithm")
            .map_or("SHA1", |s| s.as_ref())
            .to_ascii_uppercase();
        let digits = params.get("digits").map_or("6", |s| s.as_ref());
        let period = params
            .get("period")
            .map_or("30", |s| s.as_ref())
            .parse::<u32>();
        if !matches!(algorithm.as_str(), "SHA1" | "SHA256" | "SHA512")
            || !matches!(digits, "6" | "8")
            || !period.is_ok_and(|p| (15..=120).contains(&p))
        {
            return false;
        }
        params
            .get("secret")
            .map_or("", |s| s.as_ref())
            .clone_into(&mut secret);
    }
    let normalized: String = secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect();
    let chars = normalized.trim_end_matches('=');
    if normalized.len() - chars.len() > 6
        || (normalized.contains('=')
            && (!normalized.len().is_multiple_of(8)
                || normalized.len() != chars.len().div_ceil(8) * 8))
        || matches!(chars.len() % 8, 1 | 3 | 6)
    {
        return false;
    }
    let mut bits = 0;
    let mut buffer = 0u32;
    let mut bytes = 0;
    for c in chars.chars() {
        let Some(n) = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".find(c) else {
            return false;
        };
        buffer = (buffer << 5) | u32::try_from(n).unwrap_or(0);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes += 1;
        }
    }
    bytes >= 10 && (bits == 0 || buffer & ((1 << bits) - 1) == 0)
}

fn onepassword_value(
    fields: &mut Vec<Value>,
    label: &str,
    key: &str,
    value: &Value,
    guarded: bool,
    skipped: &mut usize,
) {
    if matches!(key, "totp" | "otp") {
        if let Some(value) = value.as_str() {
            if supported_totp(value) && !fields.iter().any(|f| f["id"] == "__127vaults_totp") {
                fields.push(json!({"id":"__127vaults_totp","label":"Authenticator secret","type":"password","value":value}));
            } else {
                imported_field(
                    fields,
                    &format!("{label} (setup retained; not activated)"),
                    "password",
                    value,
                );
                *skipped += 1;
            }
        } else {
            *skipped += 1;
        }
        return;
    }
    if matches!(key, "reference" | "file" | "document") {
        *skipped += 1;
        return;
    }
    let secret = guarded || matches!(key, "concealed" | "creditCardNumber");
    if let Some(value) = scalar(value) {
        let kind = if secret {
            "password"
        } else {
            match key {
                "url" => "url",
                "email" => "email",
                "phone" => "phone",
                "address" => "address",
                "date" => "date",
                "number" => "number",
                "string" | "menu" | "monthYear" | "creditCardType" | "gender" => "text",
                "sshKey" => "password",
                _ => {
                    *skipped += 1;
                    return;
                }
            }
        };
        imported_field(fields, label, kind, &value);
    } else if matches!(key, "address" | "email" | "sshKey") {
        if let Some(parts) = value.as_object() {
            for (name, part) in parts {
                let nested_label = format!("{label} · {name}");
                if let Some(value) = scalar(part) {
                    let private = secret || name.to_ascii_lowercase().contains("private");
                    imported_field(
                        fields,
                        &nested_label,
                        if private {
                            "password"
                        } else if key == "address" {
                            "address"
                        } else {
                            "text"
                        },
                        &value,
                    );
                } else if key == "sshKey" && part.is_object() {
                    onepassword_value(fields, &nested_label, key, part, guarded, skipped);
                } else {
                    *skipped += 1;
                }
            }
        } else {
            *skipped += 1;
        }
    } else {
        *skipped += 1;
    }
}

fn onepassword_record(item: &Value, kind: &str, skipped: &mut usize) -> Value {
    // Preserve basic credentials and notes, but handle vendor sections ourselves.
    let source = json!({"details":{"notesPlain":item["details"]["notesPlain"]}});
    let login_fields = item["details"]["loginFields"].as_array();
    let designated = |designation| {
        login_fields
            .into_iter()
            .flatten()
            .find(|f| f["designation"] == designation)
            .map_or("", |f| text(f, "value"))
    };
    let mut row = record(
        text(&item["overview"], "title"),
        text(&item["overview"], "url"),
        designated("username"),
        if kind == "password" {
            text(&item["details"], "password")
        } else {
            designated("password")
        },
        &source,
    );
    let fields = row["customFields"].as_array_mut().expect("record fields");
    fields.push(
        json!({"id":"__127vaults_item_type","label":"Item type","type":"metadata","value":kind}),
    );
    imported_field(
        fields,
        "Source category",
        "text",
        text(item, "categoryUuid"),
    );
    for field in login_fields
        .into_iter()
        .flatten()
        .filter(|f| !matches!(text(f, "designation"), "username" | "password"))
    {
        if let Some(value) = field["value"].as_str() {
            imported_field(fields, text(field, "name"), form_field_type(field), value);
        } else {
            *skipped += 1;
        }
    }
    for (index, website) in item["overview"]["urls"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(value) = website["url"].as_str() {
            // Only these explicit website fields participate in login matching.
            fields.push(json!({"id":format!("website-alias-{index}"),"label":if text(website,"label").is_empty(){"Additional website"}else{text(website,"label")},"type":"url","value":value}));
        } else {
            *skipped += 1;
        }
    }
    onepassword_sections(item, kind, fields, skipped);
    // Some non-login templates keep their primary credential in a section.
    for (target, candidates) in [
        ("username", &["username"][..]),
        ("password", &["password", "wireless_password"][..]),
    ] {
        if row[target].as_str().is_some_and(str::is_empty) {
            'sections: for section in item["details"]["sections"].as_array().into_iter().flatten() {
                for field in section["fields"].as_array().into_iter().flatten() {
                    if candidates.contains(&text(field, "id"))
                        && let Some(value) = field["value"][if target == "password" {
                            "concealed"
                        } else {
                            "string"
                        }]
                        .as_str()
                    {
                        row[target] = json!(value);
                        break 'sections;
                    }
                }
            }
        }
    }
    preserve_hidden_credentials(&mut row, kind);
    unique_imported_labels(row["customFields"].as_array_mut().expect("record fields"));
    row
}

fn unique_imported_labels(fields: &mut [Value]) {
    let mut names = std::collections::HashSet::new();
    for field in fields {
        if field["type"] == "metadata" || text(field, "id").starts_with("__127vaults_field:") {
            continue;
        }
        let base = text(field, "label").trim().to_owned();
        let mut label = base.clone();
        let mut suffix = 2;
        while !names.insert(label.to_lowercase()) {
            label = format!("{base} ({suffix})");
            suffix += 1;
        }
        field["label"] = json!(label);
    }
}

fn preserve_hidden_credentials(row: &mut Value, kind: &str) {
    let username_visible = matches!(
        kind,
        "login" | "bank" | "router" | "ssh" | "database" | "email" | "api"
    );
    let password_visible = username_visible || matches!(kind, "password" | "wifi");
    for (name, visible) in [
        ("username", username_visible),
        ("password", password_visible),
    ] {
        let value = text(row, name).to_owned();
        if !visible && !value.is_empty() {
            imported_field(
                row["customFields"].as_array_mut().expect("record fields"),
                if name == "password" {
                    "Imported password"
                } else {
                    "Imported username"
                },
                if name == "password" {
                    "password"
                } else {
                    "text"
                },
                &value,
            );
        }
    }
}

fn onepassword_sections(item: &Value, kind: &str, fields: &mut Vec<Value>, skipped: &mut usize) {
    for (section_index, section) in item["details"]["sections"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let section_id = format!("import-{section_index}");
        fields.push(json!({"id":format!("__127vaults_section:{section_id}"),"label":"Section","type":"metadata","value":format!("custom|{}",text(section,"title").replace('|'," "))}));
        for field in section["fields"].as_array().into_iter().flatten() {
            let start = fields.len();
            let label = field["title"].as_str().unwrap_or_else(|| text(field, "t"));
            if let Some(value) = field["value"].as_object() {
                for (key, value) in value {
                    onepassword_value(fields, label, key, value, field["guarded"] == true, skipped);
                }
            } else if let Some(value) = field["v"].as_str() {
                imported_field(
                    fields,
                    label,
                    if field["k"] == "concealed" {
                        "password"
                    } else {
                        "text"
                    },
                    value,
                );
            } else {
                *skipped += 1;
            }
            if fields.len() == start + 1
                && fields[start]["id"] != "__127vaults_totp"
                && let Some((id, field_type)) = primary_field(kind, text(field, "id"))
                && !fields[..start].iter().any(|f| f["id"] == id)
            {
                fields[start]["id"] = json!(id);
                // Never downgrade a vendor-concealed field to visible text.
                if fields[start]["type"] != "password" {
                    fields[start]["type"] = json!(field_type);
                }
                continue;
            }
            for field in &mut fields[start..] {
                if field["id"] == "__127vaults_totp" {
                    continue;
                }
                field["id"] = json!(format!(
                    "__127vaults_field:{section_id}:{}",
                    text(field, "id")
                ));
            }
        }
    }
}

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
    pub skipped_fields: usize,
    pub skipped_archived: usize,
}

impl ImportReport {
    #[must_use]
    pub fn summary(&self) -> Value {
        let mut types = std::collections::BTreeMap::<String, usize>::new();
        for row in &self.rows {
            let kind = row["customFields"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|f| f["id"] == "__127vaults_item_type")
                .map_or("login", |f| text(f, "value"));
            *types.entry(kind.to_owned()).or_default() += 1;
        }
        json!({"availableVaults":self.vaults,"skippedItems":self.skipped_items,
            "skippedAttachments":self.skipped_attachments,"skippedFields":self.skipped_fields,
            "skippedArchived":self.skipped_archived,"supportedItems":self.rows.len(),"importedTypes":types})
    }
}

pub fn parse(bytes: &[u8], format: &str) -> Result<Vec<Value>, String> {
    let report = parse_selected(bytes, format, None)?;
    if report.rows.is_empty() {
        return Err("No supported items match this import selection".into());
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
    let mut skipped_fields = 0;
    let mut skipped_archived = 0;
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
                        .filter(|item| onepassword_type(item).is_some())
                        .count();
                    vaults.push(json!({"id":source_id,"name":text(&vault["attrs"],"name"),"account":text(&account["attrs"],"name"),"records":supported}));
                    for item in vault["items"].as_array().ok_or("Missing 1Password items")? {
                        let Some(kind) = onepassword_type(item) else {
                            skipped_items += 1;
                            if item["state"] == "archived" {
                                skipped_archived += 1;
                            }
                            continue;
                        };
                        if selected_vaults.is_some_and(|ids| !ids.contains(&source_id)) {
                            continue;
                        }
                        out.push(onepassword_record(item, kind, &mut skipped_fields));
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
                    "text"
                        | "password"
                        | "url"
                        | "date"
                        | "email"
                        | "number"
                        | "note"
                        | "phone"
                        | "address"
                        | "metadata"
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
        skipped_fields,
        skipped_archived,
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
    fn pux(items: &Value) -> Vec<u8> {
        use std::io::Write as _;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("export.data", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(
            json!({"accounts":[{"vaults":[{"attrs":{"name":"Source"},"items":items}]}]})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn onepassword_v3_fields_types_and_exact_key_text() {
        let private = "-----BEGIN PRIVATE KEY-----\r\n  example==\r\n-----END PRIVATE KEY-----\r\n";
        let public = "ssh-ed25519 AAAA== example@example.test\n";
        let setup =
            "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60";
        let bytes = pux(
            &json!([{"categoryUuid":"001","overview":{"title":"Login","url":"https://primary.test","urls":[{"label":"Other login","url":"https://other.test/path"},{"url":"https://third.test"},{"url":"https://fourth.test"}]},"details":{"loginFields":[{"designation":"username","value":"user"},{"designation":"password","value":"password"},{"name":"Extra secret","fieldType":"P","value":"keep"}],"sections":[{"title":"Details","fields":[
                {"title":"PIN","value":{"concealed":"0001"}},
                {"title":"Phone","value":{"phone":"+01 (234) 005"}},
                {"title":"Address","value":{"address":{"street":"One\nTwo","zip":"00123"}}},
                {"title":"Email","value":{"email":{"email_address":"a@example.test","provider":"custom"}}},
                {"title":"Key","value":{"sshKey":{"privateKey":private,"metadata":{"privateKey":private,"publicKey":public}}}},
                {"title":"Authenticator","value":{"totp":setup}},
                {"title":"Future field","value":{"unknown":{"secret":"never expose"}}},
                {"title":"Related","value":{"reference":"id"}}
            ]}]}}]),
        );
        let report = parse_selected(&bytes, "1password", None).unwrap();
        assert_eq!(report.skipped_fields, 2);
        let row = &report.rows[0];
        let fields = row["customFields"].as_array().unwrap();
        let labels: Vec<_> = fields
            .iter()
            .filter(|f| f["type"] != "metadata" && !text(f, "id").starts_with("__127vaults_field:"))
            .map(|f| text(f, "label").to_lowercase())
            .collect();
        assert_eq!(
            labels.len(),
            labels
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
        );
        for (value, kind) in [
            ("0001", "password"),
            ("+01 (234) 005", "phone"),
            ("00123", "address"),
            (private, "password"),
            (public, "text"),
            (setup, "password"),
        ] {
            assert!(
                fields
                    .iter()
                    .any(|f| f["value"] == value && f["type"] == kind),
                "missing {kind}"
            );
        }
        assert!(
            fields
                .iter()
                .any(|f| f["id"] == "__127vaults_totp" && f["value"] == setup)
        );
        assert!(
            fields
                .iter()
                .any(|f| f["id"] == "website-alias-0" && f["value"] == "https://other.test/path")
        );
        assert!(!row.to_string().contains("never expose"));
        assert!(!report.summary().to_string().contains("JBSWY"));
    }

    #[test]
    fn onepassword_categories_fallback_archive_and_native_fields() {
        let categories = [
            ("001", "login"),
            ("002", "card"),
            ("003", "note"),
            ("004", "identity"),
            ("005", "password"),
            ("100", "license"),
            ("101", "bank"),
            ("102", "database"),
            ("103", "license"),
            ("104", "license"),
            ("105", "membership"),
            ("106", "passport"),
            ("107", "membership"),
            ("108", "identity"),
            ("109", "wifi"),
            ("110", "ssh"),
            ("111", "email"),
            ("112", "api"),
            ("113", "medical"),
            ("114", "ssh"),
            ("future", "custom"),
        ];
        let mut items: Vec<Value> = categories.iter().map(|(id,_)| json!({"categoryUuid":id,"overview":{"title":"Example"},"details":{"notesPlain":"Notes","password":"standalone","sections":[{"title":"Standard","fields":[{"id":"ccnum","title":"Number","value":{"creditCardNumber":"00001234"}},{"id":"number","title":"Number","value":{"string":"00123"}},{"id":"ssid","title":"Network","value":{"string":"home"}}]}]}})).collect();
        items.push(json!({"categoryUuid":"006","overview":{},"details":{}}));
        items.push(json!({"categoryUuid":"001","state":"archived","overview":{},"details":{}}));
        let report = parse_selected(&pux(&json!(items)), "1password", None).unwrap();
        assert_eq!(report.rows.len(), categories.len());
        assert_eq!(report.skipped_items, 2);
        assert_eq!(report.skipped_archived, 1);
        for (row, (_, kind)) in report.rows.iter().zip(categories) {
            assert!(
                row["customFields"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["id"] == "__127vaults_item_type" && f["value"] == kind)
            );
        }
        assert_eq!(report.rows[4]["password"], "standalone");
        for (index, id) in [(1, "card_number"), (11, "number"), (14, "ssid")] {
            assert!(
                report.rows[index]["customFields"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["id"] == id)
            );
        }
    }

    #[test]
    fn onepassword_totp_validation_and_multiple_setups_are_not_silently_lost() {
        for value in [
            "JBSWY3DPEHPK3PXP",
            "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA512&digits=8&period=120",
        ] {
            assert!(supported_totp(value));
        }
        for value in [
            "bad!",
            "AAA",
            "otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP",
            "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=1",
            "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
        ] {
            assert!(!supported_totp(value));
        }
        let item = json!({"categoryUuid":"001","overview":{},"details":{"sections":[{"fields":[{"title":"First","value":{"totp":"JBSWY3DPEHPK3PXP"}},{"title":"Second","value":{"totp":"JBSWY3DPEHPK3PXP"}},{"title":"Unsupported","value":{"totp":"otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP"}}]}]}});
        let report = parse_selected(&pux(&json!([item])), "1password", None).unwrap();
        assert_eq!(report.skipped_fields, 2);
        let fields = report.rows[0]["customFields"].as_array().unwrap();
        assert_eq!(
            fields
                .iter()
                .filter(|f| f["id"] == "__127vaults_totp")
                .count(),
            1
        );
        assert_eq!(fields.iter().filter(|f| f["type"] == "password").count(), 3);
    }
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
