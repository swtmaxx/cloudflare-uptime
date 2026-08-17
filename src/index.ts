import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  adminCount,
  authenticateAdmin,
  createAdmin,
  currentAdmin,
  endSession,
  requireAdmin,
  startSession,
  updateAdminPassword,
  updateAdminUsername,
  validCredential,
  validPassword,
  verifyAdminPassword,
} from './auth';
import { fetchNodes } from './check-host';
import { fetchGlobalpingLocations } from './globalping';
import {
  getMonitor,
  getAppSetting,
  getProbeNode,
  getSelectedNodes,
  getStatusPage,
  getStatusPageBySlug,
  getSystemSettings,
  listMonitors,
  listProbeNodes,
  listResults,
  listStatusPages,
  listHeartbeatSummaries,
  listTags,
  newId,
  nowIso,
  setAppSetting,
} from './db';
import { runScheduler, startMonitorJob } from './scheduler';
import {
  applyChannelToExistingMonitors,
  applyDefaultNotificationsToMonitor,
  getMonitorNotificationSettings,
  getNotificationChannelRow,
  listNotificationChannels,
  saveMonitorNotificationSettings,
  sendTestNotification,
} from './notifications';
import type {
  Env,
  GlobalpingLocation,
  HeartbeatPosition,
  HttpMethod,
  MonitorInput,
  MonitorProvider,
  MonitorNotificationRule,
  StatusPage,
  StatusPageGroup,
  ThemeMode,
  TimeDisplay,
} from './types';

type AppContext = Context<{ Bindings: Env }>;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const app = new Hono<{ Bindings: Env }>();

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function statusLabel(value: string): string {
  return ({ up: '正常', degraded: '部分异常', down: '宕机', unknown: '待探测', paused: '已暂停' } as Record<string, string>)[value] || '未知';
}

async function bodyObject(c: AppContext): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new ValidationError('请求体必须是有效 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown, field: string, min = 1, max = 160): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} 必须是文本`);
  const result = value.trim();
  if (result.length < min || result.length > max) {
    throw new ValidationError(`${field} 长度必须在 ${min}-${max} 个字符之间`);
  }
  return result;
}

function integerField(value: unknown, field: string, min: number, max: number): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new ValidationError(`${field} 必须是 ${min}-${max} 之间的整数`);
  }
  return result;
}

async function maximumNodes(env: Env): Promise<number> {
  return (await getSystemSettings(env.DB)).maxNodesPerMonitor;
}

function colorField(value: unknown, field = '标签颜色', fallback = '#5ee0b2'): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    throw new ValidationError(`${field}必须是 6 位十六进制颜色`);
  }
  return value.trim().toLowerCase();
}

function themeField(value: unknown, fallback: ThemeMode = 'auto'): ThemeMode {
  if (value === undefined) return fallback;
  if (value !== 'light' && value !== 'dark' && value !== 'auto') throw new ValidationError('主题只能是浅色、深色或自动');
  return value;
}

function optionalTextField(value: unknown, field: string, max: number, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new ValidationError(`${field}必须是文本`);
  const result = value.trim();
  if (result.length > max) throw new ValidationError(`${field}不能超过 ${max} 个字符`);
  return result;
}

function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError(`${field}必须是布尔值`);
  return value;
}

async function validateTagIds(env: Env, value: unknown): Promise<string[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError('标签列表格式不正确');
  const tagIds = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  if (tagIds.length > 20) throw new ValidationError('每个监控最多添加 20 个标签');
  if (!tagIds.length) return [];
  const placeholders = tagIds.map((_, index) => `?${index + 1}`).join(', ');
  const { results } = await env.DB
    .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
    .bind(...tagIds)
    .all<{ id: string }>();
  if (results.length !== tagIds.length) throw new ValidationError('包含不存在的标签');
  return tagIds;
}

async function validateNodeIds(env: Env, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) throw new ValidationError('必须选择探测节点');
  const nodeIds = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  if (nodeIds.length < 1) throw new ValidationError('至少选择一个探测节点');
  const limit = await maximumNodes(env);
  if (nodeIds.length > limit) {
    throw new ValidationError(`每个监控最多选择 ${limit} 个节点`);
  }
  const placeholders = nodeIds.map((_, index) => `?${index + 1}`).join(', ');
  const { results } = await env.DB
    .prepare(`SELECT id FROM probe_nodes WHERE provider = 'check-host' AND enabled = 1 AND id IN (${placeholders})`)
    .bind(...nodeIds)
    .all<{ id: string }>();
  if (results.length !== nodeIds.length) throw new ValidationError('包含无效或已下线的探测节点，请刷新节点列表');
  return nodeIds;
}

function providerField(value: unknown): MonitorProvider {
  if (value === undefined) return 'check-host';
  if (value !== 'worker' && value !== 'check-host' && value !== 'globalping') throw new ValidationError('探测服务只能是 Worker、Check-Host 或 Globalping');
  return value;
}

function httpMethodField(value: unknown): HttpMethod {
  if (value === undefined) return 'GET';
  if (!['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(value))) throw new ValidationError('HTTP 方法不支持');
  return value as HttpMethod;
}

function httpHeadersField(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('HTTP 请求头格式不正确');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw new ValidationError('最多设置 50 个请求头');
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(key) || typeof item !== 'string' || item.length > 4096) {
      throw new ValidationError('HTTP 请求头名称或值不正确');
    }
    result[key] = item;
  }
  return result;
}

function statusCodesField(value: unknown): number[] {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new ValidationError('成功状态码列表格式不正确');
  const codes = [...new Set(value.map((item) => typeof item === 'number' ? item : Number(item)))];
  if (codes.some((item) => !Number.isInteger(item) || item < 100 || item > 599)) throw new ValidationError('成功状态码必须在 100-599 之间');
  if (codes.length > 100) throw new ValidationError('最多设置 100 个成功状态码');
  return codes;
}

