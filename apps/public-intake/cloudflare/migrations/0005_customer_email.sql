-- Messages are encrypted. Provider status is submission status, not delivery confirmation.
CREATE TABLE customer_email_receipts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  provider_id TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX customer_email_receipts_expiry ON customer_email_receipts(expires_at);
CREATE INDEX customer_email_receipts_request ON customer_email_receipts(request_id);
CREATE TABLE customer_email_budget (
  window TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
