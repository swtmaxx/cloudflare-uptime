ALTER TABLE monitors ADD COLUMN provider TEXT NOT NULL DEFAULT 'check-host';
ALTER TABLE monitors ADD COLUMN http_method TEXT NOT NULL DEFAULT 'GET';
ALTER TABLE monitors ADD COLUMN globalping_locations TEXT;

ALTER TABLE probe_nodes ADD COLUMN provider TEXT NOT NULL DEFAULT 'check-host';
ALTER TABLE check_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'check-host';

CREATE INDEX IF NOT EXISTS idx_probe_nodes_provider
  ON probe_nodes (provider, enabled, country_code, city);

