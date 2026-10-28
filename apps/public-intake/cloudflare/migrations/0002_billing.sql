CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  received_at INTEGER NOT NULL,
  event TEXT NOT NULL,
  processed_at INTEGER
);
CREATE INDEX billing_events_request ON billing_events(request_id, received_at);
CREATE TABLE billing_health (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  checked_at INTEGER NOT NULL,
  checked INTEGER NOT NULL,
  failed INTEGER NOT NULL
);
