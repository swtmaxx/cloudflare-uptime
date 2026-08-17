import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckJob,
  CheckResult,
  GlobalpingLocation,
  HeartbeatSummary,
  Monitor,
  ProbeNode,
  StatusPage,
  StatusPageGroup,
  SystemSettings,
  Tag,
} from './types';

export type MonitorRow = {
  id: string;
  name: string;
  type: 'http' | 'tcp';
  provider: Monitor['provider'];
  http_method: Monitor['httpMethod'];
  target_url: string | null;
  request_headers: string | null;
  request_body: string | null;
  expected_status_codes: string | null;
  response_keyword: string | null;
  timeout_seconds: number;
  host: string | null;
  port: number | null;
  interval_seconds: number;
  enabled: number;
  current_status: Monitor['currentStatus'];
  last_started_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  globalping_locations: string | null;
};

export type TagRow = {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export type NodeRow = {
  id: string;
  provider: ProbeNode['provider'];
  country_code: string;
  country_name: string;
  city: string;
  ip: string | null;
  asn: string | null;
  enabled: number;
  last_seen_at: string;
};

export type JobRow = {
  id: string;
  monitor_id: string;
  request_id: string | null;
  provider: CheckJob['provider'];
  state: CheckJob['state'];
  error_message: string | null;
  created_at: string;
  next_poll_at: string | null;
  expires_at: string;
  completed_at: string | null;
  poll_count: number;
};

export type ResultRow = {
  id: string;
  job_id: string;
  monitor_id: string;
  node_id: string;
  success: number;
  latency_ms: number | null;
  status_code: number | null;
  message: string | null;
  resolved_ip: string | null;
  checked_at: string;
  node_provider?: ProbeNode['provider'] | null;
  node_country_code?: string | null;
  node_country_name?: string | null;
  node_city?: string | null;
  node_ip?: string | null;
  node_asn?: string | null;
};

export type StatusPageRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  footer: string;
  refresh_seconds: number;
  theme: StatusPage['theme'];
  show_tags: number;
  show_powered_by: number;
  last_heartbeat_only: number;
  rss_title: string;
  custom_css: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type StatusPageGroupRow = {
  id: string;
  name: string;
  sort_order: number;
  monitor_id?: string | null;
};

type AppSettingRow = {
  value: string;
};

const DEFAULT_SYSTEM_SETTINGS = {
  maxMonitors: 50,
  maxNodesPerMonitor: 5,
  maxJobsPerTick: 20,
  historyRetentionDays: 30,
};

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getAppSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?1').bind(key).first<AppSettingRow>();
  return row?.value || null;
}

export async function setAppSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, nowIso())
    .run();
}

function boundedSetting(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export async function getSystemSettings(db: D1Database): Promise<SystemSettings> {
  const [maxMonitors, maxNodesPerMonitor, maxJobsPerTick, historyRetentionDays, globalpingToken] = await Promise.all([
    getAppSetting(db, 'max_monitors'),
    getAppSetting(db, 'max_nodes_per_monitor'),
    getAppSetting(db, 'max_jobs_per_tick'),
    getAppSetting(db, 'history_retention_days'),
    getAppSetting(db, 'globalping_token'),
  ]);
  return {
    maxMonitors: boundedSetting(maxMonitors, DEFAULT_SYSTEM_SETTINGS.maxMonitors, 1, 1000),
    maxNodesPerMonitor: boundedSetting(maxNodesPerMonitor, DEFAULT_SYSTEM_SETTINGS.maxNodesPerMonitor, 1, 20),
    maxJobsPerTick: boundedSetting(maxJobsPerTick, DEFAULT_SYSTEM_SETTINGS.maxJobsPerTick, 1, 100),
    historyRetentionDays: boundedSetting(historyRetentionDays, DEFAULT_SYSTEM_SETTINGS.historyRetentionDays, 0, 3650),
    globalpingTokenConfigured: Boolean(globalpingToken),
  };
}

function parseGlobalpingLocations(value: string | null): GlobalpingLocation[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is GlobalpingLocation => Boolean(
      item && typeof item === 'object' && typeof (item as { country?: unknown }).country === 'string',
    )).map((item) => ({
      country: item.country.toUpperCase(),
      ...(item.city ? { city: item.city } : {}),
    }));
  } catch {
    return [];
  }
}

