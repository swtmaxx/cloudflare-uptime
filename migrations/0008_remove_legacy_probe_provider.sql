-- Normalize legacy Check-Host data without rebuilding tables that are referenced
-- by existing D1 foreign keys. Runtime code no longer reads or writes this value.

UPDATE monitors
SET provider = CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END,
    current_status = CASE WHEN provider = 'check-host' THEN 'unknown' ELSE current_status END;

UPDATE probe_nodes
SET provider = CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END;

UPDATE check_jobs
SET provider = CASE WHEN provider = 'globalping' THEN 'globalping' ELSE 'worker' END,
    state = CASE WHEN provider = 'check-host' AND state = 'pending' THEN 'expired' ELSE state END,
    error_message = CASE WHEN provider = 'check-host' AND state = 'pending' THEN '旧探测服务已移除' ELSE error_message END,
    completed_at = CASE WHEN provider = 'check-host' AND state = 'pending' THEN COALESCE(completed_at, created_at) ELSE completed_at END;

DROP TABLE IF EXISTS monitor_nodes;