function validateGlobalpingLocations(value: unknown, maximum: number): GlobalpingLocation[] {
  if (!Array.isArray(value)) throw new ValidationError('必须选择 Globalping 探测位置');
  const locations: GlobalpingLocation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('Globalping 位置格式不正确');
    const record = item as Record<string, unknown>;
    const country = textField(record.country, '国家代码', 2, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError('国家代码必须是两个英文字母');
    const city = record.city === undefined || record.city === null ? undefined : textField(record.city, '城市', 1, 120);
    const key = `${country}\u0000${city || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(city ? { country, city } : { country });
  }
  if (!locations.length) throw new ValidationError('至少选择一个 Globalping 探测位置');
  if (locations.length > maximum) throw new ValidationError(`每个监控最多选择 ${maximum} 个 Globalping 位置`);
  return locations;
}

async function parseMonitorInput(env: Env, body: Record<string, unknown>): Promise<MonitorInput & { targetUrl?: string; host?: string; provider: MonitorProvider; httpMethod: HttpMethod; globalpingLocations: GlobalpingLocation[]; tagIds: string[] }> {
  const name = textField(body.name, '监控名称', 1, 80);
  const tagIds = await validateTagIds(env, body.tagIds);
  const type = body.type;
  if (type !== 'http' && type !== 'tcp') throw new ValidationError('监控类型只能是 HTTP 或 TCP');
  const provider = providerField(body.provider);
  const enabled = body.enabled === undefined ? true : body.enabled === true;
  const intervalMinutes = integerField(body.intervalMinutes === undefined ? 1 : body.intervalMinutes, '检查频率', 1, 60);
  const intervalSeconds = intervalMinutes * 60;

  if (type === 'http') {
    const url = textField(body.url, 'URL', 1, 2048);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError('URL 格式不正确');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new ValidationError('URL 只支持 HTTP/HTTPS，且不能包含账号密码');
    }
    const httpMethod = httpMethodField(body.httpMethod);
    const requestHeaders = httpHeadersField(body.requestHeaders);
    const requestBody = optionalTextField(body.requestBody, '请求体', 64 * 1024, '');
    const responseKeyword = optionalTextField(body.responseKeyword, '响应关键字', 1000, '');
    const expectedStatusCodes = statusCodesField(body.expectedStatusCodes);
    const timeoutSeconds = integerField(body.timeoutSeconds === undefined ? 10 : body.timeoutSeconds, '请求超时', 1, 30);
    if (provider === 'check-host' && httpMethod !== 'GET') throw new ValidationError('Check-Host HTTP 只支持 GET，请切换到 Worker 监控');
    if (provider === 'globalping' && (requestBody || Object.keys(requestHeaders).length || responseKeyword || expectedStatusCodes.length)) {
      throw new ValidationError('Globalping 当前只支持 URL、方法和位置，API 断言请切换到 Worker 监控');
    }
    if (provider === 'globalping') {
      return {
        name,
        type,
        provider,
        httpMethod,
        requestHeaders,
        requestBody,
        expectedStatusCodes,
        responseKeyword,
        timeoutSeconds,
        intervalSeconds,
        url,
        targetUrl: parsed.toString(),
        nodeIds: [],
        globalpingLocations: validateGlobalpingLocations(body.globalpingLocations, await maximumNodes(env)),
        tagIds,
        enabled,
      };
    }
    return {
      name,
      type,
      provider,
      httpMethod,
      requestHeaders,
      requestBody,
      expectedStatusCodes,
      responseKeyword,
      timeoutSeconds,
      intervalSeconds,
      url,
      targetUrl: parsed.toString(),
      nodeIds: provider === 'worker' ? [] : await validateNodeIds(env, body.nodeIds),
      globalpingLocations: [],
      tagIds,
      enabled,
    };
  }

  if (provider === 'globalping') throw new ValidationError('Globalping 只支持 HTTP 监控');
  const host = textField(body.host, 'TCP 主机', 1, 253);
  if (/\s/.test(host)) throw new ValidationError('TCP 主机不能包含空格');
  const port = integerField(body.port, 'TCP 端口', 1, 65535);
  return {
    name,
    type,
    provider,
    httpMethod: 'GET',
    requestHeaders: {},
    requestBody: '',
    expectedStatusCodes: [],
    responseKeyword: '',
    timeoutSeconds: integerField(body.timeoutSeconds === undefined ? 10 : body.timeoutSeconds, '连接超时', 1, 30),
    intervalSeconds,
    host,
    port,
    nodeIds: provider === 'worker' ? [] : await validateNodeIds(env, body.nodeIds),
    globalpingLocations: [],
    tagIds,
    enabled,
  };
}

function notificationRuleInput(value: unknown, fallback?: MonitorNotificationRule): {
  enabled: boolean;
  notifyOnDegraded: boolean;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
  failureThreshold: number;
} {
  const record = value === undefined
    ? {}
    : value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : (() => { throw new ValidationError('通知规则格式不正确'); })();
  return {
    enabled: booleanField(record.enabled, '通知开关', fallback ? fallback.enabled === 1 : true),
    notifyOnDegraded: booleanField(record.notifyOnDegraded, '部分异常通知', fallback ? fallback.notifyOnDegraded === 1 : false),
    notifyOnDown: booleanField(record.notifyOnDown, '宕机通知', fallback ? fallback.notifyOnDown === 1 : true),
    notifyOnRecovery: booleanField(record.notifyOnRecovery, '恢复通知', fallback ? fallback.notifyOnRecovery === 1 : true),
    failureThreshold: integerField(record.failureThreshold === undefined ? fallback?.failureThreshold || 3 : record.failureThreshold, '连续异常次数', 1, 10),
  };
}

async function notificationBindingsInput(env: Env, value: unknown): Promise<Array<{ channelId: string; enabled: boolean }>> {
  if (!Array.isArray(value)) throw new ValidationError('通知绑定列表格式不正确');
  if (value.length > 100) throw new ValidationError('每个监控最多绑定 100 个通知');
  const bindings: Array<{ channelId: string; enabled: boolean }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('通知绑定格式不正确');
    const record = item as Record<string, unknown>;
    const channelId = textField(record.channelId, '通知配置', 1, 128);
    if (seen.has(channelId)) throw new ValidationError('通知配置不能重复');
    seen.add(channelId);
    if (typeof record.enabled !== 'boolean') throw new ValidationError('通知启用状态必须是布尔值');
    bindings.push({ channelId, enabled: record.enabled });
  }
  if (!bindings.length) return [];
  const placeholders = bindings.map((_, index) => `?${index + 1}`).join(', ');
  const { results } = await env.DB
    .prepare(`SELECT id FROM notification_channels WHERE id IN (${placeholders})`)
    .bind(...bindings.map((binding) => binding.channelId))
    .all<{ id: string }>();
  if (results.length !== bindings.length) throw new ValidationError('通知配置不存在');
  return bindings;
}

function notificationTokenInput(value: unknown): string {
  return textField(value, '发送密钥', 1, 512);
}

async function requireAdminResponse(c: AppContext): Promise<Response | null> {
  const result = await requireAdmin(c);
  return isResponse(result) ? result : null;
}

async function monitorStatusPageData(env: Env, monitorId: string) {
  const monitor = await getMonitor(env.DB, monitorId);
  if (!monitor) return null;
  const { results } = await env.DB
    .prepare(
      `SELECT r.node_id, r.success, r.latency_ms, r.status_code, r.message, r.resolved_ip, r.checked_at,
              p.country_code, p.country_name, p.city, p.provider
       FROM check_results r
       LEFT JOIN probe_nodes p ON p.id = r.node_id
       WHERE r.monitor_id = ?1
         AND r.id = (
           SELECT r2.id FROM check_results r2
           WHERE r2.monitor_id = r.monitor_id AND r2.node_id = r.node_id
           ORDER BY r2.checked_at DESC LIMIT 1
         )
       ORDER BY COALESCE(p.country_name, ''), COALESCE(p.city, ''), r.node_id`,
    )
    .bind(monitorId)
    .all<{
      node_id: string;
      success: number;
      latency_ms: number | null;
      status_code: number | null;
      message: string | null;
      resolved_ip: string | null;
      checked_at: string;
      country_code: string;
      country_name: string;
      city: string;
      provider: MonitorProvider | null;
    }>();
  const { results: historyRows } = await env.DB
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
       LIMIT 90`,
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
  const history = historyRows.reverse().map((row) => {
    const successes = Number(row.successes || 0);
    const failures = Number(row.failures || 0);
    const status = successes === 0 && failures === 0
      ? 'unknown'
      : failures > successes
        ? 'down'
        : failures > 0
          ? 'degraded'
          : 'up';
    return {
      id: row.id,
      status,
      availability: Number(row.result_count) > 0 ? Number(((successes / Number(row.result_count)) * 100).toFixed(1)) : null,
      checkedAt: row.completed_at || row.created_at,
    };
  });
  const availability = history.length
    ? Number(((history.filter((item) => item.status === 'up').length / history.length) * 100).toFixed(2))
    : null;
  return {
    id: monitor.id,
    name: monitor.name,
    type: monitor.type,
    provider: monitor.provider,
    status: monitor.currentStatus,
    enabled: Boolean(monitor.enabled),
    lastCheckedAt: monitor.lastCheckedAt,
    availability,
    history,
    tags: monitor.tags || [],
    nodes: results.map((result) => {
      return {
        id: result.node_id,
        countryCode: result.country_code || '??',
        countryName: result.country_name || 'Unknown',
        city: result.city || 'Unknown',
        success: Boolean(result.success),
        latencyMs: result.latency_ms,
        statusCode: result.status_code,
        message: result.message,
        checkedAt: result.checked_at,
      };
    }),
  };
}

function statusPageRecord(page: StatusPage) {
  return {
    ...page,
    monitorIds: page.groups.flatMap((group) => group.monitorIds),
  };
}

async function validateMonitorIds(env: Env, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) throw new ValidationError('状态页至少需要一个监控');
  const monitorIds = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  if (!monitorIds.length) throw new ValidationError('状态页至少需要一个监控');
  const placeholders = monitorIds.map((_, index) => `?${index + 1}`).join(', ');
  const { results } = await env.DB
    .prepare(`SELECT id FROM monitors WHERE id IN (${placeholders})`)
    .bind(...monitorIds)
    .all<{ id: string }>();
  if (results.length !== monitorIds.length) throw new ValidationError('状态页包含不存在的监控');
  return monitorIds;
}

