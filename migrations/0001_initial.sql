PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  target_url TEXT,
  host TEXT,
  port INTEGER,
  interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (interval_seconds = 60),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  current_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (current_status IN ('up', 'degraded', 'down', 'unknown', 'paused')),
  last_started_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (type = 'http' AND target_url IS NOT NULL AND host IS NULL AND port IS NULL)
    OR
    (type = 'tcp' AND target_url IS NULL AND host IS NOT NULL AND port IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS probe_nodes (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  city TEXT NOT NULL,
  ip TEXT,
  asn TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_nodes (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES probe_nodes(id) ON DELETE RESTRICT,
  PRIMARY KEY (monitor_id, node_id)
);

CREATE TABLE IF NOT EXISTS check_jobs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  request_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'provider_error', 'expired')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  next_poll_at TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS check_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES check_jobs(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES probe_nodes(id) ON DELETE RESTRICT,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  latency_ms INTEGER,
  status_code INTEGER,
  message TEXT,
  resolved_ip TEXT,
  checked_at TEXT NOT NULL,
  UNIQUE (job_id, node_id)
);

CREATE TABLE IF NOT EXISTS status_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_page_monitors (
  status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_monitors_enabled_started
  ON monitors (enabled, last_started_at);

CREATE INDEX IF NOT EXISTS idx_monitor_nodes_node
  ON monitor_nodes (node_id);

CREATE INDEX IF NOT EXISTS idx_check_jobs_state_poll
  ON check_jobs (state, next_poll_at);

CREATE INDEX IF NOT EXISTS idx_check_jobs_monitor_state
  ON check_jobs (monitor_id, state);

CREATE INDEX IF NOT EXISTS idx_check_results_monitor_checked
  ON check_results (monitor_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_check_results_node_checked
  ON check_results (node_id, checked_at DESC);
