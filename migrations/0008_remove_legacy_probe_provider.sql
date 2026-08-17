PRAGMA foreign_keys = OFF;

UPDATE check_jobs
SET provider = 'worker',
    state = CASE WHEN state = 'pending' THEN 'expired' ELSE state END,
    error_message = CASE WHEN state = 'pending' THEN '旧探测服务已移除' ELSE error_message END,
    completed_at = CASE WHEN state = 'pending' THEN COALESCE(completed_at, created_at) ELSE completed_at END
WHERE provider = 'check-host';

CREATE TABLE probe_nodes_v2 (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'worker' CHECK (provider IN ('worker', 'globalping')),
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  city TEXT NOT NULL,
  ip TEXT,
  asn TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_seen_at TEXT NOT NULL
);

INSERT INTO probe_nodes_v2
  (id, provider, country_code, country_name, city, ip, asn, enabled, last_seen_at)
SELECT id,
       CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END,
       country_code, country_name, city, ip, asn, enabled, last_seen_at
FROM probe_nodes;

DROP TABLE probe_nodes;
ALTER TABLE probe_nodes_v2 RENAME TO probe_nodes;

CREATE INDEX IF NOT EXISTS idx_probe_nodes_provider
  ON probe_nodes (provider, enabled, country_code, city);

DROP TABLE IF EXISTS monitor_nodes;

CREATE TABLE monitors_v7 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  provider TEXT NOT NULL DEFAULT 'worker' CHECK (provider IN ('worker', 'globalping')),
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

INSERT INTO monitors_v7 (
  id, name, type, provider, http_method, target_url, request_headers, request_body,
  expected_status_codes, response_keyword, timeout_seconds, host, port, interval_seconds,
  enabled, current_status, last_started_at, last_checked_at, created_at, updated_at,
  globalping_locations
)
SELECT id, name, type,
       CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END,
       http_method, target_url, request_headers, request_body,
       expected_status_codes, response_keyword, timeout_seconds, host, port, interval_seconds,
       enabled,
       CASE WHEN provider = 'check-host' THEN 'unknown' ELSE current_status END,
       last_started_at, last_checked_at, created_at, updated_at, globalping_locations
FROM monitors;

DROP TABLE monitors;
ALTER TABLE monitors_v7 RENAME TO monitors;

CREATE INDEX IF NOT EXISTS idx_monitors_enabled_started
  ON monitors (enabled, last_started_at);

PRAGMA foreign_keys = ON;