type StatusPageGroupInput = {
  name: string;
  monitorIds: string[];
};

async function validateStatusPageGroups(
  env: Env,
  value: unknown,
  fallback: StatusPageGroup[] = [],
): Promise<StatusPageGroupInput[]> {
  let rawGroups: unknown = value;
  if (rawGroups === undefined) {
    rawGroups = fallback.length
      ? fallback.map((group) => ({ name: group.name, monitorIds: group.monitorIds }))
      : [{ name: '服务', monitorIds: [] }];
  }
  if (!Array.isArray(rawGroups) || !rawGroups.length) throw new ValidationError('状态页至少需要一个分组');
  if (rawGroups.length > 40) throw new ValidationError('状态页最多创建 40 个分组');
  const groups: StatusPageGroupInput[] = [];
  const allMonitorIds: string[] = [];
  const names = new Set<string>();
  for (const item of rawGroups) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('状态页分组格式不正确');
    const record = item as Record<string, unknown>;
    const name = textField(record.name, '分组名称', 1, 80);
    const nameKey = name.toLocaleLowerCase();
    if (names.has(nameKey)) throw new ValidationError('状态页分组名称不能重复');
    names.add(nameKey);
    const monitorIdsValue = record.monitorIds === undefined ? [] : record.monitorIds;
    if (!Array.isArray(monitorIdsValue)) throw new ValidationError('分组监控列表格式不正确');
    const monitorIds = [...new Set(monitorIdsValue.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
    if (monitorIds.length > 200) throw new ValidationError('每个分组最多添加 200 个监控');
    groups.push({ name, monitorIds });
    allMonitorIds.push(...monitorIds);
  }
  const uniqueMonitorIds = [...new Set(allMonitorIds)];
  if (uniqueMonitorIds.length !== allMonitorIds.length) throw new ValidationError('同一个监控不能重复加入多个分组');
  if (uniqueMonitorIds.length) {
    const placeholders = uniqueMonitorIds.map((_, index) => `?${index + 1}`).join(', ');
    const { results } = await env.DB
      .prepare(`SELECT id FROM monitors WHERE id IN (${placeholders})`)
      .bind(...uniqueMonitorIds)
      .all<{ id: string }>();
    if (results.length !== uniqueMonitorIds.length) throw new ValidationError('状态页包含不存在的监控');
  }
  return groups;
}

async function parseStatusPageInput(
  env: Env,
  body: Record<string, unknown>,
  existing: StatusPage | null = null,
): Promise<{
  title: string;
  slug: string;
  description: string;
  footer: string;
  refreshSeconds: number;
  theme: ThemeMode;
  showTags: boolean;
  showPoweredBy: boolean;
  lastHeartbeatOnly: boolean;
  rssTitle: string;
  customCss: string;
  groups: StatusPageGroupInput[];
}> {
  const title = textField(body.title === undefined && existing ? existing.title : body.title, '状态页标题', 1, 120);
  const slug = textField(body.slug === undefined && existing ? existing.slug : body.slug, '访问标识', 2, 64).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ValidationError('访问标识只能使用小写字母、数字和短横线');
  const refreshValue = body.refreshSeconds === undefined ? existing?.refreshSeconds || 300 : body.refreshSeconds;
  const refreshSeconds = integerField(refreshValue, '刷新间隔', 30, 86400);
  const groups = body.groups !== undefined
    ? await validateStatusPageGroups(env, body.groups)
    : body.monitorIds !== undefined
      ? [{ name: '服务', monitorIds: await validateMonitorIds(env, body.monitorIds) }]
      : await validateStatusPageGroups(env, undefined, existing?.groups || []);
  return {
    title,
    slug,
    description: optionalTextField(body.description, '状态页描述', 4000, existing?.description || ''),
    footer: optionalTextField(body.footer, '状态页页脚', 4000, existing?.footer || ''),
    refreshSeconds,
    theme: themeField(body.theme, existing?.theme || 'auto'),
    showTags: booleanField(body.showTags, '显示标签', existing?.showTags !== 0),
    showPoweredBy: booleanField(body.showPoweredBy, '显示 Powered By', existing?.showPoweredBy !== 0),
    lastHeartbeatOnly: booleanField(body.lastHeartbeatOnly, '只显示最后一次心跳', existing?.lastHeartbeatOnly === 1),
    rssTitle: optionalTextField(body.rssTitle, 'RSS 标题', 160, existing?.rssTitle || ''),
    customCss: optionalTextField(body.customCss, '自定义 CSS', 12000, existing?.customCss || ''),
    groups,
  };
}

type EntryPageSelection =
  | { type: 'dashboard' }
  | { type: 'status'; slug: string };

const ENTRY_PAGE_SETTING = 'entry_page';

async function resolveEntryPage(db: D1Database): Promise<EntryPageSelection> {
  const value = await getAppSetting(db, ENTRY_PAGE_SETTING);
  if (value === 'dashboard') return { type: 'dashboard' };
  if (value?.startsWith('status:')) {
    const slug = value.slice('status:'.length);
    if (slug === 'home') return { type: 'status', slug: 'home' };
    const page = slug ? await getStatusPageBySlug(db, slug) : null;
    if (page?.enabled) return { type: 'status', slug: page.slug };
  }
  return { type: 'status', slug: 'home' };
}

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, providers: ['worker', 'check-host', 'globalping'] }));

