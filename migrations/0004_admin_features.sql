PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#5ee0b2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_tags (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (monitor_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_tags_tag
  ON monitor_tags (tag_id, monitor_id);

ALTER TABLE status_pages ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE status_pages ADD COLUMN footer TEXT NOT NULL DEFAULT '';
ALTER TABLE status_pages ADD COLUMN refresh_seconds INTEGER NOT NULL DEFAULT 300;
ALTER TABLE status_pages ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE status_pages ADD COLUMN show_tags INTEGER NOT NULL DEFAULT 1;
ALTER TABLE status_pages ADD COLUMN show_powered_by INTEGER NOT NULL DEFAULT 1;
ALTER TABLE status_pages ADD COLUMN last_heartbeat_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_pages ADD COLUMN rss_title TEXT NOT NULL DEFAULT '';
ALTER TABLE status_pages ADD COLUMN custom_css TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS status_page_groups (
  id TEXT PRIMARY KEY,
  status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (status_page_id, name)
);

CREATE TABLE IF NOT EXISTS status_page_group_monitors (
  group_id TEXT NOT NULL REFERENCES status_page_groups(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_status_page_groups_page
  ON status_page_groups (status_page_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_status_page_group_monitors_group
  ON status_page_group_monitors (group_id, sort_order);

INSERT INTO status_page_groups (id, status_page_id, name, sort_order, created_at, updated_at)
SELECT sp.id || ':default', sp.id, '服务', 0, sp.created_at, sp.updated_at
FROM status_pages sp
WHERE NOT EXISTS (
  SELECT 1 FROM status_page_groups g WHERE g.status_page_id = sp.id
);

INSERT INTO status_page_group_monitors (group_id, monitor_id, sort_order)
SELECT sp.id || ':default', spm.monitor_id, spm.sort_order
FROM status_pages sp
INNER JOIN status_page_monitors spm ON spm.status_page_id = sp.id
WHERE NOT EXISTS (
  SELECT 1
  FROM status_page_group_monitors gm
  WHERE gm.group_id = sp.id || ':default' AND gm.monitor_id = spm.monitor_id
);