function parseHeaders(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function parseStatusCodes(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 100 && item <= 599))];
  } catch {
    return [];
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTags(db: D1Database): Promise<Tag[]> {
  const { results } = await db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE, id').all<TagRow>();
  return results.map(toTag);
}

export async function getMonitorTags(db: D1Database, monitorId: string): Promise<Tag[]> {
  const { results } = await db
    .prepare(
      `SELECT t.*
       FROM tags t
       INNER JOIN monitor_tags mt ON mt.tag_id = t.id
       WHERE mt.monitor_id = ?1
       ORDER BY t.name COLLATE NOCASE, t.id`,
    )
    .bind(monitorId)
    .all<TagRow>();
  return results.map(toTag);
}

export function toProbeNode(row: NodeRow): ProbeNode {
  return {
    id: row.id,
    provider: row.provider || 'check-host',
    countryCode: row.country_code,
    countryName: row.country_name,
    city: row.city,
    ip: row.ip,
    asn: row.asn,
    enabled: row.enabled,
    lastSeenAt: row.last_seen_at,
  };
}

export async function getProbeNode(db: D1Database, id: string): Promise<ProbeNode | null> {
  const row = await db.prepare('SELECT * FROM probe_nodes WHERE id = ?1').bind(id).first<NodeRow>();
  return row ? toProbeNode(row) : null;
}

export async function listProbeNodes(db: D1Database, search = ''): Promise<ProbeNode[]> {
  const normalized = search.trim();
  const statement = normalized
    ? db
        .prepare(
          `SELECT * FROM probe_nodes
           WHERE provider = 'check-host' AND enabled = 1
             AND (id LIKE ?1 OR country_name LIKE ?1 OR city LIKE ?1 OR country_code LIKE ?1)
           ORDER BY country_name, city, id`,
        )
        .bind(`%${normalized}%`)
    : db.prepare("SELECT * FROM probe_nodes WHERE provider = 'check-host' AND enabled = 1 ORDER BY country_name, city, id");
  const { results } = await statement.all<NodeRow>();
  return results.map(toProbeNode);
}

export async function getSelectedNodes(db: D1Database, monitorId: string): Promise<ProbeNode[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*
       FROM probe_nodes p
       INNER JOIN monitor_nodes mn ON mn.node_id = p.id
       WHERE mn.monitor_id = ?1
       ORDER BY p.country_name, p.city, p.id`,
    )
    .bind(monitorId)
    .all<NodeRow>();
  return results.map(toProbeNode);
}

export function toMonitor(row: MonitorRow, nodes: ProbeNode[] = [], tags: Tag[] = []): Monitor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    provider: row.provider || 'check-host',
    httpMethod: row.http_method || 'GET',
    targetUrl: row.target_url,
    requestHeaders: parseHeaders(row.request_headers),
    requestBody: row.request_body,
    expectedStatusCodes: parseStatusCodes(row.expected_status_codes),
    responseKeyword: row.response_keyword,
    timeoutSeconds: Math.min(Math.max(Number(row.timeout_seconds) || 10, 1), 30),
    host: row.host,
    port: row.port,
    intervalSeconds: row.interval_seconds,
    enabled: row.enabled,
    currentStatus: row.current_status,
    lastStartedAt: row.last_started_at,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nodes,
    globalpingLocations: parseGlobalpingLocations(row.globalping_locations),
    tags,
  };
}

export async function getMonitor(db: D1Database, id: string): Promise<Monitor | null> {
  const row = await db.prepare('SELECT * FROM monitors WHERE id = ?1').bind(id).first<MonitorRow>();
  if (!row) return null;
  const [nodes, tags] = await Promise.all([getSelectedNodes(db, id), getMonitorTags(db, id)]);
  return toMonitor(row, nodes, tags);
}

export async function listMonitors(db: D1Database): Promise<Monitor[]> {
  const { results } = await db
    .prepare('SELECT * FROM monitors ORDER BY enabled DESC, name COLLATE NOCASE')
    .all<MonitorRow>();
  return Promise.all(results.map(async (row) => {
    const [nodes, tags] = await Promise.all([getSelectedNodes(db, row.id), getMonitorTags(db, row.id)]);
    return toMonitor(row, nodes, tags);
  }));
}

export async function listHeartbeatSummaries(
  db: D1Database,
  monitorId: string,
  limit = 90,
): Promise<HeartbeatSummary[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 90);
  const { results } = await db
    .prepare(
      `SELECT j.id, j.created_at, j.completed_at,
              SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END) AS successes,
              SUM(CASE WHEN r.success = 0 THEN 1 ELSE 0 END) AS failures,
              COUNT(r.id) AS result_count
       FROM check_jobs j
       LEFT JOIN check_results r ON r.job_id = j.id
       WHERE j.monitor_id = ?1 AND j.state = 'completed'
       GROUP BY j.id
       ORDER BY COALESCE(j.completed_at, j.created_at) DESC
       LIMIT ${safeLimit}`,
    )
    .bind(monitorId)
    .all<{
      id: string;
      created_at: string;
      completed_at: string | null;
      successes: number | null;
      failures: number | null;
      result_count: number;
    }>();
  return results.reverse().map((row) => {
    const successes = Number(row.successes || 0);
    const failures = Number(row.failures || 0);
    const count = Number(row.result_count || 0);
    const status: HeartbeatSummary['status'] = successes === 0 && failures === 0
      ? 'unknown'
      : failures > successes
        ? 'down'
        : failures > 0
          ? 'degraded'
          : 'up';
    return {
      id: row.id,
      status,
      availability: count > 0 ? Number(((successes / count) * 100).toFixed(1)) : null,
      checkedAt: row.completed_at || row.created_at,
    };
  });
}

export async function getPendingJob(db: D1Database, monitorId: string): Promise<JobRow | null> {
  return db
    .prepare(
      `SELECT * FROM check_jobs
       WHERE monitor_id = ?1 AND state = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(monitorId)
    .first<JobRow>();
}