app.get('/api/auth/status', async (c) => {
  const user = await currentAdmin(c);
  return c.json({ setupRequired: (await adminCount(c.env)) === 0, authenticated: Boolean(user), user });
});

app.post('/api/auth/setup', async (c) => {
  if ((await adminCount(c.env)) > 0) return c.json({ error: '管理员已经初始化' }, 409);
  const body = await bodyObject(c);
  const username = textField(body.username, '用户名', 3, 64);
  const password = body.password;
  if (!validPassword(password)) throw new ValidationError('密码长度必须为 8-128 个字符');
  const user = await createAdmin(c.env, username, password);
  await startSession(c, user.id);
  return c.json({ user }, 201);
});

app.post('/api/auth/login', async (c) => {
  const body = await bodyObject(c);
  const username = textField(body.username, '用户名', 1, 64);
  const password = body.password;
  if (typeof password !== 'string') throw new ValidationError('请输入密码');
  const user = await authenticateAdmin(c.env, username, password);
  if (!user) return c.json({ error: '用户名或密码错误' }, 401);
  await startSession(c, user.id);
  return c.json({ user });
});

app.post('/api/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const user = await currentAdmin(c);
  if (!user) return c.json({ error: '需要管理员登录' }, 401);
  return c.json({ user });
});

app.post('/api/auth/password', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const user = await currentAdmin(c);
  if (!user) return c.json({ error: '需要管理员登录' }, 401);
  const body = await bodyObject(c);
  if (!validPassword(body.currentPassword)) throw new ValidationError('当前密码长度必须为 8-128 个字符');
  if (!validPassword(body.newPassword)) throw new ValidationError('新密码长度必须为 8-128 个字符');
  if (body.newPassword !== body.confirmPassword) throw new ValidationError('两次新密码输入不一致');
  if (!(await verifyAdminPassword(c.env, user.id, body.currentPassword))) {
    return c.json({ error: '当前密码不正确' }, 403);
  }
  await updateAdminPassword(c.env, user.id, body.newPassword);
  await endSession(c);
  return c.json({ ok: true });
});

app.post('/api/auth/username', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const user = await currentAdmin(c);
  if (!user) return c.json({ error: '需要管理员登录' }, 401);
  const body = await bodyObject(c);
  const username = textField(body.username, '用户名', 3, 64);
  if (!validPassword(body.currentPassword)) throw new ValidationError('当前密码长度必须为 8-128 个字符');
  if (!(await verifyAdminPassword(c.env, user.id, body.currentPassword))) {
    return c.json({ error: '当前密码不正确' }, 403);
  }
  const existing = await c.env.DB.prepare('SELECT id FROM admin_users WHERE username = ?1').bind(username).first<{ id: string }>();
  if (existing && existing.id !== user.id) return c.json({ error: '用户名已存在' }, 409);
  await updateAdminUsername(c.env, user.id, username);
  return c.json({ user: { ...user, username } });
});

app.get('/api/dashboard', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitors = await listMonitors(c.env.DB);
  const counts = monitors.reduce<Record<string, number>>((accumulator, monitor) => {
    const key = monitor.enabled ? monitor.currentStatus : 'paused';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const { results: recentResults } = await c.env.DB
    .prepare(
      `SELECT r.monitor_id, m.name AS monitor_name, r.node_id, p.city, p.country_name,
              r.success, r.latency_ms, r.status_code, r.message, r.checked_at
       FROM check_results r
       INNER JOIN monitors m ON m.id = r.monitor_id
       LEFT JOIN probe_nodes p ON p.id = r.node_id
       ORDER BY r.checked_at DESC LIMIT 12`,
    )
    .all();
  return c.json({ counts, monitors, recentResults });
});

app.get('/api/nodes', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ nodes: await listProbeNodes(c.env.DB, c.req.query('search') || '') });
});

app.post('/api/nodes/refresh', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const nodes = await fetchNodes();
  if (!nodes.length) return c.json({ error: 'Check-Host 没有返回节点' }, 502);
  const statements = nodes.map((node) =>
    c.env.DB.prepare(
      `INSERT INTO probe_nodes (id, provider, country_code, country_name, city, ip, asn, enabled, last_seen_at)
       VALUES (?1, 'check-host', ?2, ?3, ?4, ?5, ?6, 1, ?7)
       ON CONFLICT(id) DO UPDATE SET
         provider = 'check-host',
         country_code = excluded.country_code,
         country_name = excluded.country_name,
         city = excluded.city,
         ip = excluded.ip,
         asn = excluded.asn,
         enabled = 1,
         last_seen_at = excluded.last_seen_at`,
    ).bind(node.id, node.countryCode, node.countryName, node.city, node.ip, node.asn, node.lastSeenAt),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await c.env.DB.batch(statements.slice(index, index + 50));
  }
  return c.json({ count: nodes.length, nodes: await listProbeNodes(c.env.DB) });
});

app.get('/api/globalping/locations', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ locations: await fetchGlobalpingLocations(c.env.DB) });
});

app.get('/api/tags', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ tags: await listTags(c.env.DB) });
});

app.post('/api/tags', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const body = await bodyObject(c);
  const name = textField(body.name, '标签名称', 1, 40);
  const color = colorField(body.color);
  const existing = await c.env.DB
    .prepare('SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE')
    .bind(name)
    .first<{ id: string }>();
  if (existing) return c.json({ error: '标签名称已存在' }, 409);
  const id = newId();
  const timestamp = nowIso();
  await c.env.DB.prepare(
    'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
  ).bind(id, name, color, timestamp).run();
  const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?1').bind(id).first<{
    id: string;
    name: string;
    color: string;
    created_at: string;
    updated_at: string;
  }>();
  return c.json({ tag }, 201);
});

