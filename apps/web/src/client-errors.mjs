export const safeError = (e) => e.name === 'QuotaExceededError' ? 'Device storage is full. Free storage and retry before closing the app.' : e.name === 'SecurityError' ? 'Device storage is unavailable. Use a regular browser profile with website storage enabled.' :
  ({
    INVALID_ACCOUNT_SECRET:
      "Account secret must be exactly 64 hexadecimal characters.",
    INVALID_MASTER_PASSWORD:
      "Master password must contain at least 20 characters.",
    rate_limited: "Too many attempts. Wait before retrying.",
    seat_limit_reached: "All seats are in use or reserved for existing invitations.",
    email_unavailable: "The verification code could not be sent. Wait a minute before trying again.",
    SERVER_TIMEOUT: "The server did not respond within 30 seconds.",
    SERVER_UNREACHABLE:
      "The server could not be reached. Check that the MVP stack is running.",
    INVALID_SERVER_RESPONSE: "The server returned an invalid response.",
    OFFLINE_DATA_UNAVAILABLE: "This device has no complete offline copy yet. Connect and sync first.",
    ONLINE_REQUIRED: "Connect to the server to perform this action.",
    LOCAL_STORAGE_FAILED: "Device storage could not save this change. Free space and retry before closing the app.",
    LOCAL_REPLICA_INVALID: "The encrypted local queue is invalid. It has been preserved; no queued requests were sent.",
    authentication_required: "Unlock with your master password to reconnect and sync. Local changes are preserved.",
    ENROLLMENT_EXPIRED: "This registration code expired. Close this dialog and register again.",
    ENROLLMENT_INVALID: "Device approval could not be verified. Start a new registration.",
    INVALID_USERNAME: "Enter your username (5–64 letters, digits, dots, hyphens, or underscores).",
    SYNC_REVIEW_PENDING: "Your offline changes are preserved. Choose Sync to finish reviewing the conflict.",
    LOCAL_QUEUE_CHANGED: "Another app window saved a change. Sync again to include it.",
    BASE_CHANGED: "This item changed on another device. Your queued edit is preserved. Choose Sync to review both versions.",
    VAULT_RETIRED: "This vault was removed on another device. Your offline changes are preserved for review.",
    SERVER_IDENTITY_CHANGED: "The server identity changed. Your local copy and pending changes are preserved; verify the server before registering again.",
    CLOUD_TENANT_SWITCHED: "Another Cloud tenant is active. Reopen this tenant to switch back.",
    PENDING_REMOVAL: "Resume or cancel the pending vault removal before starting another.",
    REMOVAL_SOURCE_CHANGED: "The source vault changed. It remains available; cancel the pending move and start again after syncing.",
    REMOVAL_DESTINATION_CHANGED: "The destination copy changed. Both vaults remain available; review the copy before cancelling or restarting the move.",
    SYNC_ROLLBACK: "The server returned an older sync history. Your verified local copy is preserved.",
    SYNC_FORK: "The server sync history differs from this device’s verified copy. Your local changes are preserved.",
    INVALID_SYNC_HISTORY: "Sync signatures or the operation chain could not be verified. Your encrypted local copy and changes are preserved.",
    SYNC_DEVICE_KEY_CHANGED: "A registered device’s signing key changed unexpectedly. Sync stopped; your local changes are preserved.",
    SYNC_PAYLOAD_MISMATCH: "Downloaded vault records do not match their signed operation. Sync stopped; your local copy is preserved.",
    INVALID_SYNC_CHECKPOINT: "The server’s signed checkpoint could not be verified. Your local copy and changes are preserved.",
    SYNC_CHECKPOINT_KEY_CHANGED: "The server checkpoint signing key changed. Sync stopped; verify the server before proceeding.",
    onboarding_failed:
      "Setup was rejected. The code may be invalid, expired, or already used.",
    authentication_failed:
      "Unlock failed. Check the username, account secret, master password, and enrolled browser profile.",
  })[e.message] ??
  "The operation failed. Retry; if it repeats, record the stage shown here.";
