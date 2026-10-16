-- Contact details and trial state are separately encrypted by the Worker.
-- version is the compare-and-swap guard across concurrent Worker invocations.
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  contact TEXT,
  trial TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX access_requests_retention ON access_requests(received_at) WHERE contact IS NOT NULL;
CREATE TABLE request_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX request_limits_expiry ON request_limits(expires_at);