app.patch('/api/tags/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const tagId = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?1').bind(tagId).first<{
    id: string;
    name: string;
    color: string;
    created_at: string;
    updated_at: string;
  }>();
  if (!current) return c.json({ error: '标签不存在' }, 404);
  const body = await bodyObject(c);
  const name = body.name === undefined ? current.name : textField(body.name, '标签名称', 1, 40);
  const color = colorField(body.color, '标签颜色', current.color);
  const existing = await c.env.DB
    .prepare('SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE AND id != ?2')
    .bind(name, tagId)
    .first<{ id: string }>();
  if (existing) return c.json({ error: '标签名称已存在' }, 409);
  await c.env.DB.prepare('UPDATE tags SET name = ?1, color = ?2, updated_at = ?3 WHERE id = ?4')
    .bind(name, color, nowIso(), tagId)
    .run();
  const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?1').bind(tagId).first<{
    id: string;
    name: string;
    color: string;
    created_at: string;
    updated_at: string;
  }>();
  return c.json({ tag });
});

app.delete('/api/tags/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const result = await c.env.DB.prepare('DELETE FROM tags WHERE id = ?1').bind(c.req.param('id')).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: '标签不存在' }, 404);
});

app.get('/api/notifications', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ channels: await listNotificationChannels(c.env.DB) });
});

app.post('/api/notifications', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const body = await bodyObject(c);
  if (body.type !== undefined && body.type !== 'pushplus') throw new ValidationError('通知类型只能是 PushPlus');
  const name = textField(body.name, '通知名称', 1, 80);
  const token = notificationTokenInput(body.token);
  const defaultEnabled = booleanField(body.defaultEnabled, '默认启用', false);
  const applyToExisting = booleanField(body.applyToExisting, '应用到现有监控', false);
  const id = newId();
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO notification_channels
     (id, type, name, token_plaintext, default_enabled, created_at, updated_at)
     VALUES (?1, 'pushplus', ?2, ?3, ?4, ?5, ?5)`,
  ).bind(id, name, token, defaultEnabled ? 1 : 0, timestamp).run();
  if (applyToExisting) await applyChannelToExistingMonitors(c.env.DB, id, defaultEnabled);
  const channel = (await listNotificationChannels(c.env.DB)).find((item) => item.id === id);
  return c.json({ channel }, 201);
});

app.patch('/api/notifications/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const id = c.req.param('id');
  const current = await getNotificationChannelRow(c.env.DB, id);
  if (!current) return c.json({ error: '通知配置不存在' }, 404);
  const body = await bodyObject(c);
  if (body.type !== undefined && body.type !== 'pushplus') throw new ValidationError('通知类型只能是 PushPlus');
  const name = body.name === undefined ? current.name : textField(body.name, '通知名称', 1, 80);
  let tokenPlaintext = current.token_plaintext;
  if (body.token !== undefined) {
    if (typeof body.token !== 'string') throw new ValidationError('发送密钥必须是文本');
    if (body.token.trim()) tokenPlaintext = notificationTokenInput(body.token);
  }
  const defaultEnabled = booleanField(body.defaultEnabled, '默认启用', current.default_enabled === 1);
  const applyToExisting = booleanField(body.applyToExisting, '应用到现有监控', false);
  await c.env.DB.prepare(
    `UPDATE notification_channels
     SET name = ?1, token_plaintext = ?2, default_enabled = ?3, updated_at = ?4
     WHERE id = ?5`,
  ).bind(name, tokenPlaintext, defaultEnabled ? 1 : 0, nowIso(), id).run();
  if (applyToExisting) await applyChannelToExistingMonitors(c.env.DB, id, defaultEnabled);
  const channel = (await listNotificationChannels(c.env.DB)).find((item) => item.id === id);
  return c.json({ channel });
});

app.delete('/api/notifications/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const result = await c.env.DB.prepare('DELETE FROM notification_channels WHERE id = ?1').bind(c.req.param('id')).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: '通知配置不存在' }, 404);
});

app.post('/api/notifications/:id/test', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  await sendTestNotification(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/monitors/:id/notifications', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitorId = c.req.param('id');
  if (!(await getMonitor(c.env.DB, monitorId))) return c.json({ error: '监控不存在' }, 404);
  return c.json(await getMonitorNotificationSettings(c.env.DB, monitorId));
});

app.put('/api/monitors/:id/notifications', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitorId = c.req.param('id');
  if (!(await getMonitor(c.env.DB, monitorId))) return c.json({ error: '监控不存在' }, 404);
  const body = await bodyObject(c);
  const current = await getMonitorNotificationSettings(c.env.DB, monitorId);
  const bindings = await notificationBindingsInput(c.env, body.bindings);
  const rule = notificationRuleInput(body.rule, current.rule);
  await saveMonitorNotificationSettings(c.env.DB, monitorId, bindings, rule);
  return c.json(await getMonitorNotificationSettings(c.env.DB, monitorId));
});

app.get('/api/monitors', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const search = (c.req.query('search') || '').trim().toLocaleLowerCase();
  const status = c.req.query('status') || '';
  const tagId = c.req.query('tagId') || '';
  if (status && !['up', 'degraded', 'down', 'unknown', 'paused'].includes(status)) {
    throw new ValidationError('状态筛选值不正确');
  }
  let monitors = await listMonitors(c.env.DB);
  if (search) {
    monitors = monitors.filter((monitor) => [
      monitor.name,
      monitor.targetUrl || '',
      monitor.host || '',
      ...(monitor.tags || []).map((tag) => tag.name),
    ].some((value) => value.toLocaleLowerCase().includes(search)));
  }
  if (status) {
    monitors = monitors.filter((monitor) => (monitor.enabled ? monitor.currentStatus : 'paused') === status);
  }
  if (tagId) monitors = monitors.filter((monitor) => (monitor.tags || []).some((tag) => tag.id === tagId));
  if (c.req.query('includeHistory') === '1') {
    monitors = await Promise.all(monitors.map(async (monitor) => ({
      ...monitor,
      history: await listHeartbeatSummaries(c.env.DB, monitor.id),
    })));
  }
  return c.json({ monitors, tags: await listTags(c.env.DB) });
});

app.post('/api/monitors', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const settings = await getSystemSettings(c.env.DB);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM monitors').first<{ count: number }>();
  if (Number(count?.count || 0) >= settings.maxMonitors) throw new ValidationError(`当前最多支持 ${settings.maxMonitors} 个监控`);
  const input = await parseMonitorInput(c.env, await bodyObject(c));
  const id = newId();
  const timestamp = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO monitors
       (id, name, type, provider, http_method, target_url, request_headers, request_body,
        expected_status_codes, response_keyword, timeout_seconds, host, port, interval_seconds,
        globalping_locations, enabled, current_status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'unknown', ?17, ?17)`,
    ).bind(
      id,
      input.name,
      input.type,
      input.provider,
      input.httpMethod,
      input.targetUrl || null,
      JSON.stringify(input.requestHeaders || {}),
      input.requestBody || null,
      JSON.stringify(input.expectedStatusCodes || []),
      input.responseKeyword || null,
      input.timeoutSeconds || 10,
      input.host || null,
      input.port || null,
      input.intervalSeconds || 60,
      input.globalpingLocations.length ? JSON.stringify(input.globalpingLocations) : null,
      input.enabled ? 1 : 0,
      timestamp,
    ),
    ...input.nodeIds.map((nodeId) =>
      c.env.DB.prepare('INSERT INTO monitor_nodes (monitor_id, node_id) VALUES (?1, ?2)').bind(id, nodeId),
    ),
    ...input.tagIds.map((tagId) =>
      c.env.DB.prepare('INSERT INTO monitor_tags (monitor_id, tag_id) VALUES (?1, ?2)').bind(id, tagId),
    ),
  ]);
  await applyDefaultNotificationsToMonitor(c.env.DB, id);
  return c.json({ monitor: await getMonitor(c.env.DB, id) }, 201);
});

