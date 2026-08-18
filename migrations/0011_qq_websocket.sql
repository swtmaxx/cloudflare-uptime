-- Replace the old public callback source with users learned from the QQ Gateway WebSocket.
PRAGMA foreign_keys = OFF;

CREATE TABLE qq_notification_users_v11 (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  openid TEXT NOT NULL,
  nickname TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'websocket')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (channel_id, openid)
);

INSERT INTO qq_notification_users_v11
  (id, channel_id, openid, nickname, source, enabled, created_at, updated_at, last_seen_at)
SELECT id, channel_id, openid, nickname,
       CASE WHEN source = 'webhook' THEN 'websocket' ELSE source END,
       enabled, created_at, updated_at, last_seen_at
FROM qq_notification_users;

DROP TABLE qq_notification_users;
ALTER TABLE qq_notification_users_v11 RENAME TO qq_notification_users;

CREATE INDEX IF NOT EXISTS idx_qq_notification_users_channel
  ON qq_notification_users (channel_id, enabled, updated_at DESC);

PRAGMA foreign_keys = ON;
