-- Operator-only copyable messages. Plaintext codes never enter stored rows.
CREATE TABLE customer_manual_mail (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX customer_manual_mail_expiry ON customer_manual_mail(expires_at);
