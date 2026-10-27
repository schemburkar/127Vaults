use serde_json::Value;

/// Checks access against the verified installation entitlement.
///
/// # Errors
/// Refuses missing, revoked, expired or clock-invalid entitlements.
pub fn authorize(status: &Value, observed: i64, now: i64, write: bool) -> Result<(), String> {
    let mode = status["mode"].as_str().unwrap_or("missing");
    let parse = |name: &str| {
        status[name]
            .as_str()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map_or(0, |value| value.timestamp())
    };
    if now < observed || status["clockState"] == "rollback_detected" {
        return Err("License access is paused because the system clock moved backward. Ask the operator to verify the server and device clocks; existing encrypted data is preserved".into());
    }
    if !matches!(mode, "active" | "read-only") {
        return Err("A valid signed license is required. Ask the operator to install a license; existing encrypted data is preserved".into());
    }
    let allowed = if write {
        mode == "active" && now < parse("expiresAt")
    } else {
        now < parse("readOnlyUntil")
    };
    if allowed {
        Ok(())
    } else {
        Err(if write {
        "License is read-only or expired; edits and imports require an active license"
    } else {
        "License grace period ended; ask the operator for a trial or renewed license to access or export data"
    }.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn clock_rollback_explains_the_actual_access_failure() {
        let status = json!({"mode":"locked","clockState":"rollback_detected"});
        let error = authorize(&status, 100, 101, false).unwrap_err();
        assert!(error.contains("system clock moved backward"));
        assert!(!error.contains("install a license"));
        assert!(
            authorize(&json!({"mode":"active"}), 102, 101, false)
                .unwrap_err()
                .contains("system clock moved backward")
        );
    }
    #[test]
    fn access_and_export_require_a_license_within_grace_and_writes_require_active() {
        let status = json!({"mode":"active","expiresAt":"2030-01-01T00:00:00Z","readOnlyUntil":"2030-01-31T00:00:00Z"});
        let expiry = chrono::DateTime::parse_from_rfc3339("2030-01-01T00:00:00Z")
            .unwrap()
            .timestamp();
        assert!(authorize(&status, expiry - 10, expiry - 1, true).is_ok());
        assert!(authorize(&status, expiry - 10, expiry + 1, true).is_err());
        assert!(authorize(&status, expiry - 10, expiry + 1, false).is_ok());
        assert!(authorize(&status, expiry - 10, expiry + 31 * 86400, false).is_err());
        assert!(authorize(&status, expiry, expiry - 1, false).is_err());
        for mode in ["missing", "experimental", "revoked", "locked"] {
            let mut invalid = status.clone();
            invalid["mode"] = json!(mode);
            assert!(authorize(&invalid, 0, expiry - 1, false).is_err());
        }
    }
}
