CREATE TABLE customer_passkeys (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  payload TEXT NOT NULL,
  counter INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX customer_passkeys_account ON customer_passkeys(account);
CREATE TABLE customer_passkey_challenges (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX customer_passkey_challenges_expiry ON customer_passkey_challenges(expires_at);
