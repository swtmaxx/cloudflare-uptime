PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pushplus')),
  name TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_notification_bindings (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_event_key TEXT,
  last_attempt_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (monitor_id, channel_id)
);

CREATE TABLE IF NOT EXISTS monitor_notification_rules (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  notify_on_degraded INTEGER NOT NULL DEFAULT 0 CHECK (notify_on_degraded IN (0, 1)),
  notify_on_down INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_down IN (0, 1)),
  notify_on_recovery INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_recovery IN (0, 1)),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 10),
  consecutive_abnormal INTEGER NOT NULL DEFAULT 0,
  incident_status TEXT CHECK (incident_status IN ('degraded', 'down') OR incident_status IS NULL),
  incident_id TEXT,
  pending_event_key TEXT,
  pending_event_type TEXT CHECK (pending_event_type IN ('degraded', 'down', 'recovery') OR pending_event_type IS NULL),
  pending_checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_notification_bindings_channel
  ON monitor_notification_bindings (channel_id, monitor_id);

CREATE INDEX IF NOT EXISTS idx_monitor_notification_pending
  ON monitor_notification_rules (pending_event_key, monitor_id);