export async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare('SELECT * FROM check_jobs WHERE id = ?1').bind(id).first<JobRow>();
}

export function toCheckJob(row: JobRow): CheckJob {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    requestId: row.request_id,
    provider: row.provider || 'check-host',
    state: row.state,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    nextPollAt: row.next_poll_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    pollCount: row.poll_count,
  };
}

export function toCheckResult(row: ResultRow): CheckResult {
  return {
    id: row.id,
    jobId: row.job_id,
    monitorId: row.monitor_id,
    nodeId: row.node_id,
    success: row.success,
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    message: row.message,
    resolvedIp: row.resolved_ip,
    checkedAt: row.checked_at,
    node: row.node_id && row.node_provider
      ? {
          id: row.node_id,
          provider: row.node_provider,
          countryCode: row.node_country_code || '??',
          countryName: row.node_country_name || 'Unknown',
          city: row.node_city || 'Unknown',
          ip: row.node_ip || row.resolved_ip,
          asn: row.node_asn || null,
          enabled: 1,
          lastSeenAt: row.checked_at,
        }
      : null,
  };
}

export async function listResults(
  db: D1Database,
  monitorId: string,
  limit = 100,
): Promise<CheckResult[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const { results } = await db
    .prepare(
      `SELECT r.*, p.provider AS node_provider, p.country_code AS node_country_code,
              p.country_name AS node_country_name, p.city AS node_city,
              p.ip AS node_ip, p.asn AS node_asn
       FROM check_results r
       LEFT JOIN probe_nodes p ON p.id = r.node_id
       WHERE monitor_id = ?1
       ORDER BY r.checked_at DESC
       LIMIT ${safeLimit}`,
    )
    .bind(monitorId)
    .all<ResultRow>();
  return results.map(toCheckResult);
}

export async function listStatusPages(db: D1Database): Promise<StatusPage[]> {
  const { results } = await db
    .prepare('SELECT * FROM status_pages ORDER BY title COLLATE NOCASE')
    .all<StatusPageRow>();
  return Promise.all(results.map(async (row) => toStatusPage(row, await getStatusPageGroups(db, row.id))));
}

export async function getStatusPageGroups(db: D1Database, pageId: string): Promise<StatusPageGroup[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.sort_order, gm.monitor_id
       FROM status_page_groups g
       LEFT JOIN status_page_group_monitors gm ON gm.group_id = g.id
       WHERE g.status_page_id = ?1
       ORDER BY g.sort_order, g.id, gm.sort_order, gm.monitor_id`,
    )
    .bind(pageId)
    .all<StatusPageGroupRow>();
  const groups = new Map<string, StatusPageGroup>();
  for (const row of results) {
    const group = groups.get(row.id) || {
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      monitorIds: [],
    };
    if (row.monitor_id) group.monitorIds.push(row.monitor_id);
    groups.set(row.id, group);
  }
  return [...groups.values()];
}

export function toStatusPage(row: StatusPageRow, groups: StatusPageGroup[] = []): StatusPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    footer: row.footer || '',
    refreshSeconds: Math.max(Number(row.refresh_seconds) || 300, 30),
    theme: row.theme === 'light' || row.theme === 'dark' ? row.theme : 'auto',
    showTags: row.show_tags === 0 ? 0 : 1,
    showPoweredBy: row.show_powered_by === 0 ? 0 : 1,
    lastHeartbeatOnly: row.last_heartbeat_only === 1 ? 1 : 0,
    rssTitle: row.rss_title || '',
    customCss: row.custom_css || '',
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groups,
  };
}

export async function getStatusPage(db: D1Database, id: string): Promise<StatusPage | null> {
  const row = await db.prepare('SELECT * FROM status_pages WHERE id = ?1').bind(id).first<StatusPageRow>();
  return row ? toStatusPage(row, await getStatusPageGroups(db, id)) : null;
}

export async function getStatusPageBySlug(db: D1Database, slug: string): Promise<StatusPage | null> {
  const row = await db.prepare('SELECT * FROM status_pages WHERE slug = ?1').bind(slug).first<StatusPageRow>();
  return row ? toStatusPage(row, await getStatusPageGroups(db, row.id)) : null;
}
