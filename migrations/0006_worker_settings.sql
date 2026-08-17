PRAGMA foreign_keys = OFF;

CREATE TABLE monitors_v6 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  provider TEXT NOT NULL DEFAULT 'check-host' CHECK (provider IN ('worker', 'check-host', 'globalping')),
  http_method TEXT NOT NULL DEFAULT 'GET'
    CHECK (http_method IN ('GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE')),
  target_url TEXT,
  request_headers TEXT NOT NULL DEFAULT '{}',
  request_body TEXT,
  expected_status_codes TEXT NOT NULL DEFAULT '[]',
  response_keyword TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 10 CHECK (timeout_seconds BETWEEN 1 AND 30),
  host TEXT,
  port INTEGER,
  interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (interval_seconds BETWEEN 60 AND 3600),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  current_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (current_status IN ('up', 'degraded', 'down', 'unknown', 'paused')),
  last_started_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  globalping_locations TEXT,
  CHECK (
    (type = 'http' AND target_url IS NOT NULL AND host IS NULL AND port IS NULL)
    OR
    (type = 'tcp' AND target_url IS NULL AND host IS NOT NULL AND port IS NOT NULL)
  )
);

INSERT INTO monitors_v6 (
  id, name, type, provider, http_method, target_url, host, port, interval_seconds,
  enabled, current_status, last_started_at, last_checked_at, created_at, updated_at,
  globalping_locations
)
SELECT id, name, type, provider, http_method, target_url, host, port, interval_seconds,
       enabled, current_status, last_started_at, last_checked_at, created_at, updated_at,
       globalping_locations
FROM monitors;

DROP TABLE monitors;
ALTER TABLE monitors_v6 RENAME TO monitors;

CREATE INDEX IF NOT EXISTS idx_monitors_enabled_started
  ON monitors (enabled, last_started_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS scheduler_leases (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE notification_channels ADD COLUMN token_plaintext TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO probe_nodes
  (id, provider, country_code, country_name, city, ip, asn, enabled, last_seen_at)
VALUES
  ('worker-local', 'worker', '--', 'Worker', '本地', NULL, NULL, 1, '1970-01-01T00:00:00.000Z');

PRAGMA foreign_keys = ON;