app.get('/api/monitors/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitor = await getMonitor(c.env.DB, c.req.param('id'));
  return monitor ? c.json({ monitor }) : c.json({ error: '监控不存在' }, 404);
});

app.patch('/api/monitors/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitorId = c.req.param('id');
  if (!(await getMonitor(c.env.DB, monitorId))) return c.json({ error: '监控不存在' }, 404);
  const body = await bodyObject(c);
  if (Object.keys(body).every((key) => key === 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled 必须是布尔值');
    const timestamp = nowIso();
    await c.env.DB.prepare(
      `UPDATE monitors
       SET enabled = ?1, current_status = CASE WHEN ?1 = 1 THEN 'unknown' ELSE 'paused' END, updated_at = ?2
       WHERE id = ?3`,
    ).bind(body.enabled ? 1 : 0, timestamp, monitorId).run();
    return c.json({ monitor: await getMonitor(c.env.DB, monitorId) });
  }
  const input = await parseMonitorInput(c.env, body);
  const timestamp = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE monitors
       SET name = ?1, type = ?2, provider = ?3, http_method = ?4, target_url = ?5,
           request_headers = ?6, request_body = ?7, expected_status_codes = ?8,
           response_keyword = ?9, timeout_seconds = ?10, host = ?11, port = ?12,
           interval_seconds = ?13, globalping_locations = ?14, enabled = ?15,
           current_status = CASE WHEN ?15 = 1 THEN 'unknown' ELSE 'paused' END, updated_at = ?16
       WHERE id = ?17`,
    ).bind(
      input.name,
      input.type,
      input.provider,
      input.httpMethod,
      input.targetUrl || null,
      JSON.stringify(input.requestHeaders || {}),
      input.requestBody || null,
      JSON.stringify(input.expectedStatusCodes || []),
      input.responseKeyword || null,
      input.timeoutSeconds || 10,
      input.host || null,
      input.port || null,
      input.intervalSeconds || 60,
      input.globalpingLocations.length ? JSON.stringify(input.globalpingLocations) : null,
      input.enabled ? 1 : 0,
      timestamp,
      monitorId,
    ),
    c.env.DB.prepare('DELETE FROM monitor_nodes WHERE monitor_id = ?1').bind(monitorId),
    ...input.nodeIds.map((nodeId) =>
      c.env.DB.prepare('INSERT INTO monitor_nodes (monitor_id, node_id) VALUES (?1, ?2)').bind(monitorId, nodeId),
    ),
    c.env.DB.prepare('DELETE FROM monitor_tags WHERE monitor_id = ?1').bind(monitorId),
    ...input.tagIds.map((tagId) =>
      c.env.DB.prepare('INSERT INTO monitor_tags (monitor_id, tag_id) VALUES (?1, ?2)').bind(monitorId, tagId),
    ),
  ]);
  return c.json({ monitor: await getMonitor(c.env.DB, monitorId) });
});

app.delete('/api/monitors/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const result = await c.env.DB.prepare('DELETE FROM monitors WHERE id = ?1').bind(c.req.param('id')).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: '监控不存在' }, 404);
});

app.post('/api/monitors/:id/check-now', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const result = await startMonitorJob(c.env, c.req.param('id'));
  if (result.error) return c.json({ error: result.error, jobId: result.jobId }, 409);
  return c.json({ ok: true, jobId: result.jobId }, 202);
});

app.get('/api/monitors/:id/results', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitorId = c.req.param('id');
  if (!(await getMonitor(c.env.DB, monitorId))) return c.json({ error: '监控不存在' }, 404);
  const limit = Number.parseInt(c.req.query('limit') || '100', 10);
  const results = await listResults(c.env.DB, monitorId, Number.isFinite(limit) ? limit : 100);
  return c.json({ results });
});

async function clearMonitorHistory(env: Env, monitorId?: string): Promise<number> {
  const statement = monitorId
    ? env.DB.prepare(
        `DELETE FROM check_jobs
         WHERE monitor_id = ?1 AND state != 'pending'`,
      ).bind(monitorId)
    : env.DB.prepare("DELETE FROM check_jobs WHERE state != 'pending'");
  const result = await statement.run();
  return result.meta.changes || 0;
}

app.delete('/api/monitors/:id/history', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const monitorId = c.req.param('id');
  if (!(await getMonitor(c.env.DB, monitorId))) return c.json({ error: '监控不存在' }, 404);
  return c.json({ ok: true, deletedJobs: await clearMonitorHistory(c.env, monitorId) });
});

app.delete('/api/history', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ ok: true, deletedJobs: await clearMonitorHistory(c.env) });
});

const ADMIN_THEME_SETTING = 'admin_theme';
const HEARTBEAT_POSITION_SETTING = 'heartbeat_position';
const TIME_DISPLAY_SETTING = 'time_display';
const HISTORY_RETENTION_SETTING = 'history_retention_days';

function setAppSettingStatement(db: D1Database, key: string, value: string, timestamp: string) {
  return db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, timestamp);
}

async function readAdminSettings(db: D1Database) {
  const [theme, heartbeatPosition, timeDisplay, system] = await Promise.all([
    getAppSetting(db, ADMIN_THEME_SETTING),
    getAppSetting(db, HEARTBEAT_POSITION_SETTING),
    getAppSetting(db, TIME_DISPLAY_SETTING),
    getSystemSettings(db),
  ]);
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto' as ThemeMode,
    heartbeatPosition: heartbeatPosition === 'top' ? 'top' : 'bottom' as HeartbeatPosition,
    timeDisplay: timeDisplay === 'absolute' ? 'absolute' : 'relative' as TimeDisplay,
    historyRetentionDays: system.historyRetentionDays,
    maxMonitors: system.maxMonitors,
    maxNodesPerMonitor: system.maxNodesPerMonitor,
    maxJobsPerTick: system.maxJobsPerTick,
    globalpingTokenConfigured: system.globalpingTokenConfigured,
  };
}

app.get('/api/settings/admin', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  return c.json({ settings: await readAdminSettings(c.env.DB) });
});

app.patch('/api/settings/admin', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const body = await bodyObject(c);
  const current = await readAdminSettings(c.env.DB);
  const theme = themeField(body.theme, current.theme);
  const heartbeatPosition = body.heartbeatPosition === undefined ? current.heartbeatPosition : body.heartbeatPosition;
  if (heartbeatPosition !== 'top' && heartbeatPosition !== 'bottom') throw new ValidationError('心跳栏位置不正确');
  const timeDisplay = body.timeDisplay === undefined ? current.timeDisplay : body.timeDisplay;
  if (timeDisplay !== 'relative' && timeDisplay !== 'absolute') throw new ValidationError('时间显示方式不正确');
  const historyRetentionDays = body.historyRetentionDays === undefined
    ? current.historyRetentionDays
    : integerField(body.historyRetentionDays, '历史保留天数', 0, 3650);
  const maxMonitors = body.maxMonitors === undefined ? current.maxMonitors : integerField(body.maxMonitors, '监控上限', 1, 1000);
  const maxNodesPerMonitor = body.maxNodesPerMonitor === undefined ? current.maxNodesPerMonitor : integerField(body.maxNodesPerMonitor, '节点上限', 1, 20);
  const maxJobsPerTick = body.maxJobsPerTick === undefined ? current.maxJobsPerTick : integerField(body.maxJobsPerTick, '每轮任务上限', 1, 100);
  const globalpingToken = body.globalpingToken === undefined
    ? null
    : optionalTextField(body.globalpingToken, 'Globalping Token', 512, '');
  const timestamp = nowIso();
  const statements = [
    setAppSettingStatement(c.env.DB, ADMIN_THEME_SETTING, theme, timestamp),
    setAppSettingStatement(c.env.DB, HEARTBEAT_POSITION_SETTING, heartbeatPosition, timestamp),
    setAppSettingStatement(c.env.DB, TIME_DISPLAY_SETTING, timeDisplay, timestamp),
    setAppSettingStatement(c.env.DB, HISTORY_RETENTION_SETTING, String(historyRetentionDays), timestamp),
    setAppSettingStatement(c.env.DB, 'max_monitors', String(maxMonitors), timestamp),
    setAppSettingStatement(c.env.DB, 'max_nodes_per_monitor', String(maxNodesPerMonitor), timestamp),
    setAppSettingStatement(c.env.DB, 'max_jobs_per_tick', String(maxJobsPerTick), timestamp),
    ...(globalpingToken === null ? [] : [setAppSettingStatement(c.env.DB, 'globalping_token', globalpingToken, timestamp)]),
  ];
  await c.env.DB.batch(statements);
  return c.json({ settings: await readAdminSettings(c.env.DB) });
});

app.get('/api/settings/entry-page', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const pages = [{ slug: 'home', title: '公开状态页（全部启用监控）' }, ...(await listStatusPages(c.env.DB))
    .filter((page) => page.enabled)
    .map((page) => ({ slug: page.slug, title: page.title }))];
  return c.json({ entry: await resolveEntryPage(c.env.DB), pages });
});

app.patch('/api/settings/entry-page', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const body = await bodyObject(c);
  if (body.type === 'dashboard') {
    await setAppSetting(c.env.DB, ENTRY_PAGE_SETTING, 'dashboard');
  } else if (body.type === 'status') {
    const slug = textField(body.slug, '状态页', 2, 64).toLowerCase();
    if (slug === 'home') {
      await setAppSetting(c.env.DB, ENTRY_PAGE_SETTING, 'status:home');
      return c.json({ entry: await resolveEntryPage(c.env.DB) });
    }
    const page = await getStatusPageBySlug(c.env.DB, slug);
    if (!page || !page.enabled) throw new ValidationError('只能选择已发布的状态页');
    await setAppSetting(c.env.DB, ENTRY_PAGE_SETTING, `status:${page.slug}`);
  } else {
    throw new ValidationError('入口页面类型不正确');
  }
  return c.json({ entry: await resolveEntryPage(c.env.DB) });
});

app.get('/api/status-pages', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const pages = await listStatusPages(c.env.DB);
  return c.json({ pages: pages.map(statusPageRecord) });
});

async function runStatementBatches(db: D1Database, statements: ReturnType<D1Database['prepare']>[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

function statusPageGroupStatements(
  db: D1Database,
  pageId: string,
  groups: StatusPageGroupInput[],
  timestamp: string,
) {
  return groups.flatMap((group, groupIndex) => {
    const groupId = newId();
    return [
      db.prepare(
        `INSERT INTO status_page_groups (id, status_page_id, name, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(groupId, pageId, group.name, groupIndex, timestamp),
      ...group.monitorIds.map((monitorId, monitorIndex) =>
        db.prepare(
          'INSERT INTO status_page_group_monitors (group_id, monitor_id, sort_order) VALUES (?1, ?2, ?3)',
        ).bind(groupId, monitorId, monitorIndex),
      ),
    ];
  });
}

