PRAGMA foreign_keys = OFF;

CREATE TABLE check_jobs_v2 (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  request_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'provider_error', 'expired')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  next_poll_at TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'worker' CHECK (provider IN ('worker', 'globalping'))
);

INSERT INTO check_jobs_v2
  (id, monitor_id, request_id, state, error_message, created_at, next_poll_at,
   expires_at, completed_at, poll_count, provider)
SELECT id, monitor_id, request_id, state, error_message, created_at, next_poll_at,
       expires_at, completed_at, poll_count,
       CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END
FROM check_jobs;

DROP TABLE check_jobs;
ALTER TABLE check_jobs_v2 RENAME TO check_jobs;

CREATE INDEX IF NOT EXISTS idx_check_jobs_state_poll
  ON check_jobs (state, next_poll_at);

CREATE INDEX IF NOT EXISTS idx_check_jobs_monitor_state
  ON check_jobs (monitor_id, state);

PRAGMA foreign_keys = ON;
