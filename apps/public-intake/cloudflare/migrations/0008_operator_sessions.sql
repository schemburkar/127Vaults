CREATE TABLE operator_sessions (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX operator_sessions_expiry ON operator_sessions(expires_at);