app.post('/api/status-pages', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const body = await bodyObject(c);
  const input = await parseStatusPageInput(c.env, body);
  const existing = await getStatusPageBySlug(c.env.DB, input.slug);
  if (existing) return c.json({ error: '访问标识已存在' }, 409);
  const id = newId();
  const timestamp = nowIso();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO status_pages
       (id, slug, title, description, footer, refresh_seconds, theme, show_tags, show_powered_by,
        last_heartbeat_only, rss_title, custom_css, enabled, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?13)`,
  ).bind(
    id,
    input.slug,
    input.title,
    input.description,
    input.footer,
    input.refreshSeconds,
    input.theme,
    input.showTags ? 1 : 0,
    input.showPoweredBy ? 1 : 0,
    input.lastHeartbeatOnly ? 1 : 0,
    input.rssTitle,
    input.customCss,
    timestamp,
    ),
  ];
  await runStatementBatches(c.env.DB, [...statements, ...statusPageGroupStatements(c.env.DB, id, input.groups, timestamp)]);
  const page = await getStatusPage(c.env.DB, id);
  return c.json({ page: page ? statusPageRecord(page) : null }, 201);
});

app.patch('/api/status-pages/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const pageId = c.req.param('id');
  const current = await getStatusPage(c.env.DB, pageId);
  if (!current) return c.json({ error: '状态页不存在' }, 404);
  const body = await bodyObject(c);
  if (Object.keys(body).every((key) => key === 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled 必须是布尔值');
    await c.env.DB.prepare('UPDATE status_pages SET enabled = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(body.enabled ? 1 : 0, nowIso(), pageId)
      .run();
  } else {
    const input = await parseStatusPageInput(c.env, body, current);
    const existing = await getStatusPageBySlug(c.env.DB, input.slug);
    if (existing && existing.id !== pageId) return c.json({ error: '访问标识已存在' }, 409);
    const entrySetting = await getAppSetting(c.env.DB, ENTRY_PAGE_SETTING);
    const timestamp = nowIso();
    const statements = [
      c.env.DB.prepare(
        `UPDATE status_pages
         SET slug = ?1, title = ?2, description = ?3, footer = ?4, refresh_seconds = ?5,
             theme = ?6, show_tags = ?7, show_powered_by = ?8, last_heartbeat_only = ?9,
             rss_title = ?10, custom_css = ?11, updated_at = ?12
         WHERE id = ?13`,
      ).bind(
        input.slug,
        input.title,
        input.description,
        input.footer,
        input.refreshSeconds,
        input.theme,
        input.showTags ? 1 : 0,
        input.showPoweredBy ? 1 : 0,
        input.lastHeartbeatOnly ? 1 : 0,
        input.rssTitle,
        input.customCss,
        timestamp,
        pageId,
      ),
      c.env.DB.prepare('DELETE FROM status_page_monitors WHERE status_page_id = ?1').bind(pageId),
      c.env.DB.prepare('DELETE FROM status_page_groups WHERE status_page_id = ?1').bind(pageId),
    ];
    await runStatementBatches(c.env.DB, [...statements, ...statusPageGroupStatements(c.env.DB, pageId, input.groups, timestamp)]);
    if (entrySetting === `status:${current.slug}` && input.slug !== current.slug) {
      await setAppSetting(c.env.DB, ENTRY_PAGE_SETTING, `status:${input.slug}`);
    }
  }
  const page = await getStatusPage(c.env.DB, pageId);
  return c.json({ page: page ? statusPageRecord(page) : null });
});

app.delete('/api/status-pages/:id', async (c) => {
  const auth = await requireAdminResponse(c);
  if (auth) return auth;
  const result = await c.env.DB.prepare('DELETE FROM status_pages WHERE id = ?1').bind(c.req.param('id')).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: '状态页不存在' }, 404);
});

async function publicStatusData(env: Env, page: StatusPage) {
  const monitorIds = page.groups.flatMap((group) => group.monitorIds);
  const monitorEntries = await Promise.all(monitorIds.map(async (monitorId) => [
    monitorId,
    await monitorStatusPageData(env, monitorId),
  ] as const));
  const monitorMap = new Map(monitorEntries.filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])));
  const monitors = monitorIds
    .map((monitorId) => monitorMap.get(monitorId))
    .filter((monitor): monitor is NonNullable<typeof monitor> => Boolean(monitor));
  const groups = page.groups.map((group) => ({
    id: group.id,
    name: group.name,
    sortOrder: group.sortOrder,
    monitors: group.monitorIds
      .map((monitorId) => monitorMap.get(monitorId))
      .filter((monitor): monitor is NonNullable<typeof monitor> => Boolean(monitor)),
  }));
  return { page, groups, monitors, generatedAt: nowIso() };
}

app.get('/api/public/status/:slug', async (c) => {
  const page = await getStatusPageBySlug(c.env.DB, c.req.param('slug'));
  if (!page || !page.enabled) return c.json({ error: '状态页不存在' }, 404);
  return c.json(await publicStatusData(c.env, page));
});

app.get('/api/public/home', async (c) => {
  const monitors = await listMonitors(c.env.DB);
  const publicMonitors = (await Promise.all(
    monitors.filter((monitor) => monitor.enabled).map((monitor) => monitorStatusPageData(c.env, monitor.id)),
  )).filter(Boolean);
  return c.json({
    page: {
      title: '服务状态',
      slug: 'home',
      description: '',
      footer: '',
      refreshSeconds: 300,
      theme: 'auto',
      showTags: 1,
      showPoweredBy: 1,
      lastHeartbeatOnly: 0,
      rssTitle: '服务状态',
      customCss: '',
      enabled: 1,
    },
    groups: [{ id: 'home', name: '服务', sortOrder: 0, monitors: publicMonitors }],
    monitors: publicMonitors,
    generatedAt: nowIso(),
  });
});

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.get('/status/:slug/rss.xml', async (c) => {
  const page = await getStatusPageBySlug(c.env.DB, c.req.param('slug'));
  if (!page || !page.enabled) return c.text('状态页不存在', 404);
  const data = await publicStatusData(c.env, page);
  const baseUrl = new URL(c.req.url).origin;
  const title = page.rssTitle || page.title;
  const items = data.monitors.map((monitor) => {
    const checkedAt = monitor.lastCheckedAt || data.generatedAt;
    const status = monitor.enabled ? monitor.status : 'paused';
    return `<item><title>${xmlEscape(`${monitor.name} · ${statusLabel(status)}`)}</title><description>${xmlEscape(`${statusLabel(status)}，最近检查于 ${checkedAt}`)}</description><pubDate>${xmlEscape(new Date(checkedAt).toUTCString())}</pubDate><guid isPermaLink="false">${xmlEscape(`${page.slug}:${monitor.id}:${checkedAt}`)}</guid><link>${xmlEscape(`${baseUrl}/status/${encodeURIComponent(page.slug)}`)}</link></item>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(title)}</title><description>${xmlEscape(page.description || page.title)}</description><link>${xmlEscape(`${baseUrl}/status/${encodeURIComponent(page.slug)}`)}</link><lastBuildDate>${xmlEscape(new Date(data.generatedAt).toUTCString())}</lastBuildDate>${items}</channel></rss>`;
  return new Response(xml, {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
});

app.get('/', async (c) => {
  const entry = await resolveEntryPage(c.env.DB);
  if (entry.type === 'status' && entry.slug === 'home') return c.env.ASSETS.fetch(c.req.raw);
  return c.redirect(entry.type === 'status' ? `/status/${encodeURIComponent(entry.slug)}` : '/admin', 302);
});
app.onError((error, c) => {
  console.error(error);
  if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
  return c.json({ error: '服务器内部错误' }, 500);
});

app.notFound((c) => c.req.path.startsWith('/api/')
  ? c.json({ error: '接口不存在' }, 404)
  : c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduler(env));
  },
};
