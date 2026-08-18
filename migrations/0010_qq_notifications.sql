-- Add the official QQ bot channel without losing existing PushPlus channels.
-- SQLite cannot alter the CHECK constraint in place, so rebuild this table.
PRAGMA foreign_keys = OFF;

CREATE TABLE notification_channels_v10 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pushplus', 'qqbot')),
  name TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL DEFAULT '',
  token_plaintext TEXT NOT NULL DEFAULT '',
  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0, 1)),
  qq_app_id TEXT,
  qq_app_secret TEXT,
  qq_bot_secret TEXT,
  qq_access_token TEXT,
  qq_access_token_expires_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO notification_channels_v10 (
  id, type, name, token_ciphertext, token_plaintext, default_enabled,
  created_at, updated_at
)
SELECT
  id, type, name, COALESCE(token_ciphertext, ''), COALESCE(token_plaintext, ''),
  default_enabled, created_at, updated_at
FROM notification_channels;

DROP TABLE notification_channels;
ALTER TABLE notification_channels_v10 RENAME TO notification_channels;

CREATE TABLE IF NOT EXISTS qq_notification_users (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  openid TEXT NOT NULL,
  nickname TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'webhook')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (channel_id, openid)
);

CREATE INDEX IF NOT EXISTS idx_qq_notification_users_channel
  ON qq_notification_users (channel_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS monitor_notification_user_deliveries (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES qq_notification_users(id) ON DELETE CASCADE,
  last_event_key TEXT,
  last_attempt_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (monitor_id, channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_notification_user_delivery_event
  ON monitor_notification_user_deliveries (monitor_id, channel_id, last_event_key);

PRAGMA foreign_keys = ON;
