//! Explicit, online-only trust management. Approval binds the reviewed request
//! to the new device's ID and signing-key fingerprint before any signature.
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Debug, Subcommand)]
pub enum DeviceCommand {
    /// Request enrollment from an already trusted web, desktop, or CLI device.
    Enroll {
        #[arg(long)]
        username: String,
        #[arg(long, default_value_os_t = crate::namespace::default_cli_directory())]
        config_dir: PathBuf,
    },
    /// List this account's trusted devices (online only; JSON output).
    List {
        #[arg(long, default_value_os_t = crate::namespace::default_cli_directory())]
        config_dir: PathBuf,
    },
    /// Review a pending enrollment without approving it.
    Inspect {
        code: String,
        #[arg(long, default_value_os_t = crate::namespace::default_cli_directory())]
        config_dir: PathBuf,
    },
    /// Approve a reviewed enrollment after comparing the new client's identity.
    Approve {
        code: String,
        /// Full device UUID shown by the client requesting enrollment.
        #[arg(long)]
        device_id: String,
        /// SHA-256 fingerprint shown by that client (64 hexadecimal characters).
        #[arg(long)]
        fingerprint: String,
        /// Confirm the trust change without an interactive prompt.
        #[arg(long)]
        yes: bool,
        #[arg(long, default_value_os_t = crate::namespace::default_cli_directory())]
        config_dir: PathBuf,
    },
    /// Revoke another device and its online sessions; cannot revoke this device.
    Revoke {
        device_id: String,
        /// Confirm the trust change without an interactive prompt.
        #[arg(long)]
        yes: bool,
        #[arg(long, default_value_os_t = crate::namespace::default_cli_directory())]
        config_dir: PathBuf,
    },
}

pub(crate) fn normalize_code(value: &str) -> Result<String, String> {
    let code = value.trim().to_ascii_uppercase();
    if code.len() != 8
        || !code
            .bytes()
            .all(|byte| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&byte))
    {
        return Err(
            "enrollment code must contain eight letters/digits from the requesting client"
                .to_owned(),
        );
    }
    Ok(code)
}

pub(crate) fn device_id(value: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(value).map_err(|_| "device ID must be a full UUID")?;
    if id.get_variant() != uuid::Variant::RFC4122 || !(1..=5).contains(&id.get_version_num()) {
        return Err("device ID must be an RFC 4122 UUID of version 1 through 5".to_owned());
    }
    Ok(id.to_string())
}

pub(crate) fn fingerprint(value: &str) -> Result<String, String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("fingerprint must be the full 64-character SHA-256 value".to_owned());
    }
    Ok(value.to_ascii_lowercase())
}

pub(crate) fn key_fingerprint(public_key: &[u8]) -> String {
    hex::encode(Sha256::digest(public_key))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EnrollmentInspection {
    account_id: String,
    pub enrollment_id: String,
    pub new_device_id: String,
    new_device_public_key: String,
    expires_at: String,
}

impl EnrollmentInspection {
    pub fn parse(value: Value) -> Result<Self, String> {
        let enrollment: Self =
            serde_json::from_value(value).map_err(|_| "invalid enrollment inspection")?;
        for id in [
            &enrollment.account_id,
            &enrollment.enrollment_id,
            &enrollment.new_device_id,
        ] {
            if device_id(id)? != *id {
                return Err("invalid enrollment inspection".to_owned());
            }
        }
        enrollment.public_key()?;
        if enrollment.expires_at.is_empty()
            || enrollment.expires_at.len() > 64
            || enrollment.expires_at.chars().any(char::is_control)
        {
            return Err("invalid enrollment expiry".to_owned());
        }
        Ok(enrollment)
    }

    fn public_key(&self) -> Result<[u8; 32], String> {
        URL_SAFE_NO_PAD
            .decode(&self.new_device_public_key)
            .map_err(|_| "invalid enrollment public key")?
            .try_into()
            .map_err(|_| "invalid enrollment public key".to_owned())
    }

    pub fn review(&self) -> Result<Value, String> {
        Ok(
            json!({"enrollmentId":self.enrollment_id,"deviceId":self.new_device_id,
            "fingerprint":key_fingerprint(&self.public_key()?),"expiresAt":self.expires_at}),
        )
    }

    pub fn matches(
        &self,
        enrollment_id: &str,
        expected_device: &str,
        expected_fingerprint: &str,
    ) -> Result<(), String> {
        if self.enrollment_id != device_id(enrollment_id)?
            || self.new_device_id != device_id(expected_device)?
            || key_fingerprint(&self.public_key()?) != fingerprint(expected_fingerprint)?
        {
            return Err("enrollment changed or does not match the reviewed device and fingerprint; inspect it again".to_owned());
        }
        Ok(())
    }

    pub fn signing_bytes(&self) -> Result<Vec<u8>, String> {
        vaults_protocol::signed_sync::canonical_bytes(
            &serde_json::to_value(self).map_err(|_| "invalid enrollment inspection")?,
        )
        .map_err(str::to_owned)
    }
}

pub(crate) fn revoke_target(device: &str, current_device: &str) -> Result<String, String> {
    let id = device_id(device)?;
    if id == device_id(current_device)? {
        return Err(
            "the current device cannot be revoked here; use another trusted device".to_owned(),
        );
    }
    Ok(id)
}

pub(crate) fn run(command: DeviceCommand) -> Result<String, String> {
    execute(
        command,
        &mut |profile, action, body| crate::agent::call(profile, action, body),
        &mut confirm,
    )
}

fn confirm(review: &Value) -> Result<bool, String> {
    use std::io::{self, IsTerminal, Write};
    if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
        return Err("trust changes require a terminal confirmation or explicit --yes".to_owned());
    }
    eprintln!(
        "{}",
        serde_json::to_string_pretty(review).map_err(|_| "could not display device review")?
    );
    eprint!("Confirm this device trust change? Type yes: ");
    io::stderr().flush().map_err(|_| "terminal output failed")?;
    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .map_err(|_| "terminal input failed")?;
    Ok(answer.trim() == "yes")
}

