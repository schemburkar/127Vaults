CREATE TABLE customer_challenges (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE TABLE customer_sessions (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX customer_challenges_expiry ON customer_challenges(expires_at);
CREATE INDEX customer_sessions_expiry ON customer_sessions(expires_at);
