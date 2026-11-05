CREATE TABLE intake_challenges (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX intake_challenges_expiry ON intake_challenges(expires_at);
CREATE TABLE intake_browsers (id TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
CREATE TABLE intake_activity (request_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE INDEX intake_activity_received ON intake_activity(received_at);
CREATE TABLE intake_volume_alerts (id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL, state TEXT NOT NULL);