fn execute(
    command: DeviceCommand,
    call: &mut impl FnMut(&Path, &str, Value) -> Result<Value, String>,
    confirm_change: &mut impl FnMut(&Value) -> Result<bool, String>,
) -> Result<String, String> {
    let result = match command {
        DeviceCommand::Enroll {
            username,
            config_dir,
        } => return crate::enroll_device(&config_dir, &username),
        DeviceCommand::List { config_dir } => call(
            &crate::effective_config_dir(&config_dir)?,
            "device.list",
            json!({}),
        )?,
        DeviceCommand::Inspect { code, config_dir } => call(
            &crate::effective_config_dir(&config_dir)?,
            "device.inspect",
            json!({"code":normalize_code(&code)?}),
        )?,
        DeviceCommand::Approve {
            code,
            device_id: expected_device,
            fingerprint: expected_fingerprint,
            yes,
            config_dir,
        } => {
            let code = normalize_code(&code)?;
            let expected_device = device_id(&expected_device)?;
            let expected_fingerprint = fingerprint(&expected_fingerprint)?;
            let profile = crate::effective_config_dir(&config_dir)?;
            let review = call(&profile, "device.inspect", json!({"code":code}))?;
            let enrollment_id = device_id(
                review["enrollmentId"]
                    .as_str()
                    .ok_or("invalid enrollment review")?,
            )?;
            if review["deviceId"] != expected_device
                || review["fingerprint"] != expected_fingerprint
            {
                return Err(
                    "request does not match the new client's device ID and fingerprint".to_owned(),
                );
            }
            if !yes && !confirm_change(&review)? {
                return Err("device approval cancelled; trust was not changed".to_owned());
            }
            call(
                &profile,
                "device.approve",
                json!({"code":code,"enrollment_id":enrollment_id,
                "device_id":expected_device,"fingerprint":expected_fingerprint}),
            )?
        }
        DeviceCommand::Revoke {
            device_id: target,
            yes,
            config_dir,
        } => {
            let target = device_id(&target)?;
            let profile = crate::effective_config_dir(&config_dir)?;
            let list = call(&profile, "device.list", json!({}))?;
            let target = revoke_target(
                &target,
                list["currentDeviceId"]
                    .as_str()
                    .ok_or("invalid device list")?,
            )?;
            let device = list["devices"]
                .as_array()
                .ok_or("invalid device list")?
                .iter()
                .find(|device| device["deviceId"] == target)
                .ok_or("device is not listed for this account")?;
            if device["status"] != "active" {
                return Err("device is already revoked or replaced".to_owned());
            }
            let review = json!({"deviceId":target,"effect":"Revoke this device and its online sessions. Its offline replica is not remotely erased."});
            if !yes && !confirm_change(&review)? {
                return Err("device revocation cancelled; trust was not changed".to_owned());
            }
            call(&profile, "device.revoke", json!({"device_id":target}))?
        }
    };
    serde_json::to_string_pretty(&result).map_err(|_| "could not encode device result".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey, Verifier};

    const CURRENT: &str = "ab111111-1111-4111-8111-111111111111";
    const TARGET: &str = "cd222222-2222-4222-8222-222222222222";
    const ENROLLMENT: &str = "ef333333-3333-4333-8333-333333333333";

    fn inspection() -> Value {
        json!({"accountId":CURRENT,"enrollmentId":ENROLLMENT,"newDeviceId":TARGET,
            "newDevicePublicKey":URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[7;32]).verifying_key().to_bytes()),
            "expiresAt":"2026-10-09T12:00:00.000Z"})
    }

    fn approve(yes: bool) -> DeviceCommand {
        DeviceCommand::Approve {
            code: "abcdefgh".to_owned(),
            device_id: TARGET.to_ascii_uppercase(),
            fingerprint: EnrollmentInspection::parse(inspection())
                .unwrap()
                .review()
                .unwrap()["fingerprint"]
                .as_str()
                .unwrap()
                .to_ascii_uppercase(),
            yes,
            config_dir: std::env::temp_dir().join("127vaults-device-unit-profile"),
        }
    }

    #[test]
    fn input_validation_is_strict_and_self_revocation_is_case_insensitive() {
        assert_eq!(normalize_code(" abcdefgh ").unwrap(), "ABCDEFGH");
        for code in [
            "ABC",
            "ABCD0FGH",
            "ABCDIFGH",
            "ABCDOFGH",
            "ABC\nDEFG",
            "éBCDEFGH",
        ] {
            assert!(normalize_code(code).is_err(), "accepted invalid code");
        }
        assert!(revoke_target(&CURRENT.to_ascii_uppercase(), CURRENT).is_err());
        assert!(revoke_target(CURRENT, &CURRENT.to_ascii_uppercase()).is_err());
        assert_eq!(
            revoke_target(&TARGET.to_ascii_uppercase(), CURRENT).unwrap(),
            TARGET
        );
        for id in [
            "d123",
            "00000000-0000-0000-0000-000000000000",
            "11111111-1111-7111-8111-111111111111",
        ] {
            assert!(device_id(id).is_err());
        }
        assert!(fingerprint("0123").is_err());
        assert!(fingerprint(&"z".repeat(64)).is_err());
    }

    #[test]
    fn inspection_rejects_malformed_or_unexpected_server_data() {
        for (field, value) in [
            ("accountId", json!("bad")),
            ("enrollmentId", json!("bad")),
            ("newDeviceId", json!("../path")),
            ("newDevicePublicKey", json!("AA")),
            ("expiresAt", json!("\u{1b}[31m")),
            ("expiresAt", json!("")),
            ("privateKey", json!("not-allowed")),
        ] {
            let mut data = inspection();
            data[field] = value;
            assert!(EnrollmentInspection::parse(data).is_err());
        }
        let mut data = inspection();
        data.as_object_mut().unwrap().remove("expiresAt");
        assert!(EnrollmentInspection::parse(data).is_err());
    }

    #[test]
    fn approval_signs_the_server_binding_and_review_excludes_raw_keys_and_account_identity() {
        let data = inspection();
        let enrollment = EnrollmentInspection::parse(data.clone()).unwrap();
        let review = enrollment.review().unwrap();
        assert_eq!(review.as_object().unwrap().len(), 4);
        assert!(review.get("newDevicePublicKey").is_none());
        assert!(review.get("accountId").is_none());
        assert_eq!(
            enrollment.signing_bytes().unwrap(),
            vaults_protocol::signed_sync::canonical_bytes(&data).unwrap()
        );
        let signing = SigningKey::from_bytes(&[8; 32]);
        let signature = signing.sign(&enrollment.signing_bytes().unwrap());
        signing
            .verifying_key()
            .verify(&enrollment.signing_bytes().unwrap(), &signature)
            .unwrap();
        let mut changed = data;
        changed["newDeviceId"] = json!(CURRENT);
        assert!(
            signing
                .verifying_key()
                .verify(
                    &EnrollmentInspection::parse(changed)
                        .unwrap()
                        .signing_bytes()
                        .unwrap(),
                    &signature
                )
                .is_err()
        );
    }

    #[test]
    fn approval_rejects_changed_enrollment_id_device_or_key() {
        let enrollment = EnrollmentInspection::parse(inspection()).unwrap();
        let hash = enrollment.review().unwrap()["fingerprint"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(enrollment.matches(ENROLLMENT, TARGET, &hash).is_ok());
        for (id, device, fingerprint) in [
            (CURRENT, TARGET, hash.as_str()),
            (ENROLLMENT, CURRENT, hash.as_str()),
            (ENROLLMENT, TARGET, &"0".repeat(64)),
        ] {
            assert!(enrollment.matches(id, device, fingerprint).is_err());
        }
    }

    #[test]
    fn confirmed_approval_passes_exact_review_binding_and_keeps_stdout_json() {
        let review = EnrollmentInspection::parse(inspection())
            .unwrap()
            .review()
            .unwrap();
        let mut calls = Vec::new();
        let output = execute(
            approve(true),
            &mut |profile, action, body| {
                assert_eq!(
                    profile,
                    std::env::temp_dir().join("127vaults-device-unit-profile")
                );
                calls.push((action.to_owned(), body));
                Ok(if action == "device.inspect" {
                    review.clone()
                } else {
                    json!({"approved":true})
                })
            },
            &mut |_| panic!("--yes must not prompt"),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&output).unwrap(),
            json!({"approved":true})
        );
        assert_eq!(
            calls[0],
            ("device.inspect".to_owned(), json!({"code":"ABCDEFGH"}))
        );
        assert_eq!(
            calls[1],
            (
                "device.approve".to_owned(),
                json!({"code":"ABCDEFGH","enrollment_id":ENROLLMENT,
            "device_id":TARGET,"fingerprint":review["fingerprint"]})
            )
        );
    }

    #[test]
    fn cancelled_or_mismatched_approval_never_mutates_trust() {
        for mismatch in [false, true] {
            let mut calls = Vec::new();
            let mut review = EnrollmentInspection::parse(inspection())
                .unwrap()
                .review()
                .unwrap();
            if mismatch {
                review["deviceId"] = json!(CURRENT);
            }
            let result = execute(
                approve(false),
                &mut |_, action, _| {
                    calls.push(action.to_owned());
                    Ok(review.clone())
                },
                &mut |_| Ok(false),
            );
            assert!(result.is_err());
            assert_eq!(calls, vec!["device.inspect"]);
        }
    }

    #[test]
    fn revoke_checks_membership_status_self_and_confirmation_before_mutation() {
        for (target, status, confirmed, success) in [
            (CURRENT, "active", true, false),
            (TARGET, "revoked", true, false),
            (ENROLLMENT, "active", true, false),
            (TARGET, "active", false, false),
            (TARGET, "active", true, true),
        ] {
            let list = json!({"currentDeviceId":CURRENT,"devices":[{"deviceId":CURRENT,"status":"active"},{"deviceId":TARGET,"status":status}]});
            let mut actions = Vec::new();
            let result = execute(
                DeviceCommand::Revoke {
                    device_id: target.to_ascii_uppercase(),
                    yes: false,
                    config_dir: std::env::temp_dir().join("127vaults-device-unit-profile"),
                },
                &mut |_, action, body| {
                    actions.push(action.to_owned());
                    if action == "device.revoke" {
                        assert_eq!(body, json!({"device_id":TARGET}));
                    }
                    Ok(if action == "device.list" {
                        list.clone()
                    } else {
                        json!({"status":"revoked"})
                    })
                },
                &mut |review| {
                    assert!(
                        review["effect"]
                            .as_str()
                            .unwrap()
                            .contains("offline replica")
                    );
                    Ok(confirmed)
                },
            );
            assert_eq!(result.is_ok(), success);
            assert_eq!(actions.len(), if success { 2 } else { 1 });
        }
    }

    #[test]
    fn inspect_and_list_never_prompt_or_call_a_mutating_action() {
        for (command, action) in [
            (
                DeviceCommand::List {
                    config_dir: std::env::temp_dir().join("127vaults-device-unit-profile"),
                },
                "device.list",
            ),
            (
                DeviceCommand::Inspect {
                    code: "abcdefgh".to_owned(),
                    config_dir: std::env::temp_dir().join("127vaults-device-unit-profile"),
                },
                "device.inspect",
            ),
        ] {
            let mut calls = Vec::new();
            execute(
                command,
                &mut |_, called, _| {
                    calls.push(called.to_owned());
                    Ok(json!({}))
                },
                &mut |_| panic!("read-only command prompted"),
            )
            .unwrap();
            assert_eq!(calls, vec![action]);
        }
    }
}
